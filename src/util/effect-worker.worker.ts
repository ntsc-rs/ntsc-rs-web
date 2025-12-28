import init, {
    NtscSettingsList,
    ResizeFilter,
    NtscEffectBuf,
} from 'ntsc-rs-web-wrapper';

import {postMessageFromWorker, type MessageFromWorker, type MessageToWorker} from './worker-rpc';
import Queuetex from './async-queue';

export type RenderFrame = {
    frame: VideoFrame,
    resizeHeight: number | null,
    resizeFilter: ResizeFilter,
    effectEnabled: boolean,
    frameNum: number,
};

export type WorkerSchema =
    | {
        request: {
            name: 'render-frame';
            message: RenderFrame;
        };
        response: {
            name: 'rendered-frame';
            message: ImageBitmap;
        };
    }
    | {
        request: {
            name: 'update-settings';
            message: string;
        };
        response: never;
    };

const initPromise = init();
const effectData = initPromise.then(() => {
    return {
        effect: new Queuetex(new NtscEffectBuf()),
        settingsList: new NtscSettingsList(),
    };
});

const listener = async(event: MessageEvent) => {
    const message = event.data as MessageToWorker<WorkerSchema>;

    try {
        switch (message.type) {
            case 'render-frame': {
                const data = await renderFrame(message.message);
                postMessageFromWorker<WorkerSchema>({
                    type: 'rendered-frame',
                    message: data,
                    originId: message.id,
                }, [data]);
                break;
            }
            case 'update-settings': {
                const {effect, settingsList} = await effectData;
                await effect.withValue(effect => {
                    effect.setEffectSettings(settingsList.settingsFromJSON(message.message));
                });
                break;
            }
            case 'close': {
                removeEventListener('message', listener);
                const {effect, settingsList} = await effectData;
                void effect.withValue(effect => effect.free());
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

const renderFrame = async({frame, resizeHeight, resizeFilter, effectEnabled, frameNum}: RenderFrame) => {
    const {effect} = await effectData;
    return await effect.withValue(async effect => {
        effect.setInputSize(frame.codedWidth, frame.codedHeight);
        let outputWidth, outputHeight;
        if (resizeHeight !== null) {
            const resizedWidth = Math.round(
                frame.codedWidth * resizeHeight /  frame.codedHeight);
            outputWidth = resizedWidth;
            outputHeight = resizeHeight;
        } else {
            outputWidth = frame.codedWidth;
            outputHeight = frame.codedHeight;
        }
        effect.setResizeFilter(resizeFilter);
        effect.setOutputSize(outputWidth, outputHeight);
        effect.setEffectEnabled(effectEnabled);
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
        await frame.copyTo(sourceFrameWasm, {format: 'RGBX'});
        console.time('applyEffect');
        effect.applyEffect(frameNum);
        console.timeEnd('applyEffect');
        const dstFrameWasm = effect.dstPtr();
        const dstFrameClamped = new Uint8ClampedArray(
            dstFrameWasm.buffer as ArrayBuffer,
            dstFrameWasm.byteOffset,
            dstFrameWasm.byteLength,
        );
        return await createImageBitmap(new ImageData(dstFrameClamped, outputWidth, outputHeight));
    });
};

addEventListener('message', listener);
