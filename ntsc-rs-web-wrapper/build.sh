#!/bin/bash

set -euo pipefail

cargo build --release --target wasm32-unknown-unknown -Zbuild-std=std
wasm-bindgen --target web --out-dir build target/wasm32-unknown-unknown/release/ntsc_rs_web_wrapper.wasm
wasm-opt -O4 build/ntsc_rs_web_wrapper_bg.wasm -o build/ntsc_rs_web_wrapper_bg.wasm
