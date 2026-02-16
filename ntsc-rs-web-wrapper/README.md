# ntsc-rs-web-wrapper

This is the Rust portion of ntsc-rs-web. It currently depends on nightly Rust.

To build it, you'll need the following things:

- Nightly Rust. If you installed Rustup, it should automatically install nightly Rust via `rust-toolchain.toml`.

- The `wasm32-unknown-unknown` target, from:
  ```
  rustup target add wasm32-unknown-unknown
  ```

- `wasm-bindgen`'s CLI. Install it via:
  ```
  cargo install wasm-bindgen-cli
  ```

- `cargo-about` for license information generation. Install it via:
  ```
  cargo install cargo-about
  ```

- The [Binaryen tools](https://github.com/WebAssembly/binaryen), specifically `wasm-opt`.


With those all installed, run `build.sh` in this directory.

## Docker build

If you don't want to install all those dependencies, you can build via Docker. Again in this directory:

```
docker build --output type=local,dest=. --target=export .
```
