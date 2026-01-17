import init, {
    NtscSettingsList,
    ResizeFilter,
    NtscEffectBuf,
} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

import {postMessageFromWorker, type MessageFromWorker, type MessageToWorker} from './worker-rpc';
import Queuetex from './async-queue';
import encodePng from './encode-png';

export type RenderFrame = {
    frame: VideoFrame,
    resizeHeight: number | null,
    resizeFilter: ResizeFilter,
    effectEnabled: boolean,
    frameNum: number,
    padToEven: boolean,
    outputRect: {
        top: number,
        right: number,
        bottom: number,
        left: number,
    } | null,
};

export type WorkerSchema =
    | {
        request: {
            name: 'init';
            message: null;
        };
        response: {
            name: 'initialized';
            message: null;
        };
    }
    | {
        request: {
            name: 'render-frame-to-bitmap';
            message: RenderFrame;
        };
        response: {
            name: 'rendered-frame-to-bitmap';
            message: ImageBitmap;
        };
    }
    | {
        request: {
            name: 'render-frame-to-videoframe';
            message: RenderFrame;
        };
        response: {
            name: 'rendered-frame-to-videoframe';
            message: VideoFrame;
        };
    }
    | {
        request: {
            name: 'render-frame-to-png';
            message: RenderFrame;
        };
        response: {
            name: 'rendered-frame-to-png';
            message: Blob;
        };
    }
    | {
        request: {
            name: 'update-settings';
            message: string;
        };
        response: never;
    };

const wasmMutex = new Queuetex(null);
const initPromise = init();
const effectData = initPromise.then(() => {
    return {
        effect: new NtscEffectBuf(),
        settingsList: new NtscSettingsList(),
    };
});

const listener = async(event: MessageEvent) => {
    const message = event.data as MessageToWorker<WorkerSchema>;

    try {
        switch (message.type) {
            case 'init': {
                await effectData;
                postMessageFromWorker<WorkerSchema>({
                    type: 'initialized',
                    message: null,
                    originId: message.id,
                });
                break;
            }
            case 'render-frame-to-bitmap': {
                try {
                    const data = await renderFrame(message.message, 'imagebitmap');
                    postMessageFromWorker<WorkerSchema>({
                        type: 'rendered-frame-to-bitmap',
                        message: data,
                        originId: message.id,
                    }, [data]);
                } finally {
                    message.message.frame.close();
                }
                break;
            }
            case 'render-frame-to-videoframe': {
                try {
                    const data = await renderFrame(message.message, 'videoframe');
                    postMessageFromWorker<WorkerSchema>({
                        type: 'rendered-frame-to-videoframe',
                        message: data,
                        originId: message.id,
                    }, [data]);
                } finally {
                    message.message.frame.close();
                }
                break;
            }
            case 'render-frame-to-png': {
                try {
                    const data = await renderFrame(message.message, 'pngBlob');
                    postMessageFromWorker<WorkerSchema>({
                        type: 'rendered-frame-to-png',
                        message: data,
                        originId: message.id,
                    });
                } finally {
                    message.message.frame.close();
                }
                break;
            }
            case 'update-settings': {
                const {effect, settingsList} = await effectData;
                await wasmMutex.withValue(() => {
                    effect.setEffectSettings(settingsList.settingsFromJSON(message.message));
                });
                break;
            }
            case 'close': {
                removeEventListener('message', listener);
                const {effect, settingsList} = await effectData;
                void wasmMutex.withValue(() => effect.free());
                settingsList.free();
                break;
            }
        }
    } catch (error) {
        postMessage({
            type: 'error',
            message: error,
            originId: message.id,
        } satisfies MessageFromWorker<WorkerSchema>);
    }
};

export type Formats = {
    imagebitmap: ImageBitmap,
    videoframe: VideoFrame,
    pngBlob: Blob,
};

const renderFrame = async<F extends keyof Formats>(
    {frame, resizeHeight, resizeFilter, effectEnabled, frameNum, padToEven, outputRect}: RenderFrame,
    format: F,
): Promise<Formats[F]> => {
    const {effect} = await effectData;
    return await wasmMutex.withValue(async() => {
        const visibleRect = frame.visibleRect!;
        let outputWidth, outputHeight;
        if (resizeHeight !== null) {
            const resizedWidth = Math.round(
                visibleRect.width * resizeHeight /  visibleRect.height);
            outputWidth = resizedWidth;
            outputHeight = resizeHeight;
        } else {
            outputWidth = visibleRect.width;
            outputHeight = visibleRect.height;
        }
        const sourceFrameWasm = effect.inputBuffer(visibleRect.width, visibleRect.height);
        const paddedWidth = padToEven ? outputWidth + (outputWidth % 2) : outputWidth;
        const paddedHeight = padToEven ? outputHeight + (outputHeight % 2) : outputHeight;
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
        await frame.copyTo(sourceFrameWasm, {format: 'RGBX', colorSpace: 'srgb'});
        const rect = outputRect ? {
            top: Math.max(0, Math.min(Math.round(outputRect.top * paddedHeight), paddedHeight)),
            left: Math.max(0, Math.min(Math.round(outputRect.left * paddedWidth), paddedWidth)),
            bottom: Math.max(0, Math.min(Math.round(outputRect.bottom * paddedHeight), paddedHeight)),
            right: Math.max(0, Math.min(Math.round(outputRect.right * paddedWidth), paddedWidth)),
        } : {
            top: 0,
            left: 0,
            bottom: paddedHeight,
            right: paddedWidth,
        };
        rect.bottom = Math.max(rect.bottom, rect.top);
        rect.right = Math.max(rect.right, rect.left);
        const dstFrameWasm = effect.applyEffect(
            frameNum,
            outputWidth,
            outputHeight,
            resizeFilter,
            padToEven,
            effectEnabled,
            rect.top,
            rect.right,
            rect.bottom,
            rect.left,
        );
        const dstFrameClamped = new Uint8ClampedArray(
            dstFrameWasm.buffer as ArrayBuffer,
            dstFrameWasm.byteOffset,
            dstFrameWasm.byteLength,
        );
        switch (format) {
            case 'imagebitmap':
                return await createImageBitmap(new ImageData(dstFrameClamped, paddedWidth, paddedHeight), {
                    premultiplyAlpha: 'none',
                    colorSpaceConversion: 'none',
                }) as Formats[F];
            case 'videoframe':
                return new VideoFrame(dstFrameClamped, {
                    format: 'RGBX',
                    codedWidth: paddedWidth,
                    codedHeight: paddedHeight,
                    timestamp: frame.timestamp,
                    duration: frame.duration ?? undefined,
                }) as Formats[F];
            case 'pngBlob': {
                // We can't just call toBlob on the canvas because, as mentioned above, Firefox randomizes the pixel
                // data slightly before returning it. Instead, we have to ship an entire PNG encoder. Feeling
                // "private" yet?
                const blob = await encodePng(new ImageData(dstFrameClamped, paddedWidth, paddedHeight), false);
                return blob as Formats[F];
            }
        }
    });
};

addEventListener('message', listener);
