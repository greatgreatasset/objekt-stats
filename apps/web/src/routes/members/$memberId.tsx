import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CircleDollarSign,
  LayoutGrid,
} from "lucide-react";
import { useState } from "react";
import { apolloCollectionUrl } from "@objekt-stats/stats";
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
  const [chartMetric, setChartMetric] = useState<"buyers" | "mints">("buyers");

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

  const {
    member,
    roundHistory,
    classBreakdown,
    anomalies,
    collections,
    events,
    gridSummary,
    memberEarnings,
  } = data;
  const minBuyers = member.artistId === "artms" ? 50 : 150;
  const popHistory = [...roundHistory]
    .filter((r) => r.includeInPopularity && r.roundUniqueBuyers >= minBuyers)
    .reverse(); // chronological for trajectory chart
  const totalMints = collections.reduce((s, c) => s + c.totalMints, 0);
  const popMintsSum = popHistory.reduce((s, r) => s + r.mintCount, 0);
  const popBuyersSum = popHistory.reduce((s, r) => s + r.uniqueBuyers, 0);
  const avgBuyersRank =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.uniqueBuyersRank, 0) /
          popHistory.length
        ).toFixed(1)
      : "—";
  const avgMintsRank =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.rank, 0) / popHistory.length
        ).toFixed(1)
      : "—";
  const avgBuyersRel =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.uniqueBuyersRelativeIndex, 0) /
          popHistory.length
        ).toFixed(2) + "×"
      : "—";
  const avgMintsPerBuyer =
    popBuyersSum > 0 ? `${(popMintsSum / popBuyersSum).toFixed(2)}×` : "—";

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

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-300">Avg Buyers Rank</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgBuyersRank === "—" ? "—" : `#${avgBuyersRank}`}
                </div>
                <div className="font-mono text-[10px] text-zinc-400">
                  Mints: {avgMintsRank === "—" ? "—" : `#${avgMintsRank}`}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Buyers Index</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgBuyersRel}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Mints / Buyer</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgMintsPerBuyer}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
                <div className="text-[11px] text-emerald-200/90">Grids Completed</div>
                <div className="font-mono text-lg font-bold text-white">
                  {gridSummary.totalGridsCompleted.toLocaleString()}
                </div>
                <div className="font-mono text-[10px] text-emerald-300/80">
                  {gridSummary.totalLockedFcos.toLocaleString()} FCOs locked
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

      {/* Estimated Objekt Earnings Snapshot */}
      {memberEarnings && (
        <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] via-zinc-900/50 to-zinc-900/40 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-emerald-400" />
                Estimated Digital Objekt Earnings (
                {memberEarnings.selectedSeasons.join(" + ")})
              </h2>
              <p className="text-xs text-zinc-400">
                100%-indexed on-chain seasons
                {memberEarnings.spanDays
                  ? ` (${memberEarnings.spanDays}d window)`
                  : ""}{" "}
                · Ranked{" "}
                <strong className="text-zinc-200">
                  #{memberEarnings.rankInGroup}/{memberEarnings.groupMemberCount}
                </strong>{" "}
                ({memberEarnings.shareOfGroupPct.toFixed(1)}% of group ·{" "}
                {memberEarnings.relativeToAvg.toFixed(2)}× avg). Modhaus&apos;s
                exact contract split is private — shown across 20% / 30% / 50%
                of post-fee net revenue.
              </p>
            </div>
            <Link
              to="/earnings"
              search={member.artistId === "artms" ? { artist: "artms" } : {}}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
            >
              Customize Split
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-1">
              <div className="text-[11px] text-zinc-400">Est. Gross Sales</div>
              <div className="font-mono text-lg font-bold text-white tabular-nums">
                ${Math.round(memberEarnings.totalGrossUsd).toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                Net after ~{memberEarnings.effectiveFeePct.toFixed(1)}% fees: $
                {Math.round(memberEarnings.netRevenueUsd).toLocaleString()}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-1">
              <div className="text-[11px] text-zinc-400">At 20% Net Split</div>
              <div className="font-mono text-lg font-bold text-zinc-100 tabular-nums">
                ${memberEarnings.earningsAt20Usd.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                Conservative (80/20)
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 space-y-1">
              <div className="text-[11px] text-emerald-200/90">
                At 30% Net Split
              </div>
              <div className="font-mono text-lg font-bold text-emerald-300 tabular-nums">
                ${memberEarnings.earningsAt30Usd.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-emerald-300/75">
                Mid Estimate (70/30)
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-1">
              <div className="text-[11px] text-zinc-400">At 50% Net Split</div>
              <div className="font-mono text-lg font-bold text-zinc-100 tabular-nums">
                ${memberEarnings.earningsAt50Usd.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                Artist-Forward (50/50)
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400 tabular-nums">
            <span>
              Paid FCO:{" "}
              <strong className="text-zinc-200">
                {memberEarnings.paidFcoMints.toLocaleString()}
              </strong>{" "}
              <span className="text-zinc-500">
                ({memberEarnings.rawFcoMints.toLocaleString()} raw −{" "}
                {memberEarnings.estSpinFcoMints.toLocaleString()} spin)
              </span>
            </span>
            <span>
              Paid DCO:{" "}
              <strong className="text-zinc-200">
                {memberEarnings.paidDcoMints.toLocaleString()}
              </strong>
            </span>
            <span>
              Motion MCO:{" "}
              <strong className="text-zinc-200">
                {memberEarnings.paidMcoMints.toLocaleString()}
              </strong>
            </span>
            {memberEarnings.passPlusMints > 0 && (
              <span>
                Pass+:{" "}
                <strong className="text-zinc-200">
                  {memberEarnings.passPlusMints.toLocaleString()}
                </strong>
              </span>
            )}
            <span className="text-zinc-500">
              ({memberEarnings.freeExcludedMints.toLocaleString()} free rewards
              excluded)
            </span>
          </div>
        </section>
      )}

      {/* Career Rank Trajectory Chart */}
      {popHistory.length >= 2 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">
                Rank Trajectory Across Paid Popularity Rounds
              </h2>
              <p className="text-xs text-zinc-400">
                Higher is better (#1 at top). White-ringed dots indicate
                statistically flagged surges or drops.
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChartMetric("buyers")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  chartMetric === "buyers"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Buyers Rank
              </button>
              <button
                type="button"
                onClick={() => setChartMetric("mints")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  chartMetric === "mints"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Mints Rank
              </button>
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
                    const rankVal =
                      chartMetric === "buyers" ? r.uniqueBuyersRank : r.rank;
                    const x =
                      52 + (i / Math.max(1, popHistory.length - 1)) * 676;
                    const y =
                      20 + ((rankVal - 1) / Math.max(1, maxRank - 1)) * 150;
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
                const rankVal =
                  chartMetric === "buyers" ? r.uniqueBuyersRank : r.rank;
                const x = 52 + (i / Math.max(1, popHistory.length - 1)) * 676;
                const y =
                  20 + ((rankVal - 1) / Math.max(1, maxRank - 1)) * 150;
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
                    <title>{`${r.title} (${r.startAt.slice(0, 10)}): Buyers #${r.uniqueBuyersRank} (${r.uniqueBuyers} buyers) · Mints #${r.rank} (${r.mintCount} mints, ${r.mintsPerBuyer.toFixed(1)}/buyer)`}</title>
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
                      #{c.avgBuyersRank}{" "}
                      <span className="text-xs font-normal text-zinc-400">
                        buyers avg (Mints #{c.avgRank})
                      </span>
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {c.totalMints.toLocaleString()} mints ·{" "}
                      {c.avgMintsPerBuyer.toFixed(2)}/buyer
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

      {/* COSMO Grid Supply & Lock Monitor */}
      {gridSummary.editions.length > 0 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-emerald-400" />
                COSMO Grid Completions &amp; Tradable Float
              </h2>
              <p className="text-xs text-zinc-400">
                Completed grids permanently lock Digital First Class Objekts as
                unsendable (8 cards for 1st/2nd Ed; 4 cards for 3rd Ed), reducing
                real tradable supply.
              </p>
            </div>
            <span className="font-mono text-xs text-emerald-300">
              {gridSummary.totalGridsCompleted.toLocaleString()} grids ·{" "}
              {gridSummary.totalLockedFcos.toLocaleString()} locked FCOs
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gridSummary.editions.slice(0, 9).map((ed) => (
              <div
                key={ed.key}
                className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    {ed.season} {ed.shortLabel}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      ed.gridLockPct >= 50
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {ed.gridLockPct.toFixed(1)}% locked
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className={`h-full rounded-full ${
                      ed.gridLockPct >= 50 ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(3, ed.gridLockPct))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400 tabular-nums">
                  <span>{ed.gridsCompleted.toLocaleString()} grids</span>
                  <span className="text-zinc-200">
                    ~{ed.estTradableFloatPerSlot.toLocaleString()} float/card
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
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
                  <th className="px-4 py-3 text-right">Buyers Rank</th>
                  <th className="px-4 py-3 text-right">Mints Rank</th>
                  <th className="px-4 py-3 text-right">Buyers</th>
                  <th className="px-4 py-3 text-right">Mints</th>
                  <th className="px-4 py-3 text-right">Mints/Buyer</th>
                  <th className="px-4 py-3 text-right">Top Wallet</th>
                  <th className="px-4 py-3 text-right">Buyers Index</th>
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
                      {!r.includeInPopularity && (
                        <span className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {r.saleMechanic}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {r.startAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-white">
                      #{r.uniqueBuyersRank}{" "}
                      <span className="text-zinc-500 font-normal">
                        /{r.participatingMembers}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">
                      #{r.rank}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-zinc-100 tabular-nums">
                      {r.uniqueBuyers.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">
                      {r.mintCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                      {r.mintsPerBuyer.toFixed(1)}×
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {r.topBuyerSharePct !== null ? (
                        <span
                          className={
                            r.topBuyerSharePct >= 35 && r.mintCount >= 5
                              ? "font-semibold text-amber-300"
                              : "text-zinc-400"
                          }
                        >
                          {r.topBuyerSharePct.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-zinc-200 tabular-nums">
                      {r.uniqueBuyersRelativeIndex.toFixed(2)}×
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
      {collections.length > 0 && (() => {
        const pricedCount = collections.filter(
          (c) => c.apolloMedianPriceUsd !== null && c.apolloMedianPriceUsd > 0,
        ).length;
        const apolloMatchedCount = collections.filter(
          (c) => c.apolloTotalCopies !== null && c.apolloTotalCopies > 0,
        ).length;
        return (
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">
                Top Indexed Collections
              </h2>
              {apolloMatchedCount > 0 && (
                <p className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  Apollo market:{" "}
                  <span className="text-amber-300/90">
                    {pricedCount}/{collections.length}
                  </span>{" "}
                  with active listings
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {collections.map((c) => {
                const hasPrice =
                  c.apolloMedianPriceUsd !== null && c.apolloMedianPriceUsd > 0;
                const hasRange =
                  hasPrice &&
                  c.apolloMinPriceUsd !== null &&
                  c.apolloMaxPriceUsd !== null &&
                  c.apolloMaxPriceUsd - c.apolloMinPriceUsd >= 0.05;
                const priceTitle = hasPrice
                  ? `Apollo secondary market: median $${c.apolloMedianPriceUsd!.toFixed(2)}${
                      c.apolloMinPriceUsd !== null
                        ? `, floor $${c.apolloMinPriceUsd.toFixed(2)}`
                        : ""
                    }${
                      c.apolloMaxPriceUsd !== null
                        ? `, high $${c.apolloMaxPriceUsd.toFixed(2)}`
                        : ""
                    }${
                      c.apolloListingCount
                        ? ` across ${c.apolloListingCount} listing${
                            c.apolloListingCount === 1 ? "" : "s"
                          }`
                        : ""
                    }`
                  : "No active secondary market listings on Apollo";
                return (
                  <a
                    key={c.slug}
                    href={apolloCollectionUrl(
                      c.season,
                      c.rawMemberName,
                      c.collectionNo,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-sky-500/50"
                  >
                    {c.frontImageUrl && (
                      <img
                        src={c.frontImageUrl}
                        alt={c.collectionId}
                        loading="lazy"
                        className="aspect-[2/3] w-full object-cover"
                      />
                    )}
                    <div className="p-2 space-y-0.5">
                      <p className="truncate text-[11px] font-medium text-zinc-200 group-hover:text-sky-300">
                        {c.collectionId}
                      </p>
                      {c.apolloTotalCopies !== null && c.apolloTotalCopies > 0 ? (
                        <p className="font-mono text-[10px] text-zinc-400 tabular-nums">
                          {c.apolloTotalCopies.toLocaleString()} copies ·{" "}
                          <span className="text-emerald-300/90">
                            {c.apolloTransferablePct?.toFixed(0)}%
                          </span>
                        </p>
                      ) : (
                        <p className="font-mono text-[10px] text-zinc-500">
                          {c.totalMints.toLocaleString()} mints
                        </p>
                      )}
                      {hasPrice ? (
                        <>
                          <p
                            title={priceTitle}
                            className="font-mono text-[10px] font-medium text-amber-300 tabular-nums"
                          >
                            Med ${c.apolloMedianPriceUsd!.toFixed(2)}
                            {c.apolloListingCount
                              ? ` (${c.apolloListingCount})`
                              : ""}
                          </p>
                          {hasRange && (
                            <p
                              title={priceTitle}
                              className="font-mono text-[10px] text-zinc-400 tabular-nums"
                            >
                              ${c.apolloMinPriceUsd!.toFixed(2)}–$
                              {c.apolloMaxPriceUsd!.toFixed(2)}
                            </p>
                          )}
                        </>
                      ) : c.apolloTotalCopies !== null &&
                        c.apolloTotalCopies > 0 ? (
                        <p
                          title={priceTitle}
                          className="font-mono text-[10px] text-zinc-600"
                        >
                          No active listings
                        </p>
                      ) : null}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })()}
    </div>
  );
}
