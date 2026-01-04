FROM emscripten/emsdk:4.0.22

RUN npm install -g typescript

# Pre-build system libraries
USER emscripten
RUN embuilder build crt1_reactor libc libc++ libc++abi libc++-noexcept libc++abi-noexcept \
    libcompiler_rt libdlmalloc libhtml5 libnoexit libsockets libstubs \
    libstandalonewasm-nocatch-memgrow libal libGL-getprocaddr libc_optz --lto
USER root
RUN chmod -R 777 /emsdk/upstream/emscripten/cache