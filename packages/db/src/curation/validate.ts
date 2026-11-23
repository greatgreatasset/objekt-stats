import { resolve } from "node:path";
import { loadCurationData } from "./loader.js";

const dataRoot = resolve(import.meta.dirname, "../../../../data");
const data = loadCurationData(dataRoot);

const memberCount = data.artists.reduce((acc, a) => acc + a.members.length, 0);
const eventCount = Object.values(data.eventsByArtist).reduce((acc, e) => acc + e.length, 0);
const roundCount = Object.values(data.roundsByArtist).reduce((acc, r) => acc + r.length, 0);

console.log(
  `✓ Validated curation YAML: ${data.artists.length} artists, ${memberCount} members, ${eventCount} events, ${roundCount} curated rounds.`,
);
