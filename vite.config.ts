import {defineConfig, Plugin} from 'vite';
import preact from '@preact/preset-vite';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import basicSsl from '@vitejs/plugin-basic-ssl';


// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        preact(),
        wasm() as Plugin,
        topLevelAwait(),
        {
            name: 'isolation',
            configureServer(server) {
                server.middlewares.use((_req, res, next) => {
                    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                    next();
                });
            },
        },
        basicSsl(),
    ],
    css: {
        modules: {
            localsConvention: 'camelCase',
        },
    },
    build: {
        minify: true,
        sourcemap: true,
        modulePreload: false,
    },
    server: {
        host: true,
        https: true,
    },
});
