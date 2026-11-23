import { Link, createFileRoute } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useState } from "react";
import { getEventsWithImpact, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/events")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getEventsWithImpact({ data: deps.artist }),
  component: EventsPage,
});

function EventsPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const categories = Array.from(
    new Set(data.events.map((e) => e.category)),
  ).sort();

  const filtered =
    selectedCategory === "all"
      ? data.events
      : data.events.filter((e) => e.category === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {artistName} Milestones &amp; Sales Impact
          </h1>
          <p className="text-sm text-zinc-400">
            Git-curated real-world timeline linked directly to nearby indexed
            COSMO sale rounds (−10d to +18d).
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              selectedCategory === "all"
                ? "bg-white text-zinc-950"
                : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All ({data.events.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                selectedCategory === cat
                  ? "bg-white text-zinc-950"
                  : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((ev) => (
          <article
            key={ev.id}
            className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-zinc-400">
                {ev.eventDate}
                {ev.endDate ? ` → ${ev.endDate}` : ""}
              </span>
              <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                {ev.category}
              </span>
            </div>
            <h2 className="text-base font-semibold text-white">{ev.title}</h2>
            <p className="text-sm text-zinc-400">{ev.summary}</p>
            {ev.memberIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {ev.memberIds.map((mId) => {
                  const member = memberById.get(mId);
                  if (!member) return null;
                  return (
                    <Link
                      key={mId}
                      to="/members/$memberId"
                      params={{ memberId: mId }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-600 hover:text-white"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: member.hexColor }}
                      />
                      {member.code} {member.name}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-mono text-zinc-500">
                Scope: Group-wide milestone
              </p>
            )}

            {ev.nearbyRounds.length > 0 && (
              <div className="border-t border-zinc-800/80 pt-3 space-y-1.5">
                <p className="text-[11px] font-mono uppercase text-zinc-500 flex items-center gap-1.5">
                  <Layers className="h-3 w-3" /> Nearby Indexed Sale Rounds
                </p>
                <div className="flex flex-wrap gap-2">
                  {ev.nearbyRounds.map((r) => (
                    <Link
                      key={r.slug}
                      to="/rounds/$slug"
                      params={{ slug: r.slug }}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 hover:border-sky-500/40 hover:text-sky-200"
                    >
                      <span>{r.title}</span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {r.totalMints.toLocaleString()} mints
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
