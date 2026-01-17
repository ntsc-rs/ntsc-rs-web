const toImageData = async(source: ImageData | VideoFrame | ImageBitmap) => {
    if (source instanceof ImageData) return source;
    let frame;
    if (source instanceof ImageBitmap) {
        frame = new VideoFrame(source);
    } else {
        frame = source.clone();
    }

    try {
        const rect = frame.visibleRect!;
        const dest = new ImageData(rect.width, rect.height);
        await frame.copyTo(dest.data, {rect});
        return dest;
    } finally {
        frame.close();
    }
};

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

class Writer {
    private buf: ArrayBuffer;
    private bytes: Uint8Array;
    private cursor = 0;
    private chunkStart: number | null = null;
    constructor() {
        this.buf = new ArrayBuffer(1024 * 128, {maxByteLength: 1024 * 1024 * 100});
        this.bytes = new Uint8Array(this.buf);
    }

    private reserve(n: number) {
        if (this.cursor + n > this.buf.byteLength) {
            if (this.cursor + n > this.buf.maxByteLength) {
                throw new Error(`Requested ${this.cursor + n} bytes (max ${this.buf.maxByteLength})`);
            }
            let newLen = this.buf.byteLength;
            while (this.cursor + n > newLen) {
                newLen <<= 1;
            }
            this.buf.resize(Math.min(newLen, this.buf.maxByteLength));
        }
    }

    writeUint8(value: number) {
        this.reserve(1);
        this.bytes[this.cursor++] = value;
    }

    writeUint32(value: number) {
        this.reserve(4);
        this.bytes[this.cursor++] = value >>> 24;
        this.bytes[this.cursor++] = value >>> 16;
        this.bytes[this.cursor++] = value >>> 8;
        this.bytes[this.cursor++] = value;
    }

    startChunk(name: string) {
        this.chunkStart = this.advance(4);
        this.reserve(4);
        for (let i = 0; i < 4; i++) {
            this.bytes[this.cursor++] = name.charCodeAt(i);
        }
    }

    endChunk() {
        if (this.chunkStart === null) throw new Error('Not currently in a chunk');
        // Calculate the CRC of the chunk type + data, but not the length
        const crc = crc32(this.bytes, this.chunkStart + 4, this.cursor);
        this.writeUint32(crc);
        const chunkEnd = this.cursor;
        // Write the length field
        this.cursor = this.chunkStart;
        // The length field does not include its own 4 bytes, the 4-byte chunk type, or the 4-byte CRC
        this.writeUint32(chunkEnd - this.chunkStart - 12);
        this.cursor = chunkEnd;
        this.chunkStart = null;
    }

    advance(n: number) {
        const start = this.cursor;
        this.reserve(n);
        this.cursor += n;
        return start;
    }

    writeBytes(bytes: Uint8Array) {
        this.reserve(bytes.byteLength);
        this.bytes.set(bytes, this.cursor);
        this.cursor += bytes.byteLength;
    }

    toData() {
        return this.bytes.slice(0, this.cursor);
    }
}

const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const encodePng = async(source: ImageData | VideoFrame | ImageBitmap, encodeAlpha?: boolean) => {
    const data = await toImageData(source);
    const pixels = data.data;
    let shouldEncodeAlpha;
    if (typeof encodeAlpha === 'boolean') {
        shouldEncodeAlpha = encodeAlpha;
    } else {
        shouldEncodeAlpha = true;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] !== 255) {
                shouldEncodeAlpha = false;
                break;
            }
        }
    }

    const dest = new Writer();
    dest.writeBytes(signature);

    dest.startChunk('IHDR');
    dest.writeUint32(data.width);
    dest.writeUint32(data.height);
    dest.writeUint8(8); // Bit depth
    dest.writeUint8(shouldEncodeAlpha ? 6 : 2); // Color type
    dest.advance(3); // Compression and filter methods + interlace methods (all 0)
    dest.endChunk();

    dest.startChunk('IDAT');
    const scanlineSize = (data.width * (shouldEncodeAlpha ? 4 : 3)) + 1;
    const scanlinesPerChunk = Math.min(Math.ceil((1024 * 128) / scanlineSize), data.height);
    const outputChunkSize = scanlinesPerChunk * scanlineSize;

    const cs = new CompressionStream('deflate');
    const {readable, writable} = cs;
    const reader = readable.getReader();
    const writer = writable.getWriter();

    const consumer = (async() => {
        while (true) {
            const compressedChunk = await reader.read();
            if (compressedChunk.done) {
                break;
            }
            dest.writeBytes(compressedChunk.value);
        }
    })();

    const tmpBuf = new Uint8Array(outputChunkSize);
    for (let row = 0; row < data.height; row += scanlinesPerChunk) {
        const dstOffset = encodeScanlineChunk(
            tmpBuf, pixels, row, row + scanlinesPerChunk, data.width, shouldEncodeAlpha);
        await writer.ready;
        await writer.write(tmpBuf.subarray(0, dstOffset));
    }

    await writer.close();
    await consumer;
    dest.endChunk();

    dest.startChunk('IEND');
    dest.endChunk();
    return new Blob([dest.toData()], {type: 'image/png'});
};

const encodeScanlineChunk = (
    tmpBuf: Uint8Array,
    pixels: Uint8ClampedArray,
    start: number,
    end: number,
    width: number,
    shouldEncodeAlpha: boolean,
) => {
    const scanlineSize = (width * (shouldEncodeAlpha ? 4 : 3)) + 1;
    let dstOffset = 0;
    for (let row = start; row < end; row++) {
        // We always use filter type 1 (sub)
        tmpBuf[dstOffset] = 1;
        const offset = row * width * 4;

        if (shouldEncodeAlpha) {
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
