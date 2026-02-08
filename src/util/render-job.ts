import {
    AudioSampleSink,
    AudioSampleSource,
    EncodedAudioPacketSource,
    EncodedPacketSink,
    Mp4OutputFormat,
    Output,
    StreamTarget,
    VideoSample,
    VideoSampleSource,
    WebMOutputFormat,
    AudioSource,
    getEncodableAudioCodecs,
    getEncodableVideoCodecs,
    registerEncoder,
} from 'mediabunny';
import type {PipelineSettings} from './media-player';
import EffectWorkerPool, {getRotation} from './effect-worker-pool';
import Queue from './queue';
import {TypedEvent, TypedEventTarget} from './typed-events';
import {AppVideoCodec} from '../app-state';
import {WrappedInput} from './still-image-media';
import AACEncoder from './aac-codec';

export type RenderJobSettings = {
    videoCodec: AppVideoCodec,
    videoBitrate: number,
    effectSettings: PipelineSettings,
    stillImageFrameRate: number,
    stillImageDuration: number,
};

export type RenderJobState =
    | {state: 'waiting'}
    | {state: 'rendering'}
    // The file is present for OPFS render jobs, since those require the output file to be saved by the user
    | {state: 'completed', time: number, file: File | null}
    | {state: 'cancelled', reason: unknown}
    | {state: 'error', error: unknown};

export class StateChangeEvent extends TypedEvent<'statechange'> {
    state: RenderJobState;

    constructor(state: RenderJobState) {
        super('statechange');
        this.state = state;
    }
}

registerEncoder(AACEncoder);

export const supportedCodecsForVideo = getEncodableVideoCodecs(['avc', 'vp8', 'vp9', 'av1'])
    .then(codecs => new Set(codecs));
export const supportedCodecsForAudio = getEncodableAudioCodecs(['mp3', 'aac', 'opus', 'vorbis'])
    .then(codecs => new Set(codecs));

export default class RenderJob extends TypedEventTarget<ProgressEvent | StateChangeEvent | ErrorEvent> {
    private _state: RenderJobState = {state: 'waiting'};
    private _completionPromise: Promise<void>;
    private _startTime: number = Date.now();
    readonly sourceFileName: string;
    readonly videoCodec: AppVideoCodec;
    readonly destination: FileSystemFileHandle;
    readonly isOPFS: boolean;

    private etaInfo: {
        progress: number;
        time: number;
        avgProgress: number;
        avgTime: number;
        discards: number;
        window: number;
    } | null = null;

    private abortController: AbortController = new AbortController();
    private input: Promise<WrappedInput>;
    private output: Output | null = null;

