// Surface embed-layer errors through the editor's existing error popup
// (svelte-sonner — the same toast `routing-controls.ts` uses, with the
// `<Toaster richColors />` already mounted in the /app route). This is only
// ever called from embed code, which runs exclusively in embedded mode, so
// standalone behaviour is untouched. We also log to the console so the full
// error object (stack, cause) survives for debugging — the toast shows text.

import { toast } from 'svelte-sonner';

function describe(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try {
        return JSON.stringify(e);
    } catch {
        return String(e);
    }
}

// `context` is a human-readable summary of what failed; `e` (optional) is the
// underlying cause, appended as ": <detail>".
export function embedError(context: string, e?: unknown) {
    const message = e === undefined ? context : `${context}: ${describe(e)}`;
    console.error('[embed]', message, e);
    toast.error(message);
}
