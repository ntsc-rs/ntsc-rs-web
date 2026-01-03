import bytesToHex from './bytes-to-hex';

const buf = new ArrayBuffer(16);
const bufView = new DataView(buf, 0, 6);
const lowBits = new Uint8Array(buf, 6);
const allBits = new Uint8Array(buf);

/** Generate a 128-bit random ID. The top 48 bits are a timestamp, and the remaining 80 are a random value. */
export const generateID = (): string => {
    crypto.getRandomValues(lowBits);

    const now = Date.now();
    const nowLow = now >>> 0;
    const nowHigh = Math.floor(now / 4294967296);

    bufView.setUint16(0, nowHigh, false);
    bufView.setUint32(2, nowLow, false);

    return bytesToHex(allBits);
};
