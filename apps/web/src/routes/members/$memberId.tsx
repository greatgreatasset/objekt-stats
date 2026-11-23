import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getMemberDetail } from "../../lib/server/queries";

export const Route = createFileRoute("/members/$memberId")({
  loader: ({ params }) => getMemberDetail({ data: params.memberId }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Member Not Found — Objekt Stats" }] };
    }
    const { member, roundHistory } = loaderData;
    const artistLabel = member.artistId === "artms" ? "ARTMS" : "tripleS";
    const pop = roundHistory.filter((r) => r.includeInPopularity);
    const avgRank =
      pop.length > 0
        ? `#${(pop.reduce((s, r) => s + r.rank, 0) / pop.length).toFixed(1)}`
        : "N/A";
    const title = `${member.code} ${member.name} (${artistLabel}) — Objekt Stats`;
    const desc = `Track ${member.fullName}'s COSMO Objekt sale round rankings (${avgRank} avg rank across ${pop.length} popularity rounds), demand index, and milestone shifts.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const data = Route.useLoaderData();

  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
        <h1 className="text-xl font-semibold text-white">Member not found</h1>
        <Link
          to="/members"
          className="inline-flex items-center gap-1.5 text-sm text-sky-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to members
        </Link>
      </div>
    );
  }

  const { member, roundHistory, classBreakdown, anomalies, collections, events } =
    data;
  const popHistory = [...roundHistory]
    .filter((r) => r.includeInPopularity)
    .reverse(); // chronological for trajectory chart
  const totalMints = collections.reduce((s, c) => s + c.totalMints, 0);
  const avgRank =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.rank, 0) / popHistory.length
        ).toFixed(1)
      : "—";
  const avgRel =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.relativeIndex, 0) /
          popHistory.length
        ).toFixed(2) + "×"
      : "—";

  const maxRank = member.artistId === "artms" ? 5 : 24;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          to="/members"
          search={member.artistId === "artms" ? { artist: "artms" } : {}}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All {member.artistId === "artms" ? "ARTMS" : "tripleS"} Members
        </Link>

        <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ backgroundColor: member.hexColor }}
          />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
                <span>{member.code}</span>
                <span>•</span>
                <span>Revealed {member.revealDate}</span>
                <span>•</span>
                <span>{member.hexColor}</span>
              </div>
              <h1 className="text-3xl font-bold text-white">{member.name}</h1>
              <p className="text-sm text-zinc-400">{member.fullName}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Avg Rank</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgRank === "—" ? "—" : `#${avgRank}`}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Rel. Index</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgRel}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Indexed Mints</div>
                <div className="font-mono text-lg font-bold text-white">
                  {totalMints.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Career Rank Trajectory Chart */}
      {popHistory.length >= 2 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Rank Trajectory Across Popularity Rounds
              </h2>
              <p className="text-xs text-zinc-400">
                Higher is better (#1 at top). White-ringed dots indicate
                statistically flagged surges or drops.
              </p>
            </div>
          </div>
          <div className="w-full overflow-x-auto">
            <svg viewBox="0 0 760 210" className="w-full min-w-[480px] h-52">
              {[1, Math.round(maxRank / 2), maxRank].map((tick) => {
                const y = 20 + ((tick - 1) / Math.max(1, maxRank - 1)) * 150;
                return (
                  <g key={tick}>
                    <line
                      x1={42}
                      x2={740}
                      y1={y}
                      y2={y}
                      stroke="#27272a"
                      strokeWidth={1}
                    />
                    <text
                      x={34}
                      y={y + 3.5}
                      textAnchor="end"
                      fill="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      #{tick}
                    </text>
                  </g>
                );
              })}

              <path
                d={popHistory
                  .map((r, i) => {
                    const x =
                      52 + (i / Math.max(1, popHistory.length - 1)) * 676;
                    const y =
                      20 + ((r.rank - 1) / Math.max(1, maxRank - 1)) * 150;
                    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ")}
                fill="none"
                stroke={member.hexColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {popHistory.map((r, i) => {
                const x = 52 + (i / Math.max(1, popHistory.length - 1)) * 676;
                const y = 20 + ((r.rank - 1) / Math.max(1, maxRank - 1)) * 150;
                return (
                  <circle
                    key={r.roundSlug}
                    cx={x}
                    cy={y}
                    r={r.isAnomaly ? 5.5 : 4}
                    fill={member.hexColor}
                    stroke={r.isAnomaly ? "#ffffff" : "#09090b"}
                    strokeWidth={2}
                  >
                    <title>{`${r.title} (${r.startAt.slice(0, 10)}): #${r.rank}/${r.participatingMembers} (${r.relativeIndex.toFixed(2)}×, ${r.mintCount} mints)`}</title>
                  </circle>
                );
              })}
            </svg>
          </div>
        </section>
      )}

      {/* Class Breakdown (FCO vs DCO vs PCO) & Flagged Surges/Drops */}
      {(classBreakdown.length > 0 || anomalies.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {classBreakdown.length > 0 && (
            <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">
                Performance by Objekt Class
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {classBreakdown.map((c) => (
                  <div
                    key={c.objektClass}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-1"
                  >
                    <p className="text-xs font-mono text-zinc-400">
                      {c.objektClass} Class ({c.rounds} rounds)
                    </p>
                    <p className="font-mono text-lg font-bold text-white">
                      #{c.avgRank}{" "}
                      <span className="text-xs font-normal text-zinc-400">
                        avg ({c.avgRelativeIndex.toFixed(2)}×)
                      </span>
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {c.totalMints.toLocaleString()} mints
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {anomalies.length > 0 && (
            <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Notable Surges &amp; Drops ({anomalies.length})
              </h2>
              <div className="space-y-2.5">
                {anomalies.slice(0, 5).map((a) => (
                  <div
                    key={a.roundSlug}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: a.roundSlug }}
                        className="font-semibold text-white hover:text-sky-300"
                      >
                        {a.title}
                      </Link>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                          a.anomalyDirection === "surge"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {a.anomalyDirection}
                      </span>
                    </div>
                    <p className="text-zinc-400">{a.anomalyReason}</p>
                    {a.nearestEvent && (
                      <p className="font-mono text-[11px] text-amber-300">
                        Event ({a.nearestEvent.eventDate}):{" "}
                        {a.nearestEvent.title}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Round-by-round history */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Sale Round History ({roundHistory.length})
        </h2>
        {roundHistory.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No sale rounds recorded for {member.name} yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Round</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Rank</th>
                  <th className="px-4 py-3 text-right">Mints</th>
                  <th className="px-4 py-3 text-right">Share</th>
                  <th className="px-4 py-3 text-right">Rel. Index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {roundHistory.map((r) => (
                  <tr key={r.roundSlug} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: r.roundSlug }}
                        className="font-medium text-white hover:text-sky-300"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {r.startAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-white">
                      #{r.rank}{" "}
                      <span className="text-zinc-500 font-normal">
                        /{r.participatingMembers}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-200 tabular-nums">
                      {r.mintCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                      {r.sharePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-zinc-200 tabular-nums">
                      {r.relativeIndex.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Member Milestones */}
      {events.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Tagged Milestones ({events.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-1"
              >
                <div className="font-mono text-xs text-zinc-400">
                  {ev.eventDate} • {ev.category}
                </div>
                <p className="text-sm font-semibold text-white">{ev.title}</p>
                <p className="text-xs text-zinc-400">{ev.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Indexed Collections */}
      {collections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Top Indexed Collections
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {collections.map((c) => (
              <div
                key={c.slug}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"
              >
                {c.frontImageUrl && (
                  <img
                    src={c.frontImageUrl}
                    alt={c.collectionId}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
                )}
                <div className="p-2">
                  <p className="truncate text-[11px] font-medium text-zinc-200">
                    {c.collectionId}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    {c.totalMints.toLocaleString()} mints
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
