/**
 * E2E helper for k6 load scripts: derive keys, wrap/unwrap room key, encrypt room messages.
 * Matches the-bar wire format: wrap key = SHA-256(accessCode + slug + room + salt);
 * room key (for load test) = SHA-256(accessCode + slug + room + TEST_ROOM_SALT);
 * message format = e2e.<base64(iv || aes256gcm(plaintext))>.
 */
import { crypto } from 'k6/experimental/webcrypto';
import { b64encode, b64decode } from 'k6/encoding';

const WRAP_SALT = 'the-bar-room-key-v1';
const TEST_ROOM_SALT = 'k6-loadtest-room-key-v1';
const E2E_PREFIX = 'e2e.';

function strToBuf(str) {
  return new TextEncoder().encode(str);
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return b64encode(binary, 'rawstd');
}

function base64ToBuf(b64) {
  const out = b64decode(b64, 'rawstd');
  if (out instanceof ArrayBuffer) return out;
  const str = typeof out === 'string' ? out : String(out);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes.buffer;
}

/**
 * Derive 32-byte key (for AES-256) via SHA-256. Returns ArrayBuffer.
 */
async function deriveKey(accessCode, slug, roomName, salt) {
  const str = (accessCode || '') + (slug || 'default') + (roomName || 'general').replace(/^#/, '') + salt;
  const digest = await crypto.subtle.digest('SHA-256', strToBuf(str));
  return digest;
}

/**
 * Derive wrap key (same as client's deriveWrapKey). Returns CryptoKey.
 */
async function deriveWrapKey(accessCode, slug, roomName) {
  const raw = await deriveKey(accessCode, slug, roomName, WRAP_SALT);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Derive deterministic test room key so all VUs share the same key. Returns CryptoKey.
 */
async function deriveTestRoomKey(accessCode, slug, roomName) {
  const raw = await deriveKey(accessCode, slug, roomName, TEST_ROOM_SALT);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Wrap room key bytes with wrap key; returns base64(iv || ciphertext) for wrappedroomkey:.
 */
async function wrapRoomKey(roomKeyRaw, wrapKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    wrapKey,
    roomKeyRaw
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bufToBase64(combined.buffer);
}

/**
 * Unwrap server blob to get room key bytes. Returns ArrayBuffer or null.
 */
async function unwrapRoomKey(wrappedBase64, wrapKey) {
  try {
    const bin = new Uint8Array(base64ToBuf(wrappedBase64));
    const iv = bin.slice(0, 12);
    const ciphertext = bin.slice(12);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      wrapKey,
      ciphertext
    );
  } catch (_) {
    return null;
  }
}

/**
 * Encrypt plaintext with room key; returns e2e.<base64(iv||ciphertext)>.
 */
async function encryptRoomMessage(roomKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = strToBuf(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    roomKey,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return E2E_PREFIX + bufToBase64(combined.buffer);
}

/**
 * Parse "wrappedroomkey:#room:base64" from a line. Returns { roomName, base64 } or null.
 */
function parseWrappedRoomKeyLine(line) {
  const prefix = 'wrappedroomkey:';
  if (!line || !line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length).trim();
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const roomName = rest.slice(0, lastColon).trim().replace(/^#/, '');
  const base64 = rest.slice(lastColon + 1).trim();
  if (!roomName || !base64) return null;
  return { roomName, base64 };
}

/**
 * Ensure we have a room key: if state.wrappedBlob is set, unwrap and return CryptoKey;
 * otherwise derive test room key, export raw, wrap it, send wrappedroomkey via socket, import and return key.
 */
export async function ensureRoomKey(state, accessCode, slug, roomName, socket) {
  const wrapKey = await deriveWrapKey(accessCode, slug, roomName);
  if (state.wrappedBlob) {
    const raw = await unwrapRoomKey(state.wrappedBlob, wrapKey);
    if (raw) return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  const roomKey = await deriveTestRoomKey(accessCode, slug, roomName);
  const raw = await crypto.subtle.exportKey('raw', roomKey);
  const wrapped = await wrapRoomKey(raw, wrapKey);
  if (socket) socket.send('wrappedroomkey:#' + roomName + ':' + wrapped + '\n');
  return roomKey;
}

/**
 * Process incoming message: if it contains wrappedroomkey:#room:blob, set state.wrappedBlob.
 */
export function collectWrappedKey(state, text, roomName) {
  const lines = (text || '').split('\n');
  for (const line of lines) {
    const parsed = parseWrappedRoomKeyLine(line);
    if (parsed && parsed.roomName === (roomName || 'general')) state.wrappedBlob = parsed.base64;
  }
}

/**
 * Encrypt and return wire payload (e2e.<base64>) for a chat message.
 */
export async function encryptMessage(roomKey, plaintext) {
  return encryptRoomMessage(roomKey, plaintext);
}

export { deriveTestRoomKey, parseWrappedRoomKeyLine };
