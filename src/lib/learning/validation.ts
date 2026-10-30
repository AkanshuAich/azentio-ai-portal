import { z } from "zod";

// Shared by the browser and the server so the same limits apply in both places.
export const KINDS = [
  "market_observation", "emerging_trend", "product_gap", "operational_challenge", "successful_practice", "improvement_suggestion",
] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  market_observation: "Market observation",
  emerging_trend: "Emerging trend",
  product_gap: "Product gap",
  operational_challenge: "Operational challenge",
  successful_practice: "Successful practice",
  improvement_suggestion: "Improvement suggestion",
};
export const EVIDENCE_TYPES = ["client_experience", "internal_data_summary", "industry_report", "regulatory_change", "anecdotal", "other"] as const;
export const EVIDENCE_LABEL: Record<(typeof EVIDENCE_TYPES)[number], string> = {
  client_experience: "Client experience",
  internal_data_summary: "Summary of internal data",
  industry_report: "Industry report",
  regulatory_change: "Regulatory change",
  anecdotal: "Anecdotal",
  other: "Other",
};
export const CONFIDENCE = ["low", "medium", "high"] as const;
export const SHARING = ["private", "organisation", "propose_shared"] as const;
export const SHARING_LABEL: Record<(typeof SHARING)[number], string> = {
  private: "Private to me",
  organisation: "Within my organisation",
  propose_shared: "Propose to the approved learning community",
};

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

/** A draft needs very little: it is private, so only the length limits and a title are enforced. */
export const draftSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(3, "Give it a short title").max(140, "Keep the title under 140 characters"),
  body: z.string().trim().max(4000, "Keep the description under 4000 characters"),
  offering: z.string().trim().min(1, "Choose an offering").max(80),
  industry: opt(80),
  region: opt(80),
  observationPeriod: opt(40),
  evidenceType: z.enum(EVIDENCE_TYPES).optional(),
  confidence: z.enum(CONFIDENCE).optional(),
  sharingChoice: z.enum(SHARING).default("private"),
});
export type DraftInput = z.infer<typeof draftSchema>;

/** Submitting for review is stricter: every field a reviewer needs must be present. */
export const submitSchema = draftSchema.extend({
  body: z.string().trim().min(30, "Describe it in at least 30 characters").max(4000),
  industry: z.string().trim().min(1, "Say which industry this relates to").max(80),
  region: z.string().trim().min(1, "Say which region this relates to").max(80),
  observationPeriod: z.string().trim().min(1, "Say what period this covers, e.g. 2026-H1").max(40),
  evidenceType: z.enum(EVIDENCE_TYPES, { message: "Say what kind of evidence this is" }),
  confidence: z.enum(CONFIDENCE, { message: "Say how confident you are" }),
  sharingChoice: z.literal("propose_shared", { message: "Only a contribution proposed to the learning community is submitted for review" }),
});

/** The four independent permissions. Membership, publishing and training are not interchangeable. */
export const consentSchema = z.object({
  store_process: z.boolean(),
  publish_shared: z.boolean(),
  attribution: z.boolean(),
  model_training: z.boolean(),
});
export type ConsentInput = z.infer<typeof consentSchema>;
export const CONSENT_KINDS = ["store_process", "publish_shared", "attribution", "model_training"] as const;

export const CONSENT_COPY: Record<(typeof CONSENT_KINDS)[number], { label: string; text: string; required: "always" | "to_submit" | "no" }> = {
  store_process: { label: "Store and process this contribution", text: "We store your private draft and process it so you can edit and submit it.", required: "always" },
  publish_shared: { label: "Publish a reviewed, de-identified version", text: "A moderator may publish a reviewed, de-identified version to the approved learning community. Without this, it can't be submitted.", required: "to_submit" },
  attribution: { label: "Show my organisation's name on it", text: "Optional. Your organisation would be named on the shared version, and a moderator must also approve that. Off by default.", required: "no" },
  model_training: { label: "Allow it to be used to train models (future programme)", text: "Optional and separate. No model is trained on contributions today. This only records your choice for any future, separately approved programme. Off by default.", required: "no" },
};

export const reviewDraftSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(4000),
  offering: z.string().trim().min(1).max(80),
  industry: opt(80),
  region: opt(80),
  observationPeriod: opt(40),
  evidenceType: z.enum(EVIDENCE_TYPES).optional(),
  confidence: z.enum(CONFIDENCE).optional(),
  attribution: z.enum(["anonymous", "organisation"]).default("anonymous"),
  evidenceQuality: z.enum(["strong", "moderate", "limited"]).optional(),
  topic: z.enum(KINDS).optional(),
});
export type ReviewDraftInput = z.infer<typeof reviewDraftSchema>;

export const publicReasonSchema = z.object({ reason: z.string().trim().min(5, "Give the author a clear reason").max(600) });
