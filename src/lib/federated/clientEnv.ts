import { getObject, putObject } from "@/lib/storage/private";
import { localClient, trainStandalone } from "./client";
import { PROFILES, generate } from "./data";
import { evaluate } from "./metrics";
import { seedFor } from "./prng";
import type { ClientHandle, EvalReport, Example, LocalConfig } from "./types";

/**
 * THE CLIENT SIDE. This is the only module that reads a client's dataset. In a real deployment it would run
 * inside the client's own environment and the coordinator would reach it over an authenticated channel; here it
 * is simulated in-process, which is why every page says "simulated programme". Data is written to a per-client
 * object that no route serves, and what leaves this module is limited to: a weight delta with an example count,
 * and, for the standalone baseline, evaluation metrics on the public holdout. Never rows, labels or weights of a
 * model trained only on the client's data.
 */
const keyFor = (orgId: string) => `fl/clients/${orgId}.json`;

export async function provisionDataset(orgId: string, profile: string, programmeId: string): Promise<{ n: number }> {
  const p = PROFILES[profile];
  if (!p) throw new Error("unknown dataset profile");
  const data = generate(p, seedFor(programmeId, orgId, "client-data"));
  await putObject(keyFor(orgId), new TextEncoder().encode(JSON.stringify(data)));
  return { n: data.length };
}

async function load(orgId: string): Promise<Example[]> {
  return JSON.parse((await getObject(keyFor(orgId))).toString("utf8")) as Example[];
}

export function trainingHandle(ref: string, orgId: string): ClientHandle {
  return {
    ref,
    async train(global, modelVersion, cfg) {
      return localClient(ref, await load(orgId)).train(global, modelVersion, cfg);
    },
  };
}

/** What this client could achieve alone, evaluated on the public holdout. Only the metrics leave. */
export async function evaluateAlone(orgId: string, holdout: Example[], cfg: LocalConfig, rounds: number): Promise<EvalReport> {
  return evaluate(trainStandalone(await load(orgId), cfg, rounds), holdout);
}
