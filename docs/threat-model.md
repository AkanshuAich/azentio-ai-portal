# Threat model

Scope: the azentio.ai website and collaboration portal as built. The optional federated-learning track (P2) is
**designed, not built**; its threats are in [federated-learning-design.md](federated-learning-design.md).

## Assets, in order of sensitivity

1. Client private source contributions and drafts (may contain confidential business detail despite warnings).
2. The link between a shared item and the organisation or person who wrote it.
3. Moderator reviewer notes and consent history.
4. Employee-only content (experiments, knowledge, internal sessions, recordings).
5. Sessions, one-time codes, invitation tokens.
6. Audit trail integrity.

## Trust boundaries

Browser ⇄ Next.js server ⇄ Postgres / private storage ⇄ (optional) Anthropic API. The browser is untrusted for
every decision. The Anthropic API is an external processor that receives **only** approved, de-identified text.

## Threats and mitigations

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| T1 | Cross-tenant read/write by changing an id (IDOR) | tenant from session only; per-row policy; foreign records are `NotFound`; RLS under it | `client.test.ts`, `learning.test.ts`, `rls.test.ts` |
| T2 | Forged tenant id / workspace switch | ids in bodies ignored; switch needs an active, terms-accepted membership; refusal audited | `route-coverage.test.ts`, live HTTP checks |
| T3 | Direct API or media request bypassing the UI | every route wrapped and swept anonymously and as the wrong persona; media checked per request | `route-coverage.test.ts`, `employee.test.ts` |
| T4 | Privilege escalation via roles | grants separate and inert for non-employees; client admins cannot grant platform roles | `authz.test.ts`, `client.test.ts` |
| T5 | Email-suffix spoofing for employee access | requires verified identity + organiser allowlist + approved membership | `auth.test.ts` |
| T6 | One-time code brute force | keyed hash, 10-minute expiry, 5 attempts, per-address request limit, single use | `auth.test.ts` |
| T7 | User enumeration at sign-in | identical response for every address | `auth.test.ts` |
| T8 | Invitation replay / hijack | hashed single-use token; accepted only by the intended verified account; atomic consume; cancel | `auth.test.ts`, `client.test.ts` |
| T9 | CSRF | SameSite=Lax cookie + origin check on every state-changing route | `route-coverage.test.ts` |
| T10 | Session theft | HttpOnly, Secure (production), 8-hour expiry, hash-only storage, sign-out destroys it | `auth.test.ts` |
| T11 | Stored XSS / dangerous links | React escaping; stream links https-only; banner links path or https; uploaded files type-checked from bytes, SVG refused, served with sandbox CSP | `employee.test.ts` |
| T12 | Malicious upload | allowlisted types, magic-number check, 25 MB limit, server-generated key, no static serving | `employee.test.ts` |
| T13 | Prompt injection through shared text into AIRA | passage text escaped and wrapped as data; system prompt marks it untrusted; model sees no ids; output citations validated | `aira.test.ts` |
| T14 | Private data sent to the AI provider | retrieval reads only reviewed chunks; the model payload carries only question and reviewed text; internal fields stripped before the call; prompts are not logged | `aira.test.ts` |
| T15 | Withdrawn content still searchable or retrievable | one transaction deletes index entries and retrieval chunks and bumps the cache epoch; every read also re-applies visibility | `learning.test.ts`, `aira.test.ts` |
| T16 | De-anonymisation of a rare observation | de-identified wording by default; moderator redaction with live scan; attribution opt-in and approved; no tenant fields in shared payloads | `learning*.test.ts` |
| T17 | Differencing / small-cohort inference | statistics only per theme (never over user filters); distinct-organisation threshold; counts withheld below it; facet counts suppressed | `learning*.test.ts` |
| T18 | Counting inflation (many posts from one client) | strength is distinct organisations, never posts | `learning*.test.ts` |
| T19 | Reporter exposed to the contributor | reporter identity never selected into moderator or author views | `learning.test.ts` |
| T20 | Insider misuse by a moderator | reads limited to submitted proposals; each source opening audited; reasons public, notes private; moderator cannot publish without the author's permission | `learning.test.ts` |
| T21 | Spreadsheet formula injection via export | cells starting `= + - @` are neutralised | `learning.test.ts` |
| T22 | Clickjacking, MIME sniffing, mixed content | CSP `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, HSTS, `upgrade-insecure-requests` | `security-headers.test.ts`, e2e, production check |
| T23 | Race conditions (double accept / double publish) | atomic conditional updates; the loser is refused | `auth.test.ts`, `learning.test.ts` |
| T24 | Path traversal in storage | keys resolved inside the root; client filenames never reach the filesystem | `employee.test.ts` |

## Residual risks (not mitigated, or only partly)

- **Scanner is heuristic.** It misses things. It flags for human review and says so; it is never the control.
- **Rare observations remain re-identifiable by context** even after redaction. Moderator judgement is the control;
  a minimum cohort is not a privacy guarantee. Production thresholds and stronger controls need approval.
- **CSP allows inline scripts** until a nonce middleware is added.
- **No per-IP rate limiting** and no CAPTCHA on public forms (honeypot and per-email limits only).
- **RLS covers the `withTenant()` paths**; the rest of the app uses the owner role. Move the web app to a non-owner
  role before production.
- **Database or storage administrators** can read everything. Operational access needs its own controls and audit.
- **Email delivery is not implemented.** Codes and links go to a development outbox; production refuses to send
  until a provider adapter exists. Nothing is ever labelled "delivered".
- **AIRA's live Claude call has not been run against the real API** in this build (typed and tested with a stand-in).
- **Local disk storage** stands in for object storage (no encryption at rest, no replication).
- **Backups and replicas:** withdrawal is synchronous in the primary database. Production replicas, caches and
  backups need their own propagation and expiry (see [consent-and-retention.md](consent-and-retention.md)).
- **Already viewed or copied material cannot be recalled** by withdrawal.
- **Dependency advisories (`npm audit`).** Two in production dependencies: PostCSS bundled inside Next.js 15
  (stringify XSS and source-map file read when processing *attacker-controlled CSS*, which this application does not
  do) and, in development tooling only, `@esbuild-kit` under `drizzle-kit`. No non-breaking fix exists; the fix is a
  major Next.js upgrade, which was deliberately not forced. Re-check before launch.

## Out of scope for this build

Penetration testing, formal certification, production integrations, billing, and any claim of regulatory
compliance. Security statements here describe controls and tests, not certifications.
