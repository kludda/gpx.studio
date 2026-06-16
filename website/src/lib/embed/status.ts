import { writable } from 'svelte/store';

// Per-file sync status, keyed by the editor-local file id (gpx-N). Drives the
// SyncStatusBadge in the file list. Files not in the map are browser-only and
// render as the "local" state.
export type SyncState = 'local' | 'saving' | 'saved' | 'error';

// `message` carries the host's error text (from the `status` postMessage) so the
// badge can surface it in the error tooltip. Only meaningful for the 'error' state.
export type SyncEntry = { state: SyncState; message?: string };

export const syncStatus = writable<Map<string, SyncEntry>>(new Map());

export function setStatus(localId: string | undefined, state: SyncState, message?: string) {
    if (!localId) return;
    syncStatus.update((m) => new Map(m).set(localId, { state, message }));
}

export function clearStatus(localId: string) {
    syncStatus.update((m) => {
        const next = new Map(m);
        next.delete(localId);
        return next;
    });
}
