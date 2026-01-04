#!/bin/bash

set -euo pipefail

# Apply patches
cd FFmpeg
for patch in ../patches/*.patch; do
    patch -p1 -N < "$patch" || true
done

emmake make -j

# Reverse patches to keep submodule clean
for patch in ../patches/*.patch; do
    patch -p1 -R < "$patch" || true
done

cd ..

emcc \
    -s MODULARIZE \
    -s EXPORT_ES6 \
    -s EXPORT_NAME=createAvcodec \
    -s EXPORTED_FUNCTIONS=@avcodec.symbols \
    -s EXPORTED_RUNTIME_METHODS='["wasmMemory", "wasmExports", "stackAlloc", "stackRestore", "stackSave", "HEAPU8", "HEAPU32", "HEAPF32"]' \
    -s INITIAL_MEMORY=4MB \
    -s ALLOW_TABLE_GROWTH \
    -s ALLOW_MEMORY_GROWTH \
    -s MAIN_MODULE=0 \
    -s TEXTDECODER=2 \
    -s DYNAMIC_EXECUTION=0 \
    -s ASSERTIONS=0 \
    -s STANDALONE_WASM=1 \
    -s INCOMING_MODULE_JS_API='[]' \
    -s FILESYSTEM=0 \
    -s ENVIRONMENT=web,worker \
    -o avcodec.js \
    --emit-tsd avcodec.d.ts \
    -I./FFmpeg \
    -Oz \
    -flto \
    -msimd128 \
    --minify=0 \
    --profiling-funcs \
    --no-entry \
    -std=c99 \
    support.c \
    stubs.c \
    -Wl,--wrap=av_opt_set_defaults2 \
    -Wl,--wrap=av_opt_set \
    -Wl,--wrap=av_log_default_callback \
    -Wl,--wrap=av_pix_fmt_desc_get \
    FFmpeg/libavcodec/libavcodec.a \
    FFmpeg/libavutil/libavutil.a
