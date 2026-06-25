import { defineConfig } from 'vite'

// Two HTML entry points:
//   index.html -> the plugin "main" context (M), registered by Logseq, holds `logseq`.
//   plex.html  -> the plex UI (P), injected as an <iframe> into the right-sidebar slot.
// base:'./' keeps asset URLs relative so they resolve under Logseq's plugin scheme.
export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        plex: 'plex.html',
      },
    },
  },
})
