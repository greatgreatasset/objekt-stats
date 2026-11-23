import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ArtistCurationSchema,
  EventFileCurationSchema,
  RoundFileCurationSchema,
  type ArtistCuration,
  type EventCuration,
  type RoundCuration,
} from "./schemas.js";

export interface LoadedCurationData {
  artists: ArtistCuration[];
  roundsByArtist: Record<string, RoundCuration[]>;
  eventsByArtist: Record<string, EventCuration[]>;
}

function readYamlFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => join(dirPath, f));
}

export function loadCurationData(dataRoot = resolve(process.cwd(), "data")): LoadedCurationData {
  const artistsDir = join(dataRoot, "artists");
  const artists: ArtistCuration[] = [];
  const memberIds = new Set<string>();

  for (const file of readYamlFiles(artistsDir)) {
    const raw = parseYaml(readFileSync(file, "utf8"));
    const parsed = ArtistCurationSchema.parse(raw);

    const seenOrders = new Set<number>();
    const seenCodes = new Set<string>();
    for (const m of parsed.members) {
      if (memberIds.has(m.id)) {
        throw new Error(`Duplicate member id "${m.id}" in ${file}`);
      }
      if (seenOrders.has(m.memberOrder)) {
        throw new Error(`Duplicate memberOrder ${m.memberOrder} in ${file}`);
      }
      if (seenCodes.has(m.code)) {
        throw new Error(`Duplicate member code "${m.code}" in ${file}`);
      }
      memberIds.add(m.id);
      seenOrders.add(m.memberOrder);
      seenCodes.add(m.code);
    }

    artists.push(parsed);
  }

  const eventsByArtist: Record<string, EventCuration[]> = {};
  const seenEventIds = new Set<string>();
  for (const file of readYamlFiles(join(dataRoot, "events"))) {
    const raw = parseYaml(readFileSync(file, "utf8"));
    const parsed = EventFileCurationSchema.parse(raw);
    for (const ev of parsed.events) {
      if (seenEventIds.has(ev.id)) {
        throw new Error(`Duplicate event id "${ev.id}" in ${file}`);
      }
      seenEventIds.add(ev.id);
      for (const mId of ev.members) {
        if (!memberIds.has(mId)) {
          throw new Error(`Unknown member id "${mId}" referenced by event "${ev.id}" in ${file}`);
        }
      }
    }
    eventsByArtist[parsed.artistId] = [
      ...(eventsByArtist[parsed.artistId] ?? []),
      ...parsed.events,
    ];
  }

  const roundsByArtist: Record<string, RoundCuration[]> = {};
  const seenRoundSlugs = new Set<string>();
  const roundsRoot = join(dataRoot, "rounds");
  if (existsSync(roundsRoot)) {
    for (const entry of readdirSync(roundsRoot, { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readYamlFiles(join(roundsRoot, entry.name))
        : entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")
          ? [join(roundsRoot, entry.name)]
          : [];

      for (const file of files) {
        const raw = parseYaml(readFileSync(file, "utf8"));
        const parsed = RoundFileCurationSchema.parse(raw);
        for (const r of parsed.rounds) {
          if (seenRoundSlugs.has(r.slug)) {
            throw new Error(`Duplicate round slug "${r.slug}" in ${file}`);
          }
          seenRoundSlugs.add(r.slug);
          for (const mId of r.collectionMatchers.memberIds ?? []) {
            if (!memberIds.has(mId)) {
              throw new Error(`Unknown member id "${mId}" referenced by round "${r.slug}" in ${file}`);
            }
          }
        }
        roundsByArtist[parsed.artistId] = [
          ...(roundsByArtist[parsed.artistId] ?? []),
          ...parsed.rounds,
        ];
      }
    }
  }

  return { artists, roundsByArtist, eventsByArtist };
}
