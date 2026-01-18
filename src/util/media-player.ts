import {
    AudioBufferSink,
    InputAudioTrack,
    VideoSample,
    WrappedAudioBuffer,
} from 'mediabunny';
import {TypedEvent, TypedEventTarget} from './typed-events';
import type {ResizeFilter} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';
import type EffectWorkerPool from './effect-worker-pool';
import Queue from './queue';
import {VideoSampleSinkLike, WrappedInput} from './still-image-media';

export class FrameEvent extends TypedEvent<'frame'> {
    frameTimestamp: number;

    constructor(timestamp: number) {
        super('frame');
        this.frameTimestamp = timestamp;
    }
}

export class CanvasResizeEvent extends TypedEvent<'canvasresize'> {
    width: number;
    height: number;

    constructor(width: number, height: number) {
        super('canvasresize');
        this.width = width;
        this.height = height;
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

class PresentEvent extends TypedEvent<'present'> {
    imageBitmap: ImageBitmap;
    frame: VideoSample;

    constructor(imageBitmap: ImageBitmap, frame: VideoSample) {
        super('present');
        this.imageBitmap = imageBitmap;
        this.frame = frame;
    }
}

class DoneEvent extends TypedEvent<'done'> {
    constructor() {
        super('done');
    }
}

class PresentationNode {
    frame: VideoSample;
    promise: () => Promise<ImageBitmap>;

    constructor(frame: VideoSample, promise: () => Promise<ImageBitmap>) {
        this.frame = frame;
        this.promise  = promise;
    }

    destroy() {
        this.frame.close();
        void this.promise();
    }
}

class PresentationLoop extends TypedEventTarget<PresentEvent | DoneEvent> {
    private atEndOfStream = false;
    constructor(queue: Queue<PresentationNode>, signal: AbortSignal, getPlaybackTime: () => number) {
        super();

        void (async() => {
            outer:
            while (true) {
                // TODO: is it safe to do popFront in the loop condition, or could that modify the presentation queue
                // even if the generation is stale?
                while (!queue.peekFront()) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (signal.aborted || this.atEndOfStream) break outer;
                }

                const node = queue.popFront()!;

                const imageData = await node.promise();
                if (signal.aborted) {
                    node.destroy();
                    break;
                }

                // Pacing: wait until this frame's timestamp matches the playback clock.
                while (node.frame.timestamp > getPlaybackTime()) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (signal.aborted) {
                        node.destroy();
                        break outer;
                    }
                }

                this.dispatchEvent(new PresentEvent(imageData, node.frame));
            }

            if (signal.aborted) return;
            this.dispatchEvent(new DoneEvent());
        })();
    }

    eos() {
        this.atEndOfStream = true;
    }
}

export type PipelineSettings = {
    resizeHeight: number | null;
    resizeFilter: ResizeFilter;
    effectEnabled: boolean;
    effectSettings: Record<string, number | boolean>;
    outputRect: {
        top: number;
        left: number;
        bottom: number;
        right: number;
    } | null;
};

export default class MediaPlayer extends TypedEventTarget<FrameEvent | StateChangeEvent | CanvasResizeEvent> {
    readonly input: WrappedInput;
    private videoSink: VideoSampleSinkLike;
    private audioSink: AudioBufferSink | null;
    private audioContext: AudioContext;
    private gainNode: GainNode;

    private playbackStartTimeGlobal: number | null = null;
    private playbackStartTimeMedia = 0;
    private lastDisplayedFrameTime = 0;

    private queuedAudioNodes = new Set<AudioBufferSourceNode>();
    private audioBufferIterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
    private videoSampleIterator: AsyncGenerator<VideoSample, void, unknown> | null = null;

    private playbackAbortController: AbortController = new AbortController();
    private videoAbortController: AbortController | null = null;
    private currentFrame: VideoSample | null = null;
    private effectPool: EffectWorkerPool;
    private presentationQueue: Queue<PresentationNode> = new Queue();
    private presentationLoop: PresentationLoop | null = null;

    private queuedRender: Promise<void> | null = null;
    private rerenderPending = false;
    private queuedSeekTime: number | null = null;

    private _canvas: {canvas: HTMLCanvasElement, ctx: ImageBitmapRenderingContext} | null = null;

    private pipelineSettings: PipelineSettings;

    private constructor(
        input: WrappedInput,
        audioSink: AudioBufferSink | null,
        audioContext: AudioContext,
        gainNode: GainNode,
        currentFrame: VideoSample | null,
        effectPool: EffectWorkerPool,
        settings: PipelineSettings,
    ) {
        super();
        this.input = input;
        this.videoSink = input.videoSink;
        this.audioSink = audioSink;
        this.audioContext = audioContext;
        this.gainNode = gainNode;
        this.currentFrame = currentFrame;
        this.effectPool = effectPool;
        this.pipelineSettings = settings;
    }

    static async create(
        source: Blob,
        workerPool: Promise<EffectWorkerPool>,
        settings: PipelineSettings,
        stillImageFrameRate: number,
    ) {
        const input = await WrappedInput.create(source, {calculateFrameRate: true, stillImageFrameRate});

        const audioTrack: InputAudioTrack | undefined = input.audioTracks[0];
        const audioContext = new AudioContext({sampleRate: audioTrack?.sampleRate});
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 1.0;

        const audioSink = audioTrack ? new AudioBufferSink(audioTrack) : null;

        const currentFrame = await input.videoSink.getSample(0);
        const effectPool = await workerPool;

        return new MediaPlayer(
            input,
            audioSink,
            audioContext,
            gainNode,
            currentFrame,
            effectPool,
            settings,
        );
    }

    get duration() {
        return this.input.duration;
    }

    get frameRate() {
        return this.input.frameRate!;
    }

    get timestamp() {
        return this.getPlaybackTime();
    }

    get width() {
        return this.input.visibleWidth;
    }

    get height() {
        return this.input.visibleHeight;
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
        return this._canvas?.canvas ?? null;
    }

    set canvas(canvas: HTMLCanvasElement | null) {
        if (canvas) {
            canvas.width = this.input.visibleWidth;
            canvas.height = this.input.visibleHeight;
            const ctx = canvas.getContext('bitmaprenderer', {alpha: false});
            if (!ctx) throw new Error('Canvas was created with a different context');
            this._canvas = {canvas, ctx};
            void this.reRender();
        } else {
            this._canvas = null;
        }
    }

    get effectSettings() {
        return this.pipelineSettings.effectSettings;
    }

    set effectSettings(settings: Record<string, number | boolean>) {
        if (this.pipelineSettings.effectSettings === settings) return;
        this.pipelineSettings.effectSettings = settings;
        void this.reRender();
    }

    get resizeHeight() {
        return this.pipelineSettings.resizeHeight;
    }

    set resizeHeight(height: number | null) {
        if (this.pipelineSettings.resizeHeight === height) return;
        this.pipelineSettings.resizeHeight = height;
        void this.reRender();
    }

    get resizeFilter() {
        return this.pipelineSettings.resizeFilter;
    }

    set resizeFilter(filter: ResizeFilter) {
        if (this.pipelineSettings.resizeFilter === filter) return;
        this.pipelineSettings.resizeFilter = filter;
        void this.reRender();
    }

    get effectEnabled() {
        return this.pipelineSettings.effectEnabled;
    }

    set effectEnabled(enabled: boolean) {
        if (this.pipelineSettings.effectEnabled === enabled) return;
        this.pipelineSettings.effectEnabled = enabled;
        void this.reRender();
    }

    get outputRect() {
        return this.pipelineSettings.outputRect;
    }

