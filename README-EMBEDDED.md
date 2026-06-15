# gpx.studio — embedded mode

This fork adds an **embedded mode** to the gpx.studio editor: it runs inside a host application's
`<iframe>`, owns **no files**, and exchanges GPX bytes with the host over `postMessage`. The host
owns storage, identity and versioning; collaboration is last-write-wins. A reference host lives in
the separate **gpx.studio-bridge** repo.

Activate embedded mode by loading the editor with **`?embedded=1`** (e.g. `…/app?embedded=1`).
The embed layer lives under `website/src/lib/embed/`; it also touches `website/src/lib/db.ts` (a
commit hook for autosave), `…/components/Menu.svelte` ("Save to server"), and
`…/components/file-list/FileListNodeLabel.svelte` (the sync-status badge). Standalone (non-embedded)
behavior is unchanged.

## Run (editor dev server)

```bash
cd website
npm install                # first time
npm run dev                # Vite dev server, pinned to :5180 (strictPort)
```

`npm install` needs `PUBLIC_MAPTILER_KEY` in `website/.env` (plus the embed vars below for routing/
POIs and the postMessage allowlist — see [CORS fix](#cors-fix-vite-dev-server-proxy)).

The editor app is at **`/app`**. Open `http://localhost:5180/app` for the standalone editor, or
`http://localhost:5180/app?embedded=1` to run in embedded mode — though embedded mode is normally
loaded inside a host's `<iframe>` (e.g. the bridge shell, which points its iframe at
`…/app?embedded=1`). Opened directly (not in an iframe) it announces `init` but no host answers with
`load`, so no files arrive — drive it from a host to see it work.

## The embed protocol (postMessage)

Modelled on [draw.io's embed protocol](https://github.com/jgraph/drawio/discussions/5612):
JSON objects over `window.postMessage`, activated by loading the editor with **`?embedded=1`**
(not `?embed=1` — that hits upstream's legacy read-only map-embed redirect). The editor owns no
files; it receives GPX bytes and emits GPX bytes, and the host owns storage, identity and
versioning. The two run in the same browser at **different origins** (editor iframe vs. host shell),
so every message is origin-checked.

**Field convention (draw.io-style, note the asymmetry):**

- **Editor → host** messages carry an **`event`** field. The host ignores any message whose
  `origin` isn't the editor's, and switches on `msg.event`.
- **Host → editor** messages carry an **`action`** field. The editor ignores any object without an
  `action`, pins the host's origin on the first accepted message (trust-on-first-use unless
  `VITE_EMBED_ALLOWED_ORIGINS` is set), and switches on `msg.action`.

**Identity.** The host **`id` is the file's path relative to the store root** (e.g.
`trips/day1.gpx`). Inside the iframe the editor uses its own local ids (`gpx-N`) and keeps a
`localId ↔ hostId` registry — only `id`/`hostId` ever crosses `postMessage`. **`version`** is an
opaque token (the backend's `st_mtime_ns`) used for last-write-wins.

### Handshake

```
editor (iframe, ?embedded=1)                 host (e.g. bridge shell)
  │  restore registry, attach listeners        │
  │ ──{event:'init'}──────────────────────────▶│  "editor ready"
  │                                             │  GET /file  → bytes+version
  │ ◀─{action:'load', id, data, title?, ───────│  (one per opened file)
  │      autosave:1}                            │
  │  parseGPX, open, map id↔localId             │
  │ ──{event:'load', id}──────────────────────▶│  (ack; informational)
```

Until the first inbound message arrives the editor doesn't yet know the host's origin, so its
`init` is announced with `targetOrigin: '*'`; thereafter it targets the pinned host origin.

### Editor → host (`event`)

| Message | When |
| --- | --- |
| `{event:'init'}` | Editor mounted and ready; expects `load`. |
| `{event:'load', id}` | Ack of a finished `load`. |
| `{event:'autosave', id, data}` | Debounced (~`AUTOSAVE_DEBOUNCE_MS`) on any local change to a **server-backed** file. `data` = full `buildGPX` text. |
| `{event:'save', id, data}` | Explicit save of a server-backed file. Host treats it identically to `autosave`; the editor currently emits `autosave` for all local edits. |
| `{event:'save', tempId, data, name?}` | **Promotion** — "Save to server" on a browser-only file: a `save` with **no `id`**. `tempId` is the editor's local id; `name` is derived from the file metadata (`<name>.gpx`, else `untitled.gpx`). Host creates the resource and binds it back via `status` (carrying `tempId`). |

### Host → editor (`action`)

| Message | Effect |
| --- | --- |
| `{action:'load', id, data, title?, autosave:1}` | Open a file (one per opened file — multi-file): editor `parseGPX`s, opens it, maps `id ↔ localId`, and **selects** it. |
| `{action:'merge', id, data}` | Whole-file LWW replace of an already-open file (collaboration inbound from the poll loop). Preserves the map viewport. |
| `{action:'remove', id}` | Host removed file `id`; editor closes it. |
| `{action:'status', id, ok, version?, message?, tempId?}` | **Ack** of a write outcome (`autosave`/`save`/promotion). `ok:true` carries the new `version` (adopted so the next poll won't echo the write back) → "Saved"; `ok:false` carries `message` → "Error". On a **promotion** ack it also carries `tempId` — no `id↔localId` binding exists yet, so this is how the editor binds its local file to the new path. |

The `status` ack is the only real addition beyond draw.io's set — it powers the status badge
without a websocket: the host just relays the result of its write back into the iframe. A
promotion needs no extra message: it is a `save` with no `id`, and `status` (carrying `tempId`)
both acks the write and delivers the binding.

### Promotion (browser-only file → server)

```
editor ──{event:'save', tempId, data, name}──────────────▶ host  POST /file  (auto-suffix on collision)
editor ◀──{action:'status', tempId, id, ok:true, version}── host  (bind localId → path; "Saved"; host starts polling id)
```

Collaboration is **last-write-wins, poll-based** (no websocket): the host pushes
`{action:'merge', id, data}` when an open file changes on its side, and the editor applies it as a
whole-file replace (preserving the map viewport). The host-side poll/echo mechanics live in the
[bridge README](../gpx.studio-bridge/README.md).

## CORS fix (Vite dev-server proxy)

gpx.studio's **routing** (`graphhopper`) and **POI** (`overpass`) services are fetch/XHR API calls
that only send CORS headers for the `https://gpx.studio` origin, so from any other origin they
silently fail ("tools dead"). The fix is to fetch them **same-origin** — `website/vite.config.ts`
proxies them through the editor's own Vite dev server, so the browser never makes a cross-origin
request and CORS simply never applies. (`tiles`/`styles` — and the `fonts`/`sprites` they reference —
load fine cross-origin, so they need no proxy and stay pointed at upstream `*.gpx.studio` in source.)

The proxy maps a relative path on the editor's own origin to each upstream, and `.env` points the
`VITE_*_URL` vars at those paths:

| service | proxy path (`website/vite.config.ts`) | env (`website/.env`) |
| --- | --- | --- |
| graphhopper | `/graphhopper` → `graphhopper.gpx.studio` | `VITE_GRAPHHOPPER_URL=/graphhopper` |
| overpass | `/overpass` → `overpass.gpx.studio` | `VITE_OVERPASS_URL=/overpass` |

Because the fetch is same-origin, there's **no CORS, no preflight, and no mixed-content** to manage —
the whole fix lives in the repo (`vite.config.ts` + `.env`).

> **Limitation — dev only.** `server.proxy` is a feature of the Vite *dev server*. A production
> `vite build` (static files) has no proxy, so a real deployment must move the service-proxying back
> to infrastructure (Caddy/nginx). Fine for this POC, which runs the dev server.

### Editor env (`website/.env`)

```ini
VITE_GRAPHHOPPER_URL=/graphhopper
VITE_OVERPASS_URL=/overpass
# postMessage allowlist — the host's origin (unset = trust-on-first-use, POC default)
VITE_EMBED_ALLOWED_ORIGINS=https://gpx.example.com
```

The service URLs are relative paths, so they're scheme-agnostic. `VITE_EMBED_ALLOWED_ORIGINS` is the
editor's postMessage allowlist — set it to the host's origin to lock down inbound messages; unset =
trust-on-first-use (allows any parent — the POC default).

### Vite host check

When served behind a reverse proxy on a real hostname, Vite's dev server rejects `Host` headers it
isn't told to trust (`Blocked request. This host … is not allowed.`). Add the hostname to
`server.allowedHosts` in `website/vite.config.ts` (a leading-dot wildcard covers a domain and all
its subdomains):

```js
server: { /* … */ allowedHosts: ['.example.com'] }
```

### Coverage

The Vite proxy covers only `graphhopper` and `overpass` — the two services that are CORS-locked to
`https://gpx.studio`. `tiles`, `styles`, and the `fonts`/`sprites` referenced inside the style JSON
load fine cross-origin, so they're fetched directly from upstream `*.gpx.studio` (unmodified source)
and need no proxy. Routing, elevation, terrain, POIs, and basemaps all work as-is.

## Hosting the editor

Running the editor behind a real hostname (so the host iframe can reach it), the external reverse
proxy that serves both apps, TLS, and access from other machines are deployment concerns documented
with the reference host in the **gpx.studio-bridge** repo's README.
