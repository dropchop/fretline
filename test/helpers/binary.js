// Binary writers used by tests and fixture generation.
const enc = new TextEncoder();

export const u32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
};
export const i32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
};
export const u64 = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
};

export function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of arrays) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

/** Minimal .sng writer following the spec, for testing the reader and building fixtures. */
export function writeSng(
  metadata,
  files,
  mask = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff),
) {
  const parts = [enc.encode('SNGPKG'), u32(1), mask];
  const meta = [];
  for (const [k, v] of Object.entries(metadata)) {
    meta.push(i32(enc.encode(k).length), enc.encode(k), i32(enc.encode(v).length), enc.encode(v));
  }
  const metaBytes = concat(meta);
  parts.push(u64(8 + metaBytes.length), u64(Object.keys(metadata).length), metaBytes);

  const names = Object.keys(files);
  const indexLen = names.reduce((n, name) => n + 1 + enc.encode(name).length + 16, 0);
  const headerLen = concat(parts).length + 8 + 8 + indexLen + 8;
  const index = [];
  let offset = headerLen;
  for (const name of names) {
    index.push(
      Uint8Array.of(enc.encode(name).length),
      enc.encode(name),
      u64(files[name].length),
      u64(offset),
    );
    offset += files[name].length;
  }
  parts.push(u64(8 + indexLen), u64(names.length), ...index);
  const total = names.reduce((n, name) => n + files[name].length, 0);
  parts.push(u64(total));
  for (const name of names) parts.push(files[name].map((b, i) => b ^ mask[i % 16] ^ (i & 0xff)));
  return concat(parts).buffer;
}
