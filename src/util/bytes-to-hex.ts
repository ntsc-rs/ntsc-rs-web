const hasToHex = 'toHex' in Uint8Array.prototype;

const bytesToHex = (arr: Uint8Array): string => {
    if (hasToHex) return (arr as Uint8Array & {toHex(): string}).toHex();
    let result = '';
    for (let i = 0; i < arr.length; i++) {
        const byte = arr[i];
        if (byte < 16) result += '0';
        result += byte.toString(16);
    }
    return result;
};

export default bytesToHex;
