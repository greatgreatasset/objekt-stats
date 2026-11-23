import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TrendChart } from "../../components/TrendChart";
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
  const [sortBy, setSortBy] = useState<
    "buyersIndex" | "relIndex" | "rolling5" | "buyers" | "mints" | "order"
  >("buyersIndex");

  const artistSlug = artist === "artms" ? "artms" : "triples";
  const artistName = data.artist?.name ?? (artistSlug === "artms" ? "ARTMS" : "tripleS");
  const hasStats = data.rounds.length > 0;

  const sortedMembers = useMemo(() => {
    const list = [...data.members];
    if (sortBy === "order") {
      return list.sort((a, b) => a.memberOrder - b.memberOrder);
    }
    if (sortBy === "buyers") {
      return list.sort((a, b) => b.totalUniqueBuyers - a.totalUniqueBuyers);
    }
    if (sortBy === "mints") {
      return list.sort((a, b) => b.totalMints - a.totalMints);
    }
    if (sortBy === "rolling5") {
      return list.sort(
        (a, b) =>
          (a.rolling5Rank ?? 999) - (b.rolling5Rank ?? 999) ||
          a.memberOrder - b.memberOrder,
      );
    }
    if (sortBy === "relIndex") {
      return list.sort(
        (a, b) =>
          (b.avgRelativeIndex ?? -1) - (a.avgRelativeIndex ?? -1) ||
          a.memberOrder - b.memberOrder,
      );
    }
    return list.sort(
      (a, b) =>
        (b.avgBuyersRelativeIndex ?? -1) - (a.avgBuyersRelativeIndex ?? -1) ||
        a.memberOrder - b.memberOrder,
    );
  }, [data.members, sortBy]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {artistName} Member Popularity &amp; Trends
          </h1>
          <p className="text-sm text-zinc-400">
            Normalized demand across{" "}
            <span className="font-mono text-zinc-200">{data.rounds.length}</span>{" "}
            paid popularity rounds. Ranked by{" "}
            <strong className="text-zinc-200">Unique Buyers</strong> by default
            to prevent whale distortion.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["buyersIndex", "Sort: Buyers Index"],
              ["relIndex", "Sort: Mints Index"],
              ["buyers", "Sort: Unique Buyers"],
              ["mints", "Sort: Total Mints"],
              ["rolling5", "Sort: Rolling-5 Rank"],
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

      {/* Interactive Rank Bump & Relative Index Trajectory Chart */}
      <TrendChart
        rounds={data.rounds}
        members={data.members}
        events={data.events}
        artistId={artistSlug}
      />

      {/* Sortable Master Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3 text-right">Rounds</th>
              <th className="px-4 py-3 text-right">Unique Buyers</th>
              <th className="px-4 py-3 text-right">Total Mints</th>
              <th className="px-4 py-3 text-right">Mints/Buyer</th>
              <th className="px-4 py-3 text-right">Avg Buyers Rank</th>
              <th className="px-4 py-3 text-right">Latest Rank</th>
              <th className="px-4 py-3 text-right">Buyers Index</th>
              <th className="px-4 py-3 text-right">Mints Index</th>
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
                    <span className="hidden sm:inline text-xs font-normal text-zinc-500">
                      {m.fullName}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400 tabular-nums">
                  {hasStats ? m.roundsCount : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-white tabular-nums">
                  {hasStats ? m.totalUniqueBuyers.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                  {hasStats ? m.totalMints.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400 tabular-nums">
                  {m.avgMintsPerBuyer !== null
                    ? `${m.avgMintsPerBuyer.toFixed(2)}×`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-white tabular-nums">
                  {m.avgBuyersRank !== null ? `#${m.avgBuyersRank.toFixed(1)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                  {m.latestBuyersRank !== null ? (
                    <span className="inline-flex items-center gap-1 text-zinc-200">
                      #{m.latestBuyersRank}
                      {m.latestRankDelta !== null && m.latestRankDelta !== 0 && (
                        <span
                          className={
                            m.latestRankDelta > 0
                              ? "text-emerald-400 text-[10px]"
                              : "text-rose-400 text-[10px]"
                          }
                        >
                          {m.latestRankDelta > 0
                            ? `▲${m.latestRankDelta}`
                            : `▼${Math.abs(m.latestRankDelta)}`}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                  {m.avgBuyersRelativeIndex !== null ? (
                    <span
                      className={
                        m.avgBuyersRelativeIndex >= 1.1
                          ? "text-emerald-300"
                          : m.avgBuyersRelativeIndex <= 0.9
                            ? "text-rose-300"
                            : "text-zinc-200"
                      }
                    >
                      {m.avgBuyersRelativeIndex.toFixed(2)}×
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-zinc-400">
                  {m.avgRelativeIndex !== null
                    ? `${m.avgRelativeIndex.toFixed(2)}×`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
