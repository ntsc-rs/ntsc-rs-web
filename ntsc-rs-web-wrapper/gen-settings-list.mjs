import init, {NtscSettingsList} from './build/ntsc_rs_web_wrapper.js';
import {readFile, writeFile, mkdir} from 'node:fs/promises';

const wasmPath = new URL('./build/ntsc_rs_web_wrapper_bg.wasm', import.meta.url);
const data = await readFile(wasmPath);

await init({module_or_path: data});

const settingsList = new NtscSettingsList();
const settingsDescriptors = JSON.parse(settingsList.getSettingsList());

const generatedModule = `import type {SettingDescriptor} from '../build/ntsc_rs_web_wrapper';

const SETTING_DESCRIPTORS: SettingDescriptor[] = ${JSON.stringify(settingsDescriptors, null, 4)};
export default SETTING_DESCRIPTORS;
`;

const outDir = new URL('./generated/', import.meta.url);
await mkdir(outDir, {recursive: true});
await writeFile(new URL('./generated/setting-descriptors.ts', import.meta.url), generatedModule, 'utf-8');
