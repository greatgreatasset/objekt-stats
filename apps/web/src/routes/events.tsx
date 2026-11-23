import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getArtistOverview, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/events")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getArtistOverview({ data: deps.artist }),
  component: EventsPage,
});

function EventsPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const artistName = data.artist?.name ?? (artist === "artms" ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const categories = Array.from(new Set(data.events.map((e) => e.category))).sort();

  const filtered =
    selectedCategory === "all"
      ? data.events
      : data.events.filter((e) => e.category === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {artistName} Milestones &amp; Events
          </h1>
          <p className="text-sm text-zinc-400">
            Git-curated real-world timeline correlated automatically with sales
            spikes and drops.
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
            className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-2.5"
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
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ev.memberIds.map((mId) => {
                  const member = memberById.get(mId);
                  if (!member) return null;
                  return (
                    <span
                      key={mId}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-300"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: member.hexColor }}
                      />
                      {member.code} {member.name}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-mono text-zinc-500">
                Scope: Group-wide milestone
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
