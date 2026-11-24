import { Link, useRouterState } from "@tanstack/react-router";
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
  const artistAccent = isArtms ? "#ED0090" : "#22AEFF";

  return (
    <div className="min-h-screen bg-[#0c0c0e] text-zinc-200 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-zinc-800/90 bg-[#0c0c0e]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 sm:px-6">
          <div className="flex items-center gap-4 py-3">
            <Link
              to={isArtms ? "/artms" : "/"}
              className="flex items-center gap-2.5 group"
            >
              <span
                className="h-4 w-1 rounded-[1px] shrink-0"
                style={{ backgroundColor: artistAccent }}
              />
              <span className="text-sm font-semibold tracking-tight text-white">
                objektstats
              </span>
            </Link>

            <span className="h-3.5 w-px bg-zinc-800" aria-hidden="true" />

            <div className="inline-flex items-center rounded-md border border-zinc-800 bg-[#131316] p-0.5 text-xs">
              <Link
                to="/"
                className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  !isArtms
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#22AEFF]" />
                tripleS
              </Link>
              <Link
                to="/artms"
                className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  isArtms
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#ED0090]" />
                ARTMS
              </Link>
            </div>
          </div>

          <nav className="flex items-center gap-0.5 overflow-x-auto text-xs sm:text-[13px]">
            <NavLink
              to={isArtms ? "/artms" : "/"}
              active={
                location.pathname === "/" || location.pathname === "/artms"
              }
              accent={artistAccent}
              label="Overview"
            />
            <NavLink
              to="/rounds"
              search={artistQuery}
              active={location.pathname === "/rounds"}
              accent={artistAccent}
              label="Rounds"
            />
            <NavLink
              to="/leaderboards"
              search={artistQuery}
              active={location.pathname === "/leaderboards"}
              accent={artistAccent}
              label="Cutoffs"
            />
            <NavLink
              to="/trades"
              search={artistQuery}
              active={location.pathname === "/trades"}
              accent={artistAccent}
              label="Trades"
            />
            <NavLink
              to="/spins"
              search={artistQuery}
              active={location.pathname === "/spins"}
              accent={artistAccent}
              label="Spins"
            />
            <NavLink
              to="/wallet"
              active={location.pathname === "/wallet"}
              accent={artistAccent}
              label="User Cost"
            />
            <NavLink
              to="/earnings"
              search={artistQuery}
              active={location.pathname === "/earnings"}
              accent={artistAccent}
              label="Earnings"
            />
            <NavLink
              to="/members"
              search={artistQuery}
              active={location.pathname === "/members"}
              accent={artistAccent}
              label="Members"
            />
            <NavLink
              to="/events"
              search={artistQuery}
              active={location.pathname === "/events"}
              accent={artistAccent}
              label="Events"
            />
            <NavLink
              to="/methodology"
              active={location.pathname === "/methodology"}
              accent={artistAccent}
              label="Methodology"
            />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-zinc-800/80 bg-[#0a0a0c]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            Independent COSMO Objekt data for tripleS &amp; ARTMS. Not
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
  accent,
  label,
}: {
  to: string;
  search?: Record<string, string>;
  active: boolean;
  accent: string;
  label: string;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={`relative whitespace-nowrap px-2.5 py-3.5 font-medium transition-colors sm:px-3 ${
        active ? "text-white" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {label}
      {active && (
        <span
          className="absolute inset-x-2.5 bottom-0 h-[2px]"
          style={{ backgroundColor: accent }}
        />
      )}
    </Link>
  );
}
