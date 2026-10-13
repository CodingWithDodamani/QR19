/**
 * Decorative stylized QR-code illustration.
 *
 * The module pattern is generated from a fixed seed so server and client
 * render identically (no hydration mismatch). Modules pop in with a small
 * stagger when the SVG first becomes visible.
 */

const GRID = 21;
const CELL = 8;

/** Deterministic PRNG (LCG) — same sequence on server and client. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Module {
  x: number;
  y: number;
  delay: number;
  rounded: boolean;
}

function buildModules(): Module[] {
  const rand = createRandom(20240613);
  const inFinder = (row: number, col: number) => {
    const finderAt = (r0: number, c0: number) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
    return finderAt(0, 0) || finderAt(0, GRID - 7) || finderAt(GRID - 7, 0);
  };

  const modules: Module[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      if (inFinder(row, col)) continue;
      if (rand() < 0.44) {
        modules.push({
          x: col * CELL,
          y: row * CELL,
          delay: (row + col) * 0.016 + rand() * 0.12,
          rounded: rand() < 0.14,
        });
      }
    }
  }
  return modules;
}

const MODULES = buildModules();

function FinderPattern({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={CELL * 7} height={CELL * 7} rx={CELL * 1.4} fill="none" stroke="currentColor" strokeWidth={CELL} />
      <rect x={x + CELL * 2} y={y + CELL * 2} width={CELL * 3} height={CELL * 3} rx={CELL * 0.7} fill="currentColor" />
    </g>
  );
}

export function QrIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${GRID * CELL} ${GRID * CELL}`}
      className={className}
      role="img"
      aria-label="Stylized QR code illustration"
    >
      <FinderPattern x={0} y={0} />
      <FinderPattern x={(GRID - 7) * CELL} y={0} />
      <FinderPattern x={0} y={(GRID - 7) * CELL} />
      {MODULES.map((m, i) => (
        <rect
          key={i}
          className="qr-module"
          style={{ animationDelay: `${m.delay}s` }}
          x={m.x}
          y={m.y}
          width={CELL - 1.6}
          height={CELL - 1.6}
          rx={m.rounded ? (CELL - 1.6) / 2 : 1.4}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** Small static QR glyph used in feature visuals (no animation). */
export function QrGlyph({ size = 48, className }: { size?: number; className?: string }) {
  const cells = [
    [1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0],
    [1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1],
    [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0],
    [1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    [0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0],
    [0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1],
  ];
  return (
    <svg viewBox="0 0 11 11" width={size} height={size} className={className} aria-hidden="true">
      {cells.flatMap((row, r) =>
        row.map((v, col) =>
          v ? (
            <rect key={`${r}-${col}`} x={col} y={r} width={0.82} height={0.82} rx={0.18} fill="currentColor" />
          ) : null
        )
      )}
    </svg>
  );
}
