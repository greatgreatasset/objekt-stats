# Objekt Stats (`objektstats.com`)

Blockchain-backed COSMO Objekt sale round tracker and member popularity analytics for **tripleS** (S1–S24), with secondary support for **ARTMS** (HeeJin, HaSeul, Kim Lip, JinSoul, Choerry).

Live site: **[https://objektstats.com](https://objektstats.com)**

## Features

- **Every Sale Round (`/rounds`, `/rounds/$slug`):** Filterable catalog of COSMO drops grouped into FCO editions (`101–108`, `109–116`, `117–120`), DCO (`3xx`), PCO (`4xx`), MCO (`5xx`), Physical (`A`), and Rewards. Each round includes official-color member leaderboards, exact mints, `% share`, roster-normalized Relative Share Index (`1.00×` = average), daily mint velocity, COSMO card previews, correlated real-world events, and a one-click X/Twitter recap copy button.
- **User Cost & Transaction Estimator (`/wallet`):** Search any COSMO nickname or EVM wallet to inspect complete Polygon + Abstract history with automatic legacy Polygon wallet linking (`ownerOf()` on migrated tokens), COSMO Talk `Pass+` monthly subscription deduction (1/2/4/8/24-member tiers), COSMO Spin replacement pairing (`$0` cash), reciprocal trade detection, date-aware App Store vs. `shop.cosmo.fans` bulk pack pricing, customizable unit rates, monthly spend charts, member breakdowns, and CSV export.
- **Most Traded Objekts (`/trades`):** Isolated secondary-market analytics detecting reciprocal user-to-user swaps (`≥2` Objekts within 30 minutes) without contaminating primary sales.
- **Interactive Rank Bump Chart & Member Trends (`/members`, `/members/$memberId`):** Compare up to 10 members side-by-side by ordinal Rank (`#1–#24`) or Relative Share Index (`×`) with toggleable vertical real-world event overlays, rolling-5 averages, rank volatility (`σ`), and FCO vs. DCO splits.
- **Automated Anomaly & Event Correlation (`/events`, `/`):** Automatically flags statistically significant surges and drops against each member's trailing 5-round baseline and links them to curated tripleS / ARTMS milestones within a −14d / +7d window.
- **Automated Continuous Live Sync:** A Cloudflare Workers Cron Trigger (`*/5 * * * *`) incrementally syncs new Abstract mainnet mints directly into Cloudflare D1 and recomputes sale round rankings automatically, backed up by an optional GitHub Actions heavy-sync workflow.

## Architecture

- **Frontend & API (`apps/web`):** TanStack Start + Vite 8 + Tailwind CSS v4 deployed on **Cloudflare Workers** (`objektstats.com`, `www.objektstats.com`)
- **Database (`packages/db`):** Drizzle ORM + **Cloudflare D1** (`objekt-stats-db`) storing pre-aggregated collections, daily mints, sale rounds, member stats, events, and live-sync dedupe state
- **Archive Storage:** **Cloudflare R2** (`objekt-stats-snapshots`) for historical summaries and SQLite backfill checkpoints
- **Stats Engine (`packages/stats`):** Pure TypeScript ranking, roster-size normalization (`relativeIndex`), z-score, rolling average, anomaly detection, and event correlation library
- **Dual-Chain Indexer (`packages/indexer`):** Resumable Node 24 `node:sqlite` indexer supporting **Abstract Mainnet** (`0x99bb83ae9bb0c0a6be865cacf67760947f91cb70`, Apr 18, 2025 – present) and **Polygon** (`0xa4b37be40f7b231ee9574c4b16b7ddb7eacdc99b`, May 2022 – Apr 18, 2025 via SQD Portal), enriched via COSMO v3 metadata (`/bff/v3/objekts/nft-metadata/{tokenId}`)
- **Git-Tracked Curation (`data/`):** Zod-validated YAML definitions for `data/artists/`, `data/events/`, and `data/rounds/`

## Common Commands

```bash
# Validate curation YAML, run all tests, build & typecheck
npm run validate:data
npm test
npm run build
npm run typecheck

# Run local web app
npm run dev

# Indexer CLI (resumable in data/raw/indexer.sqlite)
npm run indexer -- status
npm run indexer -- sync-abstract --blocks 20000 --concurrency 40
npm run indexer -- backfill-abstract --blocks 200000 --window 20000 --concurrency 40
npm run indexer -- sync-polygon --from 34500000 --to 35000000 --resolve true
npm run indexer -- export-rounds-draft
npm run indexer -- aggregate

# Apply curation & on-chain aggregates to Cloudflare D1
npm run db:seed-sql
npx --workspace=@objekt-stats/web wrangler d1 migrations apply objekt-stats-db --remote
npx --workspace=@objekt-stats/web wrangler d1 execute objekt-stats-db --remote --file=../../packages/db/generated/seed-curation.sql --yes
npx --workspace=@objekt-stats/web wrangler d1 execute objekt-stats-db --remote --file=../../packages/db/generated/sync-onchain.sql --yes
```

## Optional GitHub Actions Heavy Sync

The built-in Cloudflare Worker Cron (`*/5 * * * *`) automatically keeps `objektstats.com` synced continuously with zero extra configuration. To also enable the heavy 2-hour GitHub Actions Node 24 sync (`.github/workflows/live-sync.yml`) for massive drop days:
1. Add `CLOUDFLARE_API_TOKEN` (D1 + R2 edit) and `CLOUDFLARE_ACCOUNT_ID` to repository Secrets.
2. Set repository Variable `ENABLE_GH_SYNC=true`.
