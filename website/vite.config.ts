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
        // [embed] CORS fix: graphhopper + overpass are fetch/XHR API calls that gpx.studio
        // only CORS-allows for https://gpx.studio, so we proxy them through this dev server —
        // the editor calls them as same-origin relative paths (see .env VITE_*_URL=/…) → no
        // CORS at all. `changeOrigin` rewrites the Host header so upstream TLS SNI + vhost
        // routing work. tiles/styles (and the fonts/sprites they reference) load fine
        // cross-origin, so they stay pointed at upstream — no proxy needed.
        // NOTE: dev-server only — a production build needs an infra-level proxy instead.
        proxy: {
            '/graphhopper': {
                target: 'https://graphhopper.gpx.studio',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/graphhopper/, ''),
            },
            '/overpass': {
                target: 'https://overpass.gpx.studio',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/overpass/, ''),
            },
        },
    },
    ssr: {
        noExternal: ['gpx'],
    },
    plugins: [enhancedImages(), tailwindcss(), sveltekit()],
});
