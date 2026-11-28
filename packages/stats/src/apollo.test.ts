import { describe, expect, it } from "vitest";
import {
  applyApolloToRoundMeta,
  buildEnrichedRoundTitle,
  classifyApolloProvenance,
  makeApolloDropKey,
  toApolloSlug,
} from "./apollo.js";

describe("Apollo slug and provenance helpers", () => {
  it("formats Apollo slugs matching apollo.cafe conventions", () => {
    expect(toApolloSlug("Divine01", "NaKyoung", "338Z")).toBe("divine01-nakyoung-338z");
    expect(toApolloSlug("Atom01", "Kim Lip", "101Z")).toBe("atom01-kimlip-101z");
    expect(toApolloSlug("Cream02", "ChaeWon", "358Z")).toBe("cream02-chaewon-358z");
    expect(makeApolloDropKey("tripleS", "Divine01", "338z")).toBe("triples|divine01|338Z");
  });

  it("classifies COSMO Talk Pass+ drops automatically across any month", () => {
    const aug = classifyApolloProvenance({
      artistId: "triples",
      season: "Cream02",
      collectionNo: "358Z",
      objektClass: "Double",
      onOffline: "online",
      description: "Gifted to tripleS Pass+ subscribers for August 2026.",
      eventSlug: "triples-pass-august-2026",
      eventName: "tripleS Pass+ August 2026",
      eventType: "merch",
      eventDescription: "Part of the tripleS Pass+ subscription",
    });
    expect(aug.provenanceClass).toBe("pass_plus");
    expect(aug.isFreeDistribution).toBe(false);
    expect(aug.passBillingMonth).toBe("2026-08");
    expect(aug.passBillingLabel).toBe("Aug 2026 tripleS Pass+");

    const dec = classifyApolloProvenance({
      artistId: "artms",
      season: "Atom02",
      collectionNo: "399Z",
      objektClass: "Double",
      onOffline: "online",
      description: "Gifted to ARTMS Pass+ subscribers for December 2026.",
      eventSlug: "artms-pass-december-2026",
      eventName: "ARTMS Pass+ December 2026",
      eventType: "merch",
      eventDescription: "Part of the ARTMS Pass+ subscription",
    });
    expect(dec.provenanceClass).toBe("pass_plus");
    expect(dec.passBillingMonth).toBe("2026-12");
    expect(dec.passBillingLabel).toBe("Dec 2026 ARTMS Pass+");
  });

  it("classifies free promotional voting drops and shop set-completion bonuses as free_reward", () => {
    const winGift = classifyApolloProvenance({
      artistId: "triples",
      season: "Atom02",
      collectionNo: "320Z",
      objektClass: "Double",
      onOffline: "online",
      description:
        "Gifted on May 22, 2025 to everyone who participated in THE SHOW Pre-voting or Live Voting to commemorate Are You Alive's 1st win.",
      eventSlug: "triples-are-you-alive-1st-win",
      eventName: "Are You Alive 1st Win",
      eventType: "promotional",
      eventDescription: "Gifted to everyone who participated...",
    });
    expect(winGift.provenanceClass).toBe("free_reward");
    expect(winGift.isFreeDistribution).toBe(true);

    const setBonus = classifyApolloProvenance({
      artistId: "artms",
      season: "Atom02",
      collectionNo: "371Z",
      objektClass: "Double",
      onOffline: "online",
      description: "Gifted to Autumn Breeze Event 368-370Z set owners.",
      eventSlug: "artms-autumn-breeze",
      eventName: "Autumn Breeze",
      eventType: "shop",
      eventDescription: "Autumn themed shop event objekts featuring HaSeul and Kim Lip with set completion bonus.",
    });
    expect(setBonus.provenanceClass).toBe("free_reward");
    expect(setBonus.isFreeDistribution).toBe(true);

    const seasonalRankingDco = classifyApolloProvenance({
      artistId: "triples",
      season: "Divine02",
      collectionNo: "305Z",
      objektClass: "Double",
      onOffline: "online",
      description:
        "Gifted during the Cream02 season for ranking top 100 in Objekts for a member.",
      eventSlug: "triples-divine02-seasonal",
      eventName: "Divine02 Seasonal",
      eventType: "seasonal",
      eventDescription: "Welcome & Premier class objekts available throughout the season.",
    });
    expect(seasonalRankingDco.provenanceClass).toBe("free_reward");
    expect(seasonalRankingDco.isFreeDistribution).toBe(true);

    const seasonalPremier = classifyApolloProvenance({
      artistId: "triples",
      season: "Divine02",
      collectionNo: "402Z",
      objektClass: "Premier",
      onOffline: "online",
      description:
        "Gifted during the Cream02 season for ranking top 10 in Objekts, Gravity, or Grid; or ranking top 50 in Offline Badges. Randomly obtained from Divine02 FCO packs in the COSMO shop or from Spin.",
      eventSlug: "triples-divine02-seasonal",
      eventName: "Divine02 Seasonal",
      eventType: "seasonal",
      eventDescription: "Welcome & Premier class objekts available throughout the season.",
    });
    expect(seasonalPremier.provenanceClass).toBe("free_reward");
    expect(seasonalPremier.isFreeDistribution).toBe(true);
  });

  it("preserves paid seasonal FCOs, paid shop DCOs, physical scans, and dual fanclub/shop drops", () => {
    const fco = classifyApolloProvenance({
      artistId: "triples",
      season: "Divine01",
      collectionNo: "101Z",
      objektClass: "First",
      onOffline: "online",
      description: "Sold on the COSMO app shop. Gifted throughout various events on Discord.",
      eventSlug: "triples-divine01-first",
      eventName: "Divine01 1st Edition",
      eventType: "seasonal",
      eventDescription: "1st edition First & Special class objekts available throughout the season.",
    });
    expect(fco.provenanceClass).toBe("shop_paid");
    expect(fco.isFreeDistribution).toBe(false);

    const shopDco = classifyApolloProvenance({
      artistId: "triples",
      season: "Cream02",
      collectionNo: "373Z",
      objektClass: "Double",
      onOffline: "online",
      description: "Autumn Breeze Event, sold on the COSMO app shop.",
      eventSlug: "triples-autumn-breeze",
      eventName: "Autumn Breeze",
      eventType: "shop",
      eventDescription: "Autumn themed shop event objekts.",
    });
    expect(shopDco.provenanceClass).toBe("shop_paid");

    const dual = classifyApolloProvenance({
      artistId: "triples",
      season: "Divine01",
      collectionNo: "338Z",
      objektClass: "Double",
      onOffline: "online",
      description: "WAV 1st fanclub, dropped on October 31st 2024 and later sold in the COSMO app shop.",
      eventSlug: "wav-1st-fanclub",
      eventName: "WAV 1st Fanclub",
      eventType: "shop",
      eventDescription: "WAV 1st fanclub objekts dropped to members and later sold in the COSMO app shop.",
    });
    expect(dual.provenanceClass).toBe("dual_distribution");
    expect(dual.isFreeDistribution).toBe(false);

    const physical = classifyApolloProvenance({
      artistId: "triples",
      season: "Divine01",
      collectionNo: "322A",
      objektClass: "Double",
      onOffline: "offline",
      description: "Part of <ASSEMBLE24> Objekt Music Album ver2",
      eventSlug: "assemble24-oma-ver2",
      eventName: "<ASSEMBLE24> Objekt Music Album ver2",
      eventType: "album",
      eventDescription: "Physical objekts found in the ASSEMBLE24 Objekt Music Album ver2.",
    });
    expect(physical.provenanceClass).toBe("physical_merch");
    expect(physical.isFreeDistribution).toBe(false);
  });

  it("excludes free rewards and Pass+ subscriptions from Sale Round popularity trends", () => {
    const bonusRound = applyApolloToRoundMeta({
      objektClass: "Double",
      onOffline: "online",
      baseSaleMechanic: "unit_select",
      baseIncludeInPopularity: true,
      baseUnitPriceUsd: 3.29,
      provenance: {
        dropKey: "artms|atom02|371Z",
        sampleApolloSlug: "atom02-kimlip-371z",
        artistId: "artms",
        season: "Atom02",
        collectionNo: "371Z",
        description: "Gifted to Autumn Breeze Event 368-370Z set owners.",
        eventSlug: "artms-autumn-breeze",
        eventName: "Autumn Breeze",
        eventType: "shop",
        eventDescription: null,
        twitterUrl: null,
        eraSlug: "hyper-ego",
        eraName: "<Hyper-Ego>",
        eraImageUrl: null,
        provenanceClass: "free_reward",
        passBillingMonth: null,
        passBillingLabel: null,
        isFreeDistribution: true,
      },
    });
    expect(bonusRound.saleMechanic).toBe("reward");
    expect(bonusRound.includeInPopularity).toBe(false);
    expect(bonusRound.unitPriceUsd).toBe(0);

    expect(
      buildEnrichedRoundTitle({
        fallbackTitle: "Atom02 DCO 371Z",
        season: "Atom02",
        objektClass: "Double",
        collectionNo: "371Z",
        apolloEventName: "Autumn Breeze",
        apolloDescription: "Gifted to Autumn Breeze Event 368-370Z set owners.",
        provenanceClass: "free_reward",
      }),
    ).toBe("Autumn Breeze Bonus (Atom02 371Z)");
  });

  it("classifies mid-sentence gifted holders, Abstract follower airdrop, dual fanclub, and unit-random packs", () => {
    const midGift = classifyApolloProvenance({
      artistId: "artms",
      season: "Cream01",
      collectionNo: "354Z",
      objektClass: "Double",
      onOffline: "online",
      description: "2025 April Fools' Day Event, gifted to 355Z holders.",
      eventSlug: "artms-april-fools-2025",
      eventName: "April Fools' Day 2025",
      eventType: "shop",
      eventDescription: null,
    });
    expect(midGift.provenanceClass).toBe("free_reward");
    expect(midGift.isFreeDistribution).toBe(true);

    const abstractDrop = classifyApolloProvenance({
      artistId: "triples",
      season: "Atom02",
      collectionNo: "341Z",
      objektClass: "Double",
      onOffline: "online",
      description:
        "Abstract Event, sold on the COSMO app shop. Gifted to everyone who followed tripleS on the COSMO app before April 18, 2025.",
      eventSlug: "triples-abstract",
      eventName: "Abstract",
      eventType: "shop",
      eventDescription: null,
    });
    expect(abstractDrop.provenanceClass).toBe("dual_distribution");

    const msnzAnniv = applyApolloToRoundMeta({
      objektClass: "Double",
      onOffline: "online",
      baseSaleMechanic: "member_select",
      baseIncludeInPopularity: true,
      baseUnitPriceUsd: 3.29,
      provenance: {
        dropKey: "triples|cream02|354Z",
        sampleApolloSlug: "cream02-seoyeon-354z",
        artistId: "triples",
        season: "Cream02",
        collectionNo: "354Z",
        description: "msnz 1st Anniversary Event, sold on the COSMO app shop.",
        eventSlug: "triples-msnz-1st-anniversary",
        eventName: "msnz 1st Anniversary",
        eventType: "shop",
        eventDescription: null,
        twitterUrl: null,
        eraSlug: null,
        eraName: null,
        eraImageUrl: null,
        provenanceClass: "shop_paid",
        passBillingMonth: null,
        passBillingLabel: null,
        isFreeDistribution: false,
      },
    });
    expect(msnzAnniv.saleMechanic).toBe("unit_random");
    expect(msnzAnniv.includeInPopularity).toBe(false);
    expect(msnzAnniv.unitPriceUsd).toBe(3.29);

    const fanclubRound = applyApolloToRoundMeta({
      objektClass: "Double",
      onOffline: "online",
      baseSaleMechanic: "member_select",
      baseIncludeInPopularity: true,
      baseUnitPriceUsd: 3.29,
      provenance: {
        dropKey: "triples|divine01|338Z",
        sampleApolloSlug: "divine01-nakyoung-338z",
        artistId: "triples",
        season: "Divine01",
        collectionNo: "338Z",
        description:
          "WAV 1st fanclub, dropped on October 31st 2024 and later sold in the COSMO app shop.",
        eventSlug: "wav-1st-fanclub",
        eventName: "WAV 1st Fanclub",
        eventType: "shop",
        eventDescription: null,
        twitterUrl: null,
        eraSlug: null,
        eraName: null,
        eraImageUrl: null,
        provenanceClass: "dual_distribution",
        passBillingMonth: null,
        passBillingLabel: null,
        isFreeDistribution: false,
      },
    });
    expect(fanclubRound.saleMechanic).toBe("dual_distribution");
    expect(fanclubRound.includeInPopularity).toBe(false);
  });
});
