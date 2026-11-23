import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCurationData } from "./curation/loader.js";

function sqlStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function sqlBool(val: boolean): string {
  return val ? "1" : "0";
}

const dataRoot = resolve(import.meta.dirname, "../../../data");
const outDir = resolve(import.meta.dirname, "../generated");
const outFile = resolve(outDir, "seed-curation.sql");

const data = loadCurationData(dataRoot);
const lines: string[] = [
  "-- Auto-generated from data/artists/*.yaml and data/events/*.yaml",
  "-- Uses ON CONFLICT DO UPDATE (never INSERT OR REPLACE) so ON DELETE CASCADE never clears indexed data.",
  "",
];

for (const artist of data.artists) {
  lines.push(
    `INSERT INTO artists (id, name, cosmo_artist_name, is_primary, accent_color, debut_date) VALUES (${sqlStr(artist.id)}, ${sqlStr(artist.name)}, ${sqlStr(artist.cosmoArtistName)}, ${sqlBool(artist.isPrimary)}, ${sqlStr(artist.accentColor)}, ${sqlStr(artist.debutDate)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, cosmo_artist_name = excluded.cosmo_artist_name, is_primary = excluded.is_primary, accent_color = excluded.accent_color, debut_date = excluded.debut_date;`,
  );

  for (const m of artist.members) {
    lines.push(
      `INSERT INTO members (id, artist_id, code, member_order, name, full_name, cosmo_name, hex_color, reveal_date) VALUES (${sqlStr(m.id)}, ${sqlStr(artist.id)}, ${sqlStr(m.code)}, ${m.memberOrder}, ${sqlStr(m.name)}, ${sqlStr(m.fullName)}, ${sqlStr(m.cosmoName)}, ${sqlStr(m.hexColor)}, ${sqlStr(m.revealDate)}) ON CONFLICT(id) DO UPDATE SET artist_id = excluded.artist_id, code = excluded.code, member_order = excluded.member_order, name = excluded.name, full_name = excluded.full_name, cosmo_name = excluded.cosmo_name, hex_color = excluded.hex_color, reveal_date = excluded.reveal_date;`,
    );
  }
}

lines.push("");

for (const [artistId, evs] of Object.entries(data.eventsByArtist)) {
  for (const ev of evs) {
    lines.push(
      `INSERT INTO events (id, artist_id, event_date, end_date, category, title, summary, source_url) VALUES (${sqlStr(ev.id)}, ${sqlStr(artistId)}, ${sqlStr(ev.eventDate)}, ${sqlStr(ev.endDate)}, ${sqlStr(ev.category)}, ${sqlStr(ev.title)}, ${sqlStr(ev.summary)}, ${sqlStr(ev.sourceUrl)}) ON CONFLICT(id) DO UPDATE SET artist_id = excluded.artist_id, event_date = excluded.event_date, end_date = excluded.end_date, category = excluded.category, title = excluded.title, summary = excluded.summary, source_url = excluded.source_url;`,
    );
    lines.push(`DELETE FROM event_members WHERE event_id = ${sqlStr(ev.id)};`);
    for (const memberId of ev.members) {
      lines.push(
        `INSERT OR IGNORE INTO event_members (event_id, member_id) VALUES (${sqlStr(ev.id)}, ${sqlStr(memberId)});`,
      );
    }
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
console.log(`✓ Generated ${outFile} (${lines.length} lines)`);
