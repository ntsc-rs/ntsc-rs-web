import {defineConfig} from 'vite';
import preact from '@preact/preset-vite';

import {VitePWA} from 'vite-plugin-pwa';
import fs from 'node:fs/promises';
import gatherLicenses from './license-credits.js';

let Sonda = null;
if (process.env.SONDA) {
    Sonda = (await import('sonda/vite')).default;
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        preact(),
        Sonda?.({gzip: true}),
        VitePWA({
            registerType: 'prompt',
            workbox: {
                globPatterns: ['**/*.{js,css,html,woff2,png,svg,wasm,json}'],
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
        {
            name: 'merge-licenses',
            async writeBundle(options) {
                const outDir = options.dir ?? 'dist';
                const licensesOut = await gatherLicenses({
                    vite: `${outDir}/.vite/licenses.json`,
                    rust: './ntsc-rs-web-wrapper/build/about.json',
                    ffmpeg: './aac-codec/FFmpeg/',
                    inter: './src/assets/fonts/LICENSE.txt',
                });

                await fs.writeFile(
                    `${outDir}/licenses.json`,
                    JSON.stringify(licensesOut),
                );
            },
        },
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
        license: {fileName: '.vite/licenses.json'},
    },
    server: {
        host: true,
        /*https: {
            key: fs.readFileSync('./localhost+2-key.pem'),
            cert: fs.readFileSync('./localhost+2.pem'),
        },*/
    },
    preview: {
        /*https: {
            key: fs.readFileSync('./localhost+2-key.pem'),
            cert: fs.readFileSync('./localhost+2.pem'),
        },*/
    },
});
