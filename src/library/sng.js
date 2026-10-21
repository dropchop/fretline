// Reader for the .sng song container (https://github.com/mdsitton/SngFileFormat):
// a header with an XOR mask, a metadata table (the song.ini contents), a file index and
// the masked file bytes.
const MAGIC = [0x53, 0x4e, 0x47, 0x50, 0x4b, 0x47]; // "SNGPKG"
const decoder = new TextDecoder();

/**
 * @param {ArrayBuffer} buffer
 * @returns {{version: number, metadata: Record<string, string>, files: Record<string, Uint8Array>}}
 */
export function parseSng(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 26 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not an .sng file');
  let pos = 6;
  const u32 = () => {
    const v = view.getUint32(pos, true);
    pos += 4;
    return v;
  };
  const i32 = () => {
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };
  const u64 = () => {
    const v = view.getBigUint64(pos, true);
    pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('.sng section too large');
    return Number(v);
  };
  const str = (len) => {
    const s = decoder.decode(bytes.subarray(pos, pos + len));
    pos += len;
    return s;
  };

  const version = u32();
  const xorMask = bytes.slice(pos, pos + 16);
  pos += 16;

  const metadataLen = u64();
  const metadataEnd = pos + metadataLen;
  const metadataCount = u64();
  const metadata = {};
  for (let i = 0; i < metadataCount; i++) {
    const key = str(i32());
    metadata[key.toLowerCase()] = str(i32());
  }
  pos = metadataEnd;

  const fileMetaLen = u64();
  const fileMetaEnd = pos + fileMetaLen;
  const fileCount = u64();
  const index = [];
  for (let i = 0; i < fileCount; i++) {
    const name = str(bytes[pos++]);
    const length = u64();
    const offset = u64();
    index.push({ name, length, offset });
  }
  pos = fileMetaEnd;

  const files = {};
  for (const { name, length, offset } of index) {
    if (offset + length > bytes.length) throw new Error(`.sng file entry "${name}" is truncated`);
    const data = bytes.slice(offset, offset + length);
    for (let i = 0; i < data.length; i++) data[i] ^= xorMask[i % 16] ^ (i & 0xff);
    files[name] = data;
  }
  return { version, metadata, files };
}

/** Serialises the metadata table back into song.ini text. */
export function metadataToIni(metadata) {
  return `[song]\n${Object.entries(metadata)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n')}\n`;
}
