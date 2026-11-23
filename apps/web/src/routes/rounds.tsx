import { createFileRoute } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { getArtistOverview, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/rounds")({
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
  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {artistName} Sale Rounds
        </h1>
        <p className="text-sm text-zinc-400">
          Every public COSMO Objekt drop grouped into comparable rounds,
          classified by sale mechanic (member-selectable, random pack, sub-unit,
          or physical scan).
        </p>
      </div>

      {data.rounds.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
          <Layers className="mx-auto h-8 w-8 text-zinc-500" />
          <h2 className="text-base font-semibold text-zinc-200">
            No sale rounds indexed yet
          </h2>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-400">
            Once the Phase 2 Polygon + Abstract backfill runs and aggregates
            historical mints into Cloudflare D1, every seasonal FCO, DCO, PCO,
            and MCO sale round will automatically appear here with full member
            leaderboards.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-4 py-3">Round</th>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Mechanic</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Total Mints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {data.rounds.map((r) => (
                <tr key={r.slug} className="hover:bg-zinc-900/60">
                  <td className="px-4 py-3 font-medium text-white">{r.title}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {r.season}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-300">
                    {r.objektClass}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {r.saleMechanic}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {r.startAt.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-white">
                    {r.totalMints.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
