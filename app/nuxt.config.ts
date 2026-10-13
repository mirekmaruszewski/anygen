export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // The Nuxt project root is app/ itself (pages/, components/, server/ live directly under it).
  srcDir: '.',
  modules: ['@pinia/nuxt'],
  // Workspace packages ship TypeScript source.
  build: { transpile: ['@anygen/core', '@anygen/nodes'] },
  // Baklava is only loaded by the client-only editor, so Vite would otherwise discover (and
  // re-optimize) it mid-session.
  vite: {
    optimizeDeps: {
      include: ['@baklavajs/core', '@baklavajs/interface-types', '@baklavajs/renderer-vue', 'zod'],
    },
  },
  nitro: { experimental: { websocket: true } },
  devtools: { enabled: false },
})
