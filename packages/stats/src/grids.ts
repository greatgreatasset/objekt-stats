export type GridEditionId = "ed1" | "ed2" | "ed3";

export interface FcoGridEditionInfo {
  editionId: GridEditionId;
  editionNumber: 1 | 2 | 3;
  editionLabel: string;
  shortLabel: string;
  gridSize: 4 | 8;
  slotCount: 4 | 8;
  rewardScoNos: readonly string[];
}

export interface GridRewardScoInfo {
  editionId: GridEditionId;
  editionNumber: 1 | 2 | 3;
  editionLabel: string;
  shortLabel: string;
  gridSize: 4 | 8;
  artistId: string;
}

export interface EditionGridSupplyInput {
  fcoMints: number;
  scoMints: number;
  spunCount?: number;
  gridSize: number;
  slotCount?: number;
}

export interface EditionGridSupplyMetrics {
  gridsCompleted: number;
  lockedFcos: number;
  gridLockPct: number;
  estTradableFloat: number;
  estTradableFloatPerSlot: number;
}

export interface CardGridSupplyMetrics {
  gridsCompleted: number;
  lockedCopies: number;
  gridLockPct: number;
  estTradableFloat: number;
}

function parseCollectionNum(collectionNo: string): number {
  const m = /^(\d+)/.exec(collectionNo.trim());
  return m ? Number(m[1]) : 0;
}

/**
 * Maps a Digital First Class (or idntt Basic) Objekt to its COSMO Grid edition
 * (`1st Ed 101–108Z` = 8-card grid, `2nd Ed 109–116Z` = 8-card grid,
 * `3rd Ed 117–120Z` = 4-card grid) and the matching Special Class reward codes.
 *
 * Returns `null` for physical (`offline`) or non-griddable classes.
 */
export function classifyFcoGridEdition(
  artistId: string,
  season: string,
  objektClass: string,
  collectionNo: string,
  onOffline: string,
): FcoGridEditionInfo | null {
  if (onOffline.toLowerCase() !== "online") return null;

  const artist = artistId.toLowerCase();
  const cls = objektClass.toLowerCase();
  const num = parseCollectionNum(collectionNo);

  // idntt uses Basic 101Z–108Z (8-card grid) -> Special 301Z/302Z
  if (artist === "idntt") {
    if ((cls === "basic" || cls === "first") && num >= 101 && num <= 108) {
      return {
        editionId: "ed1",
        editionNumber: 1,
        editionLabel: "Basic Grid (101–108Z)",
        shortLabel: "8-card grid",
        gridSize: 8,
        slotCount: 8,
        rewardScoNos: ["301Z", "302Z"],
      };
    }
    return null;
  }

  if (cls !== "first") return null;

  const isTriplesAtom01 =
    artist === "triples" && season.toLowerCase() === "atom01";

  if (num >= 101 && num <= 108) {
    return {
      editionId: "ed1",
      editionNumber: 1,
      editionLabel: "1st Edition (101–108Z)",
      shortLabel: "1st Ed · 8-card",
      gridSize: 8,
      slotCount: 8,
      rewardScoNos: isTriplesAtom01 ? ["201Z"] : ["201Z", "202Z"],
    };
  }
  if (num >= 109 && num <= 116) {
    return {
      editionId: "ed2",
      editionNumber: 2,
      editionLabel: "2nd Edition (109–116Z)",
      shortLabel: "2nd Ed · 8-card",
      gridSize: 8,
      slotCount: 8,
      rewardScoNos: isTriplesAtom01 ? ["202Z"] : ["203Z", "204Z"],
    };
  }
  if (num >= 117 && num <= 120) {
    return {
      editionId: "ed3",
      editionNumber: 3,
      editionLabel: "3rd Edition (117–120Z)",
      shortLabel: "3rd Ed · 4-card",
      gridSize: 4,
      slotCount: 4,
      rewardScoNos: isTriplesAtom01 ? ["203Z"] : ["205Z", "206Z"],
    };
  }

  return null;
}

/**
 * Identifies whether a Digital Special Class Objekt (`201Z–206Z`, or `301Z–302Z` for idntt)
 * is a standard COSMO Grid Completion reward and returns which edition & grid size
 * it permanently locked.
 *
 * Excludes physical SCOs (`A`) and event/promo SCOs (`207Z+`, `216Z–219Z`).
 */
export function classifyGridRewardSco(
  artistId: string,
  season: string,
  objektClass: string,
  collectionNo: string,
  onOffline: string,
): GridRewardScoInfo | null {
  if (onOffline.toLowerCase() !== "online") return null;
  if (objektClass.toLowerCase() !== "special") return null;

  const artist = artistId.toLowerCase();
  const code = collectionNo.trim().toUpperCase();

  if (artist === "idntt") {
    if (code === "301Z" || code === "302Z") {
      return {
        editionId: "ed1",
        editionNumber: 1,
        editionLabel: "Basic Grid (101–108Z)",
        shortLabel: "8-card grid",
        gridSize: 8,
        artistId: artist,
      };
    }
    return null;
  }

  const isTriplesAtom01 =
    artist === "triples" && season.toLowerCase() === "atom01";

  if (isTriplesAtom01) {
    if (code === "201Z") {
      return {
        editionId: "ed1",
        editionNumber: 1,
        editionLabel: "1st Edition (101–108Z)",
        shortLabel: "1st Ed · 8-card",
        gridSize: 8,
        artistId: artist,
      };
    }
    if (code === "202Z") {
      return {
        editionId: "ed2",
        editionNumber: 2,
        editionLabel: "2nd Edition (109–116Z)",
        shortLabel: "2nd Ed · 8-card",
        gridSize: 8,
        artistId: artist,
      };
    }
    if (code === "203Z") {
      return {
        editionId: "ed3",
        editionNumber: 3,
        editionLabel: "3rd Edition (117–120Z)",
        shortLabel: "3rd Ed · 4-card",
        gridSize: 4,
        artistId: artist,
      };
    }
    return null;
  }

  if (code === "201Z" || code === "202Z") {
    return {
      editionId: "ed1",
      editionNumber: 1,
      editionLabel: "1st Edition (101–108Z)",
      shortLabel: "1st Ed · 8-card",
      gridSize: 8,
      artistId: artist,
    };
  }
  if (code === "203Z" || code === "204Z") {
    return {
      editionId: "ed2",
      editionNumber: 2,
      editionLabel: "2nd Edition (109–116Z)",
      shortLabel: "2nd Ed · 8-card",
      gridSize: 8,
      artistId: artist,
    };
  }
  if (code === "205Z" || code === "206Z") {
    return {
      editionId: "ed3",
      editionNumber: 3,
      editionLabel: "3rd Edition (117–120Z)",
      shortLabel: "3rd Ed · 4-card",
      gridSize: 4,
      artistId: artist,
    };
  }

  return null;
}

