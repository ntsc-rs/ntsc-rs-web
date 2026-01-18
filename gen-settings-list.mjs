import init, {NtscSettingsList} from './ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper.js';
import {readFile, writeFile} from 'node:fs/promises';

const wasmPath = new URL('./ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper_bg.wasm', import.meta.url);
const data = await readFile(wasmPath);

await init({module_or_path: data});

const settingsList = new NtscSettingsList();
const settingsDescriptors = JSON.parse(settingsList.getSettingsList());

const generatedModule = `import type {SettingDescriptor} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

const SETTING_DESCRIPTORS: SettingDescriptor[] = ${JSON.stringify(settingsDescriptors, null, 4)};
export default SETTING_DESCRIPTORS;
`;

await writeFile(new URL('./src/generated/setting-descriptors.ts', import.meta.url), generatedModule, 'utf-8');
