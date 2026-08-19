/**
 * Status badges, shared by the ingredient, low-stock and history tables.
 *
 * Two rules this exists to keep:
 *
 * 1. **Never colour alone.** Every badge is a glyph AND a word, so it survives greyscale,
 *    colour-blindness and a sun-washed tablet screen.
 * 2. **Exceptions only.** `kind: null` renders nothing. A badge on every row is wallpaper —
 *    if everything is badged, nothing stands out, which is the whole job of the column.
 */

export type StatusKind = 'low' | 'oversold' | 'ok' | null;

const ALERT =
  'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';
const CHECK = 'M8 14.2 3.8 10l1.4-1.4L8 11.4l6.8-6.8L16.2 6 8 14.2Z';

export function Glyph({ path }: { path: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="flex-none">
      <path d={path} />
    </svg>
  );
}

export function StatusBadge({ kind }: { kind: StatusKind }) {
  if (kind === null) return null;

  if (kind === 'oversold') {
    return (
      <span className="badge badge--out" title="Sold more than the system thinks was in stock">
        <Glyph path={ALERT} /> Oversold
      </span>
    );
  }
  if (kind === 'low') {
    return (
      <span className="badge badge--low" title="At or below the low stock threshold">
        <Glyph path={ALERT} /> Low
      </span>
    );
  }
  // Only rendered where a positive confirmation is the point of the screen, never in a list.
  return (
    <span className="badge badge--ok">
      <Glyph path={CHECK} /> In stock
    </span>
  );
}