/**
 * Returns a grid-cost-aware equivalence tier key for secondary swap comparisons.
 *
 * Crucially separates Digital First Class **8-card grid** cards (`101–116Z`, worth 1/8 SCO)
 * from **4-card grid** cards (`117–120Z`, worth 1/4 SCO = ~2× grid utility), so trading
 * 2× 1st/2nd-Ed FCOs for 1× 3rd-Ed FCO is recognized as fair grid arbitrage rather than
 * a member-popularity overpay.
 */
export function getSwapGridTier(
  objektClass: string,
  collectionNo?: string | null,
  onOffline?: string | null,
): string {
  const cls = objektClass.trim().toLowerCase();
  const fmt = (onOffline ?? "online").trim().toLowerCase();
  if (cls === "first" && fmt === "online" && collectionNo) {
    const num = parseCollectionNum(collectionNo);
    if (num >= 101 && num <= 116) return "first:online:8card";
    if (num >= 117 && num <= 120) return "first:online:4card";
  }
  return `${cls}:${fmt}`;
}

/**
 * Returns a strict exact-edition equivalence key (`season + FCO edition bucket` or
 * `season + exact DCO/SCO/MCO collectionNo`) for ultra-strict apples-to-apples swaps.
 */
export function getSwapEditionKey(
  season: string,
  objektClass: string,
  collectionNo: string,
  onOffline: string,
): string {
  const sn = season.trim().toLowerCase();
  const cls = objektClass.trim().toLowerCase();
  const fmt = onOffline.trim().toLowerCase();
  const no = collectionNo.trim().toUpperCase();

  if (cls === "first") {
    const num = parseCollectionNum(no);
    if (num >= 101 && num <= 108) return `${sn}:first:${fmt}:ed1`;
    if (num >= 109 && num <= 116) return `${sn}:first:${fmt}:ed2`;
    if (num >= 117 && num <= 120) return `${sn}:first:${fmt}:ed3`;
  }
  return `${sn}:${cls}:${fmt}:${no}`;
}

/**
 * Computes edition-level Grid Lock % and Estimated Tradable Float across all slots
 * in a season edition (e.g. all 4 slots of Cream02 3rd Ed = `scoMints * 4` locked FCOs).
 */
export function computeEditionGridSupply(
  input: EditionGridSupplyInput,
): EditionGridSupplyMetrics {
  const fcoMints = Math.max(0, Math.round(input.fcoMints));
  const gridsCompleted = Math.max(0, Math.round(input.scoMints));
  const spunCount = Math.max(0, Math.round(input.spunCount ?? 0));
  const gridSize = Math.max(1, input.gridSize);
  const slotCount = Math.max(1, input.slotCount ?? gridSize);

  const lockedFcos = Math.min(fcoMints, gridsCompleted * gridSize);
  const gridLockPct =
    fcoMints > 0 ? Math.round((lockedFcos / fcoMints) * 1000) / 10 : 0;
  const estTradableFloat = Math.max(0, fcoMints - lockedFcos - spunCount);
  const estTradableFloatPerSlot = Math.round(estTradableFloat / slotCount);

  return {
    gridsCompleted,
    lockedFcos,
    gridLockPct,
    estTradableFloat,
    estTradableFloatPerSlot,
  };
}

/**
 * Computes per-card Grid Lock % and Estimated Tradable Float for a SINGLE Digital FCO
 * collection (e.g. `Cream02 ChaeWon 118Z`). Because every completed grid for that
 * `(member, season, edition)` permanently locks exactly 1 copy of every slot in the grid,
 * `lockedCopies === min(cardMints, matchingEditionScoMints)`.
 */
export function computeCardGridSupply(
  cardMints: number,
  matchingEditionScoMints: number,
  spunCount = 0,
): CardGridSupplyMetrics {
  const mints = Math.max(0, Math.round(cardMints));
  const gridsCompleted = Math.max(0, Math.round(matchingEditionScoMints));
  const spun = Math.max(0, Math.round(spunCount));
  const lockedCopies = Math.min(mints, gridsCompleted);
  const gridLockPct =
    mints > 0 ? Math.round((lockedCopies / mints) * 1000) / 10 : 0;
  const estTradableFloat = Math.max(0, mints - lockedCopies - spun);

  return {
    gridsCompleted,
    lockedCopies,
    gridLockPct,
    estTradableFloat,
  };
}
