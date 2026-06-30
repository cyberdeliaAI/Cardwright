// PNG metadata writer for Cardwright.
// Embeds a character card as a `chara` tEXt chunk (Character Card V2 spec:
// base64 of the UTF-8 JSON), so the exported PNG re-imports here and in
// SillyTavern. Any existing `chara` / `ccv3` tEXt chunks are replaced.

// ─── CRC32 (PNG polynomial) ─────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Chunk builders ─────────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function buildChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function buildTextChunk(keyword, text) {
  const kw = new TextEncoder().encode(keyword);
  // tEXt values are Latin-1 / ASCII; base64 text is ASCII-safe.
  const tx = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
  const data = new Uint8Array(kw.length + 1 + tx.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(tx, kw.length + 1);
  return buildChunk('tEXt', data);
}

function jsonToBase64(jsonString) {
  const utf8 = new TextEncoder().encode(jsonString);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return btoa(binary);
}

// ─── Public ─────────────────────────────────────────────────────────────────

/**
 * Embed a card JSON string into PNG bytes as a `chara` tEXt chunk.
 * @param {ArrayBuffer|Uint8Array} pngInput - Raw PNG bytes (e.g. from canvas.toBlob).
 * @param {string} jsonString - The full card JSON to embed.
 * @returns {Uint8Array} New PNG bytes with the metadata chunk.
 */
export function embedCharaChunk(pngInput, jsonString) {
  const bytes = pngInput instanceof Uint8Array ? pngInput : new Uint8Array(pngInput);
  if (!PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    throw new Error('Avatar image is not a valid PNG.');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const kept = [];
  let iendChunk = null;
  let offset = 8;

  while (offset < bytes.length) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const full = bytes.slice(offset, offset + 12 + length);

    if (type === 'IEND') {
      iendChunk = full;
    } else if (type === 'tEXt') {
      // Drop any pre-existing chara/ccv3 metadata so we don't duplicate it.
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const sep = data.indexOf(0);
      const keyword = sep > 0 ? String.fromCharCode(...data.subarray(0, sep)) : '';
      if (keyword !== 'chara' && keyword !== 'ccv3') kept.push(full);
    } else {
      kept.push(full);
    }
    offset += 12 + length;
  }

  if (!iendChunk) throw new Error('PNG has no IEND chunk.');

  const charaChunk = buildTextChunk('chara', jsonToBase64(jsonString));

  const totalLength = 8
    + kept.reduce((sum, c) => sum + c.length, 0)
    + charaChunk.length
    + iendChunk.length;

  const result = new Uint8Array(totalLength);
  let pos = 0;
  result.set(PNG_SIGNATURE, pos); pos += 8;
  for (const c of kept) { result.set(c, pos); pos += c.length; }
  result.set(charaChunk, pos); pos += charaChunk.length;
  result.set(iendChunk, pos);
  return result;
}
