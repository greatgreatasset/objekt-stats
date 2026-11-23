import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getMemberDetail } from "../../lib/server/queries";

export const Route = createFileRoute("/members/$memberId")({
  loader: ({ params }) => getMemberDetail({ data: params.memberId }),
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const data = Route.useLoaderData();

  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
        <h1 className="text-xl font-semibold text-white">Member not found</h1>
        <Link
          to="/members"
          className="inline-flex items-center gap-1.5 text-sm text-sky-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to members
        </Link>
      </div>
    );
  }

  const { member, roundHistory, collections, events } = data;
  const popHistory = roundHistory.filter((r) => r.includeInPopularity);
  const totalMints = collections.reduce((s, c) => s + c.totalMints, 0);
  const avgRank =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.rank, 0) / popHistory.length
        ).toFixed(1)
      : "—";
  const avgRel =
    popHistory.length > 0
      ? (
          popHistory.reduce((s, r) => s + r.relativeIndex, 0) /
          popHistory.length
        ).toFixed(2) + "×"
      : "—";

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          to="/members"
          search={member.artistId === "artms" ? { artist: "artms" } : {}}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All {member.artistId === "artms" ? "ARTMS" : "tripleS"} Members
        </Link>

        <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ backgroundColor: member.hexColor }}
          />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
                <span>{member.code}</span>
                <span>•</span>
                <span>Revealed {member.revealDate}</span>
                <span>•</span>
                <span>{member.hexColor}</span>
              </div>
              <h1 className="text-3xl font-bold text-white">{member.name}</h1>
              <p className="text-sm text-zinc-400">{member.fullName}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Avg Rank</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgRank === "—" ? "—" : `#${avgRank}`}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Rel. Index</div>
                <div className="font-mono text-lg font-bold text-white">
                  {avgRel}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5">
                <div className="text-[11px] text-zinc-400">Indexed Mints</div>
                <div className="font-mono text-lg font-bold text-white">
                  {totalMints.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Round-by-round history */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Sale Round History ({roundHistory.length})
        </h2>
        {roundHistory.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No sale rounds recorded for {member.name} yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Round</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Rank</th>
                  <th className="px-4 py-3 text-right">Mints</th>
                  <th className="px-4 py-3 text-right">Share</th>
                  <th className="px-4 py-3 text-right">Rel. Index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {roundHistory.map((r) => (
                  <tr key={r.roundSlug} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: r.roundSlug }}
                        className="font-medium text-white hover:text-sky-300"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {r.startAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-white">
                      #{r.rank}{" "}
                      <span className="text-zinc-500 font-normal">
                        /{r.participatingMembers}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-200 tabular-nums">
                      {r.mintCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                      {r.sharePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-zinc-200 tabular-nums">
                      {r.relativeIndex.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Member Milestones */}
      {events.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Tagged Milestones ({events.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-1"
              >
                <div className="font-mono text-xs text-zinc-400">
                  {ev.eventDate} • {ev.category}
                </div>
                <p className="text-sm font-semibold text-white">{ev.title}</p>
                <p className="text-xs text-zinc-400">{ev.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Indexed Collections */}
      {collections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Top Indexed Collections
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {collections.map((c) => (
              <div
                key={c.slug}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"
              >
                {c.frontImageUrl && (
                  <img
                    src={c.frontImageUrl}
                    alt={c.collectionId}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
                )}
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
