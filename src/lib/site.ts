/** Site-wide facts and navigation. Edit here when contact details or the menu change. */

export const SITE = {
  name: 'Biomedical Manufacturing and Design Lab',
  short: 'BMDL',
  tagline: 'Leaders & Best in manufacturing research and education',
  description:
    'The Biomedical Manufacturing and Design Lab (BMDL) at the University of Michigan: biomedical manufacturing, semiconductor manufacturing, machining, and manufacturing education.',
  pi: {
    name: 'Albert Shih',
    // His titles, as listed on his College of Engineering faculty page (profileUrl below).
    // `title` is the named professorship; `appointments` are the others, in the page's order.
    title: 'Yoram Koren Collegiate Professor of Engineering',
    college: 'College of Engineering',
    institution: 'University of Michigan - Ann Arbor',
    appointments: [
      { role: 'Professor', unit: 'Mechanical Engineering' },
      { role: 'Professor', unit: 'Biomedical Engineering' },
      { role: 'Faculty Member', unit: 'Institute of Gerontology' },
    ],
    profileUrl: 'https://me.engin.umich.edu/people/faculty/albert-shih/',
    scholarUrl: 'https://scholar.google.com/citations?user=b43PE-UAAAAJ&hl=en',
  },
  contact: {
    addressLines: ['1100 HH Dow building, 2300 Hayward St.', 'Ann Arbor, MI 48109'],
    email: 'shiha@umich.edu',
    phone: '(734) 647-1766',
    phoneHref: 'tel:+17346471766',
    mapEmbedUrl:
      'https://maps.google.com/maps?hl=en-US&ll=42.293247,-83.715566&q=Herbert+H.+Dow+Bldg,+2300+Hayward+St,+Ann+Arbor,+MI+48109,+USA&z=16&output=embed',
    mapUrl:
      'https://www.google.com/maps/search/?api=1&query=Herbert+H.+Dow+Building+2300+Hayward+St+Ann+Arbor+MI+48109',
  },
} as const;

/**
 * The hidden game's online leaderboard: the web app URL of the Google Apps Script in
 * leaderboard/Code.gs (leaderboard/README.md explains how to deploy it). Set it to an empty
 * string to switch the leaderboard off; the game then works without one. PUBLIC_LEADERBOARD_URL
 * overrides it, which is how the local stand-in is used during development.
 */
export const LEADERBOARD_URL: string =
  import.meta.env.PUBLIC_LEADERBOARD_URL ||
  'https://script.google.com/macros/s/AKfycbyN5m0x9RGA5lXtXCq-sKaicKjEKsuLYtu5-8eggrcSvZhhjeeJ7NNlHukV19yYt_M9/exec';

export interface NavItem {
  label: string;
  path: string;
  children?: { label: string; path: string }[];
}

export const NAV: NavItem[] = [
  { label: 'Home', path: '/' },
  { label: 'News', path: '/news' },
  { label: 'People', path: '/people' },
  { label: 'Research', path: '/research' },
  {
    label: 'Publications',
    path: '/publications',
    children: [
      { label: 'Journal Papers', path: '/publications/journal-papers' },
      { label: 'Conference Papers', path: '/publications/conference-papers' },
      { label: 'Patents', path: '/publications/patents' },
      { label: 'Pending', path: '/publications/pending' },
    ],
  },
  { label: 'Contact', path: '/contact' },
  {
    label: 'Prof. Milton Shaw',
    path: '/prof-milton-shaw',
    children: [
      { label: 'The Life of Professor Milton Shaw', path: '/prof-milton-shaw/the-life-of-professor-milton-shaw' },
      { label: 'Manuscripts of Professor Milton Shaw', path: '/prof-milton-shaw/manuscript-of-professor-milton-shaw' },
    ],
  },
];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Turn a site path like "/news" into a link that respects the configured base path. */
export function href(path: string): string {
  if (!path.startsWith('/')) return path;
  const [pathname, hash = ''] = path.split('#');
  const clean = pathname === '/' ? '/' : pathname.replace(/\/$/, '') + '/';
  return BASE + clean + (hash ? '#' + hash : '');
}

/**
 * Prepare a snippet of trusted HTML from src/data for rendering:
 * internal links get the base path, external links open in a new tab.
 */
export function rich(html: string): string {
  return html.replace(/<a href="([^"]+)">/g, (_match, url: string) => {
    if (url.startsWith('/')) return `<a href="${href(url)}">`;
    if (url.startsWith('mailto:') || url.startsWith('tel:')) return `<a href="${url}">`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">`;
  });
}

/** Plain text of an HTML snippet (for alt text, search indexes, etc.). */
/** Make plain text safe to place inside HTML (the opposite of `plain`). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" -> "Oct 2026"; "2021-05-06" -> "May 6, 2021". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTHS[month - 1];
  return day ? `${name} ${day}, ${year}` : `${name} ${year}`;
}

/** Initials for avatar placeholders: "Jingxuan (Jessie) Lyu" -> "JL". */
export function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .replace(/^Dr\.\s+/, '')
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
