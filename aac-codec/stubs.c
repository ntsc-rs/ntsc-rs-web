#include <stdint.h>
#include <stddef.h>
#include <libavutil/opt.h>

// Stubbed out to avoid pulling in like 100KB of option parsing code and tables
void __wrap_av_opt_set_defaults2(void *s, int mask, int flags) {
    // We set all required defaults manually, which is mildly perilous but worth it
    return;
}

// Stubbed out to avoid pulling in like 100KB of option parsing code and tables
int __wrap_av_opt_set(void *obj, const char *name, const char *val, int search_flags) {
    // We set the options directly on the structs themselves
    return 0;
}

// Stubbed out to avoid pulling in a ton of debug formatting (including strftime)
void __wrap_av_log_default_callback(void *ptr, int level, const char *fmt, void *vl) {}

// Stubbed out to avoid pulling in a huge table of pixel formats and their names
const void *__wrap_av_pix_fmt_desc_get(enum AVPixelFormat pix_fmt) {
    return NULL;
}

// Stubbed out to avoid JS-side glue code for environment variable manipulation
char* getenv(const char* name) {
    return NULL;
}

// There's a circular dependency in Emscripten. The setitimer libc function calls _emscripten_timeout, which calls the
// JS-side _setitimer_js. This adds a dependency on _setitimer_js. Then on the JS side, _setitimer_js calls the
// WASM-side _emscripten_timeout, adding a dependency on it.  Because we have a JS-side dependency on
// _emscripten_timeout, it cannot be DCE'd by the linker. Therefore, simply by importing libc, we end up including a
// bunch of timer glue code that is never actually called.
void _emscripten_timeout(int which, double now) {}