    set outputRect(rect: {top: number; right: number; bottom: number; left: number} | null) {
        if (
            this.pipelineSettings.outputRect === rect ||
            (rect !== null && this.pipelineSettings.outputRect !== null &&
                rect.top === this.pipelineSettings.outputRect.top &&
                rect.right === this.pipelineSettings.outputRect.right &&
                rect.bottom === this.pipelineSettings.outputRect.bottom &&
                rect.left === this.pipelineSettings.outputRect.left
            )
        ) {
            return;
        }
        this.pipelineSettings.outputRect = rect;
        void this.reRender();
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
            const ac = this.playbackAbortController;
            const sample = await this.videoSink.getSample(timestamp);
            this.setCurrentFrame(sample);
            // We *could* check if the seek event is outdated after awaiting getSample, but in practice that makes
            // scrubbing appear a lot laggier since most frames never render at all.
            await this.reRender();
            // Another seek event may have occurred in the meantime
            if (ac.signal.aborted || this.queuedSeekTime !== timestamp) {
                return queueSeek();
            }
            this.queuedSeekTime = null;
        };

        await queueSeek();
    }

    async currentFrameAsPNG() {
        const frame = this.currentFrame;
        if (!frame) return;
        const frameNum = this.frameRate * frame.timestamp;
        const getFrame = await this.effectPool.processFrame({
            frame: frame.toVideoFrame(),
            frameNum,
            padToEven: false,
            ...this.pipelineSettings,
        }, 'pngBlob');
        const pngBlob = await getFrame();
        return pngBlob;
    }

    private startPlaying() {
        const ac = this.playbackAbortController;
        const signal = ac.signal;
        if (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted') {
            void this.audioContext.resume();
        }

        // If we're at the end, restart the video from the beginning
        if (this.playbackStartTimeMedia >= (this.input.duration ?? Infinity)) {
            this.playbackStartTimeMedia = 0;
        }

        this.playbackStartTimeGlobal = this.audioContext.currentTime;

        if (this.audioSink) {
            const audioBufferIterator = this.audioSink.buffers(this.playbackStartTimeMedia);
            const runAudioIterator = async() => {
                for await (const {buffer, timestamp} of audioBufferIterator) {
                    const playbackStartTimeGlobal = this.playbackStartTimeGlobal;
                    if (playbackStartTimeGlobal === null || signal.aborted) break;
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

        const presentationLoop = new PresentationLoop(this.presentationQueue, signal, this.getPlaybackTime.bind(this));
        presentationLoop.addEventListener('present', event => {
            if (signal.aborted) {
                event.frame.close();
                return;
            }
            this.setCurrentFrame(event.frame);
            this.presentImage(event.imageBitmap, event.frame, event.frame.timestamp);
        });
        presentationLoop.addEventListener('done', () => {
            this.stopPlaying();
            if (this.input.duration !== null && this.playbackStartTimeMedia < this.input.duration) {
                this.playbackStartTimeMedia = this.input.duration;
                this.dispatchEvent(new FrameEvent(this.input.duration));
            }
        }, {signal, once: true});
        this.presentationLoop = presentationLoop;
        this.startVideoIterator(this.playbackStartTimeMedia, presentationLoop);

        this.dispatchEvent(new StateChangeEvent('playing'));
    }

    private startVideoIterator(timestamp: number, presentationLoop: PresentationLoop) {
        if (!presentationLoop) return;
        this.videoAbortController?.abort();
        this.clearPresentationQueue();
        const playbackSignal = this.playbackAbortController.signal;
        this.videoAbortController = new AbortController();
        const videoSignal = this.videoAbortController.signal;
        const videoSampleIterator = this.videoSink.samples(timestamp);
        const runVideoIterator = async() => {
            for await (const nextFrame of videoSampleIterator) {
                if (playbackSignal.aborted || videoSignal.aborted) {
                    nextFrame.close();
                    break;
                }

                // Drop input frames if we're starting to fall behind
                if (nextFrame.timestamp + (nextFrame.duration * 0.5) < this.getPlaybackTime()) {
                    nextFrame.close();
                    continue;
                }

                const videoFrame = nextFrame.toVideoFrame();
                const frameNum = this.frameRate * nextFrame.timestamp;
                const getFrame = await this.effectPool.processFrame({
                    frame: videoFrame,
                    frameNum,
                    padToEven: false,
                    ...this.pipelineSettings,
                }, 'imagebitmap');
                const node = new PresentationNode(nextFrame, getFrame);
                if (playbackSignal.aborted || videoSignal.aborted) {
                    node.destroy();
                    break;
                }
                this.presentationQueue.pushBack(node);
                //await new Promise(resolve => requestAnimationFrame(resolve));
            }

            if (!(playbackSignal.aborted || videoSignal.aborted)) presentationLoop.eos();
        };
        void runVideoIterator();
        void this.videoSampleIterator?.return();
        this.videoSampleIterator = videoSampleIterator;
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
            node.disconnect();
        }
        this.presentationLoop = null;
        this.videoAbortController = null;
        this.queuedAudioNodes.clear();
        this.playbackAbortController.abort();
        this.playbackAbortController = new AbortController();
        this.clearPresentationQueue();

        this.dispatchEvent(new StateChangeEvent('paused'));
    }

    private getPlaybackTime() {
        if (this.playbackStartTimeGlobal !== null) {
            return this.audioContext.currentTime - this.playbackStartTimeGlobal + this.playbackStartTimeMedia;
        }
        return this.playbackStartTimeMedia;
    }

    private reRender(): Promise<void> | void {
        if (this.presentationLoop) {
            this.startVideoIterator(this.lastDisplayedFrameTime, this.presentationLoop);
            return;
        }
        if (this.queuedRender) {
            this.rerenderPending = true;
            return this.queuedRender;
        }

        this.queuedRender = (async() => {
            if (!this.currentFrame || !this._canvas) {
                this.queuedRender = null;
                return;
            }

            const frame = this.currentFrame;
            const frameNum = this.frameRate * frame.timestamp;
            const getFrame = await this.effectPool.processFrame({
                frame: frame.toVideoFrame(),
                frameNum,
                padToEven: false,
                ...this.pipelineSettings,
            }, 'imagebitmap');
            const imageBitmap = await getFrame();
            this.queuedRender = null;
            if (this.rerenderPending) {
                this.rerenderPending = false;
                return this.reRender();
            }
            // Return early if we started playback in the meantime
            if (this.presentationLoop) return;
            this.presentImage(imageBitmap, frame, frame.timestamp);
            this.dispatchEvent(new FrameEvent(frame.timestamp));
        })();

        return this.queuedRender;
    }

    private setCurrentFrame(currentFrame: VideoSample | null) {
        this.currentFrame?.close();
        this.currentFrame = currentFrame;
        if (currentFrame) {
            this.dispatchEvent(new FrameEvent(currentFrame.timestamp));
        }
    }

    private clearPresentationQueue() {
        for (const node of this.presentationQueue.drain()) {
            // Release the workers back into the pool
            node.destroy();
        }
    }

    private presentImage(imageBitmap: ImageBitmap, sourceFrame: VideoSample, timestamp: number) {
        if (!this._canvas) return;
        const {canvas, ctx} = this._canvas;
        if (canvas.width !== imageBitmap.width || canvas.height !== imageBitmap.height) {
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            this.dispatchEvent(new CanvasResizeEvent(imageBitmap.width, imageBitmap.height));
        }
        // Look at me, I'm a WHATWG committee member and I think allocation and garbage collection are completely free.
        // Buffer swap? Memory pool? What is this, 1995? Just allocate an entirely new backing store each frame and let
        // the garbage collector take care of it!
        ctx.transferFromImageBitmap(imageBitmap);
        this.lastDisplayedFrameTime = timestamp;
    }

    destroy() {
        this.input.close();
        this.setCurrentFrame(null);
        this.clearPresentationQueue();
    }
}
