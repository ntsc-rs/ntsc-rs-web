import init, {
    NtscSettingsList,
    ResizeFilter,
    NtscEffectBuf,
    Rotation,
    setPanicHook,
} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

import {postMessageFromWorker, type MessageFromWorker, type MessageToWorker} from './worker-rpc';
import Queuetex from './async-queue';
import encodePng from './encode-png';

export type RenderFrame = {
    frame: VideoFrame,
    resizeHeight: number | null,
    resizeFilter: ResizeFilter,
    effectEnabled: boolean,
    rotation: Rotation,
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
            message: {module: WebAssembly.Module};
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
let effectData: Promise<{
    effect: NtscEffectBuf,
    settingsList: NtscSettingsList,
    memory: WebAssembly.Memory,
}> | null = null;

function checkEffectData(effectData: Promise<{
    effect: NtscEffectBuf,
    settingsList: NtscSettingsList,
}> | null): asserts effectData {
    if (effectData === null) throw new Error('Not initialized');
};

const listener = async(event: MessageEvent) => {
    const message = event.data as MessageToWorker<WorkerSchema>;

    try {
        switch (message.type) {
            case 'init': {
                effectData = (async() => {
                    const {memory} = await init({module_or_path: message.message.module});
                    setPanicHook();

                    return {
                        effect: new NtscEffectBuf(),
                        settingsList: new NtscSettingsList(),
                        memory,
                    };
                })();
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
                checkEffectData(effectData);
                const {effect, settingsList} = await effectData;
                await wasmMutex.withValue(() => {
                    effect.setEffectSettings(settingsList.settingsFromJSON(message.message));
                });
                break;
            }
            case 'close': {
                removeEventListener('message', listener);
                checkEffectData(effectData);
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
    {frame, rotation, resizeHeight, resizeFilter, effectEnabled, frameNum, padToEven, outputRect}: RenderFrame,
    format: F,
): Promise<Formats[F]> => {
    checkEffectData(effectData);
    const {effect, memory} = await effectData;
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
        // The rect must be in post-rotation coordinates because the Rust pipeline applies the effect after rotation.
        // 90/270-deg rotations swap width and height.
        const rotationSwaps = rotation === Rotation.Cw90 || rotation === Rotation.Cw270;
        const frameWidth = rotationSwaps ? outputHeight : outputWidth;
        const frameHeight = rotationSwaps ? outputWidth : outputHeight;
        const rect = outputRect ? {
            top: Math.max(0, Math.min(Math.round(outputRect.top * frameHeight), frameHeight)),
            left: Math.max(0, Math.min(Math.round(outputRect.left * frameWidth), frameWidth)),
            bottom: Math.max(0, Math.min(Math.round(outputRect.bottom * frameHeight), frameHeight)),
            right: Math.max(0, Math.min(Math.round(outputRect.right * frameWidth), frameWidth)),
        } : {
            top: 0,
            left: 0,
            bottom: frameHeight,
            right: frameWidth,
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
            rotation,
            rect.top,
            rect.right,
            rect.bottom,
            rect.left,
        );
        const dstFrameClamped = new Uint8ClampedArray(
            memory.buffer,
            dstFrameWasm.ptr,
            dstFrameWasm.len,
        );
        switch (format) {
            case 'imagebitmap':
                return await createImageBitmap(
                    new ImageData(dstFrameClamped, dstFrameWasm.width, dstFrameWasm.height),
                    {
                        premultiplyAlpha: 'none',
                        colorSpaceConversion: 'none',
                    },
                ) as Formats[F];
            case 'videoframe':
                return new VideoFrame(dstFrameClamped, {
                    format: 'RGBX',
                    codedWidth: dstFrameWasm.width,
                    codedHeight: dstFrameWasm.height,
                    timestamp: frame.timestamp,
                    duration: frame.duration ?? undefined,
                }) as Formats[F];
            case 'pngBlob': {
                // We can't just call toBlob on the canvas because, as mentioned above, Firefox randomizes the pixel
                // data slightly before returning it. Instead, we have to ship an entire PNG encoder. Feeling
                // "private" yet?
                const blob = await encodePng(
                    new ImageData(dstFrameClamped, dstFrameWasm.width, dstFrameWasm.height),
                    false, /* encodeAlpha */
                );
                return blob as Formats[F];
            }
        }
    });
};

addEventListener('message', listener);
