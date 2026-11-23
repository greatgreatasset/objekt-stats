import { describe, expect, it } from "vitest";
import {
  classifyFcoGridEdition,
  classifyGridRewardSco,
  computeCardGridSupply,
  computeEditionGridSupply,
  getSwapEditionKey,
  getSwapGridTier,
} from "./grids.js";

describe("COSMO Grid engine", () => {
  it("classifies 1st, 2nd, and 3rd Edition Digital FCOs with accurate grid sizes and SCO mappings", () => {
    const ed1 = classifyFcoGridEdition("triples", "Cream02", "First", "101Z", "online");
    expect(ed1).toMatchObject({
      editionId: "ed1",
      gridSize: 8,
      rewardScoNos: ["201Z", "202Z"],
    });

    const ed2 = classifyFcoGridEdition("artms", "Ever01", "First", "114Z", "online");
    expect(ed2).toMatchObject({
      editionId: "ed2",
      gridSize: 8,
      rewardScoNos: ["203Z", "204Z"],
    });

    const ed3 = classifyFcoGridEdition("triples", "Cream02", "First", "118Z", "online");
    expect(ed3).toMatchObject({
      editionId: "ed3",
      gridSize: 4,
      rewardScoNos: ["205Z", "206Z"],
    });

    // Legacy tripleS Atom01 used single SCO per edition (201Z / 202Z / 203Z)
    expect(
      classifyFcoGridEdition("triples", "Atom01", "First", "119Z", "online"),
    ).toMatchObject({
      editionId: "ed3",
      gridSize: 4,
      rewardScoNos: ["203Z"],
    });

    // Physical cards and non-First classes are not griddable
    expect(classifyFcoGridEdition("triples", "Cream02", "First", "101A", "offline")).toBeNull();
    expect(classifyFcoGridEdition("triples", "Cream02", "Double", "353Z", "online")).toBeNull();
  });

  it("identifies standard grid reward SCOs across tripleS, ARTMS, and idntt while rejecting promo SCOs", () => {
    expect(classifyGridRewardSco("triples", "Cream02", "Special", "205Z", "online")).toMatchObject({
      editionId: "ed3",
      gridSize: 4,
    });
    expect(classifyGridRewardSco("artms", "Atom02", "Special", "202Z", "online")).toMatchObject({
      editionId: "ed1",
      gridSize: 8,
    });
    expect(classifyGridRewardSco("idntt", "Summer26", "Special", "301Z", "online")).toMatchObject({
      editionId: "ed1",
      gridSize: 8,
    });
    // Non-grid promo / physical SCOs return null
    expect(classifyGridRewardSco("triples", "Divine01", "Special", "207Z", "online")).toBeNull();
    expect(classifyGridRewardSco("triples", "Atom01", "Special", "216Z", "online")).toBeNull();
    expect(classifyGridRewardSco("triples", "Binary01", "Special", "207A", "offline")).toBeNull();
  });

  it("separates 8-card grid FCOs from 4-card grid FCOs in swap tier & edition keys", () => {
    expect(getSwapGridTier("First", "101Z", "online")).toBe("first:online:8card");
    expect(getSwapGridTier("First", "116Z", "online")).toBe("first:online:8card");
    expect(getSwapGridTier("First", "117Z", "online")).toBe("first:online:4card");
    expect(getSwapGridTier("First", "120Z", "online")).toBe("first:online:4card");
    expect(getSwapGridTier("First", "101Z", "online")).not.toBe(
      getSwapGridTier("First", "118Z", "online"),
    );

    expect(getSwapEditionKey("Cream02", "First", "117Z", "online")).toBe(
      getSwapEditionKey("Cream02", "First", "120Z", "online"),
    );
    expect(getSwapEditionKey("Cream02", "First", "101Z", "online")).not.toBe(
      getSwapEditionKey("Cream02", "First", "110Z", "online"),
    );
    expect(getSwapEditionKey("Cream02", "Double", "353Z", "online")).not.toBe(
      getSwapEditionKey("Cream02", "Double", "350Z", "online"),
    );
  });

  it("computes exact edition and per-card Grid Lock % and Estimated Tradable Float", () => {
    // Cream02 ChaeWon 3rd Ed example: 6,984 total FCOs across 4 slots, 1,123 SCOs minted
    const ed = computeEditionGridSupply({
      fcoMints: 6984,
      scoMints: 1123,
      spunCount: 100,
      gridSize: 4,
      slotCount: 4,
    });
    expect(ed.gridsCompleted).toBe(1123);
    expect(ed.lockedFcos).toBe(4492);
    expect(ed.gridLockPct).toBe(64.3);
    expect(ed.estTradableFloat).toBe(2392);
    expect(ed.estTradableFloatPerSlot).toBe(598);

    // Per-card Cream02 ChaeWon 118Z: 1,749 minted, 1,123 grids completed -> 1,123 locked
    const card = computeCardGridSupply(1749, 1123, 26);
    expect(card.lockedCopies).toBe(1123);
    expect(card.gridLockPct).toBe(64.2);
    expect(card.estTradableFloat).toBe(600);
  });
});
