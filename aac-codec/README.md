This is a WebAssembly build of ffmpeg containing only the AAC codec (and some wrappers in `support.c` to make it more pleasant to use from JavaScript). It's used for rendering H.264 videos, since browsers do not seem to support AAC encoding natively and AAC is the most well-supported audio format in .mp4 containers.

A lot of things have been patched out to reduce the size of the WebAssembly module. In particula:

- Option parsing has been patched out, and all options are set manually. This saves ~100KB by eliminating a lot of option parsing code (including a table of every X11 color name, in case you wanted to pass that to a codec or filter or something), and the full-text descriptions for every single AVCodecContext option (including ones only applicable to videos).
- Video-specific functionality, including a large table of every video pixel format, has been patched out.
- Support for fixed-point and double-precision MDCT types has been patched out, since the AAC encoder does not use them. They were being pulled in due to dynamic dispatch.
- The two-loop encoding method has been patched out, and the "fast" method is always used instead.

See the `patches` folder and `stubs.c` for more.

You can build this using Emscripten, either by installing [emsdk](https://github.com/emscripten-core/emsdk) and running `build.sh`, or just running it in Docker via:

```bash
npm run build-aac-codec
```

from the repo root (that is, not in this folder).

FFmpeg is included as a Git submodule; if you have not already done so, you'll need to initialize it:

```bash
git submodule update --init --recursive
```
