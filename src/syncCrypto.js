// ── The sync code, and what it unlocks ───────────────────────────────────────
//
// One random code is the whole of sync's secret. From it, each device derives
// two unrelated things: the vault id, which is the name the server files the
// data under, and the AES key that data is encrypted with. Both come out of
// HKDF, which is one-way — knowing the id tells you nothing about the key. So
// the server holds an id and some ciphertext, and never anything that could
// turn one into the other.
//
// The code is 25 characters of Crockford base32: 125 random bits, which is
// past guessing and still short enough to type into a phone if it has to be.

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const LENGTH = 25;
const FORMAT = 1;

const utf8 = (text) => new TextEncoder().encode(text);

export function newCode() {
  // 32 divides 256, so masking a random byte down to 5 bits is unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return formatCode(Array.from(bytes, (b) => ALPHABET[b & 31]).join(""));
}

/** `abcde-fghjk-…`, for reading aloud or copying by hand. */
export function formatCode(code) {
  return code.match(/.{1,5}/g).join("-");
}

/**
 * The canonical form of a code someone typed or pasted, or null if it isn't
 * one. Forgiving the way Crockford base32 is meant to be: case, dashes and
 * spaces don't matter, and the letters that look like digits read as digits.
 */
export function parseCode(input) {
  const code = String(input || "")
    .toLowerCase()
    .replace(/[\s-]/g, "")
    .replace(/o/g, "0")
    .replace(/[il]/g, "1");
  if (code.length !== LENGTH) return null;
  if ([...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

const derived = new Map();

/** `{ id, key }` for a code. Cached: HKDF is cheap, but not free on a phone. */
export function deriveVault(code) {
  if (!derived.has(code)) {
    derived.set(
      code,
      (async () => {
        const material = await crypto.subtle.importKey("raw", utf8(code), "HKDF", false, [
          "deriveBits",
          "deriveKey",
        ]);
        const params = (info) => ({
          name: "HKDF",
          hash: "SHA-256",
          salt: utf8("pomopomo-sync"),
          info: utf8(info),
        });
        const id = hex(await crypto.subtle.deriveBits(params("vault-id"), material, 256));
        const key = await crypto.subtle.deriveKey(
          params("vault-key"),
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
        return { id, key };
      })()
    );
  }
  return derived.get(code);
}

// ── Sealing ──────────────────────────────────────────────────────────────────
//
// JSON, gzipped, then AES-GCM with a fresh IV each time. The vault id goes in
// as associated data, so a blob copied from one vault into another fails to
// open rather than quietly becoming someone else's planner. Gzip first because
// ciphertext doesn't compress, and a year of sessions is mostly repetition.

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

const canGzip = typeof CompressionStream === "function";

function toBase64(bytes) {
  let binary = "";
  // In chunks: spreading a megabyte into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function seal(vault, value) {
  let bytes = utf8(JSON.stringify({ format: FORMAT, value }));
  if (canGzip) bytes = await pipe(bytes, new CompressionStream("gzip"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(vault.id) },
    vault.key,
    bytes
  );
  const out = new Uint8Array(iv.length + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), iv.length);
  return `${canGzip ? "z" : "p"}.${toBase64(out)}`;
}

/** Throws if the blob can't be opened with this vault's key, or is from a newer build. */
export async function open(vault, blob) {
  const [mode, body] = String(blob).split(".");
  if ((mode !== "z" && mode !== "p") || !body) throw new Error("unreadable");
  const raw = fromBase64(body);
  let bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: utf8(vault.id) },
      vault.key,
      raw.subarray(12)
    )
  );
  if (mode === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("unsupported");
    bytes = await pipe(bytes, new DecompressionStream("gzip"));
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || parsed.format > FORMAT) throw new Error("newer");
  return parsed.value;
}
