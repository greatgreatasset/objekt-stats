import { eq } from "drizzle-orm";
import { dropSchedule, type AppDatabase } from "@objekt-stats/db";
import {
  APOLLO_BASE_URL,
  classifyDropSchedule,
  parseApolloEventsHtml,
  type ClassifiedDropSchedule,
  type DropScheduleArtistId,
  type DropScheduleEntry,
  type ParsedDropScheduleItem,
} from "@objekt-stats/stats";

const DROP_SCHEDULE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface RoundLinkCandidate {
  slug: string;
  title: string;
  objektClass: string;
  onOffline: string;
  saleMechanic?: string;
  startAt: string;
  totalMints: number;
  uniqueBuyers: number;
  includeInPopularity: boolean;
  apolloEventSlug?: string | null;
  apolloEventName?: string | null;
}

export interface ArtistDropSchedulePayload extends ClassifiedDropSchedule {
  serverNowIso: string;
  lastSyncedAt: string | null;
}

function normalizeMatchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchApolloScheduleForArtist(
  artistId: DropScheduleArtistId,
): Promise<ParsedDropScheduleItem[]> {
  try {
    const res = await fetch(
      `${APOLLO_BASE_URL}/events?artist=${encodeURIComponent(artistId)}`,
      {
        headers: {
          "user-agent": "objekt-stats/1.0 (+https://objektstats.com)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(4_500),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    return parseApolloEventsHtml(html);
  } catch {
    return [];
  }
}

/**
 * Refreshes `drop_schedule` rows in D1 from Apollo's live `/events` feed.
 * Preserves any manually curated rows (`source = 'manual'`).
 */
export async function refreshDropScheduleInD1(
  rawD1: D1Database,
  artistId?: DropScheduleArtistId,
): Promise<number> {
  const targets: DropScheduleArtistId[] = artistId
    ? [artistId]
    : ["triples", "artms"];

  const allParsed = new Map<string, ParsedDropScheduleItem>();
  for (const target of targets) {
    const parsed = await fetchApolloScheduleForArtist(target);
    for (const item of parsed) {
      if (!allParsed.has(item.slug)) {
        allParsed.set(item.slug, item);
      }
    }
  }

  if (allParsed.size === 0) return 0;

  const now = new Date().toISOString();
  try {
    const upsert = rawD1.prepare(
      `INSERT INTO drop_schedule
         (slug, artist_id, name, description, event_type, start_at, end_at, twitter_url, image_url, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'apollo', ?)
       ON CONFLICT(slug) DO UPDATE SET
         name = CASE WHEN drop_schedule.source = 'manual' THEN drop_schedule.name ELSE excluded.name END,
         description = CASE WHEN drop_schedule.source = 'manual' THEN drop_schedule.description ELSE excluded.description END,
         event_type = CASE WHEN drop_schedule.source = 'manual' THEN drop_schedule.event_type ELSE excluded.event_type END,
         start_at = CASE WHEN drop_schedule.source = 'manual' THEN drop_schedule.start_at ELSE excluded.start_at END,
         end_at = CASE WHEN drop_schedule.source = 'manual' THEN drop_schedule.end_at ELSE excluded.end_at END,
         twitter_url = COALESCE(excluded.twitter_url, drop_schedule.twitter_url),
         image_url = COALESCE(excluded.image_url, drop_schedule.image_url),
         fetched_at = excluded.fetched_at`,
    );

    const stmts = Array.from(allParsed.values()).map((item) =>
      upsert.bind(
        item.slug,
        item.artistId,
        item.name,
        item.description,
        item.eventType,
        item.startAt,
        item.endAt,
        item.twitterUrl,
        item.imageUrl,
        now,
      ),
    );

    for (let i = 0; i < stmts.length; i += 80) {
      await rawD1.batch(stmts.slice(i, i + 80));
    }
    return allParsed.size;
  } catch {
    // Graceful before migration 0011 is applied
    return 0;
  }
}

/**
 * Opportunistic background refresh invoked by the live-sync Worker cron so
 * front-page reads are served immediately from D1 with zero external latency.
 */
export async function refreshDropScheduleIfStale(
  db: AppDatabase,
  rawD1: D1Database,
): Promise<number> {
  try {
    const rows = await db
      .select({
        artistId: dropSchedule.artistId,
        fetchedAt: dropSchedule.fetchedAt,
      })
      .from(dropSchedule);

    const nowMs = Date.now();
    const newestByArtist = new Map<string, number>();
    for (const r of rows) {
      const ts = Date.parse(r.fetchedAt);
      if (!Number.isNaN(ts)) {
        newestByArtist.set(
          r.artistId,
          Math.max(newestByArtist.get(r.artistId) ?? 0, ts),
        );
      }
    }

    const triplesFresh =
      nowMs - (newestByArtist.get("triples") ?? 0) < DROP_SCHEDULE_TTL_MS;
    const artmsFresh =
      nowMs - (newestByArtist.get("artms") ?? 0) < DROP_SCHEDULE_TTL_MS;

    if (triplesFresh && artmsFresh) return 0;
    return await refreshDropScheduleInD1(rawD1);
  } catch {
    return 0;
  }
}

function isPaidShopRound(r: RoundLinkCandidate): boolean {
  return r.includeInPopularity && r.saleMechanic !== "reward";
}

function sortRoundMatches(a: RoundLinkCandidate, b: RoundLinkCandidate): number {
  return (
    Number(isPaidShopRound(b)) - Number(isPaidShopRound(a)) ||
    Number(b.includeInPopularity) - Number(a.includeInPopularity) ||
    b.uniqueBuyers - a.uniqueBuyers ||
    b.totalMints - a.totalMints
  );
}

function linkDropToRound(
  drop: ParsedDropScheduleItem,
  rounds: RoundLinkCandidate[],
): RoundLinkCandidate | null {
  const isShopDrop = drop.eventType === "shop";

  // 1. Exact Apollo event slug match
  const slugMatches = rounds
    .filter((r) => r.apolloEventSlug === drop.slug)
    .sort(sortRoundMatches);
  if (slugMatches.length > 0) {
    // For paid shop drops, if slug only matched a set-completion bonus reward (e.g. 375Z),
    // keep checking nearby paid shop rounds before falling back to the bonus round.
    if (!isShopDrop || isPaidShopRound(slugMatches[0]!)) {
      return slugMatches[0] ?? null;
    }
  }

  // 2. Normalized event name / title match
  const normName = normalizeMatchText(drop.name);
  const nameMatches =
    normName.length >= 4
      ? rounds
          .filter((r) => {
            const rEv = r.apolloEventName
              ? normalizeMatchText(r.apolloEventName)
              : "";
            const rTitle = normalizeMatchText(r.title);
            return rEv === normName || rTitle.includes(normName);
          })
          .sort(sortRoundMatches)
      : [];
  if (nameMatches.length > 0) {
    if (!isShopDrop || isPaidShopRound(nameMatches[0]!)) {
      return nameMatches[0] ?? null;
    }
  }

  // 3. Shop drops whose main paid round isn't tagged yet: match online paid DCO/MCO/PCO round starting within ±18h
  if (isShopDrop && drop.startAt) {
    const dropStartMs = Date.parse(drop.startAt);
    if (!Number.isNaN(dropStartMs)) {
      const nearby = rounds
        .filter((r) => {
          if (r.onOffline !== "online" || !isPaidShopRound(r)) return false;
          if (
            r.objektClass !== "Double" &&
            r.objektClass !== "Motion" &&
            r.objektClass !== "Premier"
          ) {
            return false;
          }
          const rStartMs = Date.parse(r.startAt);
          if (Number.isNaN(rStartMs)) return false;
          return Math.abs(rStartMs - dropStartMs) <= 18 * 3_600_000;
        })
        .sort((a, b) => {
          const da = Math.abs(Date.parse(a.startAt) - dropStartMs);
          const db = Math.abs(Date.parse(b.startAt) - dropStartMs);
          return (
            da - db ||
            b.uniqueBuyers - a.uniqueBuyers ||
            b.totalMints - a.totalMints
          );
        });
      if (nearby.length > 0) return nearby[0] ?? null;
    }
  }

  // 4. Fall back to reward/bonus match if no paid shop round was found
  return slugMatches[0] ?? nameMatches[0] ?? null;
}

/**
 * Loads the artist's drop schedule from D1, auto-refreshing if empty or > 30 min stale,
 * cross-links drops to indexed `sale_rounds`, and returns classified active/upcoming/past lists.
 */
export async function getArtistDropSchedule(
  db: AppDatabase,
  rawD1: D1Database,
  artistId: DropScheduleArtistId,
  artistRounds: RoundLinkCandidate[],
): Promise<ArtistDropSchedulePayload> {
  const nowMs = Date.now();
  const serverNowIso = new Date(nowMs).toISOString();

  let rows: Array<typeof dropSchedule.$inferSelect> = [];
  let tableReady = true;

  try {
    rows = await db
      .select()
      .from(dropSchedule)
      .where(eq(dropSchedule.artistId, artistId));
  } catch {
    tableReady = false;
  }

  let latestFetchedMs = 0;
  for (const r of rows) {
    const ts = Date.parse(r.fetchedAt);
    if (!Number.isNaN(ts) && ts > latestFetchedMs) latestFetchedMs = ts;
  }

  const isStale = rows.length === 0 || nowMs - latestFetchedMs > DROP_SCHEDULE_TTL_MS;

  let items: ParsedDropScheduleItem[] = rows.map((r) => ({
    slug: r.slug,
    artistId: r.artistId === "artms" ? "artms" : "triples",
    name: r.name,
    description: r.description ?? null,
    eventType: r.eventType,
    startAt: r.startAt ?? null,
    endAt: r.endAt ?? null,
    twitterUrl: r.twitterUrl ?? null,
    imageUrl: r.imageUrl ?? null,
  }));

  if (isStale) {
    if (tableReady) {
      const updated = await refreshDropScheduleInD1(rawD1, artistId);
      if (updated > 0) {
        try {
          const freshRows = await db
            .select()
            .from(dropSchedule)
            .where(eq(dropSchedule.artistId, artistId));
          rows = freshRows;
          latestFetchedMs = 0;
          for (const r of rows) {
            const ts = Date.parse(r.fetchedAt);
            if (!Number.isNaN(ts) && ts > latestFetchedMs) latestFetchedMs = ts;
          }
          items = rows.map((r) => ({
            slug: r.slug,
            artistId: r.artistId === "artms" ? "artms" : "triples",
            name: r.name,
            description: r.description ?? null,
            eventType: r.eventType,
            startAt: r.startAt ?? null,
            endAt: r.endAt ?? null,
            twitterUrl: r.twitterUrl ?? null,
            imageUrl: r.imageUrl ?? null,
          }));
        } catch {
          // Keep previous items
        }
      }
    } else {
      // Migration 0011 not yet applied — fall back cleanly to live fetch in-memory
      const liveParsed = await fetchApolloScheduleForArtist(artistId);
      items = liveParsed.filter((i) => i.artistId === artistId);
      if (items.length > 0) latestFetchedMs = nowMs;
    }
  }

  const linkedEntries: DropScheduleEntry[] = items.map((item) => {
    const matched = linkDropToRound(item, artistRounds);
    return {
      ...item,
      status: "past",
      linkedRoundSlug: matched?.slug ?? null,
      linkedRoundTitle: matched?.title ?? null,
      linkedRoundMints: matched?.totalMints ?? null,
      linkedRoundBuyers: matched?.uniqueBuyers ?? null,
    };
  });

  const classified = classifyDropSchedule(linkedEntries, nowMs);

  return {
    ...classified,
    serverNowIso,
    lastSyncedAt: latestFetchedMs > 0 ? new Date(latestFetchedMs).toISOString() : null,
  };
}
