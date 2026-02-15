import {defineConfig, Plugin} from 'vite';
import preact from '@preact/preset-vite';
//import Sonda from 'sonda/vite';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import {VitePWA} from 'vite-plugin-pwa';
import fs from 'node:fs';


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
        //Sonda({gzip: true}),
        VitePWA({
            registerType: 'prompt',
            workbox: {
                globPatterns: ['**/*.{js,css,html,woff2,png,svg,wasm}'],
            },
            devOptions: {
                enabled: true,
            },
            manifest: {
                name: 'ntsc-rs',
                short_name: 'ntsc-rs',
                description: 'Free online VHS/analog TV effect',
                theme_color: '#161518',
                background_color: '#161518',
                display: 'standalone',
                orientation: 'any',
                icons: [
                    {
                        src: '/icon-192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: '/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: '/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
        }),
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
        https: {
            key: fs.readFileSync('./localhost+2-key.pem'),
            cert: fs.readFileSync('./localhost+2.pem'),
        },
    },
    preview: {
        https: {
            key: fs.readFileSync('./localhost+2-key.pem'),
            cert: fs.readFileSync('./localhost+2.pem'),
        },
    },
});
