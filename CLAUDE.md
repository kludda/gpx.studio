# gpx.studio (editor fork) — Claude Code working rules

A fork of gpx.studio with an **embedded mode** added. Embedded behavior, the postMessage protocol,
the architecture, the CORS fix, and run instructions live in **`README-EMBEDDED.md`**. This file is
only how to work in this repo.

## Scope of changes
- **Confine all changes to `website/`.** Do **not** modify `gpx/` — use `parseGPX` / `buildGPX`
  as-is.
- The embed addon is `website/src/lib/embed/`. It also touches
  `website/src/lib/logic/file-action-manager.ts` (the `onLocalCommit` autosave tap + the embed
  bootstrap), `…/components/Menu.svelte` ("Save to server"), and
  `…/components/file-list/FileListNodeLabel.svelte` (sync-status badge).

## Branches & commits
- `embedded-dev` — **default working branch**; commit at will, push often (remote backup).
- `embedded` — tidy; **only squashed large commits, and only when explicitly asked.**
- `upstream` — tracks upstream; **never commit our work here** (sync/rebase source only).
- Keep editor changes in their own commits, separate from the bridge.
- **Never commit `website/package-lock.json` or `website/static/en.manifest.webmanifest`** — these
  carry persistent local-only churn; leave them in the working tree and stage files explicitly.

## Invariants (never violate — see `README-EMBEDDED.md` for the why)
- The editor owns **no files**; storage, identity and versioning are the host's.
- `gpx-N` local ids **stay inside the iframe**; the embed layer maps `localId ↔ hostId`, and only
  `hostId` ever crosses postMessage.
- Apply inbound host updates by writing **Dexie directly** (bypassing `commitFileStateChange`) so
  they don't echo back as autosaves.
- The `file-action-manager.ts` commit tap (`onLocalCommit`) must **not change standalone behavior**
  when the app isn't embedded — it stays null and inert unless `$lib/embed` registers a listener.
