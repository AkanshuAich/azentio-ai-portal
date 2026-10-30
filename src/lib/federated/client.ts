import { subtract, trainLocal, zeros } from "./model";
import { SCHEMA_VERSION, type ClientHandle, type Example, type LocalConfig, type Weights } from "./types";

/**
 * The client side of the programme: local training on data that stays here. Given a global model, it returns only
 * a weight delta and an example count. Nothing in the returned update identifies a row, a label or an organisation.
 * Records with a missing or non-finite feature are dropped before training (the schema allows no missing values).
 */
export function cleanExamples(data: Example[]): Example[] {
  return data.filter((e) => e.x.every((v) => Number.isFinite(v)));
}

export function localClient(ref: string, data: Example[]): ClientHandle {
  return {
    ref,
    async train(global, modelVersion, cfg) {
      const rows = cleanExamples(data);
      if (rows.length === 0) throw new Error("no usable local data");
      const trained = trainLocal(global, rows, cfg);
      return { schemaVersion: SCHEMA_VERSION, modelVersion, delta: subtract(trained, global), nExamples: rows.length };
    },
  };
}

/** Baseline: what one client could do alone, with the same number of total local steps as the programme. */
export function trainStandalone(data: Example[], cfg: LocalConfig, rounds: number): Weights {
  return trainLocal(zeros(), cleanExamples(data), { ...cfg, epochs: cfg.epochs * rounds });
}
