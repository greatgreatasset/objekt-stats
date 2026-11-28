import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
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
    "popularity" | "all" | "First" | "Double" | "random" | "physical" | "reward" | "subscription"
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
        if (
          filter === "random" &&
          r.saleMechanic !== "random_pack" &&
          r.saleMechanic !== "unit_random" &&
          r.saleMechanic !== "dual_distribution"
        ) {
          return false;
        }
        if (filter === "physical" && r.saleMechanic !== "physical_scan") return false;
        if (filter === "reward" && r.saleMechanic !== "reward") return false;
        if (filter === "subscription" && r.saleMechanic !== "subscription") return false;
        if (seasonFilter !== "all" && r.season !== seasonFilter) return false;
        if (
          q &&
          !r.title.toLowerCase().includes(q) &&
          !r.season.toLowerCase().includes(q) &&
          !r.slug.toLowerCase().includes(q) &&
          !(r.apolloEventName ?? "").toLowerCase().includes(q) &&
          !(r.apolloEraName ?? "").toLowerCase().includes(q) &&
          !(r.apolloDescription ?? "").toLowerCase().includes(q)
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
      <header className="border-b border-zinc-800/90 pb-5 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {artistName} <span className="font-normal text-zinc-400">Sale Rounds</span>
        </h1>
        <p className="text-sm text-zinc-400">
          Defaults to Paid Public Sales (member-selectable shop drops). Switch
          filters to inspect SCO grid rewards, Welcome drops, or Physical QR scans.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-800/90 bg-[#121215] p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search season, class, or collection number..."
              className="w-full rounded-md border border-zinc-800 bg-[#0c0c0e] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <select
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            aria-label="Filter by season"
            className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
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
            className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
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
                `Member-Select Paid (${data.rounds.filter((r) => r.includeInPopularity).length})`,
              ],
              ["all", `All Releases (${data.rounds.length})`],
              ["First", "First (FCO)"],
              ["Double", "Double (DCO)"],
              ["random", "Random / Unit Packs"],
              ["physical", "Physical (A)"],
              ["reward", "Rewards / Events / SCO"],
              ["subscription", "Pass+ Subscriptions"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-zinc-800 text-white border border-zinc-700"
                  : "border border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-8 text-center space-y-1.5">
          <h2 className="text-sm font-semibold text-zinc-200">
            No matching sale rounds
          </h2>
          <p className="text-xs text-zinc-400">
            Try clearing your search or switching category filters.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800/90 bg-[#121215]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800/80 bg-[#0f0f12] font-mono text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Round</th>
                <th className="px-4 py-2.5">Class</th>
                <th className="px-4 py-2.5">Mechanic</th>
                <th className="px-4 py-2.5">#1 by Unique Buyers</th>
                <th className="px-4 py-2.5">Start</th>
                <th className="px-4 py-2.5 text-right">Members</th>
                <th className="px-4 py-2.5 text-right">Unique Buyers</th>
                <th className="px-4 py-2.5 text-right">Total Mints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
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
                    className="transition-colors hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: r.slug }}
                        className="font-medium text-zinc-100 hover:text-white hover:underline underline-offset-2"
                      >
                        {r.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-zinc-500">
                        <span>{r.season}</span>
                        {r.apolloEraName && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span className="text-zinc-400">{r.apolloEraName}</span>
                          </>
                        )}
                        {r.apolloEventType && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span className="uppercase">{r.apolloEventType}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-300">
                      {r.objektClass}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span
                        className={
                          r.includeInPopularity
                            ? "text-zinc-300"
                            : "text-zinc-500"
                        }
                      >
                        {r.saleMechanic}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {topBuyerMember && r.topSellerByBuyers ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-[2px]"
                              style={{
                                backgroundColor: topBuyerMember.hexColor,
                              }}
                            />
                            <span className="font-medium text-zinc-100">
                              {topBuyerMember.name}
                            </span>
                            <span className="font-mono text-zinc-500 tabular-nums">
                              {r.topSellerByBuyers.uniqueBuyers.toLocaleString()}
                            </span>
                          </div>
                          {leaderDiffers && topMintMember && (
                            <div className="font-mono text-[10px] text-zinc-500">
                              Mints #1: {topMintMember.name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400 tabular-nums">
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
