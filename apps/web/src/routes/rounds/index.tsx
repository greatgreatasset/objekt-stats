import { Link, createFileRoute } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useState } from "react";
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
  const [filter, setFilter] = useState<"all" | "popularity" | "physical" | "reward">(
    "all",
  );

  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));

  const filtered = data.rounds.filter((r) => {
    if (filter === "popularity") return r.includeInPopularity;
    if (filter === "physical") return r.saleMechanic === "physical_scan";
    if (filter === "reward") return r.saleMechanic === "reward";
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {artistName} Sale Rounds
          </h1>
          <p className="text-sm text-zinc-400">
            Every indexed COSMO Objekt drop grouped into comparable rounds. Click
            any round for member-by-member charts and share indices.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All (${data.rounds.length})`],
              [
                "popularity",
                `Popularity-Tracked (${data.rounds.filter((r) => r.includeInPopularity).length})`,
              ],
              ["physical", "Physical (A)"],
              ["reward", "Rewards / Welcome"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                filter === key
                  ? "bg-white text-zinc-950"
                  : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
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
            Try switching filters or running additional historical backfill
            chunks from Polygon &amp; Abstract.
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
                <th className="px-4 py-3">#1 Seller</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Members</th>
                <th className="px-4 py-3 text-right">Total Mints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filtered.map((r) => {
                const topMember = r.topSeller
                  ? memberById.get(r.topSeller.memberId)
                  : null;
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
                      {topMember && r.topSeller ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: topMember.hexColor }}
                          />
                          <span className="font-medium text-zinc-100">
                            {topMember.name}
                          </span>
                          <span className="font-mono text-zinc-500">
                            {r.topSeller.sharePct.toFixed(1)}%
                          </span>
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
