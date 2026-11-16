import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Individual profile pages for lab members (linked from the People page). */
const profiles = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/profiles' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      photo: image().optional(),
      email: z.email().optional(),
      links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
      affiliation: z.array(z.string()).default([]),
      focus: z.string().optional(),
    }),
});

/** Detail pages for past research topics (linked from the Research page). */
const topics = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/topics' }),
  schema: z.object({ title: z.string() }),
});

export const collections = { profiles, topics };
