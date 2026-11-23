# Objekt Stats (`objektstats.com`)

Blockchain-backed Objekt sale round tracker and member popularity analytics for **tripleS** (S1–S24), with secondary support for **ARTMS**.

## Vision

Every COSMO Objekt minted by Modhaus is recorded on-chain (historically on **Polygon** from May 2022 – April 18, 2025, and on **Abstract** thereafter). Objekt Stats turns that raw on-chain history into structured, normalized analytics:

- **Every Sale Round:** Browse every Objekt drop/round with dates, classes (`FCO`, `DCO`, `SCO`, `PCO`, `MCO`), formats (`Z` digital vs. `A` physical), sale mechanics (member-selectable vs. random packs), total mints, and member leaderboards.
- **Member Popularity & Rank Trajectories:** Track each member's rank (`#1`–`#24`), share of batch, rolling averages, and roster-normalized popularity across eras.
- **Trend Shifts & Event Context:** Automatically flag statistically significant jumps or drops and correlate them with real-world events (comebacks, Gravities, sub-units, variety/drama appearances, viral moments, tours, hiatuses).

## Planned Architecture

- **Frontend & API:** TanStack Start (React + Vite) deployed on **Cloudflare Workers** (`objektstats.com`)
- **Storage:** **Cloudflare D1** (aggregated collection, daily mint, sale round, and member stat tables) + **Cloudflare R2** (historical snapshots & exports)
- **Data Pipeline:** Polygon historical backfill + live Abstract sync, enriched with COSMO metadata (`api.cosmo.fans`)
- **Curation:** Auto-detected sale batches paired with Git-tracked JSON/YAML definitions for round metadata, sale mechanics, and real-world timeline events

## Status

Planning & initial repository setup.
