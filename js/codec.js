// Packs a doodle (strokes + round info) into a compact URL-safe string.
// Format: [version][metaLen varint][meta JSON][strokes], deflated, base64url.
// Prefix 'z' = deflate-raw compressed, 'u' = uncompressed fallback.

const te = new TextEncoder();
const td = new TextDecoder();
const VERSION = 1;
const MAX_PAYLOAD = 200000;

function writeVarint(out, n) {
  n = n >>> 0;
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n);
}
function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    if (pos.i >= buf.length || shift > 28) throw new Error('bad varint');
    b = buf[pos.i++];
    n |= (b & 127) << shift;
    shift += 7;
  } while (b & 128);
  return n >>> 0;
}
const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (n) => (n >>> 1) ^ -(n & 1);

function b64e(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64d(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePayload(meta, strokes = []) {
  const out = [VERSION];
  const mb = te.encode(JSON.stringify(meta));
  writeVarint(out, mb.length);
  for (const b of mb) out.push(b);
  writeVarint(out, strokes.length);
  for (const s of strokes) {
    out.push(s.c & 255, s.s & 255);
    const p = s.p;
    writeVarint(out, p.length / 2);
    let px = 0, py = 0;
    for (let i = 0; i < p.length; i += 2) {
      writeVarint(out, zig(p[i] - px));
      writeVarint(out, zig(p[i + 1] - py));
      px = p[i]; py = p[i + 1];
    }
  }
  const raw = Uint8Array.from(out);
  try {
    if (typeof CompressionStream === 'undefined') throw new Error('no compression');
    return 'z' + b64e(await pipe(raw, new CompressionStream('deflate-raw')));
  } catch {
    return 'u' + b64e(raw);
  }
}

export async function decodePayload(str, limits = { colors: 10, sizes: 3, grid: 1000 }) {
  if (!str || str.length > MAX_PAYLOAD) throw new Error('bad length');
  const kind = str[0];
  let bytes = b64d(str.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('Your browser is too old to open this link');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'u') throw new Error('unknown format');

  const pos = { i: 0 };
  if (bytes[pos.i++] !== VERSION) throw new Error('unknown version');
  const metaLen = readVarint(bytes, pos);
  const meta = JSON.parse(td.decode(bytes.subarray(pos.i, pos.i + metaLen)));
  if (!meta || typeof meta !== 'object') throw new Error('bad meta');
  pos.i += metaLen;

  const strokes = [];
  if (pos.i < bytes.length) {
    const count = readVarint(bytes, pos);
    if (count > 5000) throw new Error('too many strokes');
    const clampG = (v) => Math.max(0, Math.min(limits.grid, v));
    for (let k = 0; k < count; k++) {
      const c = Math.min(bytes[pos.i++], limits.colors - 1);
      const s = Math.min(bytes[pos.i++], limits.sizes - 1);
      const n = readVarint(bytes, pos);
      if (n > 50000) throw new Error('stroke too long');
      const p = new Array(n * 2);
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) {
        x += unzig(readVarint(bytes, pos));
        y += unzig(readVarint(bytes, pos));
        p[i * 2] = clampG(x);
        p[i * 2 + 1] = clampG(y);
      }
      strokes.push({ c, s, p });
    }
  }
  return { meta, strokes };
}

// Light obfuscation so the secret word isn't readable in the URL.
// (Not cryptography: it just keeps an honest guesser from peeking by accident.)
function xorBytes(bytes, key) {
  const k = te.encode(key);
  return bytes.map((x, i) => x ^ k[i % k.length] ^ ((i * 73 + 41) & 255));
}
export const hideWord = (word, key) => b64e(xorBytes(te.encode(word), key));
export const revealWord = (str, key) => td.decode(xorBytes(b64d(str), key));

// Ramer–Douglas–Peucker on a flat [x0,y0,x1,y1,...] array.
export function simplify(p, eps) {
  const n = p.length / 2;
  if (n <= 2 || eps <= 0) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = p[a * 2], ay = p[a * 2 + 1], dx = p[b * 2] - ax, dy = p[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy);
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = p[i * 2] - ax, py = p[i * 2 + 1] - ay;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}
