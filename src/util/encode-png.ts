const crcTable = Uint32Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

const crc32 = (buf: Uint8Array, start: number, end: number) => {
    let crc = ~0;
    for (let i = start; i < end; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ ~0) >>> 0;
};

const encodePng = async(
    source: {
        data: Uint8Array | Uint8ClampedArray | Uint16Array;
        width: number;
        height: number;
    },
    encodeAlpha?: boolean,
) => {
    const pixels = source.data;
    let shouldEncodeAlpha;
    if (typeof encodeAlpha === 'boolean') {
        shouldEncodeAlpha = encodeAlpha;
    } else {
        shouldEncodeAlpha = false;
        const maxValue = (1 << (pixels.BYTES_PER_ELEMENT * 8)) - 1;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] !== maxValue) {
                shouldEncodeAlpha = true;
                break;
            }
        }
    }

    const channels = shouldEncodeAlpha ? 4 : 3;
    const scanlineSize = (source.width * channels * pixels.BYTES_PER_ELEMENT) + 1;
    const scanlinesPerChunk = Math.min(Math.max(1, Math.ceil((1024 * 128) / scanlineSize)), source.height);
    const outputChunkSize = scanlinesPerChunk * scanlineSize;

    const {readable, writable} = new CompressionStream('deflate');
    const csReader = readable.getReader();
    const csWriter = writable.getWriter();

    const compressedChunks: Uint8Array[] = [];
    let idatSize = 0;
    const consumer = (async() => {
        let compressedChunk;
        while (!(compressedChunk = await csReader.read()).done) {
            compressedChunks.push(compressedChunk.value);
            idatSize += compressedChunk.value.length;
        }
    })();

    const tmpBuf = new Uint8Array(outputChunkSize);
    for (let row = 0; row < source.height; row += scanlinesPerChunk) {
        const dstOffset = encodeScanlineChunk(
            tmpBuf, pixels, row, Math.min(row + scanlinesPerChunk, source.height), source.width, channels);
        await csWriter.ready;
        await csWriter.write(tmpBuf.subarray(0, dstOffset));
    }

    await csWriter.close();
    await consumer;

    const pngSize =
        8 + // Signature
        25 + // IHDR
        idatSize + 12 + // IDAT
        12; // IEND

    const dest = new Uint8Array(pngSize);
    let cursor = 0;

    const writeU8 = (n: number) => {
        dest[cursor++] = n;
    };
    const writeU32 = (n: number) => {
        dest[cursor++] = n >>> 24;
        dest[cursor++] = n >>> 16;
        dest[cursor++] = n >>> 8;
        dest[cursor++] = n;
    };
    const startChunk = (chunkType: number, chunkLength: number) => {
        const start = cursor;
        writeU32(chunkLength);
        writeU32(chunkType);
        return start;
    };
    const endChunk = (chunkStart: number) => {
        writeU32(crc32(dest, chunkStart + 4, cursor)); // include the chunk type but not length
    };

    // 8-byte signature
    writeU32(0x89504e47);
    writeU32(0x0d0a1a0a);

    const ihdr = startChunk(0x49484452, 13); // 'IHDR'
    writeU32(source.width);
    writeU32(source.height);
    writeU8(pixels.BYTES_PER_ELEMENT * 8); // Bit depth
    writeU8(shouldEncodeAlpha ? 6 : 2); // Color type
    // Compression and filter methods + interlace method (3 bytes) are all 0
    cursor += 3;
    endChunk(ihdr);

    const idat = startChunk(0x49444154, idatSize); // 'IDAT'
    for (const chunk of compressedChunks) {
        dest.set(chunk, cursor);
        cursor += chunk.length;
    }
    endChunk(idat);

    endChunk(startChunk(0x49454e44, 0)); // 'IEND'
    return new Blob([dest.slice(0, cursor)], {type: 'image/png'});
};

const encodeScanlineChunk = (
    tmpBuf: Uint8Array,
    pixels: Uint8ClampedArray | Uint8Array | Uint16Array,
    start: number,
    end: number,
    width: number,
    channels: number,
) => {
    const scanlineSize = (width * channels * pixels.BYTES_PER_ELEMENT) + 1;
    let dstOffset = 0;
    for (let row = start; row < end; row++) {
        // We always use filter type 1 (sub)
        tmpBuf[dstOffset] = 1;
        const offset = row * width * 4;

        if (pixels.BYTES_PER_ELEMENT === 2) {
            for (let x = 0; x < width; x++) {
                const srcPixel = offset + (x * 4);
                const dstPixel = dstOffset + 1 + (x * channels * 2);
                for (let channel = 0; channel < channels; channel++) {
                    const value = pixels[srcPixel + channel];
                    const previous = x === 0 ? 0 : pixels[srcPixel - 4 + channel];
                    const dst = dstPixel + (channel * 2);
                    // PNG stores 16-bit samples big-endian and filters each byte separately.
                    tmpBuf[dst] = (value >>> 8) - (previous >>> 8);
                    tmpBuf[dst + 1] = (value & 0xff) - (previous & 0xff);
                }
            }
        } else if (channels === 4) {
            tmpBuf[dstOffset + 1] = pixels[offset + 0];
            tmpBuf[dstOffset + 2] = pixels[offset + 1];
            tmpBuf[dstOffset + 3] = pixels[offset + 2];
            tmpBuf[dstOffset + 4] = pixels[offset + 3];
            for (let i = 4, len = width * 4; i < len; i += 4) {
                tmpBuf[dstOffset + i + 1] = pixels[offset + i + 0] - pixels[offset + i - 4];
                tmpBuf[dstOffset + i + 2] = pixels[offset + i + 1] - pixels[offset + i - 3];
                tmpBuf[dstOffset + i + 3] = pixels[offset + i + 2] - pixels[offset + i - 2];
                tmpBuf[dstOffset + i + 4] = pixels[offset + i + 3] - pixels[offset + i - 1];
            }
        } else {
            tmpBuf[dstOffset + 1] = pixels[offset + 0];
            tmpBuf[dstOffset + 2] = pixels[offset + 1];
            tmpBuf[dstOffset + 3] = pixels[offset + 2];
            for (let i = 4, j = 3, len = width * 4; i < len; i += 4, j += 3) {
                tmpBuf[dstOffset + j + 1] = pixels[offset + i + 0] - pixels[offset + i - 4];
                tmpBuf[dstOffset + j + 2] = pixels[offset + i + 1] - pixels[offset + i - 3];
                tmpBuf[dstOffset + j + 3] = pixels[offset + i + 2] - pixels[offset + i - 2];
            }
        }

        dstOffset += scanlineSize;
    }

    return dstOffset;
};

export default encodePng;
