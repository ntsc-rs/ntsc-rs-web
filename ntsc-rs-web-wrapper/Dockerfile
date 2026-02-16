# syntax=docker/dockerfile:1

# ===========================================================================
# Multi-stage Dockerfile for ntsc-rs-web-wrapper
#
# Builds the Rust WASM module and generates setting-descriptors.ts.
#
# Usage (from the ntsc-rs-web-wrapper directory):
#   docker build --output type=local,dest=. --target=export .
# ===========================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the Rust WASM module
# ---------------------------------------------------------------------------
FROM rust:bookworm AS wasm-builder

# Install binaryen from GitHub releases, as the Debian-packaged version is too
# old to handle relaxed-SIMD instructions.
ARG BINARYEN_VERSION=126
RUN curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
    | tar -xz -C /usr/local --strip-components=1

WORKDIR /build/ntsc-rs-web-wrapper

# Install the nightly Rust toolchain specified in rust-toolchain.toml, plus
# the wasm32 compilation target. `rustup show` auto-installs the toolchain
# (and the rust-src component declared in the toml).
COPY rust-toolchain.toml .
RUN rustup show && rustup target add wasm32-unknown-unknown

# Copy Cargo manifests to cache dependency resolution.
COPY Cargo.toml Cargo.lock ./

# Install wasm-bindgen-cli at the exact version in the lockfile so that
# the CLI and the wasm-bindgen library are guaranteed to be compatible.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    WASM_BINDGEN_VERSION=$( \
        grep -A1 'name = "wasm-bindgen"' Cargo.lock \
        | grep version | head -1 \
        | sed 's/.*"\(.*\)"/\1/' \
    ) && \
    echo "Installing wasm-bindgen-cli v${WASM_BINDGEN_VERSION}" && \
    cargo install --locked wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" && \
    cargo install --locked cargo-about --version 0.8.4

# Pre-build all dependencies with a dummy source file so that the expensive
# dependency compilation is cached in the BuildKit cache mount. Only the
# thin final-crate recompile runs when source changes.
RUN mkdir -p src && echo 'pub fn __wasm_dummy() {}' > src/lib.rs

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/ntsc-rs-web-wrapper/target \
    cargo build --release --target wasm32-unknown-unknown && \
    RUSTFLAGS="-Ctarget-feature=+bulk-memory,+simd128,+relaxed-simd" \
    cargo build --profile release-relaxed-simd --target wasm32-unknown-unknown

# Copy real source and rebuild. `touch` ensures cargo sees the sources as
# newer than the dummy that produced the cached artifacts.
COPY src ./src
COPY about.toml ./

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/ntsc-rs-web-wrapper/target \
    touch src/lib.rs && \
    cargo build --release --target wasm32-unknown-unknown && \
    RUSTFLAGS="-Ctarget-feature=+bulk-memory,+simd128,+relaxed-simd" \
    cargo build --profile release-relaxed-simd --target wasm32-unknown-unknown && \
    # Run wasm-bindgen and wasm-opt. Output goes to a path outside the cache
    # mount so it is available to later stages.
    mkdir -p /wasm-output && \
    wasm-bindgen --target web --out-dir /wasm-output --omit-default-module-path \
        target/wasm32-unknown-unknown/release/ntsc_rs_web_wrapper.wasm && \
    wasm-bindgen --target web --out-dir /wasm-output --omit-default-module-path \
        --out-name ntsc_rs_web_wrapper_relaxed.wasm \
        target/wasm32-unknown-unknown/release-relaxed-simd/ntsc_rs_web_wrapper.wasm && \
    wasm-opt -O4 /wasm-output/ntsc_rs_web_wrapper_bg.wasm \
        -o /wasm-output/ntsc_rs_web_wrapper_bg.wasm && \
    wasm-opt -O4 /wasm-output/ntsc_rs_web_wrapper_relaxed.wasm \
        -o /wasm-output/ntsc_rs_web_wrapper_relaxed.wasm && \
    mkdir -p /about-output && \
    cargo about generate --format=json -o /about-output/about.json

# ---------------------------------------------------------------------------
# Stage 2: Generate setting-descriptors.ts
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS settings-generator

WORKDIR /build

# Place the WASM build output where gen-settings-list.mjs expects it.
COPY --from=wasm-builder /wasm-output ./build

# Copy the generator script (now lives in this directory).
COPY gen-settings-list.mjs ./

# Generate the settings descriptor file.
RUN node gen-settings-list.mjs

# ---------------------------------------------------------------------------
# Stage 3: Export
# ---------------------------------------------------------------------------
FROM scratch AS export

COPY --from=wasm-builder /wasm-output                        /build/
COPY --from=wasm-builder /about-output                        /build/
COPY --from=settings-generator /build/generated               /build/
