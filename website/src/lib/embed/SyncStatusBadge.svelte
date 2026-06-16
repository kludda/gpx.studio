<script lang="ts">
    import { CloudOff, CloudCheck, CloudSync, CloudAlert } from '@lucide/svelte';
    import * as Tooltip from '$lib/components/ui/tooltip/index.js';
    import { syncStatus, type SyncState } from './status';

    let { fileId }: { fileId: string } = $props();

    // POC strings are hardcoded (English) to avoid touching the typesafe-i18n
    // locale files for every language. A real build would add these as i18n keys.
    const icons = {
        local: CloudOff,
        saving: CloudSync,
        saved: CloudCheck,
        error: CloudAlert,
    } satisfies Record<SyncState, unknown>;

    const tips: Record<SyncState, string> = {
        local: 'Browser-only — not synced',
        saving: 'Syncing file to server',
        saved: 'File synced to server',
        error: 'Error',
    };

    let entry = $derived($syncStatus.get(fileId));
    let state = $derived<SyncState>(entry?.state ?? 'local');
    let Icon = $derived(icons[state]);
    // The error tooltip surfaces the host's actual message; fall back to a generic label.
    let tip = $derived(state === 'error' ? (entry?.message ?? tips.error) : tips[state]);
</script>

<Tooltip.Provider>
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#snippet child({ props })}
                <!-- Render a <span> (not the default <button>) — the badge sits inside the
                     row's <button>, and it's passive (no click handling). -->
                <!-- No color override for non-error states → inherit currentColor, matching
                     the rest of the file-list icons. Error stays red. -->
                <span
                    {...props}
                    aria-label={tip}
                    class="shrink-0 inline-flex items-center pl-1 pr-2 select-none {state === 'error'
                        ? 'text-destructive'
                        : ''}"
                >
                    <Icon size="16" />
                </span>
            {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">
            <span>{tip}</span>
        </Tooltip.Content>
    </Tooltip.Root>
</Tooltip.Provider>
