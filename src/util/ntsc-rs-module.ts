import {relaxedSimd} from 'wasm-feature-detect';
import init from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

// It's important for performance to fetch and compile the WebAssembly module only once. Otherwise, every worker thread
// will make its own uncached fetch request.
export const wasmModulePromise = (async() => {
    const supportsRelaxedSimd = await relaxedSimd();
    const moduleUrl = supportsRelaxedSimd ?
        new URL('../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper_relaxed.wasm', import.meta.url) :
        new URL('../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper_bg.wasm', import.meta.url);


    const response = await fetch(moduleUrl);
    const module = await WebAssembly.compileStreaming(response);
    await init({module_or_path: module});
    return module;
})();
