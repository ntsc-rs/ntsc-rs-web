import {ALL_FORMATS, AnyIterable, BlobSource, Input, InputAudioTrack, VideoSample, VideoSampleSink} from 'mediabunny';
import {TypedEvent, TypedEventTarget} from './typed-events';

export interface VideoSampleSinkLike {
    getSample(timestamp: number): Promise<VideoSample | null>;
    samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<VideoSample, void, unknown>;
    samplesAtTimestamps(timestamps: AnyIterable<number>): AsyncGenerator<VideoSample | null, void, unknown>;
    close?(): void;
}

export class StillImageSink implements VideoSampleSinkLike {
    private frame: VideoFrame;
    private _frameRate: number;
    private _duration: number;

    constructor(image: CanvasImageSource, frameRate: number, duration: number) {
        this.frame = new VideoFrame(image, {timestamp: 0});
        this._frameRate = frameRate;
        this._duration = duration;
    }

    get frameRate() {
        return this._frameRate;
    }

    set frameRate(frameRate: number) {
        this._frameRate = frameRate;
    }

    getSample(timestamp: number): Promise<VideoSample | null> {
        if (timestamp < 0 || timestamp >= this._duration) return Promise.resolve(null);
        const frameNum = Math.floor(timestamp * this._frameRate);
        const frameStamp = frameNum / this._frameRate;
        const next = (frameNum + 1) / this._frameRate;
        return Promise.resolve(new VideoSample(this.frame.clone(), {
            timestamp: frameStamp,
            duration: next - frameStamp,
        }));
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async *samples(
        startTimestamp: number = 0,
        endTimestamp: number = Infinity,
    ): AsyncGenerator<VideoSample, void, unknown> {
        const frameRate = this._frameRate;
        const start = Math.floor(startTimestamp * frameRate);
        const end = Math.floor(Math.min(endTimestamp, this._duration) * frameRate);
        for (let i = start; i < end; i++) {
            const frameStamp = i / frameRate;
            const next = (i + 1) / frameRate;
            yield new VideoSample(this.frame.clone(), {
                timestamp: frameStamp,
                duration: next - frameStamp,
            });
            if (this._frameRate !== frameRate) {
                return;
            }
        }
    }

    async *samplesAtTimestamps(timestamps: AnyIterable<number>): AsyncGenerator<VideoSample | null, void, unknown> {
        for await (const timestamp of timestamps) {
            yield this.getSample(timestamp);
        }
    }

    close() {
        this.frame.close();
    }
}

export class FrameRateChangeEvent extends TypedEvent<'frameratechange'> {
    readonly frameRate: number;
    constructor(frameRate: number) {
        super('frameratechange');
        this.frameRate = frameRate;
    }
}

export class WrappedInput extends TypedEventTarget<FrameRateChangeEvent> {
    private input: Input | null;
    private _audioTracks: InputAudioTrack[];
    private _videoSampleSink: VideoSampleSinkLike;
    private _frameRate: number | null;

    readonly duration: number | null;
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly isStillImage: boolean;

    private constructor(
        input: Input | null,
        frameRate: number | null,
        duration: number | null,
        audioTracks: InputAudioTrack[],
        videoSampleSink: VideoSampleSinkLike,
        width: number,
        height: number,
        isStillImage: boolean,
    ) {
        super();

        this.input = input;
        this.duration = duration;
        this._audioTracks = audioTracks;
        this._videoSampleSink = videoSampleSink;
        this._frameRate = frameRate;
        this.visibleWidth = width;
        this.visibleHeight = height;
        this.isStillImage = isStillImage;
    }

    static async create(source: Blob, options: {
        calculateFrameRate?: boolean,
        stillImageFrameRate: number,
        stillImageDuration?: number,
    }) {
        if (source.type.startsWith('image/')) {
            const image = await createImageBitmap(source);
            const sink = new StillImageSink(
                image,
                options.stillImageFrameRate,
                options.stillImageDuration ?? Infinity,
            );
            return new WrappedInput(
                null,
                options.stillImageFrameRate,
                options.stillImageDuration ?? null,
                [],
                sink,
                image.width,
                image.height,
                true,
            );
        }
        const input = new Input({
            source: new BlobSource(source),
            formats: ALL_FORMATS,
        });
        const duration = await input.computeDuration();
        const audioTracks = await input.getAudioTracks();
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
            throw new Error('No input video track');
        }

        if (!(await videoTrack.canDecode())) {
            throw new Error('Cannot decode video track. Try another browser?');
        }


        let frameRate = null;
        if (options.calculateFrameRate) {
            // TODO: perform this calculation ourselves to get an idea of whether the video has a variable framerate.
            // Mediabunny only gives us the average framerate :(
            const packetStats = await videoTrack.computePacketStats(100);
            frameRate = packetStats.averagePacketRate;
        }

        const videoSampleSink = new VideoSampleSink(videoTrack);
        return new WrappedInput(
            input,
            frameRate,
            duration,
            audioTracks,
            videoSampleSink,
            videoTrack.codedWidth,
            videoTrack.codedHeight,
            false,
        );
    }

    get audioTracks() {
        return this._audioTracks;
    }

    get frameRate(): number | null {
        return this._frameRate;
    }

    set frameRate(frameRate: number) {
        if (!this.isStillImage || this._frameRate === frameRate) return;
        (this._videoSampleSink as StillImageSink).frameRate = this._frameRate = frameRate;
        this.dispatchEvent(new FrameRateChangeEvent(frameRate));
    }

    get videoSink() {
        return this._videoSampleSink;
    }

    close() {
        this.input?.dispose();
        this._videoSampleSink.close?.();
    }
}
