// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Public origin of this workbench. Update to your real custom domain or the
  // *.workers.dev URL after the first deploy (used for canonical/SEO only).
  site: 'https://qollock-translate.workers.dev',
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
