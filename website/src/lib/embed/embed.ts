// Embed mode for gpx.studio — the editor half of the draw.io-style postMessage
// protocol (see plan.md). Activated by `?embedded=1`. (Note: `?embed` is taken
// by upstream's legacy read-only map-embedding redirect in the root +layout, so
// editor-embed mode uses the distinct `embedded` key to avoid that redirect.)
// All editor-owns-no-files
// logic lives here; standalone behaviour is untouched when this is never called.
//
// Key invariants:
//  - `gpx-N` ids never leave the iframe. The registry maps localId ↔ hostId
//    (the host's relative path); only hostId crosses postMessage.
//  - Inbound files/changes are written *directly to Dexie*, bypassing
//    commitFileStateChange, so they don't echo back out as autosaves.
//  - Local edits flow out via the commit hook (onLocalCommit).

import { get } from 'svelte/store';
import { freeze } from 'immer';
import { parseGPX, buildGPX, GPXFile } from 'gpx';
import { db } from '$lib/db';
import { onLocalCommit } from '$lib/logic/file-action-manager';
import { fileStateCollection } from '$lib/logic/file-state';
import { getFileIds } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { setStatus, clearStatus } from './status';

const AUTOSAVE_DEBOUNCE_MS = 500;

// localId (gpx-N) → host binding. Presence in the registry == "server-backed".
type Entry = { hostId: string; version?: number };
const registry = new Map<string, Entry>();
const localByHost = () => new Map([...registry].map(([l, e]) => [e.hostId, l]));

// The registry must survive an iframe/bridge reload so promoted (server-backed)
// files keep their localId↔hostId binding — otherwise they'd lose autosave/status
// and a re-`load` from the host would create a duplicate gpx-N instead of
// re-attaching. Dexie itself persists by design; we mirror the mapping into
// localStorage (durable + shared across same-origin tabs, like the shared DB).
const REGISTRY_KEY = 'gpxstudio:embed:registry';

function persistRegistry() {
    try {
        localStorage.setItem(REGISTRY_KEY, JSON.stringify([...registry]));
    } catch {
        /* storage unavailable/full — non-fatal */
    }
}

async function restoreRegistry() {
    let stored: [string, Entry][];
    try {
        stored = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]');
    } catch {
        return;
    }
    if (!Array.isArray(stored) || stored.length === 0) return;
    // Only keep entries whose file still exists in Dexie (it may have been
    // deleted from another tab while this one was gone).
    const liveIds = new Set(await db.fileids.toArray());
    let changed = false;
    for (const [localId, entry] of stored) {
        if (entry && typeof entry.hostId === 'string' && liveIds.has(localId)) {
            registry.set(localId, entry);
            setStatus(localId, 'saved'); // server-backed → reflect synced state
        } else {
            changed = true; // dropped a stale entry
        }
    }
    if (changed) persistRegistry();
}

// Guard so direct-to-Dexie inbound writes never trigger an outbound autosave.
let applyingRemote = false;

// --------------------------------------------------------------------------- //
// Transport: origin-checked postMessage to the host (window.parent).
// --------------------------------------------------------------------------- //
const configuredOrigins = (import.meta.env.VITE_EMBED_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

// Host origin, learned on the first accepted inbound message (trust-on-first-use
// when no allowlist is configured — fine for the local POC). Until then we must
// announce with '*' since we don't yet know the parent's origin.
let hostOrigin: string | null = null;

function originAllowed(origin: string): boolean {
    if (configuredOrigins.length > 0) return configuredOrigins.includes(origin);
    return true; // POC default: TOFU. Set VITE_EMBED_ALLOWED_ORIGINS to lock down.
}

function post(msg: Record<string, unknown>) {
    window.parent?.postMessage(msg, hostOrigin ?? '*');
}

// --------------------------------------------------------------------------- //
// Inbound: load / merge — write straight to Dexie (echo-free).
// liveQuery in fileStateCollection picks the write up and renders it.
// --------------------------------------------------------------------------- //
async function applyIncoming(hostId: string, data: string, title?: string) {
    applyingRemote = true;
    try {
        const file = parseGPX(data);
        if (file.metadata === undefined) file.metadata = {};
        if (title && (!file.metadata.name || file.metadata.name.trim() === '')) {
            file.metadata.name = title.replace(/\.gpx$/i, '');
        }

        let localId = localByHost().get(hostId);
        if (!localId) {
            localId = getFileIds(1)[0];
            registry.set(localId, { hostId });
            persistRegistry();
        }
        file._data.id = localId;

        await db.transaction('rw', db.files, db.fileids, async () => {
            await db.files.put(freeze(file), localId!);
            await db.fileids.put(localId!, localId!);
        });
        setStatus(localId, 'saved'); // in sync with the host
        return localId;
    } finally {
        applyingRemote = false;
    }
}

async function removeIncoming(hostId: string) {
    const localId = localByHost().get(hostId);
    if (!localId) return;
    applyingRemote = true;
    try {
        await db.transaction('rw', db.files, db.fileids, async () => {
            await db.files.delete(localId);
            await db.fileids.delete(localId);
        });
    } finally {
        applyingRemote = false;
    }
    registry.delete(localId);
    persistRegistry();
    clearStatus(localId);
}

// --------------------------------------------------------------------------- //
// Outbound: debounced autosave of server-backed files on local commits.
// --------------------------------------------------------------------------- //
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
    for (const localId of pending) {
        const entry = registry.get(localId);
        const file = fileStateCollection.getFile(localId);
        if (entry && file) {
            // exclude nothing — round-trip the full file back to the host.
            post({ event: 'autosave', id: entry.hostId, data: buildGPX(file, []) });
        }
    }
    pending.clear();
}

