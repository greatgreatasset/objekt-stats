import { createFileRoute } from "@tanstack/react-router";
import { getArtistOverview, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/members")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getArtistOverview({ data: deps.artist }),
  component: MembersPage,
});

function MembersPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {artistName} Member Popularity Matrix
        </h1>
        <p className="text-sm text-zinc-400">
          Roster order, official colors, reveal dates, and normalized popularity
          metrics (populated automatically once Phase 2 on-chain backfill loads).
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">Color</th>
              <th className="px-4 py-3">Reveal Date</th>
              <th className="px-4 py-3 text-right">Rolling-5 Rank</th>
              <th className="px-4 py-3 text-right">Rel. Index</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {data.members.map((m) => (
              <tr key={m.id} className="hover:bg-zinc-900/60">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-zinc-400">
                  {m.code}
                </td>
                <td className="px-4 py-3 font-semibold text-white">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: m.hexColor }}
                    />
                    {m.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-400">{m.fullName}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                  {m.hexColor}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                  {m.revealDate}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                  Pending sync
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                  Pending sync
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
