# Requirements traceability

Maps each requirement in the hackathon brief (v1.0, 29 October 2026) to where it is implemented, how it is
tested, and its honest status.

**A note on the source.** The brief's cover lists "Acceptance tests" among its contents, but the 12 pages supplied end
at the optional federated track with no acceptance-test section. The acceptance suite was therefore **derived from the
brief's own normative statements** ("must", "never", "do not"). The tests are named after the clause they check.

**Status key:** ✅ built and tested · 🟡 built with a stated limit · ⬜ designed only · ❌ not built.

## §03 Identity and permissions

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| IAM-01 server-side RBAC + tenant + audience + entitlement; never menu/localStorage/email suffix/user tenant id | `lib/authz/*`, route wrappers, page guards, `withTenant` + RLS | `authz`, `route-coverage`, `rls`, `client`, `employee` | ✅ |
| IAM-02 least privilege; publish, moderate, invite, grant are separate | `platform_grants`, `PERMISSION_FOR_ACTION`, grants inert for non-employees | `authz`, `route-coverage` (one grant never opens another) | ✅ |
| Required access rule; public is explicit, not a fallback | `can()`; `audience NOT NULL`, no default | `authz` (missing audience denied), `public` | ✅ |
| Client admin cannot grant platform roles / change tenant / self-enable products | `can(grant_role)`, `changeMemberRole` | `authz`, `client` | ✅ |
| Privileged actions audited; private client content needs explicit support authorisation | `audit_events`; `support.access_private` (time-boxed) | `authz`, `learning` | 🟡 privileged actions and every refusal are audited; ordinary employee writes are not |

## §04 Authentication and onboarding

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Employees: verified @azentio.com + approved membership; real managed code flow | `employee_allowlist`, `otp.ts` | `auth` | 🟡 real code flow and storage; **no email provider** (dev outbox; production refuses to send) |
| Entra ID / OIDC preferred | not used (brief allows the managed-code fallback when registration is unavailable) | n/a | ⬜ |
| Clients by invitation tied to a registered org; admin invites only into own org | `invitations.ts`, `client/service.ts` | `auth`, `client` | ✅ |
| Arbitrary external email cannot create a trusted membership | eligibility rules in `otp.ts` | `auth` | ✅ |
| Single-use expiring invitation; accepted only by the intended verified account | hashed token, atomic consume | `auth` | ✅ |
| Terms and learning-sharing explanation; joining is not consent to share or train | `/onboarding/terms`, `memberships.terms_accepted_at` | `auth`, e2e | ✅ |
| Active organisation shown; workspace switcher | `PortalHeader`, `switchWorkspace` | `auth`, `client`, e2e | ✅ |

## §05 Employee portal

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Dashboard with quick links, sessions, assigned ideas, grants | `/employee/dashboard` | `employee`, e2e | ✅ |
| Guided Playground on synthetic scenarios; labelled; not a decision | `lib/playground/scenarios.ts`, `PlaygroundClient` | `employee` | ✅ deterministic (AI-assisted variant not built) |
| Internal live sessions and recordings restricted to employees; publishing grant to configure | `live_sessions`, `/api/media/[id]`, publishing console | `employee`, `route-coverage` | 🟡 recordings are placeholder slates; sessions link out to an external stream |
| Product owner reviews themes, creates ideas, links evidence, updates status | `lib/learning/ideas.ts`, `/employee/ideas` | `learning` | ✅ |
| Experiments, hackathon teams, release notes, knowledge library with owners/review dates/feedback | `/employee/*` | `employee` | ✅ |
| Employee-only content never in public/client search or AIRA | audience policy; AIRA index built from reviewed shares only | `public`, `aira`, `employee` | ✅ |

## §06 Client portal

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Dashboard: org, entitlements, demos, sessions, contribution status, visible ideas; empty states; no other tenant's data | `/workspace/dashboard`, `getClientDashboard` | `client`, e2e | ✅ |
| Entitled sandboxes; runs/uploads/saved scenarios isolated by tenant and user | `runSandbox`, `saved_scenarios`, RLS | `client`, `rls` | 🟡 no client file uploads (brief allows links in P0) |
| Employee-only tools unreachable by URL | audience policy, page guards | `route-coverage`, `client` | ✅ |
| My observations / Our organisation's; draft, submit, follow, amend, withdraw; private vs shared kept distinct | `/workspace/observations`, `AudienceBanner` | `learning`, e2e | ✅ |
| Browse/search approved items; filters (offering, industry, region, period, topic); counts, suggestions, exports obey visibility | `lib/learning/feed.ts` | `learning` | ✅ |
| Client admin invite/revoke/grant client roles; membership and invitation states | `/workspace/members` | `client` | ✅ |
| Ideas with plain-language status, owner/team, last update; no private tickets or unapproved commitments | `listClientIdeas` whitelist | `client`, `learning` | ✅ |
| Saved searches, bookmarks, notifications, comments, acknowledgements, support tickets, client resources | `collab.ts`, `inapp.ts`, `/workspace/*` | `client`, `learning` | 🟡 comments inherit audience and are moderated; **support requests are recorded locally, not integrated with a service desk**; acknowledgements limited to status notifications |

