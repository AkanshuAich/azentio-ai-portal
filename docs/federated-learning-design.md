# Federated model-learning track (P2): design and what was built

> **Status: a simulated demonstration is built** (sections 1 to 8 are the design; **section 9 says exactly what was
> built, what differs from the design, and what is still only designed**). The brief makes this track optional and
> says a discussion board or central document repository is *not* federated learning. The collective-learning hub
> (contributions, moderation, shared feed, themes, AIRA) is a separate, required workflow and trains nothing.
> **Secure aggregation is not implemented**, and no formal privacy guarantee is claimed unless a run switches
> noise on and shows its accountant. Everything runs on synthetic data, simulated in-process.

## 1. Separation from the collective-learning hub

| | Collective learning hub (built) | Federated programme (this design) |
|---|---|---|
| Data | reviewed, de-identified text | numeric model updates from local training |
| Consent | per contribution (publish, attribution, training flag) | **programme-level opt-in**, separate from any contribution |
| Raw client records | never centralised | never leave the client environment |
| AI | retrieval + summarisation (no retraining) | trains a candidate model |

The `model_training` consent already recorded on contributions is **not** programme participation. Participation is a
separate, explicit, revocable enrolment.

## 2. Minimum credible demonstration

- **Task.** A small supervised task on synthetic data: classify whether a quarter-on-quarter decline is a *seasonal
  artefact* or a genuine deterioration (the same story as the Playground and the Seasonality theme).
- **Model.** Regularised logistic regression (convex, small, easy to reason about). Feature schema versioned
  (`seasonality_v1`: QoQ change, YoY change, seasonal strength estimate, revenue volatility, leverage, current ratio),
  with documented units, ranges and missing-value handling. Compatibility rule: a client update is accepted only for the
  same `schema_version` and `model_version`.
- **Participants.** At least three isolated synthetic client datasets, deliberately **non-IID** (different seasonal
  mixes and class balance), plus a separate synthetic **holdout** that no participant trains on.
- **Rounds.** (1) coordinator publishes global weights `w_t`; (2) each client trains locally for `E` epochs on its own
  data and returns `Δ_i = w_i − w_t`; (3) coordinator validates and clips updates, aggregates, writes `w_{t+1}`;
  (4) evaluate on the holdout and compare with a baseline (a single local model, and a centrally trained reference
  that exists **only in the experiment harness** to show the gap, never in the product).
- **Reported per round:** participating clients, weights, update norms, holdout metrics (AUC, calibration, per-slice
  error), baseline metrics, and the effect of skew (a run with one dominated client vs balanced).

## 3. Aggregation

Weighted federated averaging, `w_{t+1} = w_t + Σ (n_i / Σn) · clip(Δ_i)`, weighting by local example count `n_i`
**capped** so no client can dominate. Alternative reported alongside: unweighted mean and coordinate-wise trimmed
mean. The effect of skew is shown, not hidden: with strongly non-IID clients, plain averaging converges slower and to a
worse holdout score, and per-slice metrics expose who it serves poorly.

## 4. Validation of client updates

Rejected (and logged with a reason code, never the update contents): wrong `model_version` or `schema_version`;
shape mismatch; non-finite values; norm above the bound (after clipping the original norm is still recorded);
unauthenticated or unenrolled participant; duplicate submission for the round; late submission; participation below
the minimum cohort for the round.

