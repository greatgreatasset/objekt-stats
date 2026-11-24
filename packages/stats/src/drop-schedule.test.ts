import { describe, expect, it } from "vitest";
import {
  classifyDropSchedule,
  computeDropProgressPct,
  formatDropCountdown,
  formatDropWindow,
  parseApolloEventsHtml,
  type DropScheduleEntry,
} from "./drop-schedule.js";

const SAMPLE_APOLLO_HTML = `
matches:$R[10]=[{l:$R[13]={activeEvents:$R[14]=[
  $R[15]={id:"1",createdAt:$R[16]=new Date("2026-11-19T01:05:06.026Z"),eraId:"era-1",slug:"triples-divine02-motion-1st-edition",name:"Divine02 Motion 1st Edition ",description:"1st edition Motion class objekts.",artist:"tripleS",eventType:"seasonal",twitterUrl:null,discordUrl:null,startDate:$R[17]=new Date("2026-11-26T01:15:00.000Z"),endDate:null,imageUrl:null},
  $R[18]={id:"2",createdAt:$R[19]=new Date("2026-11-19T01:04:32.000Z"),eraId:"era-1",slug:"triples-divine02-1st-edition",name:"Divine02 1st Edition",description:"1st edition FCO.",artist:"tripleS",eventType:"seasonal",twitterUrl:null,discordUrl:null,startDate:$R[20]=new Date("2026-11-26T01:00:00.000Z"),endDate:null,imageUrl:null},
  $R[21]={id:"3",createdAt:$R[22]=new Date("2026-11-19T01:03:00.000Z"),eraId:"era-1",slug:"triples-divine02-seasonal",name:"Divine02 Seasonal",description:"Season umbrella.",artist:"tripleS",eventType:"seasonal",twitterUrl:"https://x.com/triplescosmos/status/1",discordUrl:null,startDate:$R[23]=new Date("2026-11-26T01:00:00.000Z"),endDate:null,imageUrl:null},
  $R[24]={id:"4",createdAt:$R[25]=new Date("2026-11-24T00:00:00.000Z"),eraId:"era-1",slug:"triples-msnz-1st-anniversary",name:"msnz 1st Anniversary",description:"24h shop drop.",artist:"tripleS",eventType:"shop",twitterUrl:"https://x.com/triplescosmos/status/2",discordUrl:null,startDate:$R[26]=new Date("2026-11-24T01:00:00.000Z"),endDate:$R[27]=new Date("2026-11-25T02:30:00.000Z"),imageUrl:"https://cdn.apollo.cafe/event/a.jpg"},
  $R[28]={id:"5",createdAt:$R[29]=new Date("2026-10-10T00:00:00.000Z"),eraId:"era-1",slug:"andless-world-tour",name:"\\x3CANDLESS> World Tour",description:null,artist:"tripleS",eventType:"tour",twitterUrl:null,discordUrl:null,startDate:$R[30]=new Date("2026-10-10T09:00:00.000Z"),endDate:$R[31]=new Date("2026-11-29T14:59:00.000Z"),imageUrl:null},
  $R[32]={id:"6",createdAt:$R[33]=new Date("2026-11-20T00:00:00.000Z"),eraId:"era-1",slug:"triples-hatchi-2nd-anniversary",name:"Hatchi 2nd Anniversary",description:null,artist:"tripleS",eventType:"shop",twitterUrl:null,discordUrl:null,startDate:$R[34]=new Date("2026-11-20T01:00:00.000Z"),endDate:$R[35]=new Date("2026-11-21T01:00:00.000Z"),imageUrl:null},
  $R[36]={id:"7",createdAt:$R[37]=new Date("2026-10-01T00:00:00.000Z"),eraId:"era-2",slug:"idntt-autumn26-seasonal",name:"Autumn26 Seasonal",description:null,artist:"idntt",eventType:"seasonal",twitterUrl:null,discordUrl:null,startDate:$R[38]=new Date("2026-10-01T01:00:00.000Z"),endDate:$R[39]=new Date("2027-01-01T01:00:00.000Z"),imageUrl:null}
]}}];
`;

describe("drop-schedule", () => {
  it("parses Apollo SSR events, unescapes \\x3C, and filters out non-tracked artists", () => {
    const parsed = parseApolloEventsHtml(SAMPLE_APOLLO_HTML);
    expect(parsed).toHaveLength(6);
    expect(parsed.find((e) => e.slug === "andless-world-tour")?.name).toBe(
      "<ANDLESS> World Tour",
    );
    expect(
      parsed.find((e) => e.slug === "triples-divine02-motion-1st-edition")?.name,
    ).toBe("Divine02 Motion 1st Edition");
    expect(
      parsed.find((e) => e.slug === "triples-msnz-1st-anniversary")?.imageUrl,
    ).toBe("https://cdn.apollo.cafe/event/a.jpg");
    expect(parsed.some((e) => e.slug.includes("idntt"))).toBe(false);
  });

  it("classifies active, upcoming, and past drops, prioritizes shop drops, and prunes redundant seasonal umbrellas", () => {
    const parsed = parseApolloEventsHtml(SAMPLE_APOLLO_HTML);
    const entries: DropScheduleEntry[] = parsed.map((p) => ({
      ...p,
      status: "past",
      linkedRoundSlug: null,
      linkedRoundTitle: null,
      linkedRoundMints: null,
      linkedRoundBuyers: null,
    }));

    const nowMs = Date.parse("2026-11-24T14:00:00.000Z");
    const result = classifyDropSchedule(entries, nowMs);

    expect(result.featuredActive?.slug).toBe("triples-msnz-1st-anniversary");
    expect(result.active.map((a) => a.slug)).toEqual([
      "triples-msnz-1st-anniversary",
      "andless-world-tour",
    ]);
    // Redundant `triples-divine02-seasonal` umbrella pruned because specific editions exist
    expect(result.upcoming.map((u) => u.slug)).toEqual([
      "triples-divine02-1st-edition",
      "triples-divine02-motion-1st-edition",
    ]);
    expect(result.past.map((p) => p.slug)).toEqual([
      "triples-hatchi-2nd-anniversary",
    ]);
  });

  it("formats countdowns, date windows, and progress percentages cleanly", () => {
    const nowMs = Date.parse("2026-11-24T14:00:00.000Z");
    expect(
      formatDropCountdown("2026-11-25T02:30:15.000Z", nowMs, {
        includeSeconds: true,
      }),
    ).toBe("12h 30m 15s");
    expect(
      formatDropCountdown("2026-11-26T01:00:00.000Z", nowMs, {
        includeSeconds: true,
      }),
    ).toBe("1d 11h 00m");
    expect(formatDropCountdown("2026-11-24T13:00:00.000Z", nowMs)).toBeNull();

    expect(
      formatDropWindow(
        "2026-11-24T01:00:00.000Z",
        "2026-11-25T02:30:00.000Z",
        nowMs,
      ),
    ).toBe("Nov 24 – Nov 25");
    expect(
      formatDropWindow(
        "2026-07-29T01:00:00.000Z",
        "2027-02-19T04:50:00.000Z",
        nowMs,
      ),
    ).toBe("Jul 29 – Feb 19, 2027");

    const pct = computeDropProgressPct(
      "2026-11-24T00:00:00.000Z",
      "2026-11-25T00:00:00.000Z",
      Date.parse("2026-11-24T12:00:00.000Z"),
    );
    expect(pct).toBeCloseTo(50, 5);
  });
});
