<script lang="ts">
    import { syncStatus, type SyncState } from './status';

    let { fileId }: { fileId: string } = $props();

    // POC labels are hardcoded (English) to avoid touching the typesafe-i18n
    // locale files for every language. A real build would add these as i18n keys.
    const labels: Record<SyncState, string> = {
        local: 'Local',
        saving: 'Saving…',
        saved: 'Saved',
        error: 'Error',
    };

    let state = $derived($syncStatus.get(fileId) ?? 'local');
</script>

<span
    class="shrink-0 text-xs px-1 leading-none select-none {state === 'error'
        ? 'text-destructive'
        : 'text-muted-foreground'}"
    title={labels[state]}
>
    {labels[state]}
</span>