function onCommit(updated: string[], deleted: string[]) {
    if (applyingRemote) return;
    let scheduled = false;
    for (const id of updated) {
        if (registry.has(id)) {
            pending.add(id);
            setStatus(id, 'saving');
            scheduled = true;
        }
    }
    // A local delete of a server-backed file: drop its registry entry. (The host
    // is not asked to delete in this POC — deletion is host-driven via remove.)
    let registryChanged = false;
    for (const id of deleted) {
        if (registry.has(id)) {
            registry.delete(id);
            clearStatus(id);
            pending.delete(id);
            registryChanged = true;
        }
    }
    if (registryChanged) persistRegistry();
    if (scheduled) {
        clearTimeout(timer);
        timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    }
}

// --------------------------------------------------------------------------- //
// Promotion: "Save to server" on a browser-only file. Exposed to the Menu.
// --------------------------------------------------------------------------- //
export function saveToServer(localId: string) {
    if (registry.has(localId)) return; // already server-backed
    const file = fileStateCollection.getFile(localId);
    if (!file) return;
    setStatus(localId, 'saving');
    const name = file.metadata?.name?.trim();
    post({
        event: 'saveToHost',
        tempId: localId,
        data: buildGPX(file, []),
        name: name ? `${name}.gpx` : 'untitled.gpx',
    });
}

export function isServerBacked(localId: string): boolean {
    return registry.has(localId);
}

// --------------------------------------------------------------------------- //
// Inbound dispatch.
// --------------------------------------------------------------------------- //
async function handleAction(m: Record<string, any>) {
    switch (m.action) {
        case 'load': {
            // Single inbound-open action (multi-file): every loaded file is
            // selected/activated — preferred UX over silently adding in the bg.
            const localId = await applyIncoming(m.id, m.data, m.title);
            if (localId) {
                selection.selectFileWhenLoaded(localId);
            }
            post({ event: 'load', id: m.id });
            break;
        }
        case 'merge':
            // Whole-file LWW replace. boundsManager only auto-fits *new* files,
            // so replacing an already-open file preserves the map viewport.
            await applyIncoming(m.id, m.data, m.title);
            break;
        case 'remove':
            await removeIncoming(m.id);
            break;
        case 'status': {
            // Host's ack of a write outcome (draw.io-style single status channel).
            // `ok:true` carries the new version; `ok:false` carries a message.
            const localId = localByHost().get(m.id);
            if (!localId) break;
            if (m.ok) {
                const entry = registry.get(localId);
                if (entry) {
                    entry.version = m.version;
                    persistRegistry();
                }
                setStatus(localId, 'saved');
            } else {
                setStatus(localId, 'error');
            }
            break;
        }
        case 'assignId':
            registry.set(m.tempId, { hostId: m.id });
            persistRegistry();
            setStatus(m.tempId, 'saved');
            break;
    }
}

// --------------------------------------------------------------------------- //
// Bootstrap.
// --------------------------------------------------------------------------- //
let started = false;

export function isEmbedded(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('embedded') === '1';
}

export async function initEmbed() {
    if (started || !isEmbedded()) return;
    started = true;

    // Dexie persists by design (browser-local files stay until promoted). Restore
    // the localId↔hostId registry so server-backed files keep their host binding
    // across a reload — must run before we accept inbound messages so re-`load`s
    // re-attach to the existing gpx-N instead of creating duplicates.
    await restoreRegistry();

    onLocalCommit(onCommit);

    window.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object' || !m.action) return; // ignore noise
        if (!originAllowed(e.origin)) return;
        if (hostOrigin === null) hostOrigin = e.origin; // pin host origin (TOFU)
        else if (e.origin !== hostOrigin) return;
        handleAction(m as Record<string, any>);
    });

    post({ event: 'init' });
}
