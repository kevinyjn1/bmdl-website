import type { ImageMetadata } from 'astro';

/**
 * Every image under src/assets/img, keyed by its path relative to that folder
 * (the same path the JSON files in src/data use, e.g. "people/karl-song.png").
 */
const modules = import.meta.glob<{ default: ImageMetadata }>('../assets/img/**/*.{jpg,jpeg,png,gif,webp}', {
  eager: true,
});

export function image(path: string): ImageMetadata {
  const mod = modules[`../assets/img/${path}`];
  if (!mod) throw new Error(`Image not found: src/assets/img/${path}`);
  return mod.default;
}
