# azentio.ai: Website & Intelligent Collaboration Portal

A Next.js 15 + Postgres build of the hackathon brief: a public website, an employee portal, an organisation-scoped
client portal, and a governed collective-learning workflow. **Access is enforced on the server** by one policy engine
(`src/lib/authz`), with Postgres row-level security as a second layer.

## Run it

```bash
cp .env.example .env.local
docker compose up -d
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

Sign in at `/signin`. No email provider is wired in: codes and invitation links appear at `/dev/mailbox` (development
only). Seeded demo users (all fictional):

| Persona | Email |
|---|---|
| Ordinary employee | priya.nair@azentio.com |
| Moderator (`learning.moderate`) | omar.haddad@azentio.com |
| Publisher (`media.publish`) | lena.fischer@azentio.com |
| Product owner (`ideas.manage`) and federated coordinator (`federated.coordinate`) | ravi.menon@azentio.com |
| Portal administrator, and federated approver (`federated.approve`) | sam.okafor@azentio.com |
| Meridian client admin / member | amira.khan@meridian.example / tariq.aziz@meridian.example |
| Nusantara client admin / member | dewi.lestari@nusantara.example / budi.santoso@nusantara.example |
| Zahra / Atlas client admins | fatima.zahra@zahra.example / john.mercer@atlas.example |
| Two-workspace advisor | yusuf.advisor@advisory.example |

The brief's illustrative scenario (three clients, seasonal SME cash flow, a "Seasonality context" theme with a
small-sample warning, an Under-review idea) is seeded and replayable.

The optional P2 federated programme is seeded with three enrolled clients (the minimum cohort); Atlas's administrator
can enrol live at `/workspace/federated`, Ravi runs it at `/employee/federated`, and Sam (a different person) approves.

## Verify it

```bash
npm test              # unit + acceptance suite against a throwaway database
npm run typecheck && npm run lint
npm run test:e2e      # Playwright persona journeys in a real browser (Edge by default; E2E_CHANNEL=chrome)
```

The acceptance tests are named after the brief's clauses; see
[docs/requirements-traceability.md](docs/requirements-traceability.md). Key controls have been **mutation-checked**
(deliberately broken, and a test failed).

## Documentation

| | |
|---|---|
| [docs/access-model.md](docs/access-model.md) | personas, grants, audiences, enforcement layers |
| [docs/threat-model.md](docs/threat-model.md) | threats, mitigations, evidence, residual risks |
| [docs/consent-and-retention.md](docs/consent-and-retention.md) | consent model, withdrawal and its limits, retention schedule |
| [docs/federated-learning-design.md](docs/federated-learning-design.md) | the optional P2 track: design, and what was built vs designed |
| [docs/requirements-traceability.md](docs/requirements-traceability.md) | every requirement: where, how tested, honest status |

## Honest limits

- **Email is not delivered.** Production refuses to send until a provider adapter is set (`MAIL_TRANSPORT`). Nothing is
  ever labelled "delivered".
- **AIRA's live Claude call has not run against the real API** in this build. With `ANTHROPIC_API_KEY` set it uses
  `claude-opus-5-5` (override with `AIRA_MODEL`); without it, or on any failure, it falls back to a labelled retrieval
  summary. Retrieval is lexical (Postgres full text), not embeddings.
- **The federated-learning track (P2) is a simulated demonstration, not production federated learning.** Synthetic data, clients simulated in-process, **no secure aggregation**, no formal privacy guarantee unless noise is switched on (and then only under a trusted-coordinator assumption), and "deployed" is a registry state only. See `docs/federated-learning-design.md` section 9.
- **Retention periods are proposed, and automated purge jobs are not implemented.**
- **RLS covers the `withTenant()` paths**; connect the web app as a non-owner role before production.
- Uploaded media and recordings use local disk and placeholder slates, not real video.
- A minimum cohort size is not a privacy guarantee. Production thresholds need approval.

Postgres runs on host port **5433** (5432 is often taken). Uploaded files live in `./storage` (gitignored) and are
served only through `/api/media/[id]`.
