// Mana symbols rendered from Scryfall's card-symbol SVG set.
export function ManaSymbol({ code, cls = 'ms' }: { code: string; cls?: string }) {
  return (
    <img
      className={cls}
      src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg`}
      alt={code}
    />
  );
}

/** "{2}{W}{U}" -> generic 2 + white + blue symbol images. Hybrid {W/U},
 *  phyrexian {W/P} and X costs map to Scryfall codes by dropping the slash. */
export function ManaCost({ cost }: { cost: string | undefined }) {
  if (!cost) return null;
  const parts = cost.split(/(\{[^}]{1,5}\})/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{([^}]{1,5})\}$/);
        if (!m) return <span key={i}>{part}</span>;
        const code = m[1].replace(/\//g, '');
        if (!/^[A-Z0-9]{1,3}$/i.test(code)) return <span key={i}>{part}</span>;
        return <ManaSymbol key={i} code={code} />;
      })}
    </>
  );
}
