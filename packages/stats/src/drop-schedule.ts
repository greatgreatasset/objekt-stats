/**
 * COSMO Objekt Drop Schedule Parser & Classification Engine
 *
 * Parses active, upcoming, and recent past Objekt drop windows from Apollo's
 * `/events` feed, deduplicates redundant season umbrellas when specific editions
 * exist, prioritizes limited-time shop drops, and formats countdowns cleanly.
 */

export type DropScheduleArtistId = "triples" | "artms";

export type DropScheduleStatus = "active" | "upcoming" | "past";

export interface ParsedDropScheduleItem {
  slug: string;
  artistId: DropScheduleArtistId;
  name: string;
  description: string | null;
  eventType: string;
  startAt: string | null;
  endAt: string | null;
  twitterUrl: string | null;
  imageUrl: string | null;
}

export interface DropScheduleEntry extends ParsedDropScheduleItem {
  status: DropScheduleStatus;
  linkedRoundSlug: string | null;
  linkedRoundTitle: string | null;
  linkedRoundMints: number | null;
  linkedRoundBuyers: number | null;
}

export interface ClassifiedDropSchedule {
  active: DropScheduleEntry[];
  upcoming: DropScheduleEntry[];
  past: DropScheduleEntry[];
  featuredActive: DropScheduleEntry | null;
}

function unescapeJsStringLiteral(raw: string | undefined): string | null {
  if (!raw || raw === "null") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  try {
    const normalized = trimmed.replace(
      /\\x([0-9a-fA-F]{2})/g,
      (_, hex: string) => `\\u00${hex}`,
    );
    const parsed = JSON.parse(normalized);
    return typeof parsed === "string" ? parsed.trim() || null : null;
  } catch {
    return trimmed.slice(1, -1).trim() || null;
  }
}

/**
 * Extracts event schedule records from Apollo's SSR `/events` HTML payload.
 * Handles TanStack Start / seroval dehydrated `new Date("...")` fields safely.
 */
export function parseApolloEventsHtml(html: string): ParsedDropScheduleItem[] {
  const re =
    /\{id:"([^"]+)",createdAt:[^,]+,eraId:(null|"[^"]*"),slug:"([^"]+)",name:("(?:[^"\\]|\\.)*"),description:(null|"(?:[^"\\]|\\.)*"),artist:"([^"]+)",eventType:"([^"]+)",twitterUrl:(null|"(?:[^"\\]|\\.)*"),discordUrl:(null|"(?:[^"\\]|\\.)*"),startDate:(null|(?:\$R\[\d+\]=)?new Date\("([^"]+)"\)),endDate:(null|(?:\$R\[\d+\]=)?new Date\("([^"]+)"\))(?:,imageUrl:(null|"(?:[^"\\]|\\.)*"))?/g;

  const bySlug = new Map<string, ParsedDropScheduleItem>();

  for (const match of html.matchAll(re)) {
    const slug = (match[3] ?? "").trim();
    if (!slug || bySlug.has(slug)) continue;

    const rawArtist = (match[6] ?? "").trim().toLowerCase();
    if (rawArtist !== "triples" && rawArtist !== "artms") continue;

    const name = unescapeJsStringLiteral(match[4]);
    if (!name) continue;

    const description = unescapeJsStringLiteral(match[5]);
    const eventType = (match[7] ?? "shop").trim().toLowerCase();
    const twitterUrl = unescapeJsStringLiteral(match[8]);
    const startAt = match[11] ? match[11].trim() : null;
    const endAt = match[13] ? match[13].trim() : null;
    const imageUrl = unescapeJsStringLiteral(match[14]);

    bySlug.set(slug, {
      slug,
      artistId: rawArtist,
      name,
      description,
      eventType,
      startAt,
      endAt,
      twitterUrl,
      imageUrl,
    });
  }

  return Array.from(bySlug.values());
}

const ACTIVE_TYPE_PRIORITY: Record<string, number> = {
  shop: 0,
  seasonal: 1,
  album: 2,
  tour: 3,
  merch: 4,
  offline: 5,
  promotional: 6,
};

function typePriority(eventType: string): number {
  return ACTIVE_TYPE_PRIORITY[eventType.toLowerCase()] ?? 5;
}

/**
 * Drops redundant `*-seasonal` umbrella entries (e.g. `triples-divine02-seasonal`)
 * when a specific edition (e.g. `triples-divine02-1st-edition`) for the same season
 * exists in the same schedule bucket.
 */
function pruneSeasonalUmbrellas<T extends ParsedDropScheduleItem>(items: T[]): T[] {
  const nonUmbrellaSlugs = items
    .filter((i) => !i.slug.endsWith("-seasonal"))
    .map((i) => i.slug);

  return items.filter((item) => {
    if (!item.slug.endsWith("-seasonal")) return true;
    const prefix = item.slug.slice(0, -"-seasonal".length) + "-";
    const hasSpecificEdition = nonUmbrellaSlugs.some((s) => s.startsWith(prefix));
    return !hasSpecificEdition;
  });
}

/**
 * Classifies drops into active, upcoming, and past buckets relative to `nowMs`,
 * sorting limited-time shop drops and soonest-ending / soonest-starting drops first.
 */
