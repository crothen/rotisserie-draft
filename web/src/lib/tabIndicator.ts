// Favicon dot + document title: green when it's my turn, orange when
// I'm the next player up, plain icon otherwise.
let current: string | null | undefined;

export async function setTabIndicator(mode: 'mine' | 'next' | null, draftName?: string) {
  if (mode === current) {
    if (draftName) document.title = titleFor(mode, draftName);
    return;
  }
  current = mode;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  document.title = titleFor(mode, draftName);
  if (!mode) {
    if (link) link.href = '/icon.svg';
    return;
  }
  if (!link) return;
  try {
    const img = new Image();
    img.src = '/icon.svg';
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(45, 19, 15, 0, Math.PI * 2);
    ctx.fillStyle = mode === 'mine' ? '#22c55e' : '#f0a020';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#12141c';
    ctx.stroke();
    link.href = cv.toDataURL('image/png');
  } catch { /* keep the default icon */ }
}

function titleFor(mode: 'mine' | 'next' | null, name?: string) {
  const base = name ? `${name} — Rotisserie Draft` : 'Rotisserie Draft';
  if (!mode) return base;
  return (mode === 'mine' ? 'YOUR TURN · ' : 'Up next · ') + (name || 'Rotisserie Draft');
}
