import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  Database,
  Layers,
  Sparkles,
  Users,
} from "lucide-react";

export interface OverviewData {
  artist: {
    id: string;
    name: string;
    accentColor: string;
    debutDate: string;
  } | null;
  members: Array<{
    id: string;
    code: string;
    memberOrder: number;
    name: string;
    fullName: string;
    hexColor: string;
    revealDate: string;
  }>;
  rounds: Array<{
    slug: string;
    title: string;
    season: string;
    objektClass: string;
    saleMechanic: string;
    startAt: string;
    totalMints: number;
    participatingMembers: number;
  }>;
  events: Array<{
    id: string;
    eventDate: string;
    endDate: string | null;
    category: string;
    title: string;
    summary: string;
    memberIds: string[];
  }>;
  totals: {
    roundCount: number;
    totalMints: number;
  };
}

const CATEGORY_BADGE: Record<string, string> = {
  comeback: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  subunit: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  reveal: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  gravity: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  viral: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  tour: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

export function OverviewView({
  data,
  artistSlug,
}: {
  data: OverviewData;
  artistSlug: "triples" | "artms";
}) {
  const isArtms = artistSlug === "artms";
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const searchParam = isArtms ? { artist: "artms" as const } : {};

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-10">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-mono text-zinc-300">
              <span
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ backgroundColor: accent }}
              />
              <span>
                {isArtms ? "ARTMS Secondary Tracker" : "tripleS Primary Tracker"}
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">Polygon + Abstract On-Chain</span>
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS")} Objekt Sale
              Rounds &amp; Popularity Analytics
            </h1>

            <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">
              Tracking every public Modhaus COSMO Objekt release across Polygon
              (2022–2025) and Abstract (2025–present). Compare member rank
              trajectories, roster-normalized demand shares, rolling averages,
              and correlate major surges or drops with real-world milestones.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/rounds"
              search={searchParam}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
            >
              <Layers className="h-4 w-4" />
              Browse Sale Rounds
            </Link>
            <Link
              to="/methodology"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
            >
              How Rankings Work
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-4 w-4 text-zinc-400" />}
          label="Tracked Members"
          value={String(data.members.length)}
          subtext={isArtms ? "A1 HeeJin – A5 Choerry" : "S1 SeoYeon – S24 JiYeon"}
        />
        <KpiCard
          icon={<Layers className="h-4 w-4 text-zinc-400" />}
          label="Indexed Sale Rounds"
          value={data.totals.roundCount.toLocaleString()}
          subtext={
            data.totals.roundCount === 0
              ? "Phase 2 backfill queued"
              : "Member-select & pack drops"
          }
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-zinc-400" />}
          label="Objekts Counted"
          value={data.totals.totalMints.toLocaleString()}
          subtext="Includes Polygon pre-spin supply"
        />
        <KpiCard
          icon={<Calendar className="h-4 w-4 text-zinc-400" />}
          label="Timeline Events"
          value={String(data.events.length)}
          subtext="Comebacks, Gravities & reveals"
        />
      </section>

      {/* Pipeline Status Notice when no rounds indexed yet */}
      {data.rounds.length === 0 && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-amber-200">
                  Phase 1 Live on Cloudflare Edge — Phase 2 On-Chain Backfill Next
                </h2>
                <p className="text-xs leading-relaxed text-zinc-400">
                  The Cloudflare Workers app, D1 database, member rosters, and
                  statistical ranking engine are live on{" "}
                  <span className="font-mono text-zinc-200">objektstats.com</span>
                  . Next up: running the Polygon (May 2022 – Apr 18, 2025) +
                  Abstract (Apr 18, 2025 – present) historical backfill to
                  populate every COSMO sale round and member trend chart.
                </p>
              </div>
            </div>
            <Link
              to="/methodology"
              className="shrink-0 self-start rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 sm:self-center"
            >
              Read Pipeline Spec
            </Link>
          </div>
        </section>
      )}

      {/* Member Roster */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isArtms ? "ARTMS Members" : "tripleS S1–S24 Roster"}
            </h2>
            <p className="text-xs text-zinc-400">
              Loaded live from Cloudflare D1 with official representative colors
              and reveal chronology.
            </p>
          </div>
          <Link
            to="/members"
            search={searchParam}
            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            Full matrix →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.members.map((m) => (
            <div
              key={m.id}
              className="group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: m.hexColor }}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-zinc-400">
                  {m.code}
                </span>
                <span
                  className="h-3 w-3 rounded-full ring-2 ring-zinc-950"
                  style={{ backgroundColor: m.hexColor }}
                  title={m.hexColor}
                />
              </div>
              <div className="mt-2">
                <p className="font-semibold text-white text-sm">{m.name}</p>
                <p className="text-[11px] text-zinc-500 truncate">{m.fullName}</p>
              </div>
              <p className="mt-2 font-mono text-[10px] text-zinc-500">
                {m.revealDate}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Events Timeline Preview */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-zinc-400" />
              Curated Milestone Timeline
            </h2>
            <p className="text-xs text-zinc-400">
              Events automatically cross-referenced against sales anomalies
              within a −14d / +7d window.
            </p>
          </div>
          <Link
            to="/events"
            search={searchParam}
            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            View all events →
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {data.events.slice(0, 6).map((ev) => (
            <article
              key={ev.id}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-zinc-400">
                  {ev.eventDate}
                  {ev.endDate ? ` → ${ev.endDate}` : ""}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    CATEGORY_BADGE[ev.category] ??
                    "bg-zinc-800 text-zinc-300 border-zinc-700"
                  }`}
                >
                  {ev.category}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">{ev.title}</h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                {ev.summary}
              </p>
              {ev.memberIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ev.memberIds.map((mId) => {
                    const member = memberById.get(mId);
                    if (!member) return null;
                    return (
                      <span
                        key={mId}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: member.hexColor }}
                        />
                        {member.code} {member.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        {icon}
      </div>
      <p className="font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </p>
      <p className="text-[11px] text-zinc-500">{subtext}</p>
    </div>
  );
}