export function classifyDropSchedule(
  items: DropScheduleEntry[],
  nowMs: number,
): ClassifiedDropSchedule {
  const rawActive: DropScheduleEntry[] = [];
  const rawUpcoming: DropScheduleEntry[] = [];
  const rawPast: DropScheduleEntry[] = [];

  for (const item of items) {
    const startMs = item.startAt ? Date.parse(item.startAt) : NaN;
    const endMs = item.endAt ? Date.parse(item.endAt) : NaN;
    const hasStart = !Number.isNaN(startMs);
    const hasEnd = !Number.isNaN(endMs);

    if (hasStart && startMs > nowMs) {
      rawUpcoming.push({ ...item, status: "upcoming" });
    } else if (hasEnd && endMs <= nowMs) {
      rawPast.push({ ...item, status: "past" });
    } else if (hasStart && startMs <= nowMs) {
      rawActive.push({ ...item, status: "active" });
    } else if (hasEnd && endMs > nowMs) {
      rawActive.push({ ...item, status: "active" });
    } else {
      rawPast.push({ ...item, status: "past" });
    }
  }

  const active = pruneSeasonalUmbrellas(rawActive).sort((a, b) => {
    const pDiff = typePriority(a.eventType) - typePriority(b.eventType);
    if (pDiff !== 0) return pDiff;
    const aEnd = a.endAt ? Date.parse(a.endAt) : Number.MAX_SAFE_INTEGER;
    const bEnd = b.endAt ? Date.parse(b.endAt) : Number.MAX_SAFE_INTEGER;
    if (aEnd !== bEnd) return aEnd - bEnd;
    const aStart = a.startAt ? Date.parse(a.startAt) : 0;
    const bStart = b.startAt ? Date.parse(b.startAt) : 0;
    return bStart - aStart;
  });

  const upcoming = pruneSeasonalUmbrellas(rawUpcoming).sort((a, b) => {
    const aStart = a.startAt ? Date.parse(a.startAt) : Number.MAX_SAFE_INTEGER;
    const bStart = b.startAt ? Date.parse(b.startAt) : Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
  });

  const past = pruneSeasonalUmbrellas(rawPast).sort((a, b) => {
    const aEnd = a.endAt
      ? Date.parse(a.endAt)
      : a.startAt
        ? Date.parse(a.startAt)
        : 0;
    const bEnd = b.endAt
      ? Date.parse(b.endAt)
      : b.startAt
        ? Date.parse(b.startAt)
        : 0;
    return bEnd - aEnd;
  });

  return {
    active,
    upcoming,
    past,
    featuredActive: active[0] ?? null,
  };
}

/**
 * Formats a concise human countdown (`12h 34m 18s`, `2d 05h 12m`, `45m 10s`, etc.).
 */
export function formatDropCountdown(
  targetIso: string | null,
  nowMs: number,
  options?: { includeSeconds?: boolean },
): string | null {
  if (!targetIso) return null;
  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs)) return null;
  const diffSec = Math.floor((targetMs - nowMs) / 1000);
  if (diffSec <= 0) return null;

  const days = Math.floor(diffSec / 86_400);
  const hours = Math.floor((diffSec % 86_400) / 3_600);
  const mins = Math.floor((diffSec % 3_600) / 60);
  const secs = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days >= 7) {
    return `${days}d ${hours}h`;
  }
  if (days >= 1) {
    return options?.includeSeconds
      ? `${days}d ${pad(hours)}h ${pad(mins)}m`
      : `${days}d ${hours}h ${mins}m`;
  }
  if (hours >= 1) {
    return options?.includeSeconds
      ? `${hours}h ${pad(mins)}m ${pad(secs)}s`
      : `${hours}h ${pad(mins)}m`;
  }
  return options?.includeSeconds ? `${mins}m ${pad(secs)}s` : `${Math.max(1, mins)}m`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatShortUtcDate(
  iso: string | null,
  includeYear = false,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mon = SHORT_MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return includeYear ? `${mon} ${day}, ${d.getUTCFullYear()}` : `${mon} ${day}`;
}

export function formatDropWindow(
  startAt: string | null,
  endAt: string | null,
  nowMs?: number,
): string {
  const refYear = nowMs ? new Date(nowMs).getUTCFullYear() : new Date().getUTCFullYear();
  const sDate = startAt ? new Date(startAt) : null;
  const eDate = endAt ? new Date(endAt) : null;
  const sValid = sDate && !Number.isNaN(sDate.getTime());
  const eValid = eDate && !Number.isNaN(eDate.getTime());

  const sLabel = sValid
    ? formatShortUtcDate(startAt, sDate.getUTCFullYear() !== refYear)
    : null;
  const eLabel = eValid
    ? formatShortUtcDate(endAt, eDate.getUTCFullYear() !== refYear)
    : null;

  if (sLabel && eLabel) {
    return sLabel === eLabel ? sLabel : `${sLabel} – ${eLabel}`;
  }
  if (sLabel) return `From ${sLabel}`;
  if (eLabel) return `Ends ${eLabel}`;
  return "TBA";
}

export function computeDropProgressPct(
  startAt: string | null,
  endAt: string | null,
  nowMs: number,
): number | null {
  if (!startAt || !endAt) return null;
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  const pct = ((nowMs - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, pct));
}
