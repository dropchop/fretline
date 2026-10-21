import { describe, expect, it } from 'vitest';
import { parseSng, metadataToIni } from '../src/library/sng.js';
import { writeSng } from './helpers/binary.js';

describe('parseSng', () => {
  it('round-trips metadata and unmasks files', () => {
    const files = {
      'notes.chart': new TextEncoder().encode('[Song]\n{\n}\n'),
      'song.ogg': Uint8Array.from({ length: 300 }, (_, i) => i & 0xff),
    };
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
