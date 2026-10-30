import { getObject, putObject } from "@/lib/storage/private";
import { evaluateAlone, provisionDataset, trainingHandle } from "./clientEnv";
import { generateHoldout } from "./data";
import { seedFor } from "./prng";
import type { ClientHandle, EvalReport, Example, LocalConfig } from "./types";

/**
 * The boundary between the coordinator's service and the simulated client environments. The service sees only
 * handles (a pseudonymous ref and a train() function) and metrics; it never imports the client data module.
 */
export interface Participant { ref: string; orgId: string }

export const provisionClient = provisionDataset;

export const buildClients = (ps: Participant[]): ClientHandle[] => ps.map((p) => trainingHandle(p.ref, p.orgId));

export async function standaloneBaselines(ps: Participant[], holdout: Example[], cfg: LocalConfig, rounds: number): Promise<Record<string, EvalReport>> {
  const out: Record<string, EvalReport> = {};
  for (const p of ps) out[p.ref] = await evaluateAlone(p.orgId, holdout, cfg, rounds);
  return out;
}

/** The evaluation set belongs to the coordinator: synthetic, shared with nobody for training, stored apart from every client. */
const holdoutKey = (programmeId: string) => `fl/holdout/${programmeId}.json`;

export async function holdoutFor(programmeId: string): Promise<Example[]> {
  try {
    return JSON.parse((await getObject(holdoutKey(programmeId))).toString("utf8")) as Example[];
  } catch {
    const data = generateHoldout(seedFor(programmeId, "holdout"));
    await putObject(holdoutKey(programmeId), new TextEncoder().encode(JSON.stringify(data)));
    return data;
  }
}
