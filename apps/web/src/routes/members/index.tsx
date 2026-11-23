import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getMembersMatrix, type ArtistSlug } from "../../lib/server/queries";

export const Route = createFileRoute("/members/")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getMembersMatrix({ data: deps.artist }),
  component: MembersPage,
});

function MembersPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const [sortBy, setSortBy] = useState<"order" | "relIndex" | "mints">("relIndex");
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    [...data.members]
      .sort((a, b) => (b.avgRelativeIndex ?? 0) - (a.avgRelativeIndex ?? 0))
      .slice(0, 5)
      .map((m) => m.id),
  );

  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");
  const hasStats = data.rounds.length > 0;

  const sortedMembers = useMemo(() => {
    const list = [...data.members];
    if (sortBy === "order") {
      return list.sort((a, b) => a.memberOrder - b.memberOrder);
    }
    if (sortBy === "mints") {
      return list.sort((a, b) => b.totalMints - a.totalMints);
    }
    return list.sort(
      (a, b) =>
        (b.avgRelativeIndex ?? -1) - (a.avgRelativeIndex ?? -1) ||
        a.memberOrder - b.memberOrder,
    );
  }, [data.members, sortBy]);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 8
          ? [...prev, id]
          : prev,
    );
  };

  // Multi-member Relative Index chart across rounds (if >= 2 rounds exist)
  const chartMembers = data.members.filter((m) => selectedIds.includes(m.id));
  const roundIndexBySlug = new Map(data.rounds.map((r, idx) => [r.slug, idx]));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {artistName} Member Popularity Matrix
          </h1>
          <p className="text-sm text-zinc-400">
            Normalized demand metrics across{" "}
            <span className="font-mono text-zinc-200">{data.rounds.length}</span>{" "}
            popularity-ranked rounds. Click any member to inspect full history.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["relIndex", "Sort: Demand Index"],
              ["mints", "Sort: Total Mints"],
              ["order", "Sort: Debut Order"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                sortBy === key
                  ? "bg-white text-zinc-950"
                  : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Multi-member trajectory chart when >= 2 rounds exist */}
      {data.rounds.length >= 2 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Relative Share Index Trajectory (Up to 8 Members)
              </h2>
              <p className="text-xs text-zinc-400">
                Dashed line = 1.00× round average. Click member chips below to
                compare.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {data.members.map((m) => {
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

          <div className="w-full overflow-x-auto">
            <svg
              viewBox="0 0 800 260"
              className="w-full min-w-[540px] h-64"
              role="img"
              aria-label="Member Relative Share Index trend chart"
            >
              {/* Grid lines */}
              {[0.5, 1.0, 1.5, 2.0].map((v) => {
                const y = 225 - ((v - 0.2) / 2.2) * 195;
                return (
                  <g key={v}>
                    <line
                      x1={48}
                      x2={780}
                      y1={y}
                      y2={y}
                      stroke={v === 1.0 ? "#52525b" : "#27272a"}
                      strokeDasharray={v === 1.0 ? "4 4" : undefined}
                      strokeWidth={1}
                    />
                    <text
                      x={40}
                      y={y + 4}
                      textAnchor="end"
                      fill="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      {v.toFixed(1)}×
                    </text>
                  </g>
                );
              })}

              {/* Member lines */}
              {chartMembers.map((m) => {
                const pts = m.history
                  .map((h) => {
                    const rIdx = roundIndexBySlug.get(h.roundSlug);
                    if (rIdx === undefined) return null;
                    const x =
                      56 +
                      (data.rounds.length > 1
                        ? (rIdx / (data.rounds.length - 1)) * 712
                        : 356);
                    const clamped = Math.max(0.2, Math.min(2.4, h.relativeIndex));
                    const y = 225 - ((clamped - 0.2) / 2.2) * 195;
                    return { x, y, h };
                  })
                  .filter((p): p is NonNullable<typeof p> => p !== null);

                if (pts.length === 0) return null;
                const d = pts
                  .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(" ");

                return (
                  <g key={m.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={m.hexColor}
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {pts.map((p) => (
                      <circle
                        key={p.h.roundSlug}
                        cx={p.x}
                        cy={p.y}
                        r={3.5}
                        fill={m.hexColor}
                        stroke="#09090b"
                        strokeWidth={1.5}
                      >
                        <title>{`${m.name} — ${p.h.roundSlug}: #${p.h.rank} (${p.h.relativeIndex.toFixed(2)}×, ${p.h.mintCount} mints)`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}

              {/* X-axis round labels */}
              {data.rounds.map((r, i) => {
                if (
                  data.rounds.length > 8 &&
                  i % Math.ceil(data.rounds.length / 8) !== 0 &&
                  i !== data.rounds.length - 1
                ) {
                  return null;
                }
                const x =
                  56 +
                  (data.rounds.length > 1
                    ? (i / (data.rounds.length - 1)) * 712
                    : 356);
                return (
                  <text
                    key={r.slug}
                    x={x}
                    y={248}
                    textAnchor="middle"
                    fill="#71717a"
                    fontSize={9}
                    fontFamily="monospace"
                  >
                    {r.season}
                  </text>
                );
              })}
            </svg>
          </div>
        </section>
      )}

      {/* Sortable Master Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Reveal Date</th>
              <th className="px-4 py-3 text-right">Rounds</th>
              <th className="px-4 py-3 text-right">Total Mints</th>
              <th className="px-4 py-3 text-right">Best Rank</th>
              <th className="px-4 py-3 text-right">Rolling-5 Rank</th>
              <th className="px-4 py-3 text-right">Avg Rel. Index</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {sortedMembers.map((m) => (
              <tr key={m.id} className="hover:bg-zinc-900/60">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-zinc-400">
                  {m.code}
                </td>
                <td className="px-4 py-3 font-semibold text-white">
                  <Link
                    to="/members/$memberId"
                    params={{ memberId: m.id }}
                    className="flex items-center gap-2.5 hover:text-sky-300 transition-colors"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: m.hexColor }}
                    />
                    <span>{m.name}</span>
                    <span className="text-xs font-normal text-zinc-500">
                      {m.fullName}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                  {m.revealDate}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400 tabular-nums">
                  {hasStats ? m.roundsCount : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-200 tabular-nums">
                  {hasStats ? m.totalMints.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                  {m.bestRank !== null ? `#${m.bestRank}` : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white tabular-nums">
                  {m.rolling5Rank !== null ? `#${m.rolling5Rank.toFixed(1)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                  {m.avgRelativeIndex !== null ? (
                    <span
                      className={
                        m.avgRelativeIndex >= 1.1
                          ? "text-emerald-300"
                          : m.avgRelativeIndex <= 0.9
                            ? "text-rose-300"
                            : "text-zinc-200"
                      }
                    >
                      {m.avgRelativeIndex.toFixed(2)}×
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
