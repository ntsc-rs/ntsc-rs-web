#!/bin/bash

set -euo pipefail

CONF_FLAGS=(
  --target-os=none              # disable target specific configs
  --arch=x86_32                 # use x86_32 arch
  --enable-cross-compile        # use cross compile configs
  --disable-asm                 # disable asm
  --disable-stripping           # disable stripping as it won't work
  --disable-doc                 # disable doc build
  --disable-debug               # disable debug mode
  --disable-runtime-cpudetect   # disable cpu detection
  --disable-autodetect          # disable env auto detect
  --disable-iconv               # this is an autodetected library, but for some reason seems to be enabled even with --disable-autodetect
  --disable-everything
  --disable-avdevice
  --disable-avformat
  --disable-swresample
  --disable-swscale
  --disable-avfilter
  --disable-network
  --disable-pixelutils
  --disable-autodetect
  --disable-programs
  --disable-logging # adds a ton of timestamp formatting code
  --enable-encoder=aac
  --enable-small
  --extra-cflags="-msimd128 -ffunction-sections -fdata-sections"
  --extra-ldflags="-Wl,--gc-sections"

  # assign toolchains and extra flags
  --nm=emnm
  --ar=emar
  --ranlib=emranlib
  --cc=emcc
  --cxx=em++
  --objcc=emcc
  --dep-cc=emcc

  # disable thread when FFMPEG_ST is NOT defined
  ${FFMPEG_ST:+ --disable-pthreads --disable-w32threads --disable-os2threads}
)

cd FFmpeg
emconfigure ./configure "${CONF_FLAGS[@]}" $@
