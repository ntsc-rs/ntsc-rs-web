// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let wasmMemory: any;
    let wasmExports: any;
    function stackAlloc(sz: any): any;
    function stackRestore(val: any): any;
    function stackSave(): any;
    let HEAPU8: any;
    let HEAPU32: any;
    let HEAPF32: any;
}
interface WasmModule {
  _aac_encoder_create(_0: number, _1: number, _2: number): number;
  _aac_encoder_destroy(_0: number): void;
  _aac_encoder_get_frame_size(_0: number): number;
  _aac_encoder_get_frame_ptrs(_0: number): number;
  _aac_encoder_receive_packet(_0: number): number;
  _aac_encoder_send_frame(_0: number): number;
  _aac_encoder_begin_flush(_0: number, _1: number): number;
  _aac_encoder_get_packet_data(_0: number): number;
  _aac_encoder_get_packet_size(_0: number): number;
  _aac_encoder_get_packet_duration_seconds(_0: number): number;
  _aac_encoder_packet_consumed(_0: number): void;
  _aac_encoder_get_extradata(_0: number): number;
  _aac_encoder_get_extradata_size(_0: number): number;
  __initialize(): void;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
