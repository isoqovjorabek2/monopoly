import { useMemo, useState } from 'react';
import type { CFState } from '../../cashflow/types';
import { useT } from '../../i18n';

/**
 * The race, drawn: how far each player got, round by round. The Grind is
 * the climb to the dashed line; above it is the Free Lane. The state has
 * recorded this all game - this is the one place that reads it back.
 */

const W = 520;
const H = 220;
const PAD = { top: 14, right: 86, bottom: 24, left: 34 };
const LABEL_GAP = 13;

export function CFRaceChart({ s }: { s: CFState }) {
  const t = useT();
  const G = t.cf.gameOver;
  const [hover, setHover] = useState<number | null>(null);

  const points = s.history;
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].round;
    const last = points[points.length - 1].round;
    const top = Math.max(1.25, ...points.flatMap((h) => Object.values(h.progress)));
    const x = (round: number) => PAD.left + ((round - first) / Math.max(1, last - first)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - Math.max(0, v) / top) * (H - PAD.top - PAD.bottom);

    const series = s.seats.map((id) => {
      const p = s.players[id];
      // A player who went out stops where they fell.
      const pts: [number, number][] = [];
      for (const h of points) {
        const v = h.progress[id];
        if (v === undefined) continue;
        if (v < 0) break;
        pts.push([h.round, v]);
      }
      return { id, name: p.name, color: p.color, pts };
    }).filter((sr) => sr.pts.length > 0);

    // End labels, nudged apart so none sit on top of each other.
    const labels = series
      .map((sr) => ({ id: sr.id, name: sr.name, color: sr.color, x: x(sr.pts[sr.pts.length - 1][0]), y: y(sr.pts[sr.pts.length - 1][1]) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < LABEL_GAP) labels[i].y = labels[i - 1].y + LABEL_GAP;
    }
    // Pushed past the floor: settle the stack back up from the bottom.
    const floor = H - PAD.bottom;
    for (let i = labels.length - 1; i >= 0; i--) {
      const limit = i === labels.length - 1 ? floor : labels[i + 1].y - LABEL_GAP;
      if (labels[i].y > limit) labels[i].y = limit;
    }

    const step = Math.max(1, Math.ceil((last - first) / 6));
    const ticks: number[] = [];
    for (let r = first; r <= last; r += step) ticks.push(r);

    return { first, last, x, y, series, labels, ticks };
  }, [points, s.seats, s.players]);

  if (!chart) return null;
  const { x, y, series, labels, ticks, first, last } = chart;
  const pct = (v: number) => (v >= 1
    ? `${t.cf.rail.fastTrack} +${Math.round((v - 1) * 100)}%`
    : `${Math.round(v * 100)}%`);

  const hovered = hover == null ? null : points.find((h) => h.round === hover) ?? null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const round = Math.round(first + frac * (last - first));
    setHover(Math.min(last, Math.max(first, round)));
  };

  return (
    <figure className="cfRace">
      <figcaption className="cfSheet__head">{G.progress}</figcaption>
      <div className="cfRace__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={G.chartAria}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <line className="cfRace__axis" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
          <line className="cfRace__escape" x1={PAD.left} x2={W - PAD.right} y1={y(1)} y2={y(1)} />
          <text className="cfRace__tick" x={PAD.left - 6} y={y(1) + 3} textAnchor="end">100%</text>
          <text className="cfRace__tick" x={PAD.left - 6} y={y(0) + 3} textAnchor="end">0</text>
          <text className="cfRace__escapeLabel" x={PAD.left + 4} y={y(1) - 5}>{G.escapeLine}</text>
          {ticks.map((r) => (
            <text key={r} className="cfRace__tick" x={x(r)} y={H - 6} textAnchor="middle">{r}</text>
          ))}
          {hover != null && (
            <line className="cfRace__cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} />
          )}
          {series.map((sr) => (
            <polyline
              key={sr.id}
              className="cfRace__line"
              points={sr.pts.map(([r, v]) => `${x(r)},${y(v)}`).join(' ')}
              stroke={sr.color}
            />
          ))}
          {hovered && series.map((sr) => {
            const v = hovered.progress[sr.id];
            if (v === undefined || v < 0) return null;
            return <circle key={sr.id} className="cfRace__dot" cx={x(hovered.round)} cy={y(v)} r={4} fill={sr.color} />;
          })}
          {labels.map((l) => (
            <g key={l.id}>
              <circle cx={l.x + 8} cy={l.y} r={3} fill={l.color} />
              <text className="cfRace__label" x={l.x + 14} y={l.y + 4}>{l.name}</text>
            </g>
          ))}
        </svg>
        {hovered && (
          <div
            className="cfRace__tip"
            style={{ left: `${(x(hovered.round) / W) * 100}%` }}
            data-flip={x(hovered.round) > W / 2 || undefined}
          >
            <p className="cfRace__tipHead">{G.round(hovered.round)}</p>
            {series
              .filter((sr) => (hovered.progress[sr.id] ?? -1) >= 0)
              .sort((a, b) => hovered.progress[b.id] - hovered.progress[a.id])
              .map((sr) => (
                <p key={sr.id} className="cfRace__tipRow">
                  <span className="cfRace__swatch" style={{ background: sr.color }} />
                  <span className="truncate">{sr.name}</span>
                  <span className="num">{pct(hovered.progress[sr.id])}</span>
                </p>
              ))}
          </div>
        )}
      </div>
    </figure>
  );
}
