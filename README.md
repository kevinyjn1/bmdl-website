# BMDL website

Website of the **Biomedical Manufacturing and Design Lab (BMDL)** at the University of Michigan,
led by Professor Albert Shih. It is a static site built with [Astro](https://astro.build): the
build output is plain HTML, CSS and a little JavaScript that can be hosted anywhere.

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The site is then available at http://localhost:4321 and reloads as you edit.

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Start the local development server                    |
| `npm run build`        | Build the production site into `dist/`                |
| `npm run preview`      | Serve the built site locally                          |
| `npm run check`        | Type-check all pages, components and content          |
| `npm run format`       | Format the code with Prettier                         |
| `npm run format:check` | Verify formatting without changing files (used in CI) |

## Updating content

Almost everything on the site is plain data, so routine updates do not require touching layout
code. Text fields that contain links are small snippets of HTML.

| To change...                        | Edit...                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| News items, news photos             | `src/data/news.json` (newest first; `date` is `YYYY-MM` or `YYYY-MM-DD`) |
| Current members and alumni          | `src/data/people.json`                                                   |
| A member's profile page             | `src/content/profiles/<name>.md` (Markdown)                              |
| Research projects                   | `src/data/research.json`                                                 |
| A past research topic page          | `src/content/topics/<topic>.md` (Markdown)                               |
| Journal / conference papers         | `src/data/publications/journal.json`, `conference.json`                  |
| Patents and licensed inventions     | `src/data/publications/patents.json`                                     |
| Papers in press / under review      | `src/data/publications/pending.json`                                     |
| Featured papers on Publications     | `src/data/publications/featured.json`                                    |
| Home page intro text and lab photos | `src/data/home.json`                                                     |
| Prof. Milton Shaw archive           | `src/data/shaw/*.json`                                                   |
| Address, email, phone, menu         | `src/lib/site.ts`                                                        |

The numbers shown around the site (papers, patents, alumni, and so on) are counted from these
files at build time, so they never need to be updated by hand.

### Adding a person

1. Put their photo in `src/assets/img/people/` (any reasonable size; it is resized automatically).
2. Add an entry to the right group in `src/data/people.json`:

   ```json
   { "name": "Jane Doe", "image": "people/jane-doe.jpg", "profile": null, "link": "https://example.com" }
   ```

   Use `"image": null` to show initials instead of a photo. `link` is an external page;
   `profile` is the name of a file in `src/content/profiles/` (without `.md`) for an on-site page.
   Alumni entries also take a graduation `"year"`.

### Images

Source images live in `src/assets/img/` at their original resolution and are referenced by their
path inside that folder. Astro generates optimized, correctly sized versions at build time, so
there is no need to resize or compress images before adding them.

## Project layout

```
src/
  assets/img/     Source images (photos, figures, archive scans)
  components/     Reusable pieces: header, footer, carousel, lightbox, hero scene, ...
  content/        Markdown pages (member profiles, research topic pages)
  data/           Site content as JSON
  layouts/        The page shell shared by every page
  lib/            Site settings and small helpers
  pages/          One file per page / route
  styles/         Global styles and design tokens
```

### Motion

- `components/HeroScene.astro` is the interactive particle scene on the home page (a grinding
  wheel throwing sparks). It is dependency-free Canvas 2D and pauses when off screen.
- Scroll reveals, the cursor spotlight on cards, and page transitions are defined in
  `styles/global.css` and `layouts/Base.astro`.
- All motion is disabled for visitors whose system is set to reduce motion.

## Deploying

The site is live at https://kevinyjn1.github.io/bmdl-website/.

Every push to `main` is published automatically by the
[Build and deploy](.github/workflows/build-and-deploy.yml) workflow: it checks formatting and
types, builds the site, and publishes the result to GitHub Pages. Pull requests run the same
checks without publishing.

To serve it from a custom domain, add the domain under **Settings > Pages** in the GitHub
repository. The workflow reads the address from there, so no code change is needed.

### Hosting it somewhere else

`npm run build` writes the complete site to `dist/`; upload that folder to any static host
(U-M web hosting, Netlify, Cloudflare Pages, ...). Tell the build where the site will live with
two environment variables:

| Variable    | Meaning                                                 | Example                     |
| ----------- | ------------------------------------------------------- | --------------------------- |
| `SITE_URL`  | Origin the site is served from                          | `https://example.umich.edu` |
| `BASE_PATH` | Sub-path, only if it is not served from the domain root | `/bmdl`                     |

```bash
SITE_URL=https://example.umich.edu npm run build
```

Page addresses match the previous Google Sites structure (`/news`, `/people`,
`/publications/journal-papers`, ...), so existing links keep working if the domain is pointed here.
