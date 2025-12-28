import {
    ALL_FORMATS,
    AudioBufferSink,
    BlobSource,
    Input,
    InputVideoTrack,
    PacketStats,
    VideoSample,
    VideoSampleSink,
    WrappedAudioBuffer,
} from 'mediabunny';
import {TypedEvent, TypedEventTarget} from './typed-events';
import {NtscEffectBuf, ResizeFilter} from 'ntsc-rs-web-wrapper';
import {SETTINGS_LIST} from '../app-state';
import Queuetex from './async-queue';

export class FrameEvent extends TypedEvent<'frame'> {
    frameTimestamp: number;

    constructor(timestamp: number) {
        super('frame');
        this.frameTimestamp = timestamp;
    }
}

export type MediaPlayerState = 'playing' | 'paused';

export class StateChangeEvent extends TypedEvent<'statechange'> {
    state: MediaPlayerState;

    constructor(state: MediaPlayerState) {
        super('statechange');
        this.state = state;
    }
}

const assertEffect = (effect: NtscEffectBuf | null): NtscEffectBuf => {
    if (!effect) throw new DOMException('MediaPlayer has already been closed', 'InvalidStateError');
    return effect;
};

export default class MediaPlayer extends TypedEventTarget<FrameEvent | StateChangeEvent> {
    private input: Input;
    private videoTrack: InputVideoTrack;
    private videoSink: VideoSampleSink;
    private audioSink: AudioBufferSink | null;
    private packetStats: PacketStats;
    private _duration: number;
    private audioContext: AudioContext;
    private gainNode: GainNode;

    private playbackStartTimeGlobal: number | null = null;
    private playbackStartTimeMedia = 0;
    private queuedAudioNodes = new Set<AudioBufferSourceNode>();
    private audioBufferIterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
    private videoSampleIterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
    private generation = 0;
    private currentFrame: VideoSample | null = null;
    private _canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private ntscEffect: Queuetex<NtscEffectBuf | null>;
    private _resizeHeight: number | null = null;
    private _resizeFilter = ResizeFilter.Bilinear;
    private _effectEnabled = true;
    private queuedRender: Promise<void> | null = null;
    private queuedSeekTime: number | null = null;

    constructor(
        input: Input,
        videoTrack: InputVideoTrack,
        videoSink: VideoSampleSink,
        audioSink: AudioBufferSink | null,
        packetStats: PacketStats,
        duration: number,
        audioContext: AudioContext,
        gainNode: GainNode,
        currentFrame: VideoSample | null,
    ) {
        super();
        this.input = input;
        this.videoTrack = videoTrack;
        this.videoSink = videoSink;
        this.audioSink = audioSink;
        this.packetStats = packetStats;
        this._duration = duration;
        this.audioContext = audioContext;
        this.gainNode = gainNode;
        this.currentFrame = currentFrame;
        this.ntscEffect = new Queuetex(new NtscEffectBuf());
    }

    static async init(source: Blob) {
        const input = new Input({
            source: new BlobSource(source),
            formats: ALL_FORMATS,
        });
        const duration = await input.computeDuration();
        const audioTrack = await input.getPrimaryAudioTrack();
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
            throw new Error('No input video track');
        }

        if (!(await videoTrack.canDecode())) {
            throw new Error('Cannot decode video track');
        }

        const packetStats = await videoTrack.computePacketStats(100);

        const audioContext = new AudioContext({sampleRate: audioTrack?.sampleRate});
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 1.0;

        const videoSink = new VideoSampleSink(videoTrack);
        const audioSink = audioTrack ? new AudioBufferSink(audioTrack) : null;

        const currentFrame = await videoSink.getSample(0);

