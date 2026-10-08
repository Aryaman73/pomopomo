// ── pomopomo sync server ─────────────────────────────────────────────────────
//
// Deliberately dumb. It stores one opaque string per vault and a revision
// number, and it never sees anything it could read: the vault id is a hash
// derived from the sync code, and the data is encrypted in the browser before
// it's sent. All the merging happens on the devices.
//
// The only thing it's trusted with is ordering. Writes are compare-and-swap on
// the revision, so two devices writing at once can't silently overwrite each
// other — the second one is refused, handed the current data, and merges.
// Each vault is its own Durable Object, which runs one request at a time, so
// that check-then-write can't interleave.

import { DurableObject } from "cloudflare:workers";

// Durable Object values top out at 2 MB. Leave room under it.
const MAX_DATA = 1_500_000;
const VAULT_PATH = /^\/v1\/vault\/([0-9a-f]{64})$/;

export class Vault extends DurableObject {
  async read() {
    const stored = await this.ctx.storage.get(["rev", "data"]);
    const rev = stored.get("rev");
    return rev ? { rev, data: stored.get("data") } : null;
  }

  async write(expected, data) {
    const rev = (await this.ctx.storage.get("rev")) ?? 0;
    if (rev !== expected) {
      return { ok: false, rev, data: await this.ctx.storage.get("data") };
    }
    await this.ctx.storage.put({ rev: rev + 1, data });
    return { ok: true, rev: rev + 1 };
  }
}

function allowedOrigin(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes("*")) return origin || "*";
  return origin && allowed.includes(origin) ? origin : null;
}

function respond(body, status, origin) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, PUT, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin");
    const origin = allowedOrigin(requestOrigin, env);
    // A browser on a page that isn't allowed. Requests without an Origin (curl,
    // health checks) carry on: the data is ciphertext either way.
    if (requestOrigin && !origin) return respond({ error: "origin not allowed" }, 403, null);

    if (request.method === "OPTIONS") return respond(null, 204, origin);

    const match = VAULT_PATH.exec(new URL(request.url).pathname);
    if (!match) return respond({ error: "not found" }, 404, origin);
    const vault = env.VAULT.get(env.VAULT.idFromName(match[1]));

    if (request.method === "GET") {
      const stored = await vault.read();
      return stored ? respond(stored, 200, origin) : respond({ error: "empty" }, 404, origin);
    }

    if (request.method === "PUT") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > MAX_DATA + 1024) return respond({ error: "too large" }, 413, origin);

      let body;
      try {
        body = await request.json();
      } catch {
        return respond({ error: "bad json" }, 400, origin);
      }
      const { rev, data } = body || {};
      if (!Number.isInteger(rev) || rev < 0 || typeof data !== "string" || !data) {
        return respond({ error: "expected { rev, data }" }, 400, origin);
      }
      if (data.length > MAX_DATA) return respond({ error: "too large" }, 413, origin);

      const result = await vault.write(rev, data);
      return result.ok
        ? respond({ rev: result.rev }, 200, origin)
        : respond({ rev: result.rev, data: result.data }, 409, origin);
    }

    return respond({ error: "method not allowed" }, 405, origin);
  },
};
