import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { getRoundDetail } from "../../lib/server/queries";

export const Route = createFileRoute("/rounds/$slug")({
  loader: ({ params }) => getRoundDetail({ data: params.slug }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Sale Round Not Found — Objekt Stats" }] };
    }
    const { round, leaderboard } = loaderData;
    const top1 = leaderboard[0];
    const artistLabel = round.artistId === "artms" ? "ARTMS" : "tripleS";
    const title = `${artistLabel} ${round.title} — Objekt Stats`;
    const desc = top1
      ? `${round.totalMints.toLocaleString()} total Objekts minted across ${round.participatingMembers} members. #1 ${top1.memberName} (${top1.mintCount.toLocaleString()}, ${top1.sharePct.toFixed(1)}%).`
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
  const maxMints = Math.max(1, ...leaderboard.map((l) => l.mintCount));
  const estGrossUsd =
    round.unitPriceUsd && round.unitPriceUsd > 0
      ? round.totalMints * round.unitPriceUsd
      : null;

  const copyRecap = async () => {
    const artistLabel = round.artistId === "artms" ? "ARTMS" : "tripleS";
    const topLines = leaderboard
      .slice(0, 10)
      .map(
        (r) =>
          `#${r.rank} ${r.memberName} — ${r.mintCount.toLocaleString()} (${r.sharePct.toFixed(1)}% | ${r.relativeIndex.toFixed(2)}×)`,
      );
    const text = [
      `${artistLabel} — ${round.title} (${round.startAt.slice(0, 10)})`,
      `Total Mints: ${round.totalMints.toLocaleString()} across ${round.participatingMembers} members`,
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
                    : "border-zinc-700 bg-zinc-900 text-zinc-400"
                }`}
              >
                {round.saleMechanic}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {round.title}
            </h1>
            <p className="font-mono text-xs text-zinc-400">
              Window: {round.startAt.slice(0, 16).replace("T", " ")} UTC
              {round.endAt
                ? ` → ${round.endAt.slice(0, 16).replace("T", " ")} UTC`
                : ""}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatPill label="Total Mints" value={round.totalMints.toLocaleString()} />
            <StatPill label="Members" value={String(round.participatingMembers)} />
            <StatPill
              label="Est. Gross"
              value={
                estGrossUsd ? `$${Math.round(estGrossUsd).toLocaleString()}` : "N/A"
              }
            />
          </div>
        </div>
      </div>

      {/* Member Ranking Bar Chart */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              Member Sales Ranking
            </h2>
            <p className="text-xs text-zinc-400">
              Ranked by exact on-chain mints. Relative Index compares each member
              against the round average (1.00×).
            </p>
          </div>
          <span className="font-mono text-xs text-zinc-500">
            Mean:{" "}
            {Math.round(
              round.totalMints / Math.max(1, round.participatingMembers),
            ).toLocaleString()}{" "}
            mints/member
          </span>
        </div>

        <div className="space-y-2.5">
          {leaderboard.map((row) => {
            const pctWidth = Math.max(3, (row.mintCount / maxMints) * 100);
            return (
              <Link
                key={row.memberId}
                to="/members/$memberId"
                params={{ memberId: row.memberId }}
                className="group block rounded-xl border border-transparent p-2 transition hover:border-zinc-800 hover:bg-zinc-950/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 font-mono font-bold text-zinc-300">
                      #{row.rank}
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

                  <div className="flex items-center gap-4 font-mono tabular-nums">
                    <span className="text-white font-semibold">
                      {row.mintCount.toLocaleString()}
                    </span>
                    <span className="w-12 text-right text-zinc-400">
                      {row.sharePct.toFixed(1)}%
                    </span>
                    <span
                      className={`w-12 text-right font-semibold ${
                        row.relativeIndex >= 1.15
                          ? "text-emerald-300"
                          : row.relativeIndex <= 0.85
                            ? "text-rose-300"
                            : "text-zinc-300"
                      }`}
                    >
                      {row.relativeIndex.toFixed(2)}×
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

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className="font-mono text-base font-bold text-white tabular-nums">
        {value}
      </div>
    </div>
  );
}
