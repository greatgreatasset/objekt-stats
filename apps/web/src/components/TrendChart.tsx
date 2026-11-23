import { useState } from "react";

export interface TrendChartRound {
  slug: string;
  title: string;
  season: string;
  startAt: string;
  totalMints: number;
  participatingMembers: number;
}

export interface TrendChartMember {
  id: string;
  code: string;
  name: string;
  hexColor: string;
  avgRelativeIndex: number | null;
  history: Array<{
    roundSlug: string;
    rank: number;
    relativeIndex: number;
    mintCount: number;
    sharePct: number;
    isAnomaly: boolean;
    anomalyDirection: string | null;
  }>;
}

export interface TrendChartEvent {
  id: string;
  eventDate: string;
  category: string;
  title: string;
}

export function TrendChart({
  rounds,
  members,
  events,
  artistId,
}: {
  rounds: TrendChartRound[];
  members: TrendChartMember[];
  events: TrendChartEvent[];
  artistId: string;
}) {
  const [mode, setMode] = useState<"rank" | "relativeIndex">("rank");
  const [showEvents, setShowEvents] = useState(true);
  const [hoveredRoundIdx, setHoveredRoundIdx] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    [...members]
      .sort((a, b) => (b.avgRelativeIndex ?? 0) - (a.avgRelativeIndex ?? 0))
      .slice(0, artistId === "artms" ? 5 : 6)
      .map((m) => m.id),
  );

  if (rounds.length < 2) {
    return null;
  }

  const maxRank = Math.max(
    artistId === "artms" ? 5 : 24,
    ...rounds.map((r) => r.participatingMembers),
  );
  const roundIdxBySlug = new Map(rounds.map((r, i) => [r.slug, i]));
  const selectedMembers = members.filter((m) => selectedIds.includes(m.id));

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 10
          ? [...prev, id]
          : prev,
    );
  };

  const applyPreset = (preset: "top6" | "top10" | "all5" | "clear") => {
    if (preset === "clear") {
      setSelectedIds([]);
      return;
    }
    const sorted = [...members].sort(
      (a, b) => (b.avgRelativeIndex ?? 0) - (a.avgRelativeIndex ?? 0),
    );
    const count = preset === "top10" ? 10 : preset === "all5" ? 5 : 6;
    setSelectedIds(sorted.slice(0, count).map((m) => m.id));
  };

  // Chart layout constants
  const W = 860;
  const H = 310;
  const padL = 52;
  const padR = 24;
  const padT = 22;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xForRound = (idx: number) =>
    padL + (rounds.length > 1 ? (idx / (rounds.length - 1)) * plotW : plotW / 2);

  const yForValue = (val: number) => {
    if (mode === "rank") {
      // Rank #1 at top, maxRank at bottom
      const clamped = Math.max(1, Math.min(maxRank, val));
      return padT + ((clamped - 1) / Math.max(1, maxRank - 1)) * plotH;
    }
    // Relative index: 2.2x at top, 0.2x at bottom
    const clamped = Math.max(0.2, Math.min(2.2, val));
    return padT + ((2.2 - clamped) / 2.0) * plotH;
  };

  // Map events that fall inside the displayed rounds' date window onto the X axis
  const firstMs = Date.parse(rounds[0]!.startAt.slice(0, 10) + "T00:00:00Z");
  const lastMs = Date.parse(
    rounds[rounds.length - 1]!.startAt.slice(0, 10) + "T00:00:00Z",
  );
  const eventPins =
    showEvents && lastMs > firstMs
      ? events
          .map((ev) => {
            const evMs = Date.parse(ev.eventDate + "T00:00:00Z");
            if (evMs < firstMs || evMs > lastMs) return null;
            const ratio = (evMs - firstMs) / (lastMs - firstMs);
            return { ...ev, x: padL + ratio * plotW };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
      : [];

  const yTicks =
    mode === "rank"
      ? artistId === "artms"
        ? [1, 2, 3, 4, 5]
        : [1, 6, 12, 18, 24]
      : [2.0, 1.5, 1.0, 0.5];

  const hoveredRound =
    hoveredRoundIdx !== null ? rounds[hoveredRoundIdx] ?? null : null;
  const hoveredEntries =
    hoveredRound !== null
      ? selectedMembers
          .map((m) => {
            const h = m.history.find((x) => x.roundSlug === hoveredRound.slug);
            return h ? { member: m, stat: h } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => a.stat.rank - b.stat.rank)
      : [];

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">
            {mode === "rank"
              ? `Member Rank Bump Chart (#1 – #${maxRank})`
              : "Relative Share Index Trajectory (1.00× = Average)"}
          </h2>
          <p className="text-xs text-zinc-400">
            Hover any round column to compare exact placements. Select up to 10
            members below.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("rank")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                mode === "rank"
                  ? "bg-white text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Rank Bump
            </button>
            <button
              type="button"
              onClick={() => setMode("relativeIndex")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                mode === "relativeIndex"
                  ? "bg-white text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Relative Index
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowEvents((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              showEvents
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Events {showEvents ? "On" : "Off"}
          </button>
        </div>
      </div>

      {/* Presets + Member Toggle Chips */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 mr-1">Presets:</span>
          <button
            type="button"
            onClick={() => applyPreset(artistId === "artms" ? "all5" : "top6")}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
          >
            {artistId === "artms" ? "All 5" : "Top 6"}
          </button>
          {artistId !== "artms" && (
            <button
              type="button"
              onClick={() => applyPreset("top10")}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
            >
              Top 10
            </button>
          )}
          <button
            type="button"
            onClick={() => applyPreset("clear")}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-400 hover:border-zinc-600"
          >
            Clear
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const active = selectedIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  active
                    ? "border-zinc-500 bg-zinc-800 text-white"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: m.hexColor }}
                />
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* SVG Plot */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[580px] h-72 select-none"
          role="img"
          aria-label="Member popularity trajectory chart"
          onMouseLeave={() => setHoveredRoundIdx(null)}
        >
          {/* Horizontal grid lines */}
          {yTicks.map((tick) => {
            const y = yForValue(tick);
            const isAvg = mode === "relativeIndex" && tick === 1.0;
            return (
              <g key={tick}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke={isAvg ? "#52525b" : "#27272a"}
                  strokeDasharray={isAvg ? "4 4" : undefined}
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#71717a"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {mode === "rank" ? `#${tick}` : `${tick.toFixed(1)}×`}
                </text>
              </g>
            );
          })}

          {/* Vertical real-world event overlay lines */}
          {eventPins.map((pin) => (
            <g key={pin.id}>
              <line
                x1={pin.x}
                x2={pin.x}
                y1={padT}
                y2={H - padB}
                stroke="#f59e0b"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
                strokeWidth={1.2}
              />
              <circle cx={pin.x} cy={padT - 5} r={3.5} fill="#f59e0b">
                <title>{`${pin.eventDate}: ${pin.title}`}</title>
              </circle>
            </g>
          ))}

          {/* Hover vertical guide */}
          {hoveredRoundIdx !== null && (
            <line
              x1={xForRound(hoveredRoundIdx)}
              x2={xForRound(hoveredRoundIdx)}
              y1={padT}
              y2={H - padB}
              stroke="#a1a1aa"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )}

          {/* Member trajectories */}
          {selectedMembers.map((m) => {
            const pts = m.history
              .map((h) => {
                const idx = roundIdxBySlug.get(h.roundSlug);
                if (idx === undefined) return null;
                return {
                  x: xForRound(idx),
                  y: yForValue(mode === "rank" ? h.rank : h.relativeIndex),
                  h,
                };
              })
              .filter((p): p is NonNullable<typeof p> => p !== null);

            if (pts.length === 0) return null;
            const d = pts
              .map(
                (p, i) =>
                  `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
              )
              .join(" ");

            return (
              <g key={m.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={m.hexColor}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {pts.map((p) => (
                  <circle
                    key={p.h.roundSlug}
                    cx={p.x}
                    cy={p.y}
                    r={p.h.isAnomaly ? 5 : 3.5}
                    fill={m.hexColor}
                    stroke={p.h.isAnomaly ? "#ffffff" : "#09090b"}
                    strokeWidth={p.h.isAnomaly ? 2 : 1.5}
                  >
                    <title>{`${m.name} — ${p.h.roundSlug}: #${p.h.rank} (${p.h.relativeIndex.toFixed(2)}×, ${p.h.mintCount} mints)`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {/* Invisible column hit zones for smooth hovering */}
          {rounds.map((r, i) => {
            const x = xForRound(i);
            const colW = rounds.length > 1 ? plotW / (rounds.length - 1) : plotW;
            return (
              <rect
                key={r.slug}
                x={Math.max(padL, x - colW / 2)}
                y={padT}
                width={colW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoveredRoundIdx(i)}
              />
            );
          })}

          {/* X-axis round labels */}
          {rounds.map((r, i) => {
            const maxLabels = 9;
            if (
              rounds.length > maxLabels &&
              i % Math.ceil(rounds.length / maxLabels) !== 0 &&
              i !== rounds.length - 1
            ) {
              return null;
            }
            const x = xForRound(i);
            return (
              <g key={r.slug}>
                <text
                  x={x}
                  y={H - 22}
                  textAnchor="middle"
                  fill="#a1a1aa"
                  fontSize={9.5}
                  fontFamily="monospace"
                >
                  {r.season}
                </text>
                <text
                  x={x}
                  y={H - 9}
                  textAnchor="middle"
                  fill="#52525b"
                  fontSize={8.5}
                  fontFamily="monospace"
                >
                  {r.startAt.slice(5, 10)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Live Hover Inspection Strip */}
      {hoveredRound && hoveredEntries.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-white">{hoveredRound.title}</span>
            <span className="font-mono text-zinc-400">
              {hoveredRound.startAt.slice(0, 10)} •{" "}
              {hoveredRound.totalMints.toLocaleString()} mints
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs font-mono">
            {hoveredEntries.map(({ member, stat }) => (
              <span
                key={member.id}
                className="inline-flex items-center gap-1.5 text-zinc-200"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: member.hexColor }}
                />
                <span className="text-zinc-400">#{stat.rank}</span>
                <span>{member.name}</span>
                <span className="text-zinc-500">
                  ({stat.relativeIndex.toFixed(2)}× / {stat.mintCount})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
