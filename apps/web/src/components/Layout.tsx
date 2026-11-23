import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BarChart3,
  Calendar,
  Compass,
  Layers,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const location = useRouterState({ select: (s) => s.location });
  const isArtms =
    location.pathname.startsWith("/artms") ||
    (typeof location.search === "object" &&
      location.search !== null &&
      "artist" in location.search &&
      (location.search as { artist?: string }).artist === "artms");

  const artistQuery: Record<string, string> | undefined = isArtms
    ? { artist: "artms" }
    : undefined;

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#09090b]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-5">
            <Link
              to={isArtms ? "/artms" : "/"}
              className="flex items-center gap-2.5 group"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900 font-mono text-xs font-bold tracking-tight transition-colors"
                style={{
                  color: isArtms ? "#ED0090" : "#22AEFF",
                  boxShadow: isArtms
                    ? "0 0 18px rgba(237, 0, 144, 0.25)"
                    : "0 0 18px rgba(34, 174, 255, 0.25)",
                }}
              >
                OS
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-sm font-semibold tracking-tight text-white">
                  Objekt Stats
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  objektstats.com
                </span>
              </div>
            </Link>

            <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
              <Link
                to="/"
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  !isArtms
                    ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                tripleS
              </Link>
              <Link
                to="/artms"
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  isArtms
                    ? "bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ARTMS
              </Link>
            </div>
          </div>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              to={isArtms ? "/artms" : "/"}
              active={
                location.pathname === "/" || location.pathname === "/artms"
              }
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Overview"
            />
            <NavLink
              to="/rounds"
              search={artistQuery}
              active={location.pathname === "/rounds"}
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Sale Rounds"
            />
            <NavLink
              to="/trades"
              search={artistQuery}
              active={location.pathname === "/trades"}
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
              label="Most Traded"
            />
            <NavLink
              to="/members"
              search={artistQuery}
              active={location.pathname === "/members"}
              icon={<Users className="h-3.5 w-3.5" />}
              label="Members"
            />
            <NavLink
              to="/events"
              search={artistQuery}
              active={location.pathname === "/events"}
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Events"
            />
            <NavLink
              to="/methodology"
              active={location.pathname === "/methodology"}
              icon={<Compass className="h-3.5 w-3.5" />}
              label="Methodology"
            />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950/60">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            Independent COSMO Objekt analytics for tripleS &amp; ARTMS. Not
            affiliated with MODHAUS.
          </p>
          <div className="flex items-center gap-4 font-mono">
            <span>Polygon + Abstract</span>
            <a
              href="https://github.com/greatgreatasset/objekt-stats"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavLink({
  to,
  search,
  active,
  icon,
  label,
}: {
  to: string;
  search?: Record<string, string>;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
        active
          ? "bg-zinc-800/90 text-white"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
