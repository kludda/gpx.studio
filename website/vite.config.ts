import { sveltekit } from '@sveltejs/kit/vite';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    // Pinned so the bridge's iframe (VITE_EDITOR_URL) has a stable target.
    // 5173 is occupied by another local project here; strictPort fails loudly
    // rather than silently floating to a port the host can't predict.
    server: {
        port: 5180,
        strictPort: true,
        // [embed] Allow the reverse-proxied host (gpxstudio.eel.se) through Vite's host check.
        // Leading dot = the domain and all its subdomains.
        allowedHosts: ['.eel.se'],
    },
    ssr: {
        noExternal: ['gpx'],
    },
    plugins: [enhancedImages(), tailwindcss(), sveltekit()],
});
