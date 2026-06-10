import { writable } from 'svelte/store';

// Per-file sync status, keyed by the editor-local file id (gpx-N). Drives the
// SyncStatusBadge in the file list. Files not in the map are browser-only and
// render as "Local".
export type SyncState = 'local' | 'saving' | 'saved' | 'error';

export const syncStatus = writable<Map<string, SyncState>>(new Map());

export function setStatus(localId: string | undefined, s: SyncState) {
    if (!localId) return;
    syncStatus.update((m) => new Map(m).set(localId, s));
}

export function clearStatus(localId: string) {
    syncStatus.update((m) => {
        const next = new Map(m);
        next.delete(localId);
        return next;
    });
}