    constructor(
        source: Blob,
        sourceFileName: string,
        destination: FileSystemFileHandle,
        workerPool: Promise<EffectWorkerPool>,
        settings: RenderJobSettings,
        isOPFS: boolean,
    ) {
        super();
        this.destination = destination;
        this.sourceFileName = sourceFileName;
        this.isOPFS = isOPFS;
        this.videoCodec = settings.videoCodec;
        const inputPromise = WrappedInput.create(source, {
            stillImageFrameRate: settings.stillImageFrameRate,
            stillImageDuration: settings.stillImageDuration,
        });
        this.input = inputPromise;

        const signal = this.abortController.signal;

        const completionPromise = async() => {
            const input = await inputPromise;
            const duration = input.duration;
            if (duration === null || duration === Infinity) {
                throw new Error('Input has no duration');
            }
            const effectPool = await workerPool;

            let outputFormat;
            switch (settings.videoCodec) {
                case 'avc':
                    outputFormat = new Mp4OutputFormat();
                    break;
                default:
                    outputFormat = new WebMOutputFormat();
                    break;
            }

            const writable = await destination.createWritable();
            const target = new StreamTarget(writable, {chunked: true});
            const output = new Output({
                format: outputFormat,
                target,
            });
            this.output = output;

            if (signal.aborted) return;

            const audioEncoders: (() => Promise<void>)[] = [];

            let sourceSettings = null;
            if (input.audioTracks.length > 0) {
                const supported = await supportedCodecsForAudio;
                switch (settings.videoCodec) {
                    case 'avc':
                        if (supported.has('aac')) {
                            sourceSettings = {codec: 'aac', bitrate: 128 * 1000} as const;
                            break;
                        }
                        if (supported.has('mp3')) {
                            sourceSettings = {codec: 'mp3', bitrate: 256 * 1000} as const;
                            break;
                        }
                        break;
                    case 'vp8':
                    case 'vp9':
                    case 'av1':
                        if (supported.has('opus')) {
                            sourceSettings = {codec: 'opus', bitrate: 128 * 1000} as const;
                            break;
                        }
                        if (supported.has('vorbis')) {
                            sourceSettings = {codec: 'vorbis', bitrate: 256 * 1000} as const;
                            break;
                        }
                        break;
                };
            }

            for (const audioTrack of input.audioTracks) {
                let audioSource: AudioSource;
                if (
                    (
                        outputFormat.fileExtension === '.mp4' &&
                        (audioTrack.codec === 'aac' || audioTrack.codec === 'mp3')
                    ) ||
                    (
                        outputFormat.fileExtension === '.webm' &&
                        (audioTrack.codec === 'opus' || audioTrack.codec === 'vorbis')
                    )
                ) {
                    // We can pass through some audio codecs
                    audioSource = new EncodedAudioPacketSource(audioTrack.codec);
                    audioEncoders.push(async() => {
                        const audioSink = new EncodedPacketSink(audioTrack);
                        const config = {
                            decoderConfig: (await audioTrack.getDecoderConfig()) ?? undefined,
                        };
                        for await (const audioPacket of audioSink.packets()) {
                            if (signal.aborted) break;
                            await (audioSource as EncodedAudioPacketSource).add(audioPacket, config);
                            if (signal.aborted) break;
                        }
                    });
                } else {
                    if (!sourceSettings) {
                        this.abortController.abort();
                        throw new DOMException(
                            'This browser doesn\'t support any audio codecs for the requested output format.\n' +
                            'Try a different format.',

                            'NotSupportedError',
                        );
                    }
                    audioSource = new AudioSampleSource(sourceSettings);
                    audioEncoders.push(async() => {
                        const audioSink = new AudioSampleSink(audioTrack);
                        for await (const sample of audioSink.samples()) {
                            if (signal.aborted) {
                                sample.close();
                                break;
                            }
                            try {
                                await (audioSource as AudioSampleSource).add(sample);
                            } finally {
                                sample.close();
                            }
                            if (signal.aborted) break;
                        }
                    });
                }
                output.addAudioTrack(audioSource, {
                    languageCode: audioTrack.languageCode,
                    name: audioTrack.name ?? undefined,
                    disposition: audioTrack.disposition,
                });
            }

            // These are the only ones I can verify work without padding
            const padToEven = !(settings.videoCodec === 'vp8' || settings.videoCodec === 'vp9');
            const videoSampleSource = new VideoSampleSource({
                codec: settings.videoCodec,
                bitrate: settings.videoBitrate,
            });
            const videoSink = input.videoSink;
            const sampleQueue = new Queue<{
                promise: () => Promise<VideoFrame>,
                timestamp: number,
                duration: number,
            }>();

            // TODO: add frameRate metadata?
            output.addVideoTrack(videoSampleSource);

            let waker: (() => void) | null = null as (() => void) | null;
            let done = false;
            const frameProducer = async() => {
                let frameNum = 0;
                for await (const frame of videoSink.samples()) {
                    if (signal.aborted) {
                        frame.close();
                        break;
                    }
                    const videoFrame = frame.toVideoFrame();
                    const timestamp = frame.timestamp;
                    const duration = frame.duration;
                    frame.close();
                    const getFrame = await effectPool.processFrame({
                        frame: videoFrame,
                        rotation: getRotation(frame.rotation),
                        frameNum,
                        padToEven,
                        ...settings.effectSettings,
                    }, 'videoframe');
                    if (signal.aborted) {
                        void getFrame().then(frame => frame.close());
                        break;
                    }
                    sampleQueue.pushBack({
                        promise: getFrame,
                        timestamp,
                        duration,
                    });
                    if (waker) {
                        waker();
                        waker = null;
                    }
                    frameNum++;
                }
                done = true;
                if (waker) {
                    waker();
                    waker = null;
                }
            };

            const frameConsumer = async() => {
                outer:
                while (true) {
                    let node;
                    while (!(node = sampleQueue.popFront())) {
                        if (done) break outer;
                        await new Promise<void>(resolve => {
                            waker = resolve;
                        });
                    }
                    const effectFrame = await node.promise();
                    if (signal.aborted) {
                        effectFrame.close();
                        break;
                    }

                    const sample = new VideoSample(effectFrame, {
                        timestamp: node.timestamp,
                        duration: node.duration,
                    });
                    try {
                        await videoSampleSource.add(sample);
                    } finally {
                        sample.close();
                    }
                    if (signal.aborted) break;

                    this.updateETA(
                        (node.timestamp + node.duration) / duration,
                        Date.now() / 1000,
                        effectPool.allWorkers.length,
                    );
                    this.dispatchEvent(new ProgressEvent('progress', {
                        lengthComputable: true,
                        loaded: node.timestamp,
                        total: duration,
                    }));
                }

                if (sampleQueue.peekFront()) {
                    if (!signal.aborted) {
                        throw new Error('Video frames left in queue after render. This should not happen.');
                    }
                    for (const sample of sampleQueue.drain()) {
                        void sample.promise().then(frame => frame.close());
                    }
                }
            };

            await output.start();
            if (signal.aborted) return;
            this.changeState({state: 'rendering'});
            this._startTime = Date.now() / 1000;
            const promises = [];
            for (const audioEncoder of audioEncoders) {
                promises.push(audioEncoder());
            }
            promises.push(frameProducer());
            promises.push(frameConsumer());

            await Promise.all(promises);
            if (signal.aborted) return;

            await output.finalize();
            if (signal.aborted) return;
            input.close();
            const file = isOPFS ? await destination.getFile() : null;
            this.changeState({state: 'completed', time: Date.now() / 1000, file});
        };

        this._completionPromise = (async() => {
            try {
                await completionPromise();
            } catch (error) {
                this.abortController.abort(error);
                inputPromise.then(input => input.close(), () => {});
                void this.output?.cancel();
                this.changeState({state: 'error', error});
                throw error;
            }
        })();
    }

