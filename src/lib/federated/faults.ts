import type { ClientHandle } from "./types";

/**
 * Injected faults, for the demonstration and the tests ONLY. They wrap an honest client to behave badly so the
 * coordinator's defences can be shown working. Every run that uses one is labelled "injected fault".
 */
export type FaultKind = "dropout" | "sign_flip" | "scale_up" | "wrong_model_version" | "wrong_schema" | "non_finite";

export const FAULT_LABEL: Record<FaultKind, string> = {
  dropout: "Client drops out (no response)",
  sign_flip: "Poisoning: update direction reversed and amplified",
  scale_up: "Poisoning: update scaled up 100×",
  wrong_model_version: "Invalid: update for a different model version",
  wrong_schema: "Invalid: trained on a different feature schema",
  non_finite: "Invalid: update contains NaN",
};

export function injectFault(client: ClientHandle, kind: FaultKind): ClientHandle {
  return {
    ref: client.ref,
    async train(global, version, cfg) {
      if (kind === "dropout") throw new Error("injected dropout");
      const u = await client.train(global, version, cfg);
      switch (kind) {
        case "sign_flip": return { ...u, delta: u.delta.map((v) => -3 * v) };
        case "scale_up": return { ...u, delta: u.delta.map((v) => 100 * v) };
        case "wrong_model_version": return { ...u, modelVersion: `${version}-stale` };
        case "wrong_schema": return { ...u, schemaVersion: "other_schema_v9" };
        case "non_finite": return { ...u, delta: u.delta.map((v, i) => (i === 2 ? NaN : v)) };
      }
    },
  };
}
