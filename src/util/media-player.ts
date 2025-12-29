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
import {ResizeFilter} from 'ntsc-rs-web-wrapper';
import EffectWorkerPool from './effect-worker-pool';
import type {RenderFrame} from './effect-worker.worker';

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

type PresentationNode = {
    promise: () => Promise<ImageBitmap | null>;
    timestamp: number;
    duration: number;
    next: PresentationNode;
} | null;

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
    private ctx: ImageBitmapRenderingContext | null = null;
    private effectPool: EffectWorkerPool;
    private maxInFlight: number;
    private presentationHead: PresentationNode = null;
    private presentationTail: PresentationNode = null;
    private presenterPromise: Promise<void> | null = null;
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
        this.maxInFlight = navigator.hardwareConcurrency ?? 1;
        this.effectPool = new EffectWorkerPool(this.maxInFlight);
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
            this.ctx = canvas.getContext('bitmaprenderer', {alpha: false});
            canvas.width = this.videoTrack.codedWidth;
            canvas.height = this.videoTrack.codedHeight;
            void this.queueRender();
        } else {
            this.ctx = null;
        }
    }

    async setEffectSettings(settings: Record<string, number | boolean>) {
        const json = JSON.stringify(settings);
        // Broadcast to all workers; each call returns worker to the pool when done.
        const updates: Promise<unknown>[] = [];
        for (let i = 0; i < this.maxInFlight; i++) {
            updates.push(this.effectPool.getNextWorker().then(run => {
                return run(worker => {
                    worker.sendAndForget('update-settings', json);
                    return Promise.resolve();
                });
            }));
        }
        await Promise.all(updates);
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
            for await (const nextFrame of videoSampleIterator) {
                if (generation !== this.generation) {
                    nextFrame.close();
                    break;
                }

                const getFrame = await this.processFrame(nextFrame, generation);
                if (generation !== this.generation) {
                    void getFrame();
                    break;
                }
                this.enqueueForPresentation(
                    getFrame,
                    nextFrame.timestamp,
                    nextFrame.duration,
                );
                this.ensurePresenter(generation);
            }

            // Drain any remaining frames in flight.
            while (this.presentationHead && generation === this.generation) {
                this.ensurePresenter(generation);
                if (this.presenterPromise) {
                    await this.presenterPromise;
                } else {
                    break;
                }
            }

            if (generation === this.generation) {
                this.stopPlaying();
                if (this.playbackStartTimeMedia < this._duration) {
                    this.playbackStartTimeMedia = this._duration;
                    this.dispatchEvent(new FrameEvent(this._duration));
                }
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
        this.clearPresentationQueue();
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
                requestAnimationFrame(() => {
                    this.renderCurrentFrame().then(resolve, reject);
                });
            });
        }

        return this.queuedRender;
    }

    private async renderCurrentFrame() {
        this.queuedRender = null;
        if (!this.currentFrame || !this._canvas || !this.ctx) return;

        const frame = this.currentFrame;
        const getFrame = await this.processFrame(frame.clone(), this.generation);
        const imageData = await getFrame();
        if (!imageData) return;
        this.presentImage(imageData, frame.timestamp);
    }

    private setCurrentFrame(currentFrame: VideoSample | null) {
        if (this.currentFrame) this.currentFrame.close();
        this.currentFrame = currentFrame;
        if (currentFrame) {
            this.dispatchEvent(new FrameEvent(currentFrame.timestamp));
        }
    }

    private enqueueForPresentation(
        promise: () => Promise<ImageBitmap | null>,
        timestamp: number,
        duration: number,
    ) {
        const node = {promise, timestamp, duration, next: null as PresentationNode};
        if (this.presentationTail) {
            this.presentationTail.next = node;
            this.presentationTail = node;
        } else {
            this.presentationHead = this.presentationTail = node;
        }
    }

    private ensurePresenter(generation: number) {
        if (!this.presentationHead) return;
        if (!this.presenterPromise) {
            this.presenterPromise = this.presentLoop(generation).finally(() => {
                this.presenterPromise = null;
            });
        }
    }

    private async presentLoop(generation: number) {
        while (this.presentationHead && generation === this.generation) {
            const node = this.presentationHead;
            this.presentationHead = node.next;
            if (!node.next) this.presentationTail = null;

            const imageData = await node.promise();

            if (generation !== this.generation) continue;
            if (!imageData) continue;

            // Pacing: wait until this frame's timestamp matches the playback clock.
            while (node.timestamp > this.getPlaybackTime() && generation === this.generation) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
            if (generation !== this.generation) continue;

            this.presentImage(imageData, node.timestamp);
        }
    }

    private clearPresentationQueue() {
        let node;
        while ((node = this.presentationHead)) {
            void node.promise();
            this.presentationHead = node.next;
        }
        this.presentationTail = null;
        this.presenterPromise = null;
    }

    private async processFrame(frame: VideoSample, generation: number): Promise<() => Promise<ImageBitmap | null>> {
        const frameNum = this.frameRate * frame.timestamp;
        const videoFrame = frame.toVideoFrame();
        frame.close();
        const runner = await this.effectPool.getNextWorker<ImageBitmap | null>();
        const payload: RenderFrame = {
            frame: videoFrame,
            resizeHeight: this._resizeHeight,
            resizeFilter: this._resizeFilter,
            effectEnabled: this._effectEnabled,
            frameNum,
        };

        // This is a two-step process. First, we send the frame to the worker to be processed immediately. However, the
        // "runner" callback intentionally does not finish until someone calls the function we return to access the
        // frame. This means that the number of in-flight frames is naturally limited to the number of workers in the
        // pool.
        let release: () => void;
        const waitForRelease = new Promise<void>(resolve => {
            release = resolve;
        });
        const framePromise = runner(async worker => {
            const renderedFrame = await worker.send('render-frame', payload, [videoFrame]);
            await waitForRelease;
            return renderedFrame;
        });

        return () => {
            release();
            return framePromise;
        };
    }

    private presentImage(imageData: ImageBitmap, timestamp: number) {
        if (!this._canvas || !this.ctx) return;
        const canvas = this._canvas;
        const ctx = this.ctx;
        if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
            canvas.width = imageData.width;
            canvas.height = imageData.height;
        }
        ctx.transferFromImageBitmap(imageData);
        this.dispatchEvent(new FrameEvent(timestamp));
    }

    destroy() {
        this.input.dispose();
        this.setCurrentFrame(null);
        this.effectPool.destroy();
    }
}
