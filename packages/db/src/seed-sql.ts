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
  "-- Apply locally: npx wrangler d1 execute objekt-stats-db --local --file=../../packages/db/generated/seed-curation.sql",
  "",
];

for (const artist of data.artists) {
  lines.push(
    `INSERT OR REPLACE INTO artists (id, name, cosmo_artist_name, is_primary, accent_color, debut_date) VALUES (${sqlStr(artist.id)}, ${sqlStr(artist.name)}, ${sqlStr(artist.cosmoArtistName)}, ${sqlBool(artist.isPrimary)}, ${sqlStr(artist.accentColor)}, ${sqlStr(artist.debutDate)});`,
  );

  for (const m of artist.members) {
    lines.push(
      `INSERT OR REPLACE INTO members (id, artist_id, code, member_order, name, full_name, cosmo_name, hex_color, reveal_date) VALUES (${sqlStr(m.id)}, ${sqlStr(artist.id)}, ${sqlStr(m.code)}, ${m.memberOrder}, ${sqlStr(m.name)}, ${sqlStr(m.fullName)}, ${sqlStr(m.cosmoName)}, ${sqlStr(m.hexColor)}, ${sqlStr(m.revealDate)});`,
    );
  }
}

lines.push("");

for (const [artistId, evs] of Object.entries(data.eventsByArtist)) {
  for (const ev of evs) {
    lines.push(
      `INSERT OR REPLACE INTO events (id, artist_id, event_date, end_date, category, title, summary, source_url) VALUES (${sqlStr(ev.id)}, ${sqlStr(artistId)}, ${sqlStr(ev.eventDate)}, ${sqlStr(ev.endDate)}, ${sqlStr(ev.category)}, ${sqlStr(ev.title)}, ${sqlStr(ev.summary)}, ${sqlStr(ev.sourceUrl)});`,
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
