import {defineConfig, Plugin} from 'vite';
import preact from '@preact/preset-vite';
//import Sonda from 'sonda/vite';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import basicSsl from '@vitejs/plugin-basic-ssl';


// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        preact(),
        wasm() as Plugin,
        topLevelAwait(),
        //Sonda({gzip: true}),
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
    },
});
