/**
 * The brand's identifying marks, drawn rather than fetched.
 *
 * Inline SVG, not an image file: these appear on every screen, and a logo that arrives
 * one request later than the page is a logo that flickers. Drawn from the brand book's
 * geometry — the quatrefoil emblem and the eight-point star — rather than traced from the
 * supplied artwork, so they stay crisp at 20px in a sidebar and at 120px on the login
 * page, and inherit whatever colour they are placed in.
 *
 * The full emblem in the book carries "ESTD. 2021", the wordmark and "COFFEE SHOP •
 * BAKERY • PÂTISSERIE" inside the frame. At the sizes this application uses, that text
 * would be illegible mush, so the marks here are the shape and the star: the parts that
 * survive being small. Anywhere the full lock-up belongs — a printed bill, the customer
 * site in Month 4 — use the supplied artwork, not this.
 */

/** Square with a semicircular lobe on each side. The brand's frame, and its `O`. */
const QUATREFOIL = 'M30 30 A20 20 0 0 1 70 30 A20 20 0 0 1 70 70 A20 20 0 0 1 30 70 A20 20 0 0 1 30 30 Z';

/** The eight-point star that flanks ESTD. 2021 and sits at the centre of the logomark. */
const STAR =
  'M50 18 L54.5 41.5 L68 22 L58.5 45.5 L82 32 L62.5 45.5 L86 50 L62.5 54.5 L82 68 L58.5 54.5 L68 78 L54.5 58.5 L50 82 L45.5 58.5 L32 78 L41.5 54.5 L18 68 L37.5 54.5 L14 50 L37.5 45.5 L18 32 L41.5 45.5 L32 22 L45.5 41.5 Z';

/**
 * The emblem, in outline. `detail` adds the radiating line work the book uses inside the
 * frame — worth drawing at 48px and up, noise below it, so the caller decides.
 */
export function Emblem({ size = 40, detail = false }: { size?: number; detail?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="brand-emblem"
    >
      <path d={QUATREFOIL} strokeWidth="5" />
      {detail ? (
        <g strokeWidth="1.5" opacity="0.5">
          <path d={QUATREFOIL} transform="translate(50 50) scale(0.74) translate(-50 -50)" />
          {/* Fan of rays from the centre — the book's line work, at eight points. */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line key={deg} x1="50" y1="50" x2="50" y2="18" transform={`rotate(${deg} 50 50)`} />
          ))}
        </g>
      ) : null}
      <path d={STAR} transform="translate(50 50) scale(0.3) translate(-50 -50)" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The star on its own. Punctuation: beside a label, in an empty state, on a divider. */
export function Star({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d={STAR} />
    </svg>
  );
}

/**
 * Wordmark plus descriptor, in the arrangement the book calls the secondary logo: name
 * stacked, a dashed rule, then the descriptor. Set in the display face, which resolves to
 * real Copperplate where the machine has it.
 */
export function Wordmark({ withDescriptor = true }: { withDescriptor?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__name">
        No Meat Naan
      </span>
      {withDescriptor ? (
        <span className="wordmark__descriptor">Coffee shop &middot; Bakery &middot; Pâtisserie</span>
      ) : null}
    </span>
  );
}