        return new MediaPlayer(
            input,
            videoTrack,
            videoSink,
            audioSink,
            packetStats,
            duration,
            audioContext,
            gainNode,
            currentFrame,
        );
    }

    get duration() {
        return this._duration;
    }

    get frameRate() {
        return this.packetStats.averagePacketRate;
    }

    get timestamp() {
        return this.getPlaybackTime();
    }

    get width() {
        return this.videoTrack.codedWidth;
    }

    get height() {
        return this.videoTrack.codedHeight;
    }

    get volume() {
        return Math.sqrt(this.gainNode.gain.value);
    }

    set volume(volume: number) {
        this.gainNode.gain.value = volume * volume;
    }

    get hasAudio() {
        return this.audioSink !== null;
    }

    get canvas() {
        return this._canvas;
    }

    set canvas(canvas: HTMLCanvasElement | null) {
        this._canvas = canvas;
        if (canvas) {
            this.ctx = canvas.getContext('2d');
            canvas.width = this.videoTrack.codedWidth;
            canvas.height = this.videoTrack.codedHeight;
            void this.queueRender();
        } else {
            this.ctx = null;
        }
    }

    async setEffectSettings(settings: Record<string, number | boolean>) {
        await this.ntscEffect.withValue(effect => {
            assertEffect(effect).setEffectSettings(SETTINGS_LIST.settingsFromJSON(JSON.stringify(settings)));
        });
        void this.queueRender();
    }

    get resizeHeight() {
        return this._resizeHeight;
    }

    set resizeHeight(height: number | null) {
        this._resizeHeight = height;
        void this.queueRender();
    }

    get resizeFilter() {
        return this._resizeFilter;
    }

    set resizeFilter(filter: ResizeFilter) {
        this._resizeFilter = filter;
        void this.queueRender();
    }

    get effectEnabled() {
        return this._effectEnabled;
    }

    set effectEnabled(enabled: boolean) {
        this._effectEnabled = enabled;
        void this.queueRender();
    }

    get state(): 'playing' | 'paused' {
        return this.playbackStartTimeGlobal === null ? 'paused' : 'playing';
    }

    set state(state: MediaPlayerState) {
        if (this.state === state) return;
        if (state === 'playing') {
            this.startPlaying();
        } else {
            this.stopPlaying();
        }
    }

    async seek(timestamp: number) {
        if (this.state === 'playing') this.stopPlaying();

        if (this.queuedSeekTime !== null) {
            this.queuedSeekTime = timestamp;
            return;
        }

        this.queuedSeekTime = timestamp;
        const queueSeek = async() => {
            const timestamp = this.queuedSeekTime;
            if (timestamp === null) return;
            this.playbackStartTimeMedia = timestamp;
            const generation = this.generation;
            //const start = performance.now();
            const sample = await this.videoSink.getSample(timestamp);
            //const time = performance.now() - start;
            //console.log(`seek: ${time}ms`);
            // Another seek event may have occurred in the meantime
            if (generation !== this.generation || this.playbackStartTimeMedia !== timestamp) {
                sample?.close();
                void queueSeek();
                return;
            }
            this.setCurrentFrame(sample);
            await this.queueRender();
            this.queuedSeekTime = null;
        };

        await queueSeek();
    }

    private startPlaying() {
        if (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted') {
            void this.audioContext.resume();
        }

        // If we're at the end, restart the video from the beginning
        if (this.playbackStartTimeMedia >= this._duration) {
            this.playbackStartTimeMedia = 0;
        }

        this.playbackStartTimeGlobal = this.audioContext.currentTime;
        const generation = this.generation;

        if (this.audioSink) {
            const audioBufferIterator = this.audioSink.buffers(this.playbackStartTimeMedia);
            const runAudioIterator = async() => {
                for await (const {buffer, timestamp} of audioBufferIterator) {
                    const playbackStartTimeGlobal = this.playbackStartTimeGlobal;
                    if (playbackStartTimeGlobal === null || generation !== this.generation) break;
                    const node = this.audioContext.createBufferSource();
                    node.buffer = buffer;
                    node.connect(this.gainNode);

                    const startTimestamp = playbackStartTimeGlobal + timestamp - this.playbackStartTimeMedia;

                    const now = this.audioContext.currentTime;
                    if (startTimestamp >= now) {
                        node.start(startTimestamp);
                    } else {
                        node.start(now, now - startTimestamp);
                    }


                    this.queuedAudioNodes.add(node);
                    node.addEventListener('ended', () => {
                        this.queuedAudioNodes.delete(node);
                    }, {once: true});

                    const bufferedTime = timestamp - this.getPlaybackTime();
                    // Buffer up to 1 second of audio samples to avoid choppy playback
                    const BUFFER_AMOUNT = 1;
                    if (bufferedTime > BUFFER_AMOUNT) {
                        await new Promise(resolve => {
                            setTimeout(resolve, (bufferedTime - BUFFER_AMOUNT) * 1000);
                        });
                    }
                }
            };
            void runAudioIterator();
            this.audioBufferIterator = audioBufferIterator;
        }

        const videoSampleIterator = this.videoSink.samples(this.playbackStartTimeMedia);
        const runVideoIterator = async() => {
            while (true) {
                const nextFrame = (await videoSampleIterator.next()).value;
                if (!nextFrame) {
                    this.stopPlaying();
                    if (this.playbackStartTimeMedia < this._duration) {
                        this.playbackStartTimeMedia = this._duration;
                        this.dispatchEvent(new FrameEvent(this._duration));
                    }
                    break;
                }

                if (nextFrame.timestamp <= this.getPlaybackTime()) {
                    nextFrame.close();
                    continue;
                }

                while (nextFrame.timestamp > this.getPlaybackTime()) {
                    await new Promise(resolve => {
                        requestAnimationFrame(resolve);
                    });
                    if (this.generation !== generation) {
                        nextFrame.close();
                        return;
                    }
                }

                if (this.generation !== generation) {
                    nextFrame.close();
                    return;
                }

                this.setCurrentFrame(nextFrame);
                await this.render();
            }
        };
        void runVideoIterator();
        this.videoSampleIterator = videoSampleIterator;

        this.dispatchEvent(new StateChangeEvent('playing'));
    }

    private stopPlaying() {
        this.playbackStartTimeMedia = this.getPlaybackTime();
        this.playbackStartTimeGlobal = null;
        void this.audioBufferIterator?.return();
        void this.videoSampleIterator?.return();
        this.audioBufferIterator = null;
        this.videoSampleIterator = null;
        for (const node of this.queuedAudioNodes) {
            node.stop();
        }
        this.queuedAudioNodes.clear();
        this.generation++;

        this.dispatchEvent(new StateChangeEvent('paused'));
    }

    private getPlaybackTime() {
        if (this.playbackStartTimeGlobal !== null) {
            return this.audioContext.currentTime - this.playbackStartTimeGlobal + this.playbackStartTimeMedia;
        }
        return this.playbackStartTimeMedia;
    }

    private queueRender() {
        if (!this.queuedRender) {
            this.queuedRender = new Promise((resolve, reject) => {
                queueMicrotask(() => {
                    this.render().then(resolve, reject);
                });
            });
        }

        return this.queuedRender;
    }

    private async render() {
        this.queuedRender = null;
        if (!this.currentFrame || !this._canvas || !this.ctx) {
            return;
        }

        const currentFrame = this.currentFrame;
        const canvas = this._canvas;
        const ctx = this.ctx;
        await this.ntscEffect.withValue(async maybeEffect => {
            const effect = assertEffect(maybeEffect);
            effect.setInputSize(currentFrame.codedWidth, currentFrame.codedHeight);
            let outputWidth, outputHeight;
            if (this._resizeHeight) {
                const resizedWidth = Math.round(
                    currentFrame.codedWidth * this._resizeHeight /  currentFrame.codedHeight);
                outputWidth = resizedWidth;
                outputHeight = this._resizeHeight;
            } else {
                outputWidth = currentFrame.codedWidth;
                outputHeight = currentFrame.codedHeight;
            }
            effect.setResizeFilter(this._resizeFilter);
            effect.setOutputSize(outputWidth, outputHeight);
            effect.setEffectEnabled(this._effectEnabled);
            const sourceFrameWasm = effect.srcPtr();
            // For some stupid reason, this method is async! Why is a simple colorspace conversion async? The committee
            // says so, so it must be! Sync bad, async good! Race conditions are muuuuuch better than two frames of
            // jank! Async good, jank bad! Never mind that the WebAssembly memory might be invalidated by the time we're
            // *finished copying into it* by some other WASM method being called, and the only way to work around this
            // is to disallow *any* other WASM calls while we're busy doing a glorified memcpy asynchronously, or
            // introduce *another* intermediate array copy that the web committees all seem to pretend are completely
            // free. The best part, get this, drawing to a canvas is completely synchronous! Oh, that means we *could*
            // use `getImageData` to do things entirely synchronously, but that results in another intermediate copy and
            // Firefox now RANDOMIZES the pixel data for security-theater reasons. I greatly look forward to debugging a
            // bajillion different race conditions because the committees who design these APIs never have to actually
            // use them.
            await currentFrame.copyTo(sourceFrameWasm, {format: 'RGBX'});
            if (
                currentFrame !== this.currentFrame ||
                !canvas ||
                !ctx ||
                this._canvas !== canvas
            ) return;
            const frameNum = this.frameRate * currentFrame.timestamp;
            console.time('applyEffect');
            effect.applyEffect(frameNum);
            console.timeEnd('applyEffect');
            const dstFrameWasm = effect.dstPtr();
            const dstFrameClamped = new Uint8ClampedArray(
                dstFrameWasm.buffer as ArrayBuffer,
                dstFrameWasm.byteOffset,
                dstFrameWasm.byteLength,
            );
            const imageData = new ImageData(dstFrameClamped, outputWidth, outputHeight);

            if (
                canvas.width !== outputWidth ||
                canvas.height !== outputHeight
            ) {
                canvas.width = outputWidth;
                canvas.height = outputHeight;
            }

            ctx.putImageData(imageData, 0, 0);
        });
    }

    private setCurrentFrame(currentFrame: VideoSample | null) {
        if (this.currentFrame) this.currentFrame.close();
        this.currentFrame = currentFrame;
        if (currentFrame) {
            this.dispatchEvent(new FrameEvent(currentFrame.timestamp));
        }
    }

    destroy() {
        this.input.dispose();
        this.setCurrentFrame(null);
        void this.ntscEffect.withValue(effect => {
            if (effect) {
                effect.free();
                effect = null;
            }
        });
    }
}
