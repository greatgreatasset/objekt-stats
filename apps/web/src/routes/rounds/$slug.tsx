import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Info,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getRoundDetail } from "../../lib/server/queries";

export const Route = createFileRoute("/rounds/$slug")({
  loader: ({ params }) => getRoundDetail({ data: params.slug }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Sale Round Not Found — Objekt Stats" }] };
    }
    const { round, leaderboard } = loaderData;
    const topByBuyers = [...leaderboard].sort(
      (a, b) =>
        a.uniqueBuyersRank - b.uniqueBuyersRank || b.mintCount - a.mintCount,
    )[0];
    const artistLabel = round.artistId === "artms" ? "ARTMS" : "tripleS";
    const title = `${artistLabel} ${round.title} — Objekt Stats`;
    const desc = topByBuyers
      ? `${round.uniqueBuyers.toLocaleString()} unique buyers minted ${round.totalMints.toLocaleString()} Objekts across ${round.participatingMembers} members. #1 by buyers: ${topByBuyers.memberName} (${topByBuyers.uniqueBuyers.toLocaleString()} buyers, ${topByBuyers.mintCount.toLocaleString()} mints).`
      : `${round.totalMints.toLocaleString()} total Objekts minted in ${round.title}.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: RoundDetailPage,
});

function RoundDetailPage() {
  const data = Route.useLoaderData();
  const [copied, setCopied] = useState(false);
  const [metric, setMetric] = useState<"buyers" | "mints">("buyers");

  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
        <h1 className="text-xl font-semibold text-white">Sale round not found</h1>
        <Link
          to="/rounds"
          className="inline-flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sale rounds
        </Link>
      </div>
    );
  }

  const { round, leaderboard, collections, dailyCurve, correlatedEvents } = data;
  const sortedLeaderboard = useMemo(() => {
    const copy = [...leaderboard];
    if (metric === "buyers") {
      return copy.sort(
        (a, b) =>
          a.uniqueBuyersRank - b.uniqueBuyersRank ||
          b.uniqueBuyers - a.uniqueBuyers ||
          b.mintCount - a.mintCount,
      );
    }
    return copy.sort(
      (a, b) =>
        a.rank - b.rank ||
        b.mintCount - a.mintCount ||
        b.uniqueBuyers - a.uniqueBuyers,
    );
  }, [leaderboard, metric]);

  const maxMetricValue = Math.max(
    1,
    ...sortedLeaderboard.map((l) =>
      metric === "buyers" ? l.uniqueBuyers : l.mintCount,
    ),
  );
  const sumUniqueBuyersAcrossMembers = sortedLeaderboard.reduce(
    (acc, r) => acc + r.uniqueBuyers,
    0,
  );
  const estGrossUsd =
    round.unitPriceUsd && round.unitPriceUsd > 0
      ? round.totalMints * round.unitPriceUsd
      : null;

  const nonPopularityReason =
    round.saleMechanic === "reward"
      ? "Special Class (SCO) grid completion reward or free event drop — not a paid public shop sale."
      : round.saleMechanic === "physical_scan"
        ? "Physical Objekt QR scan (A-series) — reflects album/merch code scans rather than digital shop sales."
        : round.saleMechanic === "random_pack"
          ? "Random pack draw — uniform odds pull every member toward equal share."
          : "Excluded from member popularity trend averages.";

  const copyRecap = async () => {
    const artistLabel = round.artistId === "artms" ? "ARTMS" : "tripleS";
    const modeLabel = metric === "buyers" ? "Unique Buyers" : "Total Mints";
    const topLines = sortedLeaderboard.slice(0, 10).map((r) => {
      if (metric === "buyers") {
        return `#${r.uniqueBuyersRank} ${r.memberName} — ${r.uniqueBuyers.toLocaleString()} buyers (${r.mintCount.toLocaleString()} mints, ${r.mintsPerBuyer.toFixed(1)}/w | ${r.uniqueBuyersRelativeIndex.toFixed(2)}×)`;
      }
      return `#${r.rank} ${r.memberName} — ${r.mintCount.toLocaleString()} mints (${r.uniqueBuyers.toLocaleString()} buyers, ${r.sharePct.toFixed(1)}% | ${r.relativeIndex.toFixed(2)}×)`;
    });
    const text = [
      `${artistLabel} — ${round.title} (${round.startAt.slice(0, 10)}) · Ranked by ${modeLabel}`,
      `${round.uniqueBuyers.toLocaleString()} Unique Buyers · ${round.totalMints.toLocaleString()} Total Mints across ${round.participatingMembers} members`,
      "",
      ...topLines,
      "",
      `Full stats: https://objektstats.com/rounds/${round.slug}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable in insecure context
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/rounds"
            search={round.artistId === "artms" ? { artist: "artms" } : {}}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All {round.artistId === "artms" ? "ARTMS" : "tripleS"} Sale Rounds
          </Link>

          <button
            type="button"
            onClick={copyRecap}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied Recap
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy X/Twitter Recap
              </>
            )}
          </button>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-200">
                {round.season}
              </span>
              <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">
                {round.objektClass} Class
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  round.includeInPopularity
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {round.includeInPopularity
                  ? `paid · ${round.saleMechanic}`
                  : `excluded · ${round.saleMechanic}`}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {round.title}
            </h1>
            <p className="font-mono text-xs text-zinc-400">
              Indexed window: {round.startAt.slice(0, 16).replace("T", " ")} UTC
              {round.endAt
                ? ` → ${round.endAt.slice(0, 16).replace("T", " ")} UTC`
                : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatPill
              label="Unique Buyers"
              value={round.uniqueBuyers.toLocaleString()}
              highlight
            />
            <StatPill
              label="Total Mints"
              value={round.totalMints.toLocaleString()}
            />
            <StatPill
              label="Members"
              value={String(round.participatingMembers)}
            />
            <StatPill
              label="Est. Gross"
              value={
                estGrossUsd ? `$${Math.round(estGrossUsd).toLocaleString()}` : "N/A"
              }
            />
          </div>
        </div>

        {!round.includeInPopularity && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-200">
                Excluded from Member Popularity Trends
              </p>
              <p className="text-amber-200/80">
                {nonPopularityReason} Because single-wallet bulk completions or
                scans can heavily skew total mint counts, compare{" "}
                <strong className="text-white">Unique Buyers</strong> and{" "}
                <strong className="text-white">Top Wallet %</strong> below to
                separate broad fan demand from single-whale spikes.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Member Ranking Bar Chart */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Member Demand Ranking
            </h2>
            <p className="text-xs text-zinc-400">
              {metric === "buyers"
                ? "Ranked by distinct purchasing wallets — resistant to single-whale bulk minting. Relative Index compares against the round average (1.00×)."
                : "Ranked by total on-chain Objekts minted. Whale pills flag when a single wallet minted ≥ 35% of a member's total."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMetric("buyers")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                  metric === "buyers"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Unique Buyers
              </button>
              <button
                type="button"
                onClick={() => setMetric("mints")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  metric === "mints"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Total Mints
              </button>
            </div>

            <span className="font-mono text-xs text-zinc-500">
              Mean:{" "}
              {metric === "buyers"
                ? `${Math.round(sumUniqueBuyersAcrossMembers / Math.max(1, round.participatingMembers)).toLocaleString()} buyers/member`
                : `${Math.round(round.totalMints / Math.max(1, round.participatingMembers)).toLocaleString()} mints/member`}
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          {sortedLeaderboard.map((row) => {
            const activeVal =
              metric === "buyers" ? row.uniqueBuyers : row.mintCount;
            const activeRank =
              metric === "buyers" ? row.uniqueBuyersRank : row.rank;
            const otherRank =
              metric === "buyers" ? row.rank : row.uniqueBuyersRank;
            const activeShare =
              metric === "buyers" ? row.uniqueBuyersSharePct : row.sharePct;
            const activeRel =
              metric === "buyers"
                ? row.uniqueBuyersRelativeIndex
                : row.relativeIndex;
            const pctWidth = Math.max(3, (activeVal / maxMetricValue) * 100);
            const hasWhaleSkew =
              row.topBuyerSharePct !== null &&
              row.topBuyerSharePct >= 35 &&
              row.mintCount >= 5;
            const hasLargeRankGap = Math.abs(row.rank - row.uniqueBuyersRank) >= 2;

            return (
              <Link
                key={row.memberId}
                to="/members/$memberId"
                params={{ memberId: row.memberId }}
                className="group block rounded-xl border border-transparent p-2 transition hover:border-zinc-800 hover:bg-zinc-950/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-7 font-mono font-bold text-zinc-300">
                      #{activeRank}
                    </span>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: row.hexColor }}
                    />
                    <span className="font-semibold text-white group-hover:text-sky-300">
                      {row.memberName}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {row.memberCode}
                    </span>

                    {hasLargeRankGap && (
                      <span
                        title={
                          metric === "buyers"
                            ? `Ranked #${row.rank} by total mints vs #${row.uniqueBuyersRank} by unique buyers`
                            : `Ranked #${row.uniqueBuyersRank} by unique buyers vs #${row.rank} by total mints`
                        }
                        className="rounded border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                      >
                        {metric === "buyers"
                          ? `Mints #${otherRank}`
                          : `Buyers #${otherRank}`}
                      </span>
                    )}

                    {hasWhaleSkew && row.topBuyerSharePct !== null && (
                      <span
                        title={`Top single wallet minted ${row.topBuyerSharePct.toFixed(1)}% of ${row.memberName}'s copies (${row.mintCount} mints across ${row.uniqueBuyers} unique buyers, ${row.mintsPerBuyer.toFixed(1)} mints/buyer)`}
                        className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Top wallet {row.topBuyerSharePct.toFixed(0)}%
                      </span>
                    )}

                    {row.rankDeltaPrev !== null && row.rankDeltaPrev !== 0 && (
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          row.rankDeltaPrev > 0
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {row.rankDeltaPrev > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {row.rankDeltaPrev > 0
                          ? `+${row.rankDeltaPrev}`
                          : row.rankDeltaPrev}
                      </span>
                    )}

                    {row.isAnomaly && (
                      <span
                        title={row.anomalyReason ?? undefined}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          row.anomalyDirection === "surge"
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {row.anomalyDirection}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 font-mono tabular-nums">
                    <span className="text-white font-semibold">
                      {metric === "buyers"
                        ? `${row.uniqueBuyers.toLocaleString()} buyers`
                        : `${row.mintCount.toLocaleString()} mints`}
                    </span>
                    <span className="hidden sm:inline text-[11px] text-zinc-400">
                      {metric === "buyers"
                        ? `${row.mintCount.toLocaleString()} mints · ${row.mintsPerBuyer.toFixed(1)}/w`
                        : `${row.uniqueBuyers.toLocaleString()} buyers · ${row.mintsPerBuyer.toFixed(1)}/w`}
                    </span>
                    <span className="w-12 text-right text-zinc-400">
                      {activeShare.toFixed(1)}%
                    </span>
                    <span
                      className={`w-12 text-right font-semibold ${
                        activeRel >= 1.15
                          ? "text-emerald-300"
                          : activeRel <= 0.85
                            ? "text-rose-300"
                            : "text-zinc-300"
                      }`}
                    >
                      {activeRel.toFixed(2)}×
                    </span>
                  </div>
                </div>

                <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-950">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pctWidth}%`,
                      backgroundColor: row.hexColor,
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Daily Velocity & Concurrent Events */}
      <div className="grid gap-6 lg:grid-cols-2">
        {dailyCurve.length > 0 && (
          <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">
              Daily Mint Activity (UTC)
            </h2>
            <div className="space-y-2">
              {dailyCurve.map((d) => {
                const maxDay = Math.max(1, ...dailyCurve.map((x) => x.mintCount));
                return (
                  <div key={d.mintDate} className="flex items-center gap-3 text-xs">
                    <span className="w-24 font-mono text-zinc-400">
                      {d.mintDate}
                    </span>
                    <div className="flex-1 h-2 overflow-hidden rounded-full bg-zinc-950">
                      <div
                        className="h-full rounded-full bg-sky-400"
                        style={{
                          width: `${Math.max(4, (d.mintCount / maxDay) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="w-16 text-right font-mono text-zinc-200 tabular-nums">
                      {d.mintCount.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-400" />
            Nearby Curated Events (−14d / +7d)
          </h2>
          {correlatedEvents.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No curated milestones recorded within 14 days before or 7 days
              after this sale window yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {correlatedEvents.map((c) => (
                <div
                  key={c.event.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span>{c.event.eventDate}</span>
                    <span>
                      {c.dayOffset === 0
                        ? "Same day"
                        : c.dayOffset > 0
                          ? `+${c.dayOffset}d after`
                          : `${c.dayOffset}d before`}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-zinc-100">
                    {c.event.title}
                  </p>
                  <p className="text-xs text-zinc-400">{c.event.summary}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Indexed Objekt Card Previews */}
      {collections.some((c) => c.frontImageUrl) && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-white">
            Objekt Previews ({collections.length} collections)
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {collections
              .filter((c) => c.frontImageUrl)
              .slice(0, 24)
              .map((c) => (
                <div
                  key={c.slug}
                  className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"
                >
                  <img
                    src={c.frontImageUrl!}
                    alt={c.collectionId}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
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

function StatPill({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 ${
        highlight
          ? "border-sky-500/40 bg-sky-500/10"
          : "border-zinc-800 bg-zinc-900/60"
      }`}
    >
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className="font-mono text-base font-bold text-white tabular-nums">
        {value}
      </div>
    </div>
  );
}
