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
npx wrangler secret put ACCESS_KEY
npm run deploy
```

`secret put` asks for the **access key**: whatever you like, as long as you
remember it. Every request has to carry it, so nobody else can store data on
your server even though its URL is in the public site. The server refuses
everything until it's set. It's separate from the sync code — the server sees
the access key, never the code — so it controls who can use the server, not
who can read your data. Sync links carry it, so you only ever type it once,
when you first turn sync on.

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
printf 'ACCESS_KEY=any-local-key\n' > .dev.vars   # gitignored
npm run dev            # http://127.0.0.1:8787
```

and point the app at it with a gitignored `.env.development.local` in the repo
root containing `VITE_SYNC_URL=http://127.0.0.1:8787`.

## API

Every request needs `Authorization: Bearer <ACCESS_KEY>`, or gets `401`.

| Request | Response |
| --- | --- |
| `GET /v1/vault/:id` | `200 { rev, data }`, or `404` if nothing's stored yet |
| `PUT /v1/vault/:id` with `{ rev, data }` | `200 { rev }` when `rev` matches what's stored (0 for a new vault); otherwise `409 { rev, data }` with the current copy to merge against |

`:id` is 64 hex characters. `data` is the sealed blob, at most 1.5 MB.

## What it can and can't see

It sees the access key, the vault id, the size of the encrypted data, when it
changes, and the IP addresses of the requests. It never sees the sync code or
the encryption key, which never leave your devices, so it can't decrypt
anything.

The URL ends up in the public site bundle, which is what the access key is for.
Someone who guessed it could store blobs of their own here, but still couldn't
read or touch yours without your sync code. A long key makes guessing
pointless; change it any time with `wrangler secret put ACCESS_KEY`, then reopen
a sync panel on each device and join again with the new key.
