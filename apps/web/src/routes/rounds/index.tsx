import { Link, createFileRoute } from "@tanstack/react-router";
import { Layers, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { getArtistOverview, type ArtistSlug } from "../../lib/server/queries";

export const Route = createFileRoute("/rounds/")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getArtistOverview({ data: deps.artist }),
  component: RoundsPage,
});

function RoundsPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const [filter, setFilter] = useState<
    "popularity" | "all" | "First" | "Double" | "physical" | "reward"
  >("popularity");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"buyers" | "mints" | "date" | "members">(
    "buyers",
  );

  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const seasons = useMemo(
    () => Array.from(new Set(data.rounds.map((r) => r.season))).sort().reverse(),
    [data.rounds],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rounds
      .filter((r) => {
        if (filter === "popularity" && !r.includeInPopularity) return false;
        if (filter === "First" && r.objektClass !== "First") return false;
        if (filter === "Double" && r.objektClass !== "Double") return false;
        if (filter === "physical" && r.saleMechanic !== "physical_scan") return false;
        if (filter === "reward" && r.saleMechanic !== "reward") return false;
        if (seasonFilter !== "all" && r.season !== seasonFilter) return false;
        if (
          q &&
          !r.title.toLowerCase().includes(q) &&
          !r.season.toLowerCase().includes(q) &&
          !r.slug.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "buyers") return b.uniqueBuyers - a.uniqueBuyers || b.totalMints - a.totalMints;
        if (sortBy === "mints") return b.totalMints - a.totalMints;
        if (sortBy === "members") return b.participatingMembers - a.participatingMembers;
        return b.startAt.localeCompare(a.startAt);
      });
  }, [data.rounds, filter, seasonFilter, query, sortBy]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {artistName} Sale Rounds
        </h1>
        <p className="text-sm text-zinc-400">
          Defaults to <strong className="text-zinc-200">Paid Public Sales</strong>{" "}
          (member-selectable shop drops). Switch tabs to inspect SCO grid
          rewards, Welcome drops, or Physical QR scans.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search season, class, or collection number..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <select
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            aria-label="Filter by season"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
          >
            <option value="all">All Seasons ({seasons.length})</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as "buyers" | "mints" | "date" | "members",
              )
            }
            aria-label="Sort sale rounds"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
          >
            <option value="buyers">Sort: Most Unique Buyers</option>
            <option value="mints">Sort: Highest Mint Volume</option>
            <option value="date">Sort: Most Recent</option>
            <option value="members">Sort: Most Members</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [
                "popularity",
                `Paid Public Sales (${data.rounds.filter((r) => r.includeInPopularity).length})`,
              ],
              ["all", `All Indexed (${data.rounds.length})`],
              ["First", "First (FCO)"],
              ["Double", "Double (DCO)"],
              ["physical", "Physical (A)"],
              ["reward", "Rewards / SCO / Welcome"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                filter === key
                  ? "bg-white text-zinc-950"
                  : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
          <Layers className="mx-auto h-8 w-8 text-zinc-500" />
          <h2 className="text-base font-semibold text-zinc-200">
            No matching sale rounds
          </h2>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-400">
            Try clearing your search or switching category filters.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-4 py-3">Round</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Mechanic</th>
                <th className="px-4 py-3">#1 by Unique Buyers</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3 text-right">Members</th>
                <th className="px-4 py-3 text-right">Unique Buyers</th>
                <th className="px-4 py-3 text-right">Total Mints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filtered.map((r) => {
                const topBuyerMember = r.topSellerByBuyers
                  ? memberById.get(r.topSellerByBuyers.memberId)
                  : null;
                const topMintMember = r.topSeller
                  ? memberById.get(r.topSeller.memberId)
                  : null;
                const leaderDiffers =
                  topBuyerMember &&
                  topMintMember &&
                  topBuyerMember.id !== topMintMember.id;
                return (
                  <tr
                    key={r.slug}
                    className="transition hover:bg-zinc-900/70"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: r.slug }}
                        className="font-semibold text-white hover:text-sky-300 transition-colors"
                      >
                        {r.title}
                      </Link>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {r.season}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-300">
                      {r.objektClass}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 font-mono text-[11px] ${
                          r.includeInPopularity
                            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}
                      >
                        {r.saleMechanic}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {topBuyerMember && r.topSellerByBuyers ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor: topBuyerMember.hexColor,
                              }}
                            />
                            <span className="font-medium text-zinc-100">
                              {topBuyerMember.name}
                            </span>
                            <span className="font-mono text-zinc-500">
                              {r.topSellerByBuyers.uniqueBuyers.toLocaleString()}
                            </span>
                          </div>
                          {leaderDiffers && topMintMember && (
                            <div className="font-mono text-[10px] text-amber-300/90">
                              Mints #1: {topMintMember.name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {r.startAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400 tabular-nums">
                      {r.participatingMembers}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-white tabular-nums">
                      {r.uniqueBuyers.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                      {r.totalMints.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
