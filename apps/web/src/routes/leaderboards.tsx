import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Copy,
  Crown,
  Download,
  Flame,
  Grid2x2,
  Scale,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getSeasonalLeaderboardCutoffs,
  type ArtistSlug,
} from "../lib/server/queries";

export const Route = createFileRoute("/leaderboards")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { artist?: ArtistSlug; season?: string } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
    season:
      typeof search.season === "string" && search.season.trim()
        ? search.season.trim()
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getSeasonalLeaderboardCutoffs({ data: deps.artist }),
  head: ({ loaderData }) => {
    const name = loaderData?.artist?.name ?? "tripleS";
    const latest =
      loaderData?.seasons?.[loaderData.seasons.length - 1]?.season ?? "Cream02";
    const title = `${name} COSMO Leaderboard Cutoffs (${latest}) — Objekt Stats`;
    const desc = `Verified on-chain COSMO seasonal leaderboard cutoffs (Top 1 / Top 3 / Top 10 / Top 25 / Top 50) for ${name} Objekts and Grids across every season — compare whale competition vs. broad fanbase popularity.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  component: LeaderboardsPage,
});

type TierKey = "top1" | "top3" | "top10" | "top25" | "top50";
type BoardSort = "memberOrder" | "objekts" | "grids";
type TableSort =
  | "objekts"
  | "grids"
  | "objDelta"
  | "grdDelta"
  | "whaleShare"
  | "collectors"
  | "divergence"
  | "memberOrder";

const TIER_OPTIONS: Array<{
  key: TierKey;
  label: string;
  short: string;
  rankNum: number;
}> = [
  { key: "top1", label: "Top 1", short: "#1", rankNum: 1 },
  { key: "top3", label: "Top 3", short: "#3", rankNum: 3 },
  { key: "top10", label: "Top 10 (PCO)", short: "Top 10", rankNum: 10 },
  { key: "top25", label: "Top 25", short: "Top 25", rankNum: 25 },
  { key: "top50", label: "Top 50", short: "Top 50", rankNum: 50 },
];

const UNIT_PRICE_USD = 3.29;

function getTierObjekt(
  row: {
    objektTop1: number;
    objektTop3: number;
    objektTop10: number;
    objektTop25: number;
    objektTop50: number;
  },
  tier: TierKey,
): number {
  switch (tier) {
    case "top1":
      return row.objektTop1;
    case "top3":
      return row.objektTop3;
    case "top10":
      return row.objektTop10;
    case "top25":
      return row.objektTop25;
    case "top50":
      return row.objektTop50;
  }
}

function getTierGrid(
  row: {
    gridTop1: number;
    gridTop3: number;
    gridTop10: number;
    gridTop25: number;
    gridTop50: number;
  },
  tier: TierKey,
): number {
  switch (tier) {
    case "top1":
      return row.gridTop1;
    case "top3":
      return row.gridTop3;
    case "top10":
      return row.gridTop10;
    case "top25":
      return row.gridTop25;
    case "top50":
      return row.gridTop50;
  }
}

/**
 * Gently lifts dark member signature colors (e.g. deep royal blue) for crisp
 * legibility on dark `#0f0f13` cards without distorting their hue.
 */
function readableHexOnDark(hex: string): string {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((c) => Number.isNaN(c))) return hex;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.32) return hex;
  const blend = luminance < 0.16 ? 0.48 : 0.3;
  const nr = Math.round(r + (255 - r) * blend);
  const ng = Math.round(g + (255 - g) * blend);
  const nb = Math.round(b + (255 - b) * blend);
  return `#${nr.toString(16).padStart(2, "0")}${ng
    .toString(16)
    .padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

function formatUsd(val: number): string {
  return `$${Math.round(val).toLocaleString("en-US")}`;
}

function formatSignedDelta(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")}`;
}

