import { z } from "zod";

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Expected 6-digit hex color like #22AEFF");

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

export const MemberCurationSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  memberOrder: z.number().int().positive(),
  name: z.string().min(1),
  fullName: z.string().min(1),
  cosmoName: z.string().min(1),
  hexColor: HexColorSchema,
  revealDate: IsoDateSchema,
});

export const ArtistCurationSchema = z.object({
  id: z.enum(["triples", "artms"]),
  name: z.string().min(1),
  cosmoArtistName: z.string().min(1),
  isPrimary: z.boolean(),
  accentColor: HexColorSchema,
  debutDate: IsoDateSchema,
  members: z.array(MemberCurationSchema).min(1),
});

export const SaleMechanicSchema = z.enum([
  "member_select",
  "random_pack",
  "unit_select",
  "unit_random",
  "physical_scan",
  "reward",
]);

export const RoundCurationSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be lowercase kebab-case"),
  title: z.string().min(1),
  season: z.string().min(1),
  objektClass: z.enum([
    "First",
    "Double",
    "Special",
    "Premier",
    "Motion",
    "Unit",
    "Welcome",
    "Mixed",
  ]),
  onOffline: z.enum(["online", "offline"]).default("online"),
  saleMechanic: SaleMechanicSchema,
  startAt: z.string().min(10),
  endAt: z.string().min(10).optional(),
  unitPriceUsd: z.number().nonnegative().optional(),
  includeInPopularity: z.boolean().optional(),
  collectionMatchers: z.object({
    seasons: z.array(z.string()).min(1),
    collectionNos: z.array(z.string()).min(1),
    memberIds: z.array(z.string()).optional(),
  }),
  notes: z.string().optional(),
});

export const RoundFileCurationSchema = z.object({
  artistId: z.enum(["triples", "artms"]),
  rounds: z.array(RoundCurationSchema),
});

export const EventCategorySchema = z.enum([
  "comeback",
  "gravity",
  "subunit",
  "variety",
  "viral",
  "tour",
  "hiatus",
  "controversy",
  "reveal",
]);

export const EventCurationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "Event id must be lowercase kebab-case"),
  eventDate: IsoDateSchema,
  endDate: IsoDateSchema.optional(),
  category: EventCategorySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  members: z.array(z.string()).default([]),
});

export const EventFileCurationSchema = z.object({
  artistId: z.enum(["triples", "artms"]),
  events: z.array(EventCurationSchema),
});

export type ArtistCuration = z.infer<typeof ArtistCurationSchema>;
export type MemberCuration = z.infer<typeof MemberCurationSchema>;
export type RoundCuration = z.infer<typeof RoundCurationSchema>;
export type EventCuration = z.infer<typeof EventCurationSchema>;
export type SaleMechanic = z.infer<typeof SaleMechanicSchema>;
export type EventCategory = z.infer<typeof EventCategorySchema>;