    get state() {
        return this._state;
    }

    private changeState(state: RenderJobState) {
        this._state = state;
        this.dispatchEvent(new StateChangeEvent(state));
    }

    private updateETA(progress: number, time: number, pipelineSize: number) {
        if (this.etaInfo === null) {
            this.etaInfo = {
                progress,
                time,
                avgProgress: progress,
                avgTime: time,
                discards: Math.round(pipelineSize * 1.5),
                window: 4,
            };
            return;
        }
        // Discard the first several samples since multithreading means frames get processed in batches, meaning the
        // first several probably all arrive at once
        if (this.etaInfo.discards > 0) {
            this.etaInfo.progress = this.etaInfo.avgProgress = progress;
            this.etaInfo.time = this.etaInfo.avgTime = time;
            this.etaInfo.discards--;
            return;
        }

        // Only update the ETA every half-second
        if (time - this.etaInfo.time < 0.5) return;
        // For the first few counted samples, we perform a simple windowed average instead of an exponential one
        if (this.etaInfo.window > 0) {
            this.etaInfo.progress = progress;
            this.etaInfo.time = time;
            this.etaInfo.window--;
            return;
        }

        const ALPHA = 0.1;
        // Calculating separate averages for the progress and time seems to give better results than calculating the
        // rate and averaging that
        this.etaInfo.avgProgress = (ALPHA * progress) + ((1 - ALPHA) * this.etaInfo.avgProgress);
        this.etaInfo.avgTime = (ALPHA * time) + ((1 - ALPHA) * this.etaInfo.avgTime);
        this.etaInfo.progress = progress;
        this.etaInfo.time = time;
    }

    get eta() {
        if (!this.etaInfo?.avgProgress || !this.etaInfo.avgTime || this.etaInfo.window > 0) return null;
        const avgRate = (this.etaInfo.progress - this.etaInfo.avgProgress) / (this.etaInfo.time - this.etaInfo.avgTime);
        return (1 - this.etaInfo.progress) / avgRate;
    }

    get completionPromise() {
        return this._completionPromise;
    }

    get startTime() {
        return this._startTime;
    }

    cancel(reason?: unknown) {
        this.abortController.abort(reason);
        const cancelPromise = this.output?.cancel() ?? Promise.resolve();
        this.changeState({state: 'cancelled', reason});
        return cancelPromise.then(() =>
            this.input.then(input => input.close(), () => {}),
        );
    }
}