function formatPctChange(curr: number, prev: number | null): string | null {
  if (prev === null || prev <= 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function LeaderboardsPage() {
  const data = Route.useLoaderData();
  const { artist, season: searchSeason } = Route.useSearch();
  const artistSlug: ArtistSlug = artist === "artms" ? "artms" : "triples";
  const isArtms = artistSlug === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");

  const latestSeason =
    data.seasons[data.seasons.length - 1]?.season ?? "";

  const [selectedSeason, setSelectedSeason] = useState<string>(() => {
    if (
      searchSeason &&
      data.seasons.some(
        (s) => s.season.toLowerCase() === searchSeason.toLowerCase(),
      )
    ) {
      return (
        data.seasons.find(
          (s) => s.season.toLowerCase() === searchSeason.toLowerCase(),
        )?.season ?? latestSeason
      );
    }
    return latestSeason;
  });

  useEffect(() => {
    if (
      searchSeason &&
      data.seasons.some(
        (s) => s.season.toLowerCase() === searchSeason.toLowerCase(),
      )
    ) {
      const matched = data.seasons.find(
        (s) => s.season.toLowerCase() === searchSeason.toLowerCase(),
      );
      if (matched) {
        setSelectedSeason(matched.season);
        return;
      }
    }
    setSelectedSeason(latestSeason);
  }, [artistSlug, searchSeason, latestSeason, data.seasons]);

  const [tier, setTier] = useState<TierKey>("top10");
  const [boardSort, setBoardSort] = useState<BoardSort>("memberOrder");
  const [showBoardDelta, setShowBoardDelta] = useState(true);
  const [showBoardUsd, setShowBoardUsd] = useState(false);
  const [tableSort, setTableSort] = useState<TableSort>("objekts");
  const [chartMetric, setChartMetric] = useState<"objekts" | "grids">(
    "objekts",
  );
  const [hoveredSeasonIdx, setHoveredSeasonIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const memberById = useMemo(
    () => new Map(data.members.map((m) => [m.id, m])),
    [data.members],
  );

  const seasonIdx = useMemo(
    () => data.seasons.findIndex((s) => s.season === selectedSeason),
    [data.seasons, selectedSeason],
  );
  const currentSeasonMeta =
    seasonIdx >= 0 ? data.seasons[seasonIdx] ?? null : null;
  const prevSeasonMeta =
    seasonIdx > 0 ? data.seasons[seasonIdx - 1] ?? null : null;
  const nextSeasonMeta =
    seasonIdx >= 0 && seasonIdx < data.seasons.length - 1
      ? data.seasons[seasonIdx + 1] ?? null
      : null;

  // Build rows for selected season enriched with member info, previous-season deltas, and dynamic tier ranks
  const seasonEntries = useMemo(() => {
    const currRows = data.rows.filter((r) => r.season === selectedSeason);
    const prevByMember = new Map(
      (prevSeasonMeta
        ? data.rows.filter((r) => r.season === prevSeasonMeta.season)
        : []
      ).map((r) => [r.memberId, r]),
    );

    const raw = currRows
      .map((row) => {
        const member = memberById.get(row.memberId);
        if (!member) return null;
        const prev = prevByMember.get(row.memberId) ?? null;
        const objVal = getTierObjekt(row, tier);
        const grdVal = getTierGrid(row, tier);
        const prevObjVal = prev ? getTierObjekt(prev, tier) : null;
        const prevGrdVal = prev ? getTierGrid(prev, tier) : null;
        const objDelta = prevObjVal !== null ? objVal - prevObjVal : null;
        const grdDelta = prevGrdVal !== null ? grdVal - prevGrdVal : null;

        return {
          row,
          member,
          objVal,
          grdVal,
          prevObjVal,
          prevGrdVal,
          objDelta,
          grdDelta,
          estUsd: objVal * UNIT_PRICE_USD,
          // Positive = Whale cutoff rank is HARDER (better #) than Broad unique-buyers rank
          whaleOverperform: row.objektBuyersRank - row.objektCutoffRank,
          tierObjRank: 1,
          tierGrdRank: 1,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Compute competition ranks for active tier
    const byObj = [...raw].sort(
      (a, b) => b.objVal - a.objVal || a.member.memberOrder - b.member.memberOrder,
    );
    let rObj = 1;
    byObj.forEach((item, idx) => {
      if (idx > 0 && item.objVal < byObj[idx - 1]!.objVal) rObj = idx + 1;
      item.tierObjRank = rObj;
    });

    const byGrd = [...raw].sort(
      (a, b) => b.grdVal - a.grdVal || a.member.memberOrder - b.member.memberOrder,
    );
    let rGrd = 1;
    byGrd.forEach((item, idx) => {
      if (idx > 0 && item.grdVal < byGrd[idx - 1]!.grdVal) rGrd = idx + 1;
      item.tierGrdRank = rGrd;
    });

    return raw;
  }, [data.rows, selectedSeason, prevSeasonMeta, memberById, tier]);

  // Default selected members on trajectory chart: top 5 hardest Objekt cutoffs in latest season
  const [selectedChartIds, setSelectedChartIds] = useState<string[]>([]);
  useEffect(() => {
    const latestRows = data.rows
      .filter((r) => r.season === latestSeason)
      .sort((a, b) => b.objektTop10 - a.objektTop10);
    setSelectedChartIds(
      latestRows.slice(0, isArtms ? 5 : 5).map((r) => r.memberId),
    );
  }, [artistSlug, latestSeason, data.rows, isArtms]);

  const toggleChartMember = (memberId: string) => {
    setSelectedChartIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : prev.length < 8
          ? [...prev, memberId]
          : prev,
    );
  };

  // Board rows
  const boardEntries = useMemo(() => {
    const list = [...seasonEntries];
    if (boardSort === "objekts") {
      return list.sort(
        (a, b) => b.objVal - a.objVal || a.member.memberOrder - b.member.memberOrder,
      );
    }
    if (boardSort === "grids") {
      return list.sort(
        (a, b) => b.grdVal - a.grdVal || a.member.memberOrder - b.member.memberOrder,
      );
    }
    return list.sort((a, b) => a.member.memberOrder - b.member.memberOrder);
  }, [seasonEntries, boardSort]);

  const splitIndex = isArtms
    ? boardEntries.length
    : Math.ceil(boardEntries.length / 2);
  const leftBoardCol = boardEntries.slice(0, splitIndex);
  const rightBoardCol = boardEntries.slice(splitIndex);

  // Full analytics table rows
  const tableEntries = useMemo(() => {
    const list = [...seasonEntries];
    switch (tableSort) {
      case "memberOrder":
        return list.sort((a, b) => a.member.memberOrder - b.member.memberOrder);
      case "grids":
        return list.sort(
          (a, b) => b.grdVal - a.grdVal || b.objVal - a.objVal,
        );
      case "objDelta":
        return list.sort(
          (a, b) => (b.objDelta ?? -999999) - (a.objDelta ?? -999999),
        );
      case "grdDelta":
        return list.sort(
          (a, b) => (b.grdDelta ?? -999999) - (a.grdDelta ?? -999999),
        );
      case "whaleShare":
        return list.sort(
          (a, b) =>
            b.row.objektTop10SharePct - a.row.objektTop10SharePct ||
            b.objVal - a.objVal,
        );
      case "collectors":
        return list.sort(
          (a, b) =>
            b.row.objektUniqueCollectors - a.row.objektUniqueCollectors ||
            b.objVal - a.objVal,
        );
      case "divergence":
        return list.sort(
          (a, b) =>
            b.whaleOverperform - a.whaleOverperform || b.objVal - a.objVal,
        );
      default:
        return list.sort(
          (a, b) => b.objVal - a.objVal || a.member.memberOrder - b.member.memberOrder,
        );
    }
  }, [seasonEntries, tableSort]);

  // KPIs & callouts for current season + active tier
  const stats = useMemo(() => {
    if (seasonEntries.length === 0) return null;
    const hardestObj = [...seasonEntries].sort((a, b) => b.objVal - a.objVal)[0]!;
    const easiestObj = [...seasonEntries].sort((a, b) => a.objVal - b.objVal)[0]!;
    const hardestGrd = [...seasonEntries].sort((a, b) => b.grdVal - a.grdVal)[0]!;
    const highestWhaleShare = [...seasonEntries].sort(
      (a, b) => b.row.objektTop10SharePct - a.row.objektTop10SharePct,
    )[0]!;
    const biggestWhaleBattle = [...seasonEntries].sort(
      (a, b) => b.whaleOverperform - a.whaleOverperform || b.objVal - a.objVal,
    )[0]!;
    const bestValueBroad = [...seasonEntries].sort(
      (a, b) => a.whaleOverperform - b.whaleOverperform || a.objVal - b.objVal,
    )[0]!;

    const avgObj = Math.round(
      seasonEntries.reduce((s, e) => s + e.objVal, 0) / seasonEntries.length,
    );
    const avgGrd = Math.round(
      seasonEntries.reduce((s, e) => s + e.grdVal, 0) / seasonEntries.length,
    );

    const prevComparable = seasonEntries.filter((e) => e.prevObjVal !== null);
    const prevAvgObj =
      prevComparable.length > 0
        ? Math.round(
            prevComparable.reduce((s, e) => s + (e.prevObjVal ?? 0), 0) /
              prevComparable.length,
          )
        : null;
    const prevAvgGrd =
      prevComparable.length > 0
        ? Math.round(
            prevComparable.reduce((s, e) => s + (e.prevGrdVal ?? 0), 0) /
              prevComparable.length,
          )
        : null;

    return {
      hardestObj,
      easiestObj,
      hardestGrd,
      highestWhaleShare,
      biggestWhaleBattle,
      bestValueBroad,
      avgObj,
      avgGrd,
      prevAvgObj,
      prevAvgGrd,
    };
  }, [seasonEntries]);

  // Multi-season trajectory chart data
  const chartData = useMemo(() => {
    const seasons = data.seasons;
    const bySeasonMember = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) {
      bySeasonMember.set(`${r.season}|${r.memberId}`, r);
    }

    const avgSeries = seasons.map((s) => {
      const sRows = data.rows.filter((r) => r.season === s.season);
      if (sRows.length === 0) return 0;
      const sum = sRows.reduce(
        (acc, r) =>
          acc +
          (chartMetric === "objekts"
            ? getTierObjekt(r, tier)
            : getTierGrid(r, tier)),
        0,
      );
      return Math.round(sum / sRows.length);
    });

    const memberSeries = selectedChartIds
      .map((mid) => {
        const m = memberById.get(mid);
        if (!m) return null;
        const points = seasons.map((s, idx) => {
          const r = bySeasonMember.get(`${s.season}|${mid}`);
          if (!r) return null;
          const val =
            chartMetric === "objekts"
              ? getTierObjekt(r, tier)
              : getTierGrid(r, tier);
          return { idx, season: s.season, val };
        });
        return { member: m, points };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let maxVal = Math.max(10, ...avgSeries);
    for (const ms of memberSeries) {
      for (const p of ms.points) {
        if (p && p.val > maxVal) maxVal = p.val;
      }
    }
    // Round maxVal up cleanly for nice grid ticks
    const step =
      maxVal > 1000 ? 250 : maxVal > 400 ? 100 : maxVal > 100 ? 50 : 25;
    const yMax = Math.ceil((maxVal * 1.08) / step) * step;

    return { seasons, avgSeries, memberSeries, yMax };
  }, [data.seasons, data.rows, chartMetric, tier, selectedChartIds, memberById]);

  const activeTierMeta =
    TIER_OPTIONS.find((t) => t.key === tier) ?? TIER_OPTIONS[2]!;

  const copySummary = async () => {
    const lines = [
      `${artistName} ${selectedSeason} COSMO Leaderboard Cutoffs (${activeTierMeta.label})`,
      ...boardEntries.map(
        (e) =>
          `${e.member.code.padEnd(4)} ${e.member.name.padEnd(10)} | Objekts: ${String(
            e.objVal.toLocaleString(),
          ).padStart(6)} | Grids: ${String(e.grdVal.toLocaleString()).padStart(4)}`,
      ),
      "",
      `Live interactive cutoffs & multi-season history: https://objektstats.com/leaderboards${isArtms ? "?artist=artms" : ""}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const exportCsv = () => {
    const header = [
      "season",
      "code",
      "member",
      "objekt_top1",
      "objekt_top3",
      "objekt_top10",
      "objekt_top25",
      "objekt_top50",
      "objekt_top10_est_usd",
      "objekt_top10_share_pct",
      "objekt_unique_collectors",
      "objekt_total_eligible",
      "objekt_cutoff_rank",
      "objekt_buyers_rank",
      "grid_top1",
      "grid_top3",
      "grid_top10",
      "grid_top25",
      "grid_top50",
      "grid_total_completed",
      "grid_unique_gridders",
      "grid_cutoff_rank",
    ];
    const csvRows = [
      header.join(","),
      ...tableEntries.map(({ row, member }) =>
        [
          row.season,
          member.code,
          `"${member.name.replace(/"/g, '""')}"`,
          row.objektTop1,
          row.objektTop3,
          row.objektTop10,
          row.objektTop25,
          row.objektTop50,
          row.objektTop10EstUsd.toFixed(2),
          row.objektTop10SharePct.toFixed(2),
          row.objektUniqueCollectors,
          row.objektTotalEligible,
          row.objektCutoffRank,
          row.objektBuyersRank,
          row.gridTop1,
          row.gridTop3,
          row.gridTop10,
          row.gridTop25,
          row.gridTop50,
          row.gridTotalCompleted,
          row.gridUniqueGridders,
          row.gridCutoffRank,
        ].join(","),
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artistSlug}-${selectedSeason.toLowerCase()}-cosmo-leaderboard-cutoffs.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (data.seasons.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-[#131316] p-8 text-center space-y-2">
        <h1 className="text-lg font-semibold text-white">
          {artistName} COSMO Leaderboard Cutoffs
        </h1>
        <p className="text-sm text-zinc-400">
          Seasonal leaderboard cutoff snapshots are currently being computed.
        </p>
      </div>
    );
  }

  // SVG chart dimensions
  const W = 860;
  const H = 290;
  const padL = 56;
  const padR = 26;
  const padT = 22;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xForSeason = (idx: number) =>
    padL +
    (chartData.seasons.length > 1
      ? (idx / (chartData.seasons.length - 1)) * plotW
      : plotW / 2);
  const yForVal = (val: number) =>
    padT + (1 - Math.max(0, Math.min(chartData.yMax, val)) / chartData.yMax) * plotH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    Math.round(chartData.yMax * f),
  );

  const avgPath = chartData.avgSeries
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${xForSeason(i).toFixed(1)},${yForVal(v).toFixed(1)}`,
    )
    .join(" ");

  return (
    <div className="space-y-8">
      {/* Editorial Header */}
      <header className="border-b border-zinc-800/90 pb-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 font-mono text-xs text-zinc-500">
              <span className="text-zinc-300">{selectedSeason}</span>
              {currentSeasonMeta && (
                <>
                  <span className="text-zinc-700">/</span>
                  <span>
                    {currentSeasonMeta.seasonStartAt.slice(0, 10)} &rarr;{" "}
                    {nextSeasonMeta
                      ? `${nextSeasonMeta.seasonStartAt.slice(0, 10)} (era)`
                      : currentSeasonMeta.seasonEndAt.slice(0, 10)}
                  </span>
                </>
              )}
              <span className="text-zinc-700">/</span>
              <span>Polygon + Abstract On-Chain Verified</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName} COSMO Leaderboard Cutoffs
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Exact on-chain minimum <strong className="text-zinc-200">Objekts</strong>{" "}
              and <strong className="text-zinc-200">Grids</strong> required to place
              on every member&apos;s seasonal COSMO leaderboard &mdash; tracking
              season-over-season inflation and contrasting{" "}
              <strong className="text-zinc-200">whale competition</strong> against{" "}
              <strong className="text-zinc-200">broad fanbase popularity</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copySummary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#131316] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied!" : "Copy Board"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#131316] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Season Selector + Tier Selector */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Season
            </span>
            {data.seasons.map((s) => {
              const active = s.season === selectedSeason;
              return (
                <button
                  key={s.season}
                  type="button"
                  onClick={() => setSelectedSeason(s.season)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                    active
                      ? "border-zinc-500 bg-zinc-800 text-white"
                      : "border-zinc-800/90 bg-[#131316] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {s.season}
                </button>
              );
            })}
          </div>

          <div className="inline-flex flex-wrap items-center rounded-lg border border-zinc-800 bg-[#131316] p-0.5 text-xs">
            {TIER_OPTIONS.map((t) => {
              const active = tier === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTier(t.key)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    active
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* KPI Strip */}
      {stats && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800/90 bg-[#131316] p-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              <span>Hardest {activeTierMeta.short} Objekts</span>
              <Crown className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-lg font-bold tracking-tight"
                style={{
                  color: readableHexOnDark(stats.hardestObj.member.hexColor),
                }}
              >
                {stats.hardestObj.member.name}
              </span>
              <span className="font-mono text-xl font-bold tabular-nums text-white">
                {stats.hardestObj.objVal.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span>Est. {formatUsd(stats.hardestObj.estUsd)} @ $3.29</span>
              {stats.hardestObj.objDelta !== null && (
                <span
                  className={
                    stats.hardestObj.objDelta >= 0
                      ? "text-rose-400"
                      : "text-emerald-400"
                  }
                >
                  {formatSignedDelta(stats.hardestObj.objDelta)} vs{" "}
                  {prevSeasonMeta?.season}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/90 bg-[#131316] p-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              <span>Hardest {activeTierMeta.short} Grids</span>
              <Grid2x2 className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-lg font-bold tracking-tight"
                style={{
                  color: readableHexOnDark(stats.hardestGrd.member.hexColor),
                }}
              >
                {stats.hardestGrd.member.name}
              </span>
              <span className="font-mono text-xl font-bold tabular-nums text-white">
                {stats.hardestGrd.grdVal.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span>
                {stats.hardestGrd.row.gridTotalCompleted.toLocaleString()} total
                grids
              </span>
              {stats.hardestGrd.grdDelta !== null && (
                <span
                  className={
                    stats.hardestGrd.grdDelta >= 0
                      ? "text-rose-400"
                      : "text-emerald-400"
                  }
                >
                  {formatSignedDelta(stats.hardestGrd.grdDelta)} vs{" "}
                  {prevSeasonMeta?.season}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/90 bg-[#131316] p-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              <span>Group Avg ({activeTierMeta.short})</span>
              <Flame className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <div className="flex items-baseline gap-3 font-mono">
              <span className="text-xl font-bold tabular-nums text-white">
                {stats.avgObj.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  obj
                </span>
              </span>
              <span className="text-zinc-700">/</span>
              <span className="text-lg font-semibold tabular-nums text-zinc-200">
                {stats.avgGrd.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  grids
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span>
                Range: {stats.easiestObj.objVal.toLocaleString()} &ndash;{" "}
                {stats.hardestObj.objVal.toLocaleString()}
              </span>
              {stats.prevAvgObj !== null && (
                <span
                  className={
                    stats.avgObj >= stats.prevAvgObj
                      ? "text-rose-400"
                      : "text-emerald-400"
                  }
                >
                  {formatPctChange(stats.avgObj, stats.prevAvgObj)} vs{" "}
                  {prevSeasonMeta?.season}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/90 bg-[#131316] p-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              <span>Top-10 Whale Share Peak</span>
              <Scale className="h-3.5 w-3.5 text-fuchsia-400" />
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-lg font-bold tracking-tight"
                style={{
                  color: readableHexOnDark(
                    stats.highestWhaleShare.member.hexColor,
                  ),
                }}
              >
                {stats.highestWhaleShare.member.name}
              </span>
              <span className="font-mono text-xl font-bold tabular-nums text-white">
                {stats.highestWhaleShare.row.objektTop10SharePct.toFixed(1)}%
              </span>
            </div>
            <div className="font-mono text-[11px] text-zinc-500">
              Top 10 wallets own{" "}
              {stats.highestWhaleShare.row.objektTop10Sum.toLocaleString()} of{" "}
              {stats.highestWhaleShare.row.objektTotalEligible.toLocaleString()}{" "}
              mints
            </div>
          </div>
        </section>
      )}

      {/* Shareable 2-Column Color-Coded Board */}
      <section className="rounded-2xl border border-zinc-800/90 bg-[#101014] overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-zinc-800/80 bg-[#131316] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: accent }}
              />
              <h2 className="text-base font-semibold text-white">
                {artistName} {selectedSeason} &mdash; {activeTierMeta.label}{" "}
                Cutoff Board
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">
              Minimum seasonal Objekts &amp; Grids needed to finish in{" "}
              <span className="font-mono text-zinc-200">
                {activeTierMeta.label}
              </span>
              . Click any member to inspect their full stats.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {(
                [
                  ["memberOrder", isArtms ? "A1–A5" : "S1–S24"],
                  ["objekts", "Objekts"],
                  ["grids", "Grids"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBoardSort(key)}
                  className={`rounded-md px-2 py-1 font-medium transition ${
                    boardSort === key
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {prevSeasonMeta && (
              <button
                type="button"
                onClick={() => setShowBoardDelta((v) => !v)}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition ${
                  showBoardDelta
                    ? "border-zinc-600 bg-zinc-800 text-white"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                &Delta; vs {prevSeasonMeta.season}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowBoardUsd((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition ${
                showBoardUsd
                  ? "border-zinc-600 bg-zinc-800 text-white"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Est. $
            </button>
          </div>
        </div>

        {/* Compact 2-column grid (1-column for ARTMS 5 members) */}
        <div
          className={`grid gap-x-10 gap-y-0 px-5 py-4 sm:px-7 ${
            rightBoardCol.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "max-w-xl"
          }`}
        >
          {[leftBoardCol, ...(rightBoardCol.length > 0 ? [rightBoardCol] : [])].map(
            (col, colIdx) => (
              <div key={colIdx} className="divide-y divide-zinc-800/40">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 pb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  <span>Member</span>
                  <span className="text-right min-w-[92px]">
                    Objekts{showBoardUsd ? " / $" : ""}
                  </span>
                  <span className="text-right min-w-[68px]">Grids</span>
                </div>
                {col.map((entry) => {
                  const textColor = readableHexOnDark(entry.member.hexColor);
                  return (
                    <div
                      key={entry.member.id}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 hover:bg-zinc-900/50 -mx-2 px-2 rounded-md transition-colors"
                    >
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: entry.member.id }}
                        className="flex items-baseline gap-2 min-w-0 group"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0 self-center"
                          style={{ backgroundColor: entry.member.hexColor }}
                        />
                        <span
                          className="text-[15px] font-bold tracking-tight truncate group-hover:underline"
                          style={{ color: textColor }}
                        >
                          {entry.member.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                          {entry.member.code}
                        </span>
                      </Link>

                      <div className="text-right min-w-[92px] font-mono tabular-nums">
                        <div className="text-[16px] font-bold text-white leading-tight">
                          {entry.objVal.toLocaleString()}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 text-[10px] leading-tight mt-0.5">
                          {showBoardUsd && (
                            <span className="text-zinc-500">
                              {formatUsd(entry.estUsd)}
                            </span>
                          )}
                          {showBoardDelta && entry.objDelta !== null && (
                            <span
                              className={
                                entry.objDelta > 0
                                  ? "text-rose-400/90"
                                  : entry.objDelta < 0
                                    ? "text-emerald-400/90"
                                    : "text-zinc-600"
                              }
                            >
                              {formatSignedDelta(entry.objDelta)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right min-w-[68px] font-mono tabular-nums">
                        <div className="text-[15px] font-semibold text-zinc-200 leading-tight">
                          {entry.grdVal.toLocaleString()}
                        </div>
                        {showBoardDelta && entry.grdDelta !== null && (
                          <div
                            className={`text-[10px] leading-tight mt-0.5 ${
                              entry.grdDelta > 0
                                ? "text-rose-400/90"
                                : entry.grdDelta < 0
                                  ? "text-emerald-400/90"
                                  : "text-zinc-600"
                            }`}
                          >
                            {formatSignedDelta(entry.grdDelta)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 bg-[#0d0d11] px-5 py-2.5 font-mono text-[11px] text-zinc-500">
          <span>
            objektstats.com/leaderboards &bull; {selectedSeason} &bull;{" "}
            {activeTierMeta.label} minimum threshold
          </span>
          <span>
            Grids = online SCO mints &bull; Objekts = purchased/scanned season
            mints + paired Units (excl. free/Pass+/Spin)
          </span>
        </div>
      </section>

      {/* Multi-Season Cutoff Trajectory Chart */}
      {chartData.seasons.length >= 2 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Multi-Season {activeTierMeta.short}{" "}
                {chartMetric === "objekts" ? "Objekts" : "Grids"} Cutoff
                Trajectory
              </h2>
              <p className="text-xs text-zinc-400">
                Track how hard each member&apos;s leaderboard has inflated
                across seasons (dashed line = group average). Hover any season
                to inspect exact cutoffs.
              </p>
            </div>

            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChartMetric("objekts")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  chartMetric === "objekts"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Objekts Cutoff
              </button>
              <button
                type="button"
                onClick={() => setChartMetric("grids")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  chartMetric === "grids"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Grids Cutoff
              </button>
            </div>
          </div>

          {/* Member Overlay Chips */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-zinc-500 mr-1">Overlay (max 8):</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedChartIds(
                    [...seasonEntries]
                      .sort((a, b) =>
                        chartMetric === "objekts"
                          ? b.objVal - a.objVal
                          : b.grdVal - a.grdVal,
                      )
                      .slice(0, 5)
                      .map((e) => e.member.id),
                  )
                }
                className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
              >
                Hardest 5
              </button>
              {prevSeasonMeta && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedChartIds(
                      [...seasonEntries]
                        .sort((a, b) =>
                          chartMetric === "objekts"
                            ? (b.objDelta ?? -9999) - (a.objDelta ?? -9999)
                            : (b.grdDelta ?? -9999) - (a.grdDelta ?? -9999),
                        )
                        .slice(0, 5)
                        .map((e) => e.member.id),
                    )
                  }
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
                >
                  Biggest Jumpers
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedChartIds([])}
                className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-400 hover:border-zinc-600"
              >
                Avg Only
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {data.members.map((m) => {
                const active = selectedChartIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleChartMember(m.id)}
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

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full min-w-[560px] h-64 select-none"
              role="img"
              aria-label="Multi-season COSMO leaderboard cutoff trajectory"
              onMouseLeave={() => setHoveredSeasonIdx(null)}
            >
              {yTicks.map((tick) => {
                const y = yForVal(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={padL}
                      x2={W - padR}
                      y1={y}
                      y2={y}
                      stroke="#27272a"
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
                      {tick.toLocaleString()}
                    </text>
                  </g>
                );
              })}

              {/* Highlight currently selected season column */}
              {seasonIdx >= 0 && (
                <line
                  x1={xForSeason(seasonIdx)}
                  x2={xForSeason(seasonIdx)}
                  y1={padT}
                  y2={H - padB}
                  stroke={accent}
                  strokeOpacity={0.35}
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                />
              )}

              {hoveredSeasonIdx !== null && (
                <line
                  x1={xForSeason(hoveredSeasonIdx)}
                  x2={xForSeason(hoveredSeasonIdx)}
                  y1={padT}
                  y2={H - padB}
                  stroke="#a1a1aa"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
              )}

              {/* Group average dashed trajectory */}
              <path
                d={avgPath}
                fill="none"
                stroke="#a1a1aa"
                strokeDasharray="5 4"
                strokeWidth={2}
              />
              {chartData.avgSeries.map((v, i) => (
                <circle
                  key={`avg-${i}`}
                  cx={xForSeason(i)}
                  cy={yForVal(v)}
                  r={3}
                  fill="#a1a1aa"
                />
              ))}

              {/* Selected member trajectories */}
              {chartData.memberSeries.map(({ member, points }) => {
                const valid = points.filter(
                  (p): p is NonNullable<typeof p> => p !== null,
                );
                if (valid.length === 0) return null;
                const d = valid
                  .map(
                    (p, idx) =>
                      `${idx === 0 ? "M" : "L"}${xForSeason(p.idx).toFixed(
                        1,
                      )},${yForVal(p.val).toFixed(1)}`,
                  )
                  .join(" ");
                const strokeColor = readableHexOnDark(member.hexColor);
                return (
                  <g key={member.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {valid.map((p) => (
                      <circle
                        key={p.season}
                        cx={xForSeason(p.idx)}
                        cy={yForVal(p.val)}
                        r={3.5}
                        fill={strokeColor}
                        stroke="#09090b"
                        strokeWidth={1.5}
                      >
                        <title>{`${member.name} — ${p.season}: ${p.val.toLocaleString()} ${chartMetric}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}

              {/* Hover targets + clickable season switchers */}
              {chartData.seasons.map((s, i) => {
                const x = xForSeason(i);
                const colW =
                  chartData.seasons.length > 1
                    ? plotW / (chartData.seasons.length - 1)
                    : plotW;
                return (
                  <rect
                    key={s.season}
                    x={Math.max(padL, x - colW / 2)}
                    y={padT}
                    width={colW}
                    height={plotH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredSeasonIdx(i)}
                    onClick={() => setSelectedSeason(s.season)}
                  />
                );
              })}

              {/* Season X-axis labels */}
              {chartData.seasons.map((s, i) => {
                const x = xForSeason(i);
                const isSelected = s.season === selectedSeason;
                return (
                  <g key={s.season}>
                    <text
                      x={x}
                      y={H - 20}
                      textAnchor="middle"
                      fill={isSelected ? "#ffffff" : "#a1a1aa"}
                      fontWeight={isSelected ? "700" : "400"}
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      {s.season}
                    </text>
                    <text
                      x={x}
                      y={H - 7}
                      textAnchor="middle"
                      fill="#52525b"
                      fontSize={8.5}
                      fontFamily="monospace"
                    >
                      {s.seasonStartAt.slice(0, 7)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {hoveredSeasonIdx !== null && chartData.seasons[hoveredSeasonIdx] && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white">
                  {chartData.seasons[hoveredSeasonIdx]!.season} ({activeTierMeta.label})
                </span>
                <span className="font-mono text-zinc-400">
                  Group Avg:{" "}
                  <strong className="text-zinc-200">
                    {chartData.avgSeries[hoveredSeasonIdx]!.toLocaleString()}
                  </strong>{" "}
                  {chartMetric}
                </span>
              </div>
              {chartData.memberSeries.length > 0 && (
                <div className="flex flex-wrap gap-3 text-xs font-mono">
                  {chartData.memberSeries
                    .map((ms) => ({
                      member: ms.member,
                      pt: ms.points[hoveredSeasonIdx],
                    }))
                    .filter((x) => x.pt !== null && x.pt !== undefined)
                    .sort((a, b) => (b.pt?.val ?? 0) - (a.pt?.val ?? 0))
                    .map(({ member, pt }) => (
                      <span
                        key={member.id}
                        className="inline-flex items-center gap-1.5 text-zinc-200"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: member.hexColor }}
                        />
                        <span>{member.name}</span>
                        <span className="text-white font-semibold">
                          {pt!.val.toLocaleString()}
                        </span>
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Whale Competition vs. Broad Popularity Callout Strip */}
      {stats && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-rose-300">
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>Fiercest Whale Battleground (vs. Fanbase Size)</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className="text-base font-bold"
                style={{
                  color: readableHexOnDark(
                    stats.biggestWhaleBattle.member.hexColor,
                  ),
                }}
              >
                {stats.biggestWhaleBattle.member.name} (
                {stats.biggestWhaleBattle.member.code})
              </span>
              <span className="font-mono text-xs text-zinc-300">
                #{stats.biggestWhaleBattle.row.objektCutoffRank} Top-10 Cutoff vs. #
                {stats.biggestWhaleBattle.row.objektBuyersRank} Unique Collectors
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Top-10 cutoff sits{" "}
              <strong className="text-rose-300 font-mono">
                +{stats.biggestWhaleBattle.whaleOverperform} ranks harder
              </strong>{" "}
              than broad collector rank ({stats.biggestWhaleBattle.row.objektTop10.toLocaleString()}{" "}
              Objekts, {stats.biggestWhaleBattle.row.objektTop10SharePct.toFixed(1)}%
              top-10 supply share).
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-emerald-300">
              <ArrowDownRight className="h-3.5 w-3.5" />
              <span>Broadest Fanbase / Most Accessible Top-10</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className="text-base font-bold"
                style={{
                  color: readableHexOnDark(
                    stats.bestValueBroad.member.hexColor,
                  ),
                }}
              >
                {stats.bestValueBroad.member.name} (
                {stats.bestValueBroad.member.code})
              </span>
              <span className="font-mono text-xs text-zinc-300">
                #{stats.bestValueBroad.row.objektCutoffRank} Top-10 Cutoff vs. #
                {stats.bestValueBroad.row.objektBuyersRank} Unique Collectors
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Broad collector base ranks{" "}
              <strong className="text-emerald-300 font-mono">
                {Math.abs(stats.bestValueBroad.whaleOverperform)} spots higher
              </strong>{" "}
              than Top-10 whale cutoff ({stats.bestValueBroad.row.objektTop10.toLocaleString()}{" "}
              Objekts across{" "}
              {stats.bestValueBroad.row.objektUniqueCollectors.toLocaleString()}{" "}
              unique wallets).
            </p>
          </div>
        </section>
      )}

      {/* Full Sortable Analytical Table */}
      <section className="rounded-2xl border border-zinc-800/90 bg-[#131316] overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-zinc-800/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              Whale Competition vs. Broad Popularity ({selectedSeason})
            </h2>
            <p className="text-xs text-zinc-400">
              Full breakdown comparing{" "}
              <span className="font-mono text-zinc-200">
                {activeTierMeta.label}
              </span>{" "}
              cutoffs, estimated minimum spend ($3.29/ea), Top-10 concentration,
              and unique seasonal buyers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-500 mr-1">Sort:</span>
            {(
              [
                ["objekts", "Objekts"],
                ["grids", "Grids"],
                ["whaleShare", "Whale Share"],
                ["collectors", "Unique Buyers"],
                ["divergence", "Whale vs Broad"],
                ["memberOrder", isArtms ? "A1–A5" : "S1–S24"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTableSort(key)}
                className={`rounded-md border px-2 py-1 font-medium transition ${
                  tableSort === key
                    ? "border-zinc-500 bg-zinc-800 text-white"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-[#0e0e11] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-3 pl-5 pr-3">Rank</th>
                <th className="py-3 px-3">Member</th>
                <th className="py-3 px-3 text-right">
                  {activeTierMeta.short} Objekts
                </th>
                <th className="py-3 px-3 text-right">Est. Min $</th>
                <th className="py-3 px-3 text-right">
                  {activeTierMeta.short} Grids
                </th>
                <th className="py-3 px-3 text-right">Top-10 Share</th>
                <th className="py-3 px-3 text-right">Unique Buyers</th>
                <th className="py-3 pl-3 pr-5 text-right">
                  Top-10 vs Broad Rank
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 font-mono tabular-nums">
              {tableEntries.map((e) => {
                const diff = e.whaleOverperform;
                return (
                  <tr
                    key={e.member.id}
                    className="hover:bg-zinc-900/60 transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3 text-zinc-500">
                      #{e.tierObjRank}
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: e.member.id }}
                        className="inline-flex items-center gap-2 group"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: e.member.hexColor }}
                        />
                        <span
                          className="font-semibold group-hover:underline"
                          style={{
                            color: readableHexOnDark(e.member.hexColor),
                          }}
                        >
                          {e.member.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          {e.member.code}
                        </span>
                      </Link>
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="font-bold text-white text-[13px]">
                        {e.objVal.toLocaleString()}
                      </div>
                      {e.objDelta !== null && (
                        <div
                          className={`text-[10px] ${
                            e.objDelta > 0
                              ? "text-rose-400"
                              : e.objDelta < 0
                                ? "text-emerald-400"
                                : "text-zinc-600"
                          }`}
                        >
                          {formatSignedDelta(e.objDelta)}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right text-zinc-300">
                      {formatUsd(e.estUsd)}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="font-semibold text-zinc-200">
                        {e.grdVal.toLocaleString()}
                      </div>
                      {e.grdDelta !== null && (
                        <div
                          className={`text-[10px] ${
                            e.grdDelta > 0
                              ? "text-rose-400"
                              : e.grdDelta < 0
                                ? "text-emerald-400"
                                : "text-zinc-600"
                          }`}
                        >
                          {formatSignedDelta(e.grdDelta)}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <span className="text-zinc-200">
                        {e.row.objektTop10SharePct.toFixed(1)}%
                      </span>
                      <div className="text-[10px] text-zinc-500">
                        {e.row.objektTop10Sum.toLocaleString()} /{" "}
                        {(e.row.objektTotalEligible / 1000).toFixed(1)}k
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1 text-zinc-200">
                        <Users className="h-3 w-3 text-zinc-500" />
                        {e.row.objektUniqueCollectors.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        #{e.row.objektBuyersRank} broad
                      </div>
                    </td>

                    <td className="py-3 pl-3 pr-5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          diff >= 4
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                            : diff <= -4
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-700/80 bg-zinc-800/60 text-zinc-300"
                        }`}
                      >
                        #{e.row.objektCutoffRank} vs #{e.row.objektBuyersRank}
                        {diff !== 0 && (
                          <span>({diff > 0 ? `+${diff}` : diff})</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-zinc-800/80 bg-[#0e0e11] px-5 py-3 text-[11px] text-zinc-500">
          <strong className="text-zinc-300">How to read Top-10 vs Broad Rank:</strong>{" "}
          A positive badge (e.g. <span className="font-mono text-rose-300">+8</span>)
          means a member&apos;s Top-10 leaderboard cutoff ranks 8 spots harder than
          their unique buyer count (whale-heavy competition). A negative badge
          (e.g. <span className="font-mono text-emerald-300">-6</span>) indicates a
          large casual fanbase with a relatively accessible Top-10 threshold.{" "}
          <Link
            to="/methodology"
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
          >
            Full methodology
          </Link>
        </div>
      </section>
    </div>
  );
}
