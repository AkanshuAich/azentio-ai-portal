# Federated model-learning track (P2): design

> **Status: designed, not implemented in this build.** The brief makes this track optional and says a discussion
> board or central document repository is *not* federated learning. The collective-learning hub that **is** built
> (contributions, moderation, shared feed, themes, AIRA) is a separate, required workflow and trains nothing.
> Nothing in the product claims secure aggregation or formal privacy. This document describes what a credible,
> honestly labelled demonstration would be, so it can be built without changing the access model.

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
