import { describe, expect, it } from 'vitest';
import { parseSng, metadataToIni } from '../src/library/sng.js';

/** Minimal .sng writer following the spec, for testing the reader. */
export function writeSng(metadata, files) {
  const enc = new TextEncoder();
  const parts = [];
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const i32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
  const u64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
  const mask = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
  parts.push(enc.encode('SNGPKG'), u32(1), mask);

  const meta = [];
  for (const [k, v] of Object.entries(metadata)) meta.push(i32(enc.encode(k).length), enc.encode(k), i32(enc.encode(v).length), enc.encode(v));
  const metaBytes = concat(meta);
  parts.push(u64(8 + metaBytes.length), u64(Object.keys(metadata).length), metaBytes);

  const names = Object.keys(files);
  const indexLen = names.reduce((n, name) => n + 1 + enc.encode(name).length + 16, 0);
  const headerLen = concat(parts).length + 8 + 8 + indexLen + 8;
  const index = [];
  let offset = headerLen;
  for (const name of names) {
    index.push(Uint8Array.of(enc.encode(name).length), enc.encode(name), u64(files[name].length), u64(offset));
    offset += files[name].length;
  }
  parts.push(u64(8 + indexLen), u64(names.length), ...index);
  const total = names.reduce((n, name) => n + files[name].length, 0);
  parts.push(u64(total));
  for (const name of names) parts.push(files[name].map((b, i) => b ^ mask[i % 16] ^ (i & 0xff)));
  return concat(parts).buffer;
}

function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of arrays) { out.set(a, p); p += a.length; }
  return out;
}

describe('parseSng', () => {
  it('round-trips metadata and unmasks files', () => {
    const files = { 'notes.chart': new TextEncoder().encode('[Song]\n{\n}\n'), 'song.ogg': Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) };
    const buf = writeSng({ name: 'Packed', artist: 'Band' }, files);
    const sng = parseSng(buf);
    expect(sng.version).toBe(1);
    expect(sng.metadata).toEqual({ name: 'Packed', artist: 'Band' });
    expect(Object.keys(sng.files)).toEqual(['notes.chart', 'song.ogg']);
    expect(new TextDecoder().decode(sng.files['notes.chart'])).toBe('[Song]\n{\n}\n');
    expect([...sng.files['song.ogg']]).toEqual([...files['song.ogg']]);
    expect(metadataToIni(sng.metadata)).toBe('[song]\nname = Packed\nartist = Band\n');
  });

  it('rejects other files', () => {
    expect(() => parseSng(new Uint8Array(40).buffer)).toThrow(/not an .sng/);
  });
});
