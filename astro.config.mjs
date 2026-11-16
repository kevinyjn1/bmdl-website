// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Set `site` to the production URL once it is known (enables canonical URLs).
  // If the site is served from a sub-path (e.g. GitHub Pages project sites), also set `base`.
  // site: 'https://example.umich.edu',
  // base: '/repo-name',
  trailingSlash: 'always',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: {
    // Source images are kept at original resolution; Astro generates optimized variants at build time.
    responsiveStyles: false,
  },
});
