/** Small inline icon set; stroke icons inherit currentColor. */
const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true } as const;

export const IconUsb = () => (
  <svg {...base}><path d="M12 2v14" /><path d="M8 8h8" /><circle cx="12" cy="20" r="2" /><path d="M7 12l5-4 5 4" /></svg>
);
export const IconSave = () => (
  <svg {...base}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>
);
export const IconRefresh = () => (
  <svg {...base}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
);
export const IconDownload = () => (
  <svg {...base}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
);
export const IconUpload = () => (
  <svg {...base}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
);
export const IconTrash = () => (
  <svg {...base}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
);
export const IconPlus = () => (
  <svg {...base}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);
export const IconGlobe = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c-3 3-4 6-4 9s1 6 4 9" /><path d="M12 3c3 3 4 6 4 9s-1 6-4 9" /></svg>
);
export const IconChevron = () => (
  <svg {...base}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconWarning = () => (
  <svg {...base}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
);
export const IconCheck = () => (
  <svg {...base}><path d="M20 6L9 17l-5-5" /></svg>
);
export const IconLink = () => (
  <svg {...base}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" /></svg>
);
export const IconRotate = ({ ccw = false }: { ccw?: boolean }) => (
  <svg {...base} style={ccw ? 'transform:scaleX(-1)' : undefined}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
);
export const IconUnplug = () => (
  <svg {...base}><path d="M18.4 2.6l3 3" /><path d="M14 8l6-6" /><path d="M9 15l-6 6" /><path d="M17 11l-6-6-5 5a4 4 0 0 0 0 5.7l.3.3a4 4 0 0 0 5.7 0l5-5z" /></svg>
);