**Dropout.** A round proceeds only if at least `k_min` valid updates arrive (default 3, configurable and never below
the deployment's minimum distinct-organisation threshold). A client that fails or drops is recorded as
`dropped`; the round either completes with the remaining quorum or is abandoned, and either outcome is logged. A
failed-participant scenario is part of the demonstration.

## 5. Threat model for the programme

| Threat | Design response | Honest label |
|---|---|---|
| **Update leakage** (gradients/updates can reveal training data) | clipping bounds each client's influence; secure aggregation hides individual updates from the coordinator; differential privacy bounds what the aggregate reveals | *Secure aggregation: designed (pairwise masking, dropout-tolerant, minimum cohort). In a demo it would be simulated and labelled **simulated**.* |
| **Poisoning / backdoors** | norm bounds, cosine-similarity outlier screening against the cohort median, trimmed-mean aggregation, per-client contribution caps, holdout regression gate before any candidate is registered | detection reduces risk; it does not eliminate it |
| **Free-riding / sybils** | enrolment tied to an authenticated, approved client organisation (the existing tenant identity); one participant per organisation | |
| **Model inversion / membership inference** | DP noise on the aggregate with a **declared** privacy accountant (ε, δ, clipping norm, noise multiplier, rounds), or no DP claim at all | *A plain averaging demo must not claim formal privacy.* If DP is not run, the programme page says "no formal privacy guarantee". |
| **Coordinator compromise** | coordinator never sees raw records; with secure aggregation it never sees individual updates; its logs hold metadata only | |
| **Skew harms** | per-slice evaluation and a documented statement of who the model may serve poorly | |

Local retention of raw data is useful but **does not by itself provide confidentiality, anonymity or regulatory
compliance.** The documentation and UI must say that.

## 6. Governance, consent, lineage

- **Enrolment record** per organisation per programme: who agreed, when, scope (task, model, schema, rounds), and the
  right to leave. Programme consent is independent of workspace membership, contribution publishing consent and
  attribution.
- **Logs (metadata only):** programme consent, participants, model and update versions, aggregation method and
  parameters, evaluation results, validation outcomes. Training examples never appear in coordinator logs or payloads.
- **Candidate registry.** Each aggregate is stored as a *candidate* with lineage (round, participants by pseudonymous
  id, parameters, holdout and baseline metrics, data and schema versions). **No candidate is deployed automatically.**
  A named human reviewer records an explicit deployment decision with a reason; a second approval is required for
  anything customer-facing.
- **Rollback.** Deployments are versioned and reversible: the previous approved model stays deployable, and a
  rollback is a single audited action that re-points to it.
- **Withdrawal policy.** A participant leaving **prevents future participation and future use of their updates** under
  the programme rules. Treatment of an *already aggregated or deployed* model is an explicit, per-programme policy
  (for example: retrain from the remaining participants within N days and retire the affected candidate). The product
  will **not** promise automatic "untraining".

## 7. Where it would sit in this codebase

New, isolated tables (`fl_programmes`, `fl_enrolments`, `fl_rounds`, `fl_updates` metadata only, `model_candidates`),
a coordinator service behind its own audience (`programme_participant`), and the same `can()` policy with a new
audience. Client training runs in the client's environment (for the hackathon, a separate process per synthetic
client with its own data directory). Nothing in the existing contribution tables is read.

## 8. Acceptance criteria for a future build

1. Three isolated synthetic datasets; local training demonstrably touches only its own data.
2. One aggregation round with reported participation, weights and update norms.
3. Holdout evaluation vs a stated baseline, plus a skewed-clients run.
4. A dropout scenario and a rejected/invalid update scenario, both logged.
5. A candidate registered, not deployed, until a human records a decision; a rollback exercised.
6. Every simulated control labelled as simulated; no secure-aggregation or privacy claim the code does not earn.
7. Consent, enrolment and withdrawal records, and a test that training data never appears in coordinator logs.

## 9. What was built, and where it differs from the design

**Where it lives.** Pure modules in `src/lib/federated/` (`data`, `model`, `metrics`, `client`, `aggregate`, `dp`,
`coordinator`, `faults`); the simulated client environment in `clientEnv.ts` and its only door, `wiring.ts`; the
service (`service.ts`) and tables `fl_programmes`, `fl_enrolments`, `fl_runs`, `fl_rounds`, `fl_updates`,
`fl_model_versions`, `fl_decisions` (migration `0010_federated.sql`). Pages: `/employee/federated` and
`/workspace/federated`. APIs: `/api/fl/*` (employee) and `/api/client/federated/*` (client).

