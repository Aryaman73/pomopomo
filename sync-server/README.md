# pomopomo sync server

A Cloudflare Worker that keeps one encrypted blob per sync vault. It can't read
anything it stores: the vault id is a hash derived from your sync code, and the
data is encrypted in the browser before it's sent. Merging happens on the
devices; the server only refuses a write that's based on an out-of-date copy,
so two devices can't overwrite each other.

Runs on Cloudflare's free plan. Each open pomopomo tab makes at most about one
request a minute, plus one per burst of edits — nowhere near the free limits.

## Deploying

You need a Cloudflare account (free) and Node 20+.

```bash
cd sync-server
npm install
npx wrangler login
npm run deploy
```

`deploy` prints the server's URL — something like
`https://pomopomo-sync.<your-subdomain>.workers.dev`.

Then tell the site about it, so the sync panel doesn't have to ask. In the
GitHub repo: **Settings → Secrets and variables → Actions → Variables**, add
`SYNC_URL` with that URL — or from the repo folder:

```bash
gh variable set SYNC_URL --body "https://pomopomo-sync.<your-subdomain>.workers.dev"
```

and re-run the Pages deploy (push to `master`, or run the workflow by hand).

## Allowed sites

`ALLOWED_ORIGINS` in `wrangler.toml` lists the pages that may call the server:
`https://aryamans.me` and local dev ports. Add your own if pomopomo is served
from somewhere else, then deploy again.

## Running it locally

```bash
npm run dev            # http://127.0.0.1:8787
```

and point the app at it with a gitignored `.env.development.local` in the repo
root containing `VITE_SYNC_URL=http://127.0.0.1:8787`.

## API

| Request | Response |
| --- | --- |
| `GET /v1/vault/:id` | `200 { rev, data }`, or `404` if nothing's stored yet |
| `PUT /v1/vault/:id` with `{ rev, data }` | `200 { rev }` when `rev` matches what's stored (0 for a new vault); otherwise `409 { rev, data }` with the current copy to merge against |

`:id` is 64 hex characters. `data` is the sealed blob, at most 1.5 MB.

## What it can and can't see

It sees the vault id, the size of the encrypted data, when it changes, and the
IP addresses of the requests. It never sees the sync code or the key, which
never leave your devices, so it can't decrypt anything.

The URL ends up in the public site bundle, so anyone could store blobs of
their own on it. They can't read or touch yours without your sync code.
