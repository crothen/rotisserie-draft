// Inline SVG icons (ported 1:1 from the old app's icon constants).
const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

export const IconBellOn = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconBellOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

export const IconShare = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
  </svg>
);

export const IconDeck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
    <line x1="9" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="9" y1="18" x2="21" y2="18" />
    <line x1="4" y1="6" x2="4.01" y2="6" /><line x1="4" y1="12" x2="4.01" y2="12" /><line x1="4" y1="18" x2="4.01" y2="18" />
  </svg>
);

export const IconChat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
