import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {License, LicenseList} from './cargo-about-types.js';

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

type LicenseGroup = {
    title: string,
    licenses: CreditsLicense[]
};

const gatherLicenses = async(licensePaths: {
    vite: string,
    rust: string,
    ffmpeg: string,
    inter: string,
}) => {
    const viteLicenses = JSON.parse(await fs.readFile(licensePaths.vite, 'utf-8')) as LicenseEntry[];
    const rustLicenses = JSON.parse(await fs.readFile(licensePaths.rust, 'utf-8')) as LicenseList;
    const lgplText = await fs.readFile(path.join(licensePaths.ffmpeg, 'COPYING.LGPLv3'), 'utf-8');
    const ffmpegRelease = await fs.readFile(path.join(licensePaths.ffmpeg, 'RELEASE'), 'utf-8');
    const oflText = await fs.readFile(licensePaths.inter, 'utf-8');

    let nextLicenseIndex = 1;
    const licenseTexts = new Map<string, number>([[lgplText, 0]]);
    const textToIndex = (licenseText: string) => {
        let textIndex = licenseTexts.get(licenseText);
        if (typeof textIndex === 'undefined') {
            licenseTexts.set(licenseText, nextLicenseIndex);
            textIndex = nextLicenseIndex++;
        }
        return textIndex;
    };
    const licensesOut: {
        groups: LicenseGroup[],
        texts: string[],
    } = {
        groups: [],
        texts: [],
    };
    const jsLicenseGroup = [];
    for (const license of viteLicenses) {
        if (!license.identifier) continue;
        const textIndex = typeof license.text === 'string' ? textToIndex(license.text) : undefined;
        jsLicenseGroup.push({
            name: license.name,
            version: license.version,
            identifier: license.identifier,
            text: textIndex,
        });
    }

    const rustLicenseGroup = [];
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
            const textIndex = textToIndex(license.text);
            licenseIndices.push({name: license.name, text: textIndex});
        }
        rustLicenseGroup.push({
            name: crate.name,
            version: crate.version,
            text: licenseIndices,
        });
    }

    licensesOut.groups.push({title: 'Rust dependencies', licenses: rustLicenseGroup});
    licensesOut.groups.push({title: 'JavaScript dependencies', licenses: jsLicenseGroup});
    licensesOut.groups.push({
        title: 'C dependencies',
        licenses: [
            {
                name: 'ffmpeg',
                version: ffmpegRelease,
                identifier: 'LGPL-2.1-or-later',
                text: textToIndex(lgplText),
            },
        ]});
    licensesOut.groups.push({
        title: 'Fonts',
        licenses: [
            {
                name: 'Inter',
                version: '4.1',
                identifier: 'OFL-1.1',
                text: textToIndex(oflText),
            },
        ]});

    for (const licenseText of licenseTexts.keys()) {
        licensesOut.texts.push(licenseText);
    }

    return licensesOut;
};

export default gatherLicenses;
