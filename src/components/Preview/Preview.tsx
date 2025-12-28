import style from './style.module.scss';

import {SETTINGS_LIST, useAppState} from '../../app-state';
import {useCallback, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

const Preview = () => {
    const appState = useAppState();
    const mediaBlobURL = useSignal('foo');
    const canvasAndContext = useRef<{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D} | null>(null);
    const videoElem = useRef<HTMLVideoElement | null>(null);
    const canvasRefCallback = useCallback((canvas: HTMLCanvasElement | null) => {
        if (!canvas) {
            canvasAndContext.current = null;
            return;
        }
        const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: true})!;
        canvasAndContext.current = {canvas, ctx};
    }, []);
    const ntscSettings = useComputed(() => {
        return SETTINGS_LIST.settingsFromJSON(JSON.stringify(appState.settingsAsObject()));
    });
    const timings = useSignal<{totalTime: number, effectTime: number, auxTime: number} | null>(null);
    const yiqBuffer = useRef<Float32Array | null>(null);
    const outputBuffer = useRef<Uint8ClampedArray<ArrayBuffer> | null>(null);
    const frameMetadata = useRef<VideoFrameCallbackMetadata | null>(null);

    const updatePreview = useCallback(() => {
        const metadata = frameMetadata.current;
        if (!metadata) return;
        const canvCtx = canvasAndContext.current;
        if (!canvCtx) return;
        const videoRef = videoElem.current;
        if (!videoRef) return;
        const startTime = performance.now();
        const {canvas, ctx} = canvCtx;

        if (canvas.width !== metadata.width || canvas.height !== metadata.height) {
            canvas.width = metadata.width;
            canvas.height = metadata.height;
        }

        const frameNum = Math.round(metadata.mediaTime * 30);

        let currentYiqBuffer = yiqBuffer.current;
        const yiqBufferLengthNeeded = ntscSettings.value.buf_length_for(
            metadata.width,
            metadata.height,
            frameNum,
        );
        if (
            currentYiqBuffer === null ||
            currentYiqBuffer.length < yiqBufferLengthNeeded ||
            currentYiqBuffer.length >= 2 * yiqBufferLengthNeeded
        ) {
            currentYiqBuffer = yiqBuffer.current = new Float32Array(yiqBufferLengthNeeded);
        }

        let currentOutputBuffer = outputBuffer.current;
        const outputBufferLengthNeeded = metadata.width * metadata.height * 4;
        if (
            currentOutputBuffer === null ||
            currentOutputBuffer.length < outputBufferLengthNeeded ||
            currentOutputBuffer.length >= 2 * outputBufferLengthNeeded
        ) {
            currentOutputBuffer = outputBuffer.current = new Uint8ClampedArray(outputBufferLengthNeeded);
            currentOutputBuffer.fill(255);
        }

        ctx.drawImage(videoRef, 0, 0);
        const imageData = ctx.getImageData(0, 0, metadata.width, metadata.height);
        const startEffectTime = performance.now();
        ntscSettings.value.apply(
            metadata.width,
            metadata.height,
            new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.length),
            currentYiqBuffer.subarray(0, yiqBufferLengthNeeded),
            new Uint8Array(
                currentOutputBuffer.buffer, currentOutputBuffer.byteOffset, outputBufferLengthNeeded),
            frameNum,
        );
        const endEffectTime = performance.now();

        ctx.putImageData(
            new ImageData(
                currentOutputBuffer.subarray(0, outputBufferLengthNeeded),
                metadata.width,
                metadata.height,
            ),
            0,
            0,
        );
        const endTime = performance.now();

        const totalTime = endTime - startTime;
        const effectTime = endEffectTime - startEffectTime;
        const auxTime = totalTime - effectTime;

        timings.value = {totalTime, effectTime, auxTime};
    }, []);

    const blobURL = mediaBlobURL.value;

    const videoRefCallback = useCallback((currentRef: HTMLVideoElement | null) => {
        videoElem.current = currentRef;
        if (!currentRef) return;

        let callbackHandle: number | null = null;
        const frameCallback = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
            frameMetadata.current = metadata;
            updatePreview();
            callbackHandle = currentRef.requestVideoFrameCallback(frameCallback);
        };

        callbackHandle = currentRef.requestVideoFrameCallback(frameCallback);

        return () => {
            if (callbackHandle !== null) currentRef.cancelVideoFrameCallback(callbackHandle);
        };
    }, [blobURL]);

    useSignalEffect(() => {
        const __ = ntscSettings.value;
        updatePreview();
    });

    if (blobURL === null) return null;

    return <div className={style.preview}>
        <video src={blobURL} controls ref={videoRefCallback} />
        <canvas ref={canvasRefCallback} />
        {timings.value ?
            <div>
                <span className={style.timing}>{timings.value.totalTime.toFixed(2).padStart(5, '0')}</span>ms
                (<span className={style.timing}>{timings.value.effectTime.toFixed(2).padStart(5, '0')}</span>ms effect,
                {' '}<span className={style.timing}>{timings.value.auxTime.toFixed(2).padStart(5, '0')}</span>ms other)
            </div> :
            null}
    </div>;
};

export default Preview;
