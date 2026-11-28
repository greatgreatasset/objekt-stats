import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { apolloCollectionUrl, apolloEventUrl } from "@objekt-stats/stats";
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
  const [previewSort, setPreviewSort] = useState<"sales" | "member">("sales");

  if (!data) {
    return (
      <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-white">Sale round not found</h1>
        <Link
          to="/rounds"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-white underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sale rounds
        </Link>
      </div>
    );
  }

  const {
    round,
    abstractSync,
    apolloSupply,
    leaderboard,
    collections,
    dailyCurve,
    correlatedEvents,
  } = data;

  const isSyncCatchingUpForRound = (() => {
    if (
      !abstractSync?.lastIndexedTimestamp ||
      abstractSync.lagMinutes === null ||
      abstractSync.lagMinutes < 30
    ) {
      return false;
    }
    const syncMs = Date.parse(abstractSync.lastIndexedTimestamp);
    const roundEndMs = Date.parse(round.endAt ?? round.startAt);
    if (Number.isNaN(syncMs) || Number.isNaN(roundEndMs)) return false;
    return syncMs - roundEndMs <= 6 * 60 * 60 * 1000;
  })();

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
    round.saleMechanic === "subscription"
      ? "COSMO Talk Pass+ monthly subscriber drop — reflects recurring talk subscriptions rather than a one-off public shop drop."
      : round.saleMechanic === "reward"
        ? "Free event reward, set-completion bonus, promotional/tour drop, or Special Class (SCO) grid completion — not a paid public shop sale."
        : round.saleMechanic === "physical_scan"
          ? "Physical Objekt QR scan (A-series) — reflects album/merch code scans rather than digital shop sales."
          : round.saleMechanic === "unit_random"
            ? "Random unit-pack draw — fans buy a unit pack and receive a random member from that unit."
            : round.saleMechanic === "random_pack"
              ? "Random pack draw — uniform odds pull every member toward equal share."
              : round.saleMechanic === "dual_distribution"
                ? "Dual fanclub/follower airdrop + shop release — initial mass drop pulls member totals toward equal share."
                : "Excluded from member popularity trend averages.";

  const copyRecap = async () => {
    const artistLabel = round.artistId === "artms" ? "ARTMS" : "tripleS";
    const modeLabel = metric === "buyers" ? "Unique Buyers" : "Total Mints";
    const topLines = sortedLeaderboard.slice(0, 10).map((r) => {
      if (metric === "buyers") {
        return `#${r.uniqueBuyersRank} ${r.memberName} — ${r.uniqueBuyers.toLocaleString()} buyers (${r.mintCount.toLocaleString()} mints, ${r.mintsPerBuyer.toFixed(1)}/buyer | ${r.uniqueBuyersRelativeIndex.toFixed(2)}×)`;
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
      <header className="border-b border-zinc-800/90 pb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/rounds"
            search={round.artistId === "artms" ? { artist: "artms" } : {}}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All {round.artistId === "artms" ? "ARTMS" : "tripleS"} Sale Rounds
          </Link>

          <button
            type="button"
            onClick={copyRecap}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-[#121215] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied Recap
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy Recap
              </>
            )}
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-xs text-zinc-400">
            <span className="text-zinc-200">{round.season}</span>
            <span className="text-zinc-700">/</span>
            <span>{round.objektClass} Class</span>
            <span className="text-zinc-700">/</span>
            <span
              className={
                round.includeInPopularity ? "text-emerald-400" : "text-amber-400"
              }
            >
              {round.includeInPopularity
                ? `paid · ${round.saleMechanic}`
                : `excluded · ${round.saleMechanic}`}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {round.title}
          </h1>
          <p className="font-mono text-xs text-zinc-500">
            Indexed window: {round.startAt.slice(0, 16).replace("T", " ")} UTC
            {round.endAt
              ? ` → ${round.endAt.slice(0, 16).replace("T", " ")} UTC`
              : ""}
          </p>
        </div>

        {/* Inline Metric Strip */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 pt-1">
          <div>
            <div className="text-xs text-zinc-500">Unique Buyers</div>
            <div className="mt-0.5 font-mono text-xl font-semibold text-white tabular-nums">
              {round.uniqueBuyers.toLocaleString()}
            </div>
          </div>
          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />
          <div>
            <div className="text-xs text-zinc-500">Total Mints</div>
            <div className="mt-0.5 font-mono text-xl font-semibold text-white tabular-nums">
              {round.totalMints.toLocaleString()}
            </div>
          </div>
          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />
          <div>
            <div className="text-xs text-zinc-500">Members</div>
            <div className="mt-0.5 font-mono text-xl font-semibold text-white tabular-nums">
              {round.participatingMembers}
            </div>
          </div>
          {estGrossUsd !== null && (
            <>
              <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />
              <div>
                <div className="text-xs text-zinc-500">List-Price Gross</div>
                <div className="mt-0.5 font-mono text-xl font-semibold text-white tabular-nums">
                  ${Math.round(estGrossUsd).toLocaleString()}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {isSyncCatchingUpForRound && abstractSync?.lastIndexedTimestamp && (
        <div className="rounded-lg border-l-2 border-l-amber-400 border border-zinc-800/90 bg-[#121215] px-4 py-3 text-xs text-zinc-300 space-y-0.5">
          <p className="font-semibold text-amber-300">
            Live sync catching up on active drop
          </p>
          <p className="text-zinc-400">
            Abstract indexing is currently through{" "}
            <span className="font-mono text-zinc-200">
              {abstractSync.lastIndexedTimestamp.slice(0, 16).replace("T", " ")}{" "}
              UTC
            </span>{" "}
            (block{" "}
            <span className="font-mono">
              #{abstractSync.lastIndexedBlock.toLocaleString()}
            </span>
            , ~
            {abstractSync.lagMinutes !== null && abstractSync.lagMinutes >= 60
              ? `${(abstractSync.lagMinutes / 60).toFixed(1)}h`
              : `${abstractSync.lagMinutes}m`}{" "}
            behind chain head). Mints after that timestamp will appear as the
            cron catches up.
          </p>
        </div>
      )}

      {(round.apolloDescription ||
        round.apolloEventName ||
        apolloSupply.totalCopies > 0) && (
        <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] text-zinc-500">
                <span className="uppercase tracking-wider text-zinc-300">
                  Release Provenance
                </span>
                {round.apolloEventType && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="uppercase">{round.apolloEventType}</span>
                  </>
                )}
                {round.apolloEraName && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="text-zinc-400">{round.apolloEraName}</span>
                  </>
                )}
              </div>
              {round.apolloDescription && (
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {round.apolloDescription}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs">
              {round.apolloTwitterUrl && (
                <a
                  href={round.apolloTwitterUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-2"
                >
                  Announcement
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {round.apolloEventSlug && (
                <a
                  href={apolloEventUrl(round.apolloEventSlug)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-2"
                >
                  Apollo
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {apolloSupply.totalCopies > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 pt-3 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-zinc-300 tabular-nums">
                <span>
                  <span className="text-zinc-500">All-Time Supply:</span>{" "}
                  <strong className="text-white">
                    {apolloSupply.totalCopies.toLocaleString()}
                  </strong>
                  {apolloSupply.matchedCollections <
                    apolloSupply.totalCollections && (
                    <span className="text-zinc-500">
                      {" "}
                      ({apolloSupply.matchedCollections}/
                      {apolloSupply.totalCollections} cached)
                    </span>
                  )}
                </span>
                <span>
                  <span className="text-zinc-500">Tradeable:</span>{" "}
                  <strong className="text-emerald-400">
                    {apolloSupply.transferableCopies.toLocaleString()}
                  </strong>
                  {apolloSupply.transferablePct !== null && (
                    <span className="text-zinc-400">
                      {" "}
                      ({apolloSupply.transferablePct.toFixed(1)}%)
                    </span>
                  )}
                </span>
                {apolloSupply.medianMarketPriceUsd !== null && (
                  <span>
                    <span className="text-zinc-500">Median Market:</span>{" "}
                    <strong className="text-amber-300">
                      ${apolloSupply.medianMarketPriceUsd.toFixed(2)}
                    </strong>
                    {apolloSupply.totalListings > 0 && (
                      <span className="text-zinc-500">
                        {" "}
                        ({apolloSupply.totalListings} listing
                        {apolloSupply.totalListings === 1 ? "" : "s"})
                      </span>
                    )}
                  </span>
                )}
              </div>
              <a
                href="https://apollo.cafe"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                via apollo.cafe
              </a>
            </div>
          )}
        </div>
      )}

      {!round.includeInPopularity && (
        <div className="rounded-lg border-l-2 border-l-amber-500/80 border border-zinc-800/90 bg-[#121215] px-4 py-3 text-xs text-zinc-400 space-y-0.5">
          <p className="font-semibold text-zinc-200">
            Excluded from member popularity trends
          </p>
          <p>{nonPopularityReason}</p>
        </div>
      )}

      {/* Member Demand Ranking */}
      <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Member Demand Ranking
            </h2>
            <p className="text-xs text-zinc-400">
              {metric === "buyers"
                ? "Ranked by distinct purchasing wallets (1.00× = round average)."
                : "Ranked by total on-chain Objekts minted. Flags when one wallet minted ≥ 35%."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMetric("buyers")}
                className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  metric === "buyers"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Unique Buyers
              </button>
              <button
                type="button"
                onClick={() => setMetric("mints")}
                className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  metric === "mints"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Total Mints
              </button>
            </div>

            <span className="font-mono text-xs text-zinc-500 tabular-nums">
              Mean:{" "}
              {metric === "buyers"
                ? `${Math.round(sumUniqueBuyersAcrossMembers / Math.max(1, round.participatingMembers)).toLocaleString()} buyers`
                : `${Math.round(round.totalMints / Math.max(1, round.participatingMembers)).toLocaleString()} mints`}
            </span>
          </div>
        </div>

        <div className="divide-y divide-zinc-800/60">
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
                className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70 sm:px-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 font-mono text-zinc-500 tabular-nums">
                      {activeRank}
                    </span>
                    <span
                      className="h-2.5 w-2.5 rounded-[2px]"
                      style={{ backgroundColor: row.hexColor }}
                    />
                    <span className="text-sm font-medium text-zinc-100 group-hover:text-white">
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
                        className="font-mono text-[10px] text-zinc-500"
                      >
                        ({metric === "buyers" ? `mints #${otherRank}` : `buyers #${otherRank}`})
                      </span>
                    )}

                    {hasWhaleSkew && row.topBuyerSharePct !== null && (
                      <span
                        title={`Top single wallet minted ${row.topBuyerSharePct.toFixed(1)}% of ${row.memberName}'s copies (${row.mintCount} mints across ${row.uniqueBuyers} unique buyers)`}
                        className="font-mono text-[10px] text-amber-400"
                      >
                        top wallet {row.topBuyerSharePct.toFixed(0)}%
                      </span>
                    )}

                    {row.rankDeltaPrev !== null && row.rankDeltaPrev !== 0 && (
                      <span
                        className={`font-mono text-[11px] ${
                          row.rankDeltaPrev > 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {row.rankDeltaPrev > 0
                          ? `+${row.rankDeltaPrev}`
                          : row.rankDeltaPrev}
                      </span>
                    )}

                    {row.isAnomaly && (
                      <span
                        title={row.anomalyReason ?? undefined}
                        className={`font-mono text-[10px] uppercase ${
                          row.anomalyDirection === "surge"
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {row.anomalyDirection}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 font-mono tabular-nums">
                    <span className="text-zinc-100 font-semibold">
                      {metric === "buyers"
                        ? `${row.uniqueBuyers.toLocaleString()} buyers`
                        : `${row.mintCount.toLocaleString()} mints`}
                    </span>
                    <span
                      className="hidden sm:inline text-xs text-zinc-500"
                      title={`Average ${row.mintsPerBuyer.toFixed(2)} Objekts minted per unique buyer`}
                    >
                      {metric === "buyers"
                        ? `${row.mintCount.toLocaleString()} mints · ${row.mintsPerBuyer.toFixed(1)}/buyer`
                        : `${row.uniqueBuyers.toLocaleString()} buyers · ${row.mintsPerBuyer.toFixed(1)}/buyer`}
                    </span>
                    {row.apollo && row.apollo.totalCopies > 0 && (
                      <span
                        title={`Apollo all-time supply: ${row.apollo.totalCopies.toLocaleString()} total, ${row.apollo.transferableCopies.toLocaleString()} tradeable (${row.apollo.transferablePct.toFixed(1)}%)${row.apollo.medianPriceUsd ? ` · Median listing $${row.apollo.medianPriceUsd.toFixed(2)}` : ""}`}
                        className="hidden md:inline text-[11px] text-zinc-400"
                      >
                        {row.apollo.transferablePct.toFixed(0)}% tradeable
                        {row.apollo.medianPriceUsd
                          ? ` · $${row.apollo.medianPriceUsd.toFixed(2)}`
                          : ""}
                      </span>
                    )}
                    <span className="w-12 text-right text-zinc-500">
                      {activeShare.toFixed(1)}%
                    </span>
                    <span
                      className={`w-12 text-right font-semibold ${
                        activeRel >= 1.15
                          ? "text-emerald-400"
                          : activeRel <= 0.85
                            ? "text-rose-400"
                            : "text-zinc-200"
                      }`}
                    >
                      {activeRel.toFixed(2)}×
                    </span>
                  </div>
                </div>

                <div className="mt-2 ml-8 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                  <div
                    className="h-full transition-all"
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
          <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
            <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
              <h2 className="text-sm font-semibold text-white">
                Daily Mint Activity (UTC)
              </h2>
            </div>
            <div className="p-4 sm:p-5 space-y-2">
              {dailyCurve.map((d) => {
                const maxDay = Math.max(1, ...dailyCurve.map((x) => x.mintCount));
                return (
                  <div key={d.mintDate} className="flex items-center gap-3 text-xs">
                    <span className="w-24 font-mono text-zinc-400 tabular-nums">
                      {d.mintDate}
                    </span>
                    <div className="flex-1 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className="h-full bg-zinc-300"
                        style={{
                          width: `${Math.max(3, (d.mintCount / maxDay) * 100)}%`,
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

        <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-semibold text-white">
              Nearby Events (−14d / +7d)
            </h2>
          </div>
          {correlatedEvents.length === 0 ? (
            <p className="p-4 text-xs text-zinc-500 sm:p-5">
              No curated milestones recorded within 14 days before or 7 days
              after this sale window.
            </p>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {correlatedEvents.map((c) => (
                <div key={c.event.id} className="px-4 py-3 space-y-1 sm:px-5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                    <span>{c.event.eventDate}</span>
                    <span>
                      {c.dayOffset === 0
                        ? "Same day"
                        : c.dayOffset > 0
                          ? `+${c.dayOffset}d after`
                          : `${c.dayOffset}d before`}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-zinc-100">
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
      {(() => {
        const basePreviewCols = collections
          .filter((c) => c.frontImageUrl)
          .slice(0, 24);
        if (basePreviewCols.length === 0) return null;

        const salesRankBySlug = new Map<string, number>();
        [...basePreviewCols]
          .sort(
            (a, b) =>
              b.totalMints - a.totalMints || a.memberOrder - b.memberOrder,
          )
          .forEach((c, idx) => {
            salesRankBySlug.set(c.slug, idx + 1);
          });

        const previewCols = [...basePreviewCols].sort((a, b) =>
          previewSort === "sales"
            ? b.totalMints - a.totalMints || a.memberOrder - b.memberOrder
            : a.memberOrder - b.memberOrder ||
              a.collectionNo.localeCompare(b.collectionNo),
        );

        const distinctCollectionNos = new Set(
          previewCols.map((c) => c.collectionNo),
        ).size;
        const isArtmsRound = round.artistId === "artms";
        const memberSortLabel = isArtmsRound ? "A1–A5" : "S1–S24";
        const pricedCount = previewCols.filter(
          (c) => c.apolloMedianPriceUsd !== null && c.apolloMedianPriceUsd > 0,
        ).length;
        const apolloMatchedCount = previewCols.filter(
          (c) => c.apolloTotalCopies !== null && c.apolloTotalCopies > 0,
        ).length;

        return (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold text-white">
                  Objekt Previews ({collections.length} collections)
                </h2>
                <p className="font-mono text-xs text-zinc-400 tabular-nums">
                  {round.unitPriceUsd !== null && round.unitPriceUsd > 0 && (
                    <span>
                      COSMO retail ~${round.unitPriceUsd.toFixed(2)}
                      {apolloMatchedCount > 0 ? " · " : ""}
                    </span>
                  )}
                  {apolloMatchedCount > 0 && (
                    <span>
                      Apollo market:{" "}
                      <span className="text-amber-300">
                        {pricedCount}/{previewCols.length}
                      </span>{" "}
                      with active listings
                    </span>
                  )}
                </p>
              </div>

              <div className="inline-flex rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewSort("sales")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                    previewSort === "sales"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  Most Sales
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewSort("member")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                    previewSort === "member"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {memberSortLabel}
                </button>
              </div>
            </div>

            <div
              className={
                isArtmsRound && previewCols.length <= 5
                  ? "grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5"
                  : "grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              }
            >
              {previewCols.map((c) => {
                const salesRank = salesRankBySlug.get(c.slug) ?? 1;
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
                    title={`${c.collectionId} · ${c.totalMints.toLocaleString()} on-chain sales${c.apolloTransferablePct !== null ? ` · ${c.apolloTransferablePct.toFixed(1)}% tradeable` : ""} · ${priceTitle}`}
                    className="group overflow-hidden rounded-lg border border-zinc-800/90 bg-[#121215] transition-colors hover:border-zinc-500"
                  >
                    <img
                      src={c.frontImageUrl!}
                      alt={c.collectionId}
                      loading="lazy"
                      className="aspect-[2/3] w-full object-cover"
                    />
                    <div className="p-2.5 space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {c.memberName}
                        </span>
                        <span className="font-mono text-xs text-zinc-400 shrink-0">
                          {distinctCollectionNos > 1
                            ? c.collectionNo
                            : c.memberCode || c.collectionNo}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                        <span className="text-sm font-bold text-zinc-100">
                          {c.totalMints.toLocaleString()}
                          <span className="ml-1 font-sans text-xs font-normal text-zinc-400">
                            sales
                          </span>
                        </span>
                        <span className="text-xs text-zinc-400">
                          #{salesRank}
                        </span>
                      </div>

                      {hasPrice ? (
                        <div className="flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums pt-0.5">
                          <span className="font-medium text-amber-300">
                            ${c.apolloMedianPriceUsd!.toFixed(2)}
                            {c.apolloListingCount
                              ? ` (${c.apolloListingCount})`
                              : ""}
                          </span>
                          {hasRange ? (
                            <span className="text-zinc-400 text-[11px]">
                              ${c.apolloMinPriceUsd!.toFixed(2)}–$
                              {c.apolloMaxPriceUsd!.toFixed(2)}
                            </span>
                          ) : c.apolloTransferablePct !== null ? (
                            <span className="text-emerald-400/90">
                              {c.apolloTransferablePct.toFixed(0)}% trade
                            </span>
                          ) : null}
                        </div>
                      ) : c.apolloTransferablePct !== null ? (
                        <p className="font-mono text-xs text-emerald-400/90 tabular-nums pt-0.5">
                          {c.apolloTransferablePct.toFixed(0)}% tradeable
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
