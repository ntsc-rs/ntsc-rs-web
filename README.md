# ntsc-rs-web

This is the (experimental) web version of [ntsc-rs](https://github.com/ntsc-rs/ntsc-rs). It uses Preact, and is built via Vite.

## Building

This project uses Git submodules. You should clone this repo including submodules:

```
git clone --recurse-submodules https://github.com/ntsc-rs/ntsc-rs-web.git
```

If you cloned this repo without submodules, you may initialize them via:

```
git submodule update --init --recursive
```

To run a development server:

```
npm run dev
```

To build into `dist`:

```
npm run build
```
