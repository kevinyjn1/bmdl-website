// @ts-check
/// <reference types="node" />
import { defineConfig } from 'astro/config';

// The production address comes from the environment, so the same code can be hosted anywhere:
//   SITE_URL   the origin the site is served from, e.g. https://example.umich.edu
//   BASE_PATH  the sub-path it lives under, if any, e.g. /bmdl-website on GitHub Pages
// The deploy workflow sets both from the repository's GitHub Pages settings.
// When they are unset (local development, pull requests) the site builds for the domain root.
const site = process.env.SITE_URL || undefined;
const base = process.env.BASE_PATH || undefined;

// https://astro.build/config
export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: {
    // Source images are kept at original resolution; Astro generates optimized variants at build time.
    responsiveStyles: false,
  },
});