## §07 Capture and evidence

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Structured form for six contribution kinds; starts private; never shared by Save | `ObservationForm`, `createDraft` | `learning`, `learning-pure` | ✅ |
| Validate required fields and lengths client **and** server | shared zod schemas | `learning-pure`, `learning` | ✅ |
| Draft, submit, edit-returned, withdraw | `contributions.ts` | `learning` | ✅ |
| Attachments optional (links instead in P0) | not built | n/a | ⬜ by design |
| Prompt to exclude sensitive information; scan is not a guarantee; flag for review | `scanner.ts`, form notice, moderator view | `learning-pure`, `learning` | ✅ heuristic by nature |

## §08 Review, publication and withdrawal

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Lifecycle with explicit transitions and audit events; source separate from shared copy | `lifecycle.ts`, `shared_publications`, `review_drafts` | `learning-pure` (exhaustive), `learning` | ✅ |
| Moderators redact, request clarification, reject, publish; in-app notices | `moderation.ts`, `/employee/moderation` | `learning`, e2e | ✅ |
| Material edit creates a new version needing renewed review; never silently widen | `updateContribution` | `learning` | ✅ |
| Report action; unpublish during review; decision recorded; contributor told; reporter not exposed | `feed.ts`, `moderation.ts` | `learning` | ✅ |
| Withdrawal invalidates search, index, cache and AIRA retrieval within 60 s; state production SLA; state limits | `withdrawal.ts` (one transaction) | `learning`, `aira`, e2e | ✅ measured in tens of ms; SLA in `consent-and-retention.md` |
| Persisted notifications; idempotent outbox; never "email delivered" | `outbox_messages`, `queueEmail` | `auth` | 🟡 provider-backed email is P1 and not built |

## §09 Sharing, consent, confidentiality

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Private / organisation / community choices; org-only never shared by default | `sharingChoice`, `orgSharedAt` | `learning` | ✅ |
| Four separate permissions with history | `consents` (append-only) | `learning` | ✅ |
| No tenant ids, author profiles, attachments, reviewer notes in shared payloads | `toSharedDTO` whitelist, `findForbiddenKey` | `learning-pure`, `learning`, `aira` | ✅ |
| De-identified by default; attribution opt-in and reviewed; reduce specific geography/dates | scanner, moderator copy, attribution rules | `learning` | 🟡 moderator-driven |
| No raw private records in shared analytics, vector indexes, logs or AI payloads | index from reviewed copy only; model payload stripped; no prompt logging | `learning`, `aira` | ✅ (lexical index; no embeddings) |
| Show the contributor who can see each version and how it may be used | observation visibility panel | e2e, `learning` | ✅ |
| Documented retention; no claim withdrawal undoes a trained model | `consent-and-retention.md` | n/a | 🟡 policy documented; **purge jobs not implemented** |
| Minimum distinct organisations; ≥3 synthetic orgs; suppress small cohorts and differencing-friendly filters | `safeguards.ts`, themes, facets | `learning-pure`, `learning` | 🟡 minimum cohort is not a privacy guarantee (stated in UI and docs) |

## §10 Insights and improvement loop

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Searchable approved feed and theme dashboard (theme, offerings, evidence, period, distinct orgs where safe, confidence/limitations, latest update) | `FeedView`, `ThemeCards`, `themes.ts` | `learning` | ✅ |
| Never count repeated posts from one organisation as independent evidence | `cohortStat` on distinct org ids | `learning-pure`, `learning` | ✅ |
| Improvement ideas with required fields; statuses; audited status changes | `ideas.ts` | `learning` | ✅ |
| Close the loop without exposing private material | scanned client update, generic notifications | `learning` | ✅ |
| Illustrative end-to-end scenario | seeded and tested | `learning` (scenario test), e2e | ✅ |
| Semantic clustering, duplicate detection, trend summaries, digests, assisted prioritisation | not built | n/a | ❌ (advanced, optional) |
| Useful / needs-evidence feedback; transparent reasons; reviewer-assessed quality; no leaderboards | `publication_feedback`, `evidenceQuality` | `learning` | ✅ |
| AIRA cites approved contributions; retrieval ≠ retraining | `lib/aira/*` | `aira` | 🟡 live Claude call **not run against the real API** in this build |

## §11 Federated model learning (P2)

| Requirement | Status |
|---|---|
| Genuine federated training demonstration | ⬜ **designed only**: [federated-learning-design.md](federated-learning-design.md) |
| Threat model, withdrawal and lineage policy, honest labelling | ⬜ documented in the design; no simulated control is claimed because nothing is built |

## Cross-cutting

| Item | Status |
|---|---|
| Security headers, CSP verified in a real browser (dev and production mode) | 🟡 `'unsafe-inline'` for scripts until a nonce is added |
| Postgres row-level security as a second layer | 🟡 applies to `withTenant()` paths; see `access-model.md` |
| End-to-end persona journeys (Playwright, real browser, isolated database) | ✅ `tests/e2e` |
| Public site rebuilt to the brand, reference routes reused, public AIRA from public content only | ✅ |
| Do not build the actual credit/reporting/document products | ✅ sandboxes use synthetic data and are labelled |