**Acceptance criteria from section 8, and where each is checked.**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Isolated synthetic datasets; local training touches only its own data | built | `federated-pure.test.ts` (generator, heterogeneity); `federated.test.ts` static rule: only `clientEnv.ts` reads `fl/clients/`, only `wiring.ts` imports it |
| 2 | A round with participation, weights, update norms | built | per-round table on the employee page; `fl_updates` |
| 3 | Holdout evaluation vs a baseline, plus a skewed-clients run | built, with one deliberate difference (below) | untrained model and each client trained alone, on a separate holdout; skew test: a very large 95%-artefact client at 67% weight gives 68.5% holdout accuracy vs 77.3% with a 25% weight cap |
| 4 | Dropout and rejected/invalid update scenarios, logged | built | injected faults: dropout, sign-flip, 100x scale, stale model version, wrong schema, NaN; each rejection carries a reason code |
| 5 | Candidate registered, not deployed until a human decides; rollback exercised | built | candidate to approved to deployed; two-person rule; rollback restores the previous model if still fit; all tested |
| 6 | Simulated controls labelled; no unearned claim | built | banner on every federated screen; injected faults labelled; secure aggregation stated as not implemented |
| 7 | Consent, enrolment, withdrawal records; training data never in coordinator logs | built | enrolment/withdrawal audited; a test searches every persisted coordinator row, audit row and captured console output for client feature values and organisation ids |

**Differences from the design, stated plainly.**

- **No centralised reference model.** The design proposed one inside the experiment harness to show the gap. It was
  not built, so the comparison says nothing about how close the federated model is to pooling the data. The baselines
  are the untrained model and each client trained alone for the same number of local steps.
- **Secure aggregation is not implemented, not even simulated.** The coordinator sees every individual update. That is
  why it is labelled, and why the privacy claims below are narrow.
- **Differential privacy is optional and narrow.** With noise on, a run reports a declared accountant: Gaussian
  mechanism on the aggregate, Renyi composition, client-level, full participation, **trusted coordinator**. It is not
  secure aggregation and not local DP. In one measured run (multiplier 1, 8 rounds) epsilon was about 17.6 at
  delta = 1e-5, which is weak, and holdout accuracy fell from about 81% to 72%. With noise off there is no accountant
  and the page says no guarantee is claimed.
- **Poisoning screen is deliberately conservative.** A first version rejected honest clients near convergence (on
  skewed data, honest updates legitimately point in different directions), and the programme stalled with every round
  abandoned. That was found by running it, fixed (an opposed direction counts only if the update is also larger than
  typical; raw norm is checked before clipping hides it), and a regression test pins it. The screen reduces risk. A
  reversed update of normal size, or an attacker staying inside the bounds, is not caught; clipping, the weight cap and
  the optional trimmed mean limit what such an update can do. In testing, with the screen off a sign-flipping
  participant dropped fedavg accuracy sharply; trimmed mean held up without the screen.
- **Accuracy at 0.5 can drift while loss improves.** Over 8 rounds holdout log loss and calibration error improved while
  accuracy moved about 0.8 points the other way. Charts therefore use a minimum axis span so a small wobble is not
  drawn as a collapse.
- **Authorisation.** Two new separate grants, `federated.coordinate` (start runs) and `federated.approve` (decide on
  models). Neither follows from employee status or from any other grant. Clients enrol and withdraw their own
  organisation (client administrator only, organisation taken from the session). The design's `programme_participant`
  audience was not needed: a client sees only its own participation and the deployed model.
- **Two-person rule.** The person who registered a candidate cannot approve it. The design's "second approval for
  anything customer-facing" is stricter and is not built; nothing here is customer-facing.
- **Withdrawal.** Stops future participation and flags every live (candidate, approved, deployed, or superseded and
  therefore restorable) model the participant contributed to as **needs review**: approval, deployment and rollback
  restore are blocked until an approver records a note of at least 10 characters. The weights are unchanged: nothing is
  "untrained", and the UI and tests say so.
- **"Deployed" is registry state.** Nothing in this portal serves predictions from a federated model.
- **Row-level security.** `fl_enrolments` carries an organisation column but is deliberately exempt (the coordinator
  reads across organisations; client reads filter on the session organisation). It is listed with that reason in the
  RLS exemption test.
- **Not built:** pairwise-masking secure aggregation; a real network boundary (clients are simulated in-process, with
  datasets in private storage that no route serves); per-client training in a separate process; asynchronous or
  late-update handling beyond a client simply failing.
