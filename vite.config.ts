import {defineConfig, Plugin} from 'vite';
import preact from '@preact/preset-vite';
//import Sonda from 'sonda/vite';

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import {VitePWA} from 'vite-plugin-pwa';
import fs from 'node:fs';
import type {License, LicenseList} from './cargo-about-types';

// https://github.com/vitejs/vite/blob/a2aab8d/packages/vite/src/node/plugins/license.ts
type LicenseEntry = {
    /**
     * Package name
     */
    name: string
    /**
     * Package version
     */
    version: string
    /**
     * SPDX license identifier (from package.json "license" field)
     */
    identifier?: string
    /**
     * License file text
     */
    text?: string
};

type CreditsLicense = {
    name: string;
    version: string;
    identifier?: string;
    text?: number | {name: string; text: number}[];
};

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
            writeBundle(options) {
                const outDir = options.dir ?? 'dist';
                const viteLicensePath = `${outDir}/.vite/licenses.json`;
                const rustLicensePath = './ntsc-rs-web-wrapper/build/about.json';
                const ffmpegLicensePath = './aac-codec/FFmpeg/COPYING.LGPLv2.1';

                const viteLicenses = JSON.parse(fs.readFileSync(viteLicensePath, 'utf-8')) as LicenseEntry[];
                const rustLicenses = JSON.parse(fs.readFileSync(rustLicensePath, 'utf-8')) as LicenseList;
                const lgplText = fs.readFileSync(ffmpegLicensePath, 'utf-8');

                let nextLicenseIndex = 1;
                const licenseTexts = new Map<string, number>([[lgplText, 0]]);
                const licensesOut: {
                    js: CreditsLicense[],
                    rust: CreditsLicense[],
                    c: CreditsLicense[],
                    texts: string[],
                } = {
                    js: [],
                    rust: [],
                    c: [
                        {
                            name: 'ffmpeg',
                            version: '8.0',
                            identifier: 'LGPLv2.1',
                            text: 0,
                        },
                    ],
                    texts: [],
                };
                for (const license of viteLicenses) {
                    if (!license.identifier) continue;
                    let textIndex = undefined;
                    if (license.text) {
                        textIndex = licenseTexts.get(license.text);
                        if (typeof textIndex === 'undefined') {
                            licenseTexts.set(license.text, nextLicenseIndex);
                            textIndex = nextLicenseIndex++;
                        }
                    }
                    licensesOut.js.push({
                        name: license.name,
                        version: license.version,
                        identifier: license.identifier,
                        text: textIndex,
                    });
                }

                const crateLicenses = new Map<string, License[]>();
                for (const license of rustLicenses.licenses) {
                    for (const {crate} of license.used_by) {
                        let licensesForCrate = crateLicenses.get(crate.id);
                        if (!licensesForCrate) {
                            licensesForCrate = [];
                            crateLicenses.set(crate.id, licensesForCrate);
                        }
                        licensesForCrate.push(license);
                    }
                }
                for (const {package: crate} of rustLicenses.crates) {
                    const licenses = crateLicenses.get(crate.id);
                    if (!licenses) continue;

                    const licenseIndices = [];
                    for (const license of licenses) {
                        let textIndex = licenseTexts.get(license.text);
                        if (typeof textIndex === 'undefined') {
                            licenseTexts.set(license.text, nextLicenseIndex);
                            textIndex = nextLicenseIndex++;
                        }
                        licenseIndices.push({name: license.name, text: textIndex});
                    }
                    licensesOut.rust.push({
                        name: crate.name,
                        version: crate.version,
                        text: licenseIndices,
                    });
                }

                for (const licenseText of licenseTexts.keys()) {
                    licensesOut.texts.push(licenseText);
                }

                fs.writeFileSync(
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
