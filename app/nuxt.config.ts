export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // The Nuxt project root is app/ itself (pages/, components/, server/ live directly under it).
  srcDir: '.',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/theme.css'],
  app: {
    head: {
      htmlAttrs: { 'data-theme': 'light' },
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap',
        },
      ],
      // Runs before first paint so a stored dark preference doesn't flash light.
      script: [
        {
          innerHTML:
            "try{var t=localStorage.getItem('anygen-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
        },
      ],
    },
  },
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
