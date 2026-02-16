import {AudioCodec, AudioSample, CustomAudioEncoder, EncodedPacket, MaybePromise} from 'mediabunny';
import createAvcodec, {MainModule} from '../../aac-codec/avcodec';

let avcodecPromise: Promise<MainModule> | null = null;

type Ptr = number;

function assertInit(x: unknown): asserts x {
    if (!x) throw new Error('Encoder not initialized');
};

class AACEncoder extends CustomAudioEncoder {
    private encoder: Ptr = 0;
    private avcodec: MainModule | null = null;
    private currentTimestamp: number | null = null;
    private chunkMetadata: EncodedAudioChunkMetadata = {};
    private frameSize = 0;
    private bufferedSamples = 0;

    static supports(codec: AudioCodec, _config: AudioEncoderConfig): boolean {
        // TODO: pass config to wasm to check if we *really* support it, but how to instantiate it? This method needs to
        // be synchronous.
        return codec === 'aac';
    }

    constructor() {
        super();
    }

    async init(): Promise<void> {
        if (!avcodecPromise) avcodecPromise = createAvcodec();
        const avcodec = this.avcodec = await avcodecPromise;

        const encoder = avcodec._aac_encoder_create(
            this.config.bitrate ?? 128000,
            this.config.numberOfChannels,
            this.config.sampleRate,
        );

        if (!encoder) throw new Error(`Failed to create AAC encoder`);

        this.encoder = encoder;
        this.frameSize = avcodec._aac_encoder_get_frame_size(encoder);

        // Get extradata (AudioSpecificConfig) for the decoder config
        const extradataPtr = avcodec._aac_encoder_get_extradata(encoder);
        const extradataSize = avcodec._aac_encoder_get_extradata_size(encoder);
        let description: Uint8Array | undefined;
        if (extradataPtr && extradataSize > 0) {
            description = (avcodec.HEAPU8 as Uint8Array).slice(extradataPtr, extradataPtr + extradataSize);
        }

        this.chunkMetadata = {
            decoderConfig: {
                codec: 'mp4a.40.2',
                numberOfChannels: this.config.numberOfChannels,
                sampleRate: this.config.sampleRate,
                description,
            },
        };
    }

    encode(audioSample: AudioSample): MaybePromise<void> {
        const {avcodec, encoder} = this;
        assertInit(avcodec && encoder);

        if (this.currentTimestamp === null) {
            this.currentTimestamp = audioSample.timestamp;
        }

        if (
            audioSample.numberOfChannels !== this.config.numberOfChannels ||
            audioSample.sampleRate !== this.config.sampleRate) {
            throw new Error('Audio sample config does not match encoder config');
        }

        const totalSamples = audioSample.numberOfFrames;
        let offset = 0;
        while (offset < totalSamples) {
            // Number of samples remaining from input
            const remaining = totalSamples - offset;
            // Number of samples needed to fill the codec frame
            const needed = this.frameSize - this.bufferedSamples;
            // Number of samples we can actually copy
            const toCopy = Math.min(needed, remaining);

            const ptrs = avcodec._aac_encoder_get_frame_ptrs(encoder);
            if (!ptrs) throw new Error(`Failed to get frame pointers`);
            for (let ch = 0, n = this.config.numberOfChannels; ch < n; ch++) {
                const channelPtr = (avcodec.HEAPU32 as Uint32Array)[(ptrs >> 2) + ch];
                const dest = (avcodec.HEAPF32 as Float32Array).subarray(
                    (channelPtr >> 2) + this.bufferedSamples,
                    (channelPtr >> 2) + this.bufferedSamples + toCopy,
                );
                audioSample.copyTo(dest, {
                    format: 'f32-planar',
                    planeIndex: ch,
                    frameOffset: offset,
                    frameCount: toCopy,
                });
            }

            offset += toCopy;
            this.bufferedSamples += toCopy;

            // Frame complete - send it
            if (this.bufferedSamples === this.frameSize) {
                const result = avcodec._aac_encoder_send_frame(encoder);
                if (result < 0) throw new Error(`Failed to send frame (${result})`);
                this.drainPackets();
                this.bufferedSamples = 0;
            }
        }
    }

    /**
     * Drain all available packets from the encoder.
     * Per FFmpeg docs: "Repeat [receive] until it returns AVERROR(EAGAIN)"
     */
    private drainPackets(): void {
        const {avcodec, encoder} = this;
        assertInit(avcodec && encoder);
        if (this.currentTimestamp === null) {
            throw new Error('Invalid encoder state');
        }

        while (true) {
            const result = avcodec._aac_encoder_receive_packet(encoder);
            if (result < 0) throw new Error(`Encoding error (${result})`);

            if (result === 0) {
                // No more packets available (EAGAIN)
                break;
            }

            try {
                // Packet available - extract and emit it
                const dataPtr = avcodec._aac_encoder_get_packet_data(encoder);
                const size = avcodec._aac_encoder_get_packet_size(encoder);
                const packetData = (avcodec.HEAPU8 as Uint8Array).slice(dataPtr, dataPtr + size);
                const duration = avcodec._aac_encoder_get_packet_duration_seconds(encoder);
                this.onPacket(
                    new EncodedPacket(packetData, 'key', this.currentTimestamp, duration),
                    this.chunkMetadata,
                );

                // After the first packet, clear metadata (mimic WebCodecs behavior)
                if (this.chunkMetadata.decoderConfig) {
                    this.chunkMetadata = {};
                }

                this.currentTimestamp += duration;
            } finally {
                // Tell the encoder we've consumed the packet
                avcodec._aac_encoder_packet_consumed(encoder);
            }
        }
    }

    flush(): MaybePromise<void> {
        const {avcodec, encoder} = this;
        assertInit(avcodec && encoder);

        // Begin flush: sends any partial frame and signals EOF
        const result = avcodec._aac_encoder_begin_flush(encoder, this.bufferedSamples);
        if (result < 0) throw new Error(`Failed to begin flush (${result})`);
        this.bufferedSamples = 0;

        // Drain all remaining packets
        this.drainPackets();
    }

    close(): void {
        if (this.avcodec && this.encoder) {
            this.avcodec._aac_encoder_destroy(this.encoder);
            this.encoder = 0;
        }
    }
}

export default AACEncoder;
