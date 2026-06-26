# gpx.studio — embedded mode

This fork adds an **embedded mode** to the gpx.studio editor: it runs inside a host application's
`<iframe>`, owns **no files**, and exchanges GPX bytes with the host over `postMessage`. The host
owns storage, identity and versioning. A reference host lives in
the separate [**gpx.studio-bridge**](https://github.com/kludda/gpx.studio-bridge) repo.

Activate embedded mode by loading the editor with **`?embedded=1`** (e.g. `…/app?embedded=1`).
The embed layer lives under `website/src/lib/embed/`; it also touches `website/src/lib/db.ts` (a
commit hook for autosave), `…/components/Menu.svelte` ("Save to server"), and
`…/components/file-list/FileListNodeLabel.svelte` (the sync-status badge). Standalone (non-embedded)
behavior is unchanged.

## Dependencies

gpx.studio's **routing** (`graphhopper`) and **POI** (`overpass`) and **DEM/elevation tiles** (`mapterhorn`) services are fetch/XHR API calls that only send CORS headers for the `https://gpx.studio` origin, so from any other origin they fail and the editor becomes unusable.

The gpx.studio served map styles will also fail with browser console error, but the app still works without those maps.


### DEM/elevation tiles (`mapterhorn`)

You can fetch **DEM/elevation tiles** from `tiles.mapterhorn.com` directly instead. Set `VITE_ELEVATION_TILES_URL=https://tiles.mapterhorn.com` in `website/.env`.


### Routing (`graphhopper`) and POI (`overpass`)

#### Serve your own (`graphhopper`) and (`overpass`)

You can (likely, I have not tested) serve your own `graphhopper`, `overpass` and `mapterhorn` instances and point `VITE_GRAPHHOPPER_URL`, `VITE_OVERPASS_URL` and `VITE_ELEVATION_TILES_URL` in `website/.env` to those.

#### Revese proxy

You can reverse proxy the services and rewrite the headers.

#### Vite dev-server proxy

The easiest alternative in a dev environment is to fetch them  **same-origin** — `website/vite.config.ts` proxies them through the editor's own Vite dev server, so the browser never makes a cross-origin request and CORS simply never applies.

The proxy maps a relative path on the editor's own origin to each upstream, and `.env` points the
`VITE_*_URL` vars at those paths:

| service | proxy path (`website/vite.config.ts`) | env (`website/.env`) |
| --- | --- | --- |
| graphhopper | `/graphhopper` → `graphhopper.gpx.studio` | `VITE_GRAPHHOPPER_URL=/graphhopper` |
| overpass | `/overpass` → `overpass.gpx.studio` | `VITE_OVERPASS_URL=/overpass` |


> **Limitation — dev only.** `server.proxy` is a feature of the Vite *dev server*. A production
> `vite build` (static files) has no proxy, so a real deployment must move the service-proxying back
> to infrastructure. Fine for this POC, which runs the dev server.




## Run

First time you need to:
- build the `gpx` library, see [README.md](README.md).
- copy `website/.env.example` to `website/.env`.
- get a MapTiler key and add it to `website/.env`, see [README.md](README.md).
- edit env vars in `website/.env` for services that the app depends on, see comments in [website/.env.example](website/.env.example)


```bash
cd website
npm install                # first time only
npm run dev                # Vite dev server, pinned to :5180 (strictPort)
```


## The embed protocol (postMessage)

Modelled on [draw.io's embed protocol](https://github.com/jgraph/drawio/discussions/5612):
JSON objects over `window.postMessage`, activated by loading the editor with **`?embedded=1`**. The editor owns no files; it receives GPX bytes and emits GPX bytes, and the host owns storage, identity and versioning. The two run in the same browser at **different origins** (editor iframe vs. host shell), so every message is origin-checked.

**Field convention:**

- **Editor → host** messages carry an **`event`** field. The host ignores any message whose
  `origin` isn't the editor's, and switches on `msg.event`.
- **Host → editor** messages carry an **`action`** field. The editor ignores any object without an
  `action`, pins the host's origin on the first accepted message (trust-on-first-use) unless
  `VITE_EMBED_ALLOWED_ORIGINS` is set, and switches on `msg.action`.

**Identity.** The host `id` (`hostId`) is an **opaque token** the editor never interprets — how the
host derives it is the host's concern. Inside the iframe the editor uses its own local ids (`gpx-N`)
and keeps a `localId ↔ hostId`
registry — only `id`/`hostId` ever crosses `postMessage`. **`version`** is likewise an opaque token
the editor stores and echoes back unchanged, used by the host for conflict detection.

### Handshake

```
editor                                        host
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
| `{event:'init', files}` | Editor mounted and ready; expects `load`. `files` = the editor's already server-backed files as `[{id, version}]`, restored from a prior session, so the host can **reconcile each against the server before any edit** (the reload race — see [Reload reconciliation](#reload-reconciliation--conflicts)). Empty on a cold open. |
| `{event:'load', id}` | Ack of a finished `load`. |
| `{event:'autosave', id, data}` | Debounced (~`AUTOSAVE_DEBOUNCE_MS`) on any local change to a **server-backed** file. `data` = full `buildGPX` text. |
| `{event:'save', id, data}` | Explicit save of a server-backed file. Host treats it identically to `autosave`; the editor currently emits `autosave` for all local edits. |
| `{event:'save', tempId, data, name?}` | **Promotion** — "Save to server" on a browser-only file: a `save` with **no `id`**. `tempId` is the editor's local id; `name` is derived from the file metadata (`<name>.gpx`, else `untitled.gpx`). Host creates the resource and binds it back via `status` (carrying `tempId`). |

### Host → editor (`action`)

| Message | Effect |
| --- | --- |
| `{action:'load', id, data, title?, autosave:1}` | Open a file (one per opened file — multi-file): editor `parseGPX`s, opens it, maps `id ↔ localId`, and **selects** it. |
| `{action:'merge', id, data}` | Whole-file replace of an already-open file (collaboration inbound from the host). Preserves the map viewport. |
| `{action:'remove', id}` | Host removed file `id`; editor closes it. |
| `{action:'status', id, ok, version?, message?, tempId?}` | **Per-file ack** of a write outcome (`autosave`/`save`/promotion). `ok:true` carries the new `version` (adopted so the next poll won't echo the write back) → "Saved"; `ok:false` carries `message` → "Error". On a **promotion** ack it also carries `tempId` — no `id↔localId` binding exists yet, so this is how the editor binds its local file to the new path. |
| `{action:'status', ok:false, message}` *(no `id`/`tempId`)* | **Global host notice**, not a per-file ack — the editor can't resolve a `localId`, so there's no badge to set. It surfaces `message` as a **sticky, de-duplicated toast** (stable id → repeated sends refresh one toast and it auto-clears when they stop) — e.g. a host connection-loss notice. How the host decides to send it is the host's concern. |

The `status` ack is the only real addition beyond draw.io's set — it powers the status badge
without a websocket: the host just relays the result of its write back into the iframe. A
promotion needs no extra message: it is a `save` with no `id`, and `status` (carrying `tempId`)
both acks the write and delivers the binding.

### Promotion (browser-only file → server)

```
editor ──{event:'save', tempId, data, name}──────────────▶ host  POST /file  (auto-suffix on collision)
editor ◀──{action:'status', tempId, id, ok:true, version}── host  (bind localId → path; "Saved"; host now syncs id)
```

For ongoing collaboration the host pushes `{action:'merge', id, data}` whenever an open file changes
on its side, and the editor applies it as a **whole-file replace** (preserving the map viewport).
That is the whole of the editor's view: it never polls and never field-merges. What the `merge` bytes
represent (a last-write-wins overwrite, a real merge, …) and how the host notices the change
(polling, websocket, …) are the host's concern.

### Reload reconciliation & conflicts

Two cases need care beyond the happy path; both are driven from the editor side here.

- **Reload.** The editor persists its files in Dexie, so after a reload it shows its **last-known
  copy** — which may be behind the server if another session edited it meanwhile. To avoid a first
  edit autosaving that stale copy over the newer version, the editor re-announces its server-backed
  files in `{event:'init', files}` (see above) and marks them **"revalidating"** (the
  `saving`/`CloudSync` badge), *not* "Saved", until the host's `merge`/`status` reply settles them.
  The host then reconciles each against the server before any edit lands.
- **Conflict.** Each `autosave` carries a base `version`. If the host rejects it as stale, that
  arrives back as `{action:'status', id, ok:false, message}` → red badge + error toast; the host then
  sends a `merge`, which the editor applies as a whole-file replace (the local edit is discarded — the
  editor never field-merges). Whether a stale write is rejected at all, and what the surviving content
  is, are the host's policy.

The host-side counterparts — the version scheme, echo avoidance, the 409, and the id-less
connection-loss notice — are the host's concern.

