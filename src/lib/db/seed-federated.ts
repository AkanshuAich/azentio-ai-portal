import { randomBytes } from "node:crypto";
import type { Db } from "./client";
import * as s from "./schema";
import { DEFAULT_AGG } from "../federated/aggregate";
import { DEFAULT_RUN } from "../federated/coordinator";
import { provisionDataset } from "../federated/clientEnv";
import { CONSENT_VERSION } from "../federated/service";
import { SCHEMA_VERSION } from "../federated/types";

export const PROGRAMME_CONFIG = { rounds: DEFAULT_RUN.rounds, local: DEFAULT_RUN.local, agg: DEFAULT_AGG };

type U = { id: string };
type O = { id: string };

/**
 * The simulated federated programme. Three organisations are enrolled (exactly the minimum cohort) so the
 * dropout and quorum behaviour can be shown; a fourth, Atlas, enrols live through its own administrator.
 */
export async function seedFederated(db: Db, a: { creator: U; orgs: Array<{ org: O; admin: U; profile: string }> }) {
  const [programme] = await db.insert(s.flProgrammes).values({
    name: "Seasonality context model",
    description: "A simulated programme in which clients jointly train a small model that separates seasonal artefacts from genuine deterioration in quarter-on-quarter declines. Synthetic data only; nothing here is a deployed or approved credit model.",
    schemaVersion: SCHEMA_VERSION, minCohort: 3, config: PROGRAMME_CONFIG, createdBy: a.creator.id,
  }).returning();
  for (const e of a.orgs) {
    await provisionDataset(e.org.id, e.profile, programme.id);
    await db.insert(s.flEnrolments).values({
      programmeId: programme.id, orgId: e.org.id, participantRef: `P-${randomBytes(3).toString("hex")}`, status: "enrolled",
      profile: e.profile, consentVersion: CONSENT_VERSION, enrolledBy: e.admin.id,
    });
  }
}
