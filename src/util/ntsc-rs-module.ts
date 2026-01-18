import init, {setPanicHook} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

// It's important for performance to fetch and compile the WebAssembly module only once. Otherwise, every worker thread
// will make its own uncached fetch request.
export const wasmModulePromise = (async() => {
    const response = await fetch(
        new URL('../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper_bg.wasm', import.meta.url));
    const module = await WebAssembly.compileStreaming(response);
    await init({module_or_path: module});
    setPanicHook();
    return module;
})();
