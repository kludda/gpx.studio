# gpx.studio (editor fork) — Claude Code working rules

A fork of gpx.studio with an **embedded mode** added. Embedded behavior, the postMessage protocol,
the CORS fix, and run instructions live in **`README-EMBEDDED.md`**; architecture and build order are
in the workspace `../plan.md`. This file is only how to work in this repo.

## Scope of changes
- **Confine all changes to `website/`.** Do **not** modify `gpx/` — use `parseGPX` / `buildGPX`
  as-is.
- The embed addon is `website/src/lib/embed/`. It also touches `website/src/lib/db.ts` (autosave
  commit hook), `…/components/Menu.svelte` ("Save to server"), and
  `…/components/file-list/FileListNodeLabel.svelte` (sync-status badge).

## Branches & commits
- `embedded-dev` — **default working branch**; commit at will, push often (remote backup).
- `embedded` — tidy; **only squashed large commits, and only when explicitly asked.**
- `upstream` — tracks upstream; **never commit our work here** (sync/rebase source only).
- Commit from this repo (`git -C gpx.studio …`); never `git` at the workspace root.

## Invariants (never violate — see `../plan.md` for the why)
- The editor owns **no files**; storage, identity and versioning are the host's.
- `gpx-N` local ids **stay inside the iframe**; the embed layer maps `localId ↔ hostId`, and only
  `hostId` ever crosses postMessage.
- Apply inbound host updates by writing **Dexie directly** (bypassing `commitFileStateChange`) so
  they don't echo back as autosaves.
- The `db.ts` commit hook must **not change standalone behavior** when the app isn't embedded.
