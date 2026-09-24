// Small hand-drawn icon set — stroke-based, consistent weight, no external
// icon library / network dependency needed for a handful of glyphs.
const S = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  grip: `<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  copy: `<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>`,
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>`,
  moon: `<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>`,
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>`,
  chart: `<path d="M4 19V9M11 19V5M18 19v-7"/><path d="M3 21h18"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 000-3l1.8-1.4-2-3.4-2.1.6a7.6 7.6 0 00-2.6-1.5L14 2.5h-4l-.5 2.3a7.6 7.6 0 00-2.6 1.5l-2.1-.6-2 3.4L4.6 10.5a7.6 7.6 0 000 3l-1.8 1.4 2 3.4 2.1-.6a7.6 7.6 0 002.6 1.5L10 21.5h4l.5-2.3a7.6 7.6 0 002.6-1.5l2.1.6 2-3.4-1.8-1.4z"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  arrowUp: `<path d="M12 19V5M6 11l6-6 6 6"/>`,
  chevronLeft: `<path d="M15 18l-6-6 6-6"/>`,
  chevronRight: `<path d="M9 6l6 6-6 6"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`,
  filter: `<path d="M4 5h16M7 12h10M10 19h4"/>`,
  dots: `<circle cx="12" cy="6" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18" r="1.3"/>`,
  edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>`,
  trash: `<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 019.5 3h5A1.5 1.5 0 0116 4.5V6"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>`,
  archive: `<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V19a2 2 0 002 2h10a2 2 0 002-2V8.5"/><path d="M10 13h4"/>`,
  check: `<path d="M5 13l4 4L19 7"/>`,
  x: `<path d="M18 6L6 18M6 6l12 12"/>`,
  upload: `<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.5-5.5a2 2 0 00-2.8 0L4 19"/>`,
  link: `<path d="M9.5 14.5l5-5"/><path d="M7 17l-1.5 1.5a3.5 3.5 0 01-5-5L4 12"/><path d="M17 7l1.5-1.5a3.5 3.5 0 015 5L22 12"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>`,
  arrowRight: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  building: `<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/>`,
  users: `<circle cx="9" cy="8" r="3"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3 3 0 010 6"/><path d="M15 14a6 6 0 016 6"/>`,
  expand: `<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M3 3l18 18"/><path d="M10.6 5.2A10.9 10.9 0 0112 5c6.5 0 10 7 10 7a18 18 0 01-3.2 4.1M6.5 6.6A17.7 17.7 0 002 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.5"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>`,
  heart: `<path d="M12 20s-7.5-4.7-9.7-9.4C.8 7.1 3 4 6.3 4c2 0 3.4 1 5.7 3.4C14.3 5 15.7 4 17.7 4 21 4 23.2 7.1 21.7 10.6 19.5 15.3 12 20 12 20z"/>`,
  comment: `<path d="M21 11.5a8.5 8.5 0 01-8.9 8.5 9 9 0 01-3.4-.6L3 21l1.7-4.9A8.5 8.5 0 1121 11.5z"/>`,
  bookmark: `<path d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"/>`,
  book: `<path d="M4 19.5V5.5A2.5 2.5 0 016.5 3H20v15.5H6.5A2.5 2.5 0 004 21z"/><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>`,
  folder: `<path d="M3 7a1.5 1.5 0 011.5-1.5H9l2 2.2h8.5A1.5 1.5 0 0121 9.2v9.3A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5z"/>`,
  target: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>`,
  layers: `<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>`,
  download: `<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 19h16"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.8 2.8 0 015.4.9c0 1.8-2.4 2.1-2.6 3.6"/><path d="M12 17v.01"/>`,
  chat: `<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1.2-4.3A8 8 0 1121 12z"/>`,
  send: `<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>`,
  bulb: `<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>`,
  logout: `<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`,
  teleprompter: `<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 8h10M7 11.5h7"/><path d="M9 21h6M12 17v4"/>`,
  play: `<path d="M7 5l12 7-12 7z"/>`,
  pause: `<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>`,
  refresh: `<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3"/><path d="M18 4v4h-4M6 20v-4h4"/>`,
  bot: `<rect x="4" y="8" width="16" height="12" rx="4"/><circle cx="9" cy="14.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="14.5" r="1.2" fill="currentColor" stroke="none"/><path d="M12 8V4.5"/><circle cx="12" cy="3" r="1.1" fill="currentColor" stroke="none"/><path d="M4 13H2M22 13h-2"/>`,
  mic: `<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0014 0v-1"/><path d="M12 18v4M9 22h6"/>`,
  megaphone: `<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15 9a4 4 0 010 6"/><path d="M18 6.5a8 8 0 010 11"/>`,
  bell: `<path d="M6 8a6 6 0 0112 0c0 4.5 1.5 6 2.5 7H3.5c1-1 2.5-2.5 2.5-7z"/><path d="M9.5 19a2.5 2.5 0 005 0"/>`,
  palette: `<path d="M12 3a9 9 0 000 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-3.9-4-6.8-9-6.8z"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/>`,
  typography: `<path d="M5 20l4.5-14h1l4.5 14"/><path d="M6.5 15h6"/><path d="M17 20V9.5c0-1.4 1.1-2.5 2.5-2.5S22 8.1 22 9.5V10"/><path d="M17 15.5c.6-.8 1.5-1.3 2.5-1.3 1.4 0 2.5 1.1 2.5 2.5S20.9 19.2 19.5 19.2c-1 0-1.9-.5-2.5-1.3"/>`,
};

export function icon(name, { size = 18, className = "" } = {}) {
  const body = PATHS[name] || PATHS.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${S} class="${className}">${body}</svg>`;
}

export const PLATFORM_ICON = {
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 3v10.5a3.5 3.5 0 11-3.5-3.5"/><path d="M14 3c.5 2.8 2.3 4.6 5 5"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="2.5" y="6" width="19" height="12" rx="3.5"/><path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9.2"/><path d="M14 21v-7h2.2l.4-3H14V9c0-.9.3-1.5 1.7-1.5H16.7V4.8c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 3.9V11H8v3h2.5v7"/></svg>`,
};

export function platformIcon(idOrName) {
  const key = (idOrName || "").toLowerCase();
  return PLATFORM_ICON[key] || icon("layers", { size: 15 });
}
