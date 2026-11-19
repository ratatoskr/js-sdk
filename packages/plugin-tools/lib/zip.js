// Dependency-free zips. Deflate or stored only, no ZIP64.

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(data) {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * Deterministic, every date is 1980-01-01.
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Buffer}
 */
export function zip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;
    const date = (1 << 5) | 1;
    for (const { name, data } of entries) {
        const nameBytes = Buffer.from(name, "utf8");
        const deflated = deflateRawSync(data, { level: 9 });
        const stored = deflated.length >= data.length;
        const body = stored ? Buffer.from(data) : deflated;
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        locals.push(local, nameBytes, body);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(stored ? 0 : 8, 10);
        entry.writeUInt16LE(date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(body.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(nameBytes.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBytes);

        offset += local.length + nameBytes.length + body.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...central, end]);
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ name: string, data: Buffer }[]}
 */
export function unzip(bytes) {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error("not a zip");
    const count = buf.readUInt16LE(end + 10);
    let at = buf.readUInt32LE(end + 16);
    const files = [];
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("a broken zip");
        const method = buf.readUInt16LE(at + 10);
        const compressed = buf.readUInt32LE(at + 20);
        const size = buf.readUInt32LE(at + 24);
        const nameLen = buf.readUInt16LE(at + 28);
        const extraLen = buf.readUInt16LE(at + 30);
        const commentLen = buf.readUInt16LE(at + 32);
        const localAt = buf.readUInt32LE(at + 42);
        const name = buf.toString("utf8", at + 46, at + 46 + nameLen).replaceAll("\\", "/");
        at += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith("/")) continue;

        // Local header sizes can be 0 if a data descriptor follows
        const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
        const body = buf.subarray(dataAt, dataAt + compressed);
        let data;
        if (method === 0) data = Buffer.from(body);
        else if (method === 8) data = inflateRawSync(body);
        else throw new Error(`${name}: compressed in a way this can't read (method ${method})`);
        if (data.length !== size) throw new Error(`${name}: a broken zip`);
        files.push({ name, data });
    }
    return files;
}

/** Refuses files that would escape `dir`. */
export function extract(bytes, dir) {
    const root = resolve(dir);
    for (const { name, data } of unzip(bytes)) {
        const target = resolve(root, name);
        if (!target.startsWith(root + sep)) throw new Error(`${name} would go outside ${dir}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
    }
}
