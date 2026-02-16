#!/bin/bash

set -euo pipefail

cargo build --release --target wasm32-unknown-unknown #-Zbuild-std=std
RUSTFLAGS="-Ctarget-feature=+bulk-memory,+simd128,+relaxed-simd" cargo build --profile release-relaxed-simd --target wasm32-unknown-unknown #-Zbuild-std=std
wasm-bindgen --target web --out-dir build --omit-default-module-path target/wasm32-unknown-unknown/release/ntsc_rs_web_wrapper.wasm
wasm-bindgen --target web --out-dir build/relaxed --omit-default-module-path target/wasm32-unknown-unknown/release-relaxed-simd/ntsc_rs_web_wrapper.wasm
wasm-opt -O4 build/ntsc_rs_web_wrapper_bg.wasm -o build/ntsc_rs_web_wrapper_bg.wasm
wasm-opt -O4 build/relaxed/ntsc_rs_web_wrapper_bg.wasm -o build/ntsc_rs_web_wrapper_relaxed_bg.wasm
cargo about generate --format=json -o build/about.json
node gen-settings-list.mjs
cp generated/setting-descriptors.ts build/