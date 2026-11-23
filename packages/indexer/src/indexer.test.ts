import { describe, expect, it } from "vitest";
import { inferAutoRoundGroup, normalizeMemberLookupKey } from "./aggregate.js";
import { normalizeMetadataV3 } from "./cosmo-metadata.js";

describe("normalizeMetadataV3", () => {
  it("parses live COSMO v3 payload into normalized collection metadata", () => {
    const parsed = normalizeMetadataV3(9419276, {
      name: "Ever01 SeoYeon 116Z #9419276",
      description: "tripleS objekt",
      image: "https://imagedelivery.net/example/original",
      background_color: "#33ECFD",
      attributes: [
        { trait_type: "Artist", value: "tripleS" },
        { trait_type: "Class", value: "First" },
        { trait_type: "Member", value: "SeoYeon" },
        { trait_type: "Season", value: "Ever01" },
        { trait_type: "Collection", value: "116Z" },
      ],
    });

    expect(parsed).toMatchObject({
      tokenId: 9419276,
      artistId: "triples",
      rawMember: "SeoYeon",
      season: "Ever01",
      objektClass: "First",
      collectionNo: "116Z",
      onOffline: "online",
      slug: "triples-ever01-seoyeon-116z",
    });
  });
});

describe("inferAutoRoundGroup", () => {
  it("buckets FCO editions cleanly and excludes Welcome/Special/Physical from popularity", () => {
    const fcoEd1 = inferAutoRoundGroup("triples", "Cream02", "First", "105Z", "online");
    expect(fcoEd1.slug).toBe("triples-cream02-fco-ed1-digital");
    expect(fcoEd1.includeInPopularity).toBe(true);

    const fcoEd2 = inferAutoRoundGroup("triples", "Cream02", "First", "112Z", "online");
    expect(fcoEd2.slug).toBe("triples-cream02-fco-ed2-digital");
    expect(fcoEd2.includeInPopularity).toBe(true);

    const dcoPhys = inferAutoRoundGroup("triples", "Cream02", "Double", "301A", "offline");
    expect(dcoPhys.saleMechanic).toBe("physical_scan");
    expect(dcoPhys.includeInPopularity).toBe(false);

    const welcome = inferAutoRoundGroup("artms", "Atom02", "Welcome", "100Z", "online");
    expect(welcome.saleMechanic).toBe("reward");
    expect(welcome.includeInPopularity).toBe(false);
  });

  it("normalizes member names across spacing and casing", () => {
    expect(normalizeMemberLookupKey("Kim Lip")).toBe("kimlip");
    expect(normalizeMemberLookupKey("KimLip")).toBe("kimlip");
    expect(normalizeMemberLookupKey("YooYeon")).toBe("yooyeon");
  });
});
