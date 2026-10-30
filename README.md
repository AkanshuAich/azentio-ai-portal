# azentio.ai: Website & Intelligent Collaboration Portal

An enterprise AI website and a secure, multi-tenant collaboration portal, built for the Azentio hackathon brief.
One product serves five kinds of people, and **what each of them can see and do is decided on the server**, never by
a menu link or a browser flag.

| Who | What they get |
|---|---|
| **Public visitor** | Branded marketing site: products, solutions, technology, lab, media, insights, demo enquiry, hackathon registration, and a public-only AI assistant |
| **Employee** | Internal portal: guided Playground on synthetic data, live sessions and recordings, experiments, hackathon spaces, knowledge library, release notes |
| **Client member / admin** | Organisation-scoped workspace: entitled demos, observations, shared learning, themes, member management, comments |
| **Moderator** | Reviews proposed contributions, redacts them side by side, publishes or returns them |
| **Product owner** | Turns recurring themes into improvement ideas with an audited status |

## The idea in two minutes

Clients see things in the field that Azentio's products should handle better (for example, a seasonal business that
looks like it is deteriorating every off-season). The portal lets them share that **without exposing who they are**:

1. A client member writes a **private** observation and chooses whether to propose it to the community.
2. A moderator reviews it, redacts identifying detail, and publishes a **separate, de-identified copy**. The original
   stays private; the published copy is built only from reviewed fields.
3. Other clients find it in the shared feed. Once **three or more different organisations** report the same thing, it
   surfaces as a theme. Five posts from one organisation count as one.
4. A product owner can turn a theme into an improvement idea.
5. The author can **withdraw** at any time. It disappears from search, counts, feeds and the AI assistant in the same
   request (about 30 ms measured locally; the brief's bar is 60 s).

Behind that sit the rules the brief insists on: a client can never read another client's data (not by changing an
ID, not by pasting a media URL, not by calling the API directly), and moderating, publishing, inviting and granting
roles are **four separate permissions**, none of which comes with being an employee.

There is also an optional **simulated federated-learning programme** (see [below](#optional-federated-learning-programme)).

## Tech stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · PostgreSQL 16 · Drizzle ORM · Zod · Vitest · Playwright.
The AI assistant (AIRA) uses the Claude API when a key is set and a deterministic fallback otherwise.

## Quick start

**You need:** Node.js 20 or newer, Docker (for Postgres), and Git.

```bash
git clone https://github.com/AkanshuAich/azentio-ai-portal.git
cd azentio-ai-portal
npm install
npm run setup      # creates .env.local with a random database password and session secret
npm run db:up      # starts Postgres in Docker
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. That is the public site. Postgres is exposed on host port **5433** (not 5432, which is
often already taken) and only on your own machine.

**No passwords are stored in the repo.** `npm run setup` generates them into `.env.local`, which is git-ignored.
`.env.example` only holds placeholders.

### Signing in

There is no email provider, so **sign-in codes are shown in a local "dev mailbox" instead of being emailed**:

1. Go to `/signin`, enter one of the demo emails below, and press *Email me a sign-in code*.
2. Open `/dev/mailbox` in another tab and copy the six-digit code.
3. Enter the code. You land in the portal that fits your role.

Only the seeded demo emails work. For any other address the app deliberately sends nothing and still says "ok", so
the form cannot be used to find out who has an account. The dev mailbox does not exist in production builds.

### Demo accounts (all fictional)

| Persona | Email |
|---|---|
| Ordinary employee (no extra grants) | priya.nair@azentio.com |
| Moderator (`learning.moderate`) | omar.haddad@azentio.com |
| Publisher (`media.publish`) | lena.fischer@azentio.com |
| Product owner (`ideas.manage`) and federated coordinator (`federated.coordinate`) | ravi.menon@azentio.com |
| Portal administrator, and federated approver (`federated.approve`) | sam.okafor@azentio.com |
| Meridian Commercial Bank: admin / member | amira.khan@meridian.example / tariq.aziz@meridian.example |
| Nusantara Finance: admin / member | dewi.lestari@nusantara.example / budi.santoso@nusantara.example |
| Zahra Takaful: admin | fatima.zahra@zahra.example |
| Atlas Trading Group: admin | john.mercer@atlas.example |
| Advisor with two workspaces | yusuf.advisor@advisory.example |

### Things worth trying

- **The full learning loop.** As Tariq, submit an observation at `/workspace/observations/new` and choose *propose to
  the community*. As Omar, review it at `/employee/moderation`, redact, and publish. As Budi, find it under *Shared
  learning* and ask AIRA about it. As Tariq, withdraw it and watch it vanish. The brief's own scenario (three clients,
  seasonal SME cash flow, a "Seasonality context" theme, an idea under review) is already seeded.
- **Try to break the boundaries.** As Tariq, open `/employee/dashboard` (refused), or call an employee API directly
  (403). As Priya, open `/employee/moderation` (refused: she lacks the grant even though she is an employee).
- **Workspace switching.** Sign in as Yusuf, who belongs to two client organisations and picks one explicitly.

## Configuration

`npm run setup` creates `.env.local` from `.env.example` (it never overwrites an existing one). The defaults work for
local development.

| Variable | Purpose | Default |
|---|---|---|
| `POSTGRES_PASSWORD` | Password for the Docker database. Must match the password in `DATABASE_URL` | random, from `npm run setup` |
| `DATABASE_URL` | Postgres connection string | Docker database on port 5433 |
| `SESSION_SECRET` | Signs session and code hashes. Use a different long random value in any real deployment | random, from `npm run setup` |
| `MIN_DISTINCT_ORGS` | Minimum different organisations before a theme or trend is shown | `3` |
| `ANTHROPIC_API_KEY` | Enables live Claude answers in AIRA. Optional | empty: fallback summaries |
| `AIRA_MODEL` | Overrides the AIRA model | `claude-opus-5-5` |
| `MAIL_TRANSPORT` | Mail provider adapter. Production refuses to send until one is set | `dev` (mailbox page) |
| `PRIVATE_STORAGE_DIR` | Where uploaded files and simulated client data live | `./storage` |

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Create `.env.local` with generated secrets (once) |
| `npm run db:up` / `npm run db:down` | Start / stop the local Postgres container |
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | **Reset** the dev database to the demo data (wipes it first; refuses to run in production) |
| `npm test` | Unit and acceptance tests, against a throwaway database |
| `npm run test:e2e` | Playwright journeys in a real browser |
| `npm run typecheck` / `npm run lint` | Type check and lint |
| `npm run db:generate` | Create a new migration after editing the schema |

## How it is tested

The tests are the main evidence that the access rules hold, so they are written to mirror the brief.

- **389 unit and acceptance tests**, named after the brief's clauses (for example *IAM-01*, *IAM-02*). They create their
  own throwaway database (`azentio_test`) from the real migrations on every run, so they never touch your demo data.
  Needs the Docker database running (`npm run db:up`) and `.env.local` present.
- **Route and page sweeps** fail the build if any API route or protected page skips its check, and call every route
  as the wrong kind of user to confirm none succeeds.
- **8 Playwright journeys** drive a real browser through each persona against an isolated database (`azentio_e2e`,
  port 3101). They use the browser already installed (Edge by default; set `E2E_CHANNEL=chrome` for Chrome), so nothing
  is downloaded.
- Key controls were **mutation-checked**: deliberately broken to confirm a test fails.

Where each requirement lives, how it is tested, and its honest status:
[docs/requirements-traceability.md](docs/requirements-traceability.md).

## How access is enforced

Three layers, so one mistake does not become a leak:

1. **One policy function**, `can(principal, action, resource)` in `src/lib/authz`. The principal is built on the server
   from the session; a tenant ID in a request body, query or header is never trusted.
2. **Every route and page calls a guard.** Missing audience metadata means *deny*, not public.
3. **Postgres row-level security** on the tenant tables, as a second line of defence behind the application checks.

Media is only ever served through `/api/media/[id]`, after the same check. Details:
[docs/access-model.md](docs/access-model.md).

## Optional: federated-learning programme

A small **simulated** programme where clients jointly train a model that tells seasonal artefacts from genuine
deterioration, without sharing their records. It is seeded with three enrolled clients; Atlas's admin can enrol live
at `/workspace/federated`, Ravi runs it at `/employee/federated`, and Sam (a different person) approves the result.
A run only produces a *candidate* model; nothing is used until a second person approves it.

Be aware of what it is not: it runs on **synthetic data**, clients are simulated in one process, **secure aggregation is
not implemented**, and no privacy guarantee is claimed unless noise is switched on (and then only under stated
assumptions). Every federated screen says so. See [docs/federated-learning-design.md](docs/federated-learning-design.md).

## Project layout

```
src/
  app/            Pages and API routes
    (public)/       Marketing site
    (auth)/         Sign-in, invitations, terms
    employee/       Employee portal
    workspace/      Client portal
    api/            All HTTP endpoints (each wrapped by a reviewed guard)
    dev/            Local mailbox (development only)
  components/     UI building blocks, grouped by area
  lib/
    authz/          The policy engine and permission guard
    auth/           Email codes, sessions, invitations, route wrappers
    db/             Schema, tenant-scoped access, seed data
    learning/       Contributions, lifecycle, moderation, withdrawal, feed
    insights/       Themes and minimum-cohort safeguards
    aira/           The AI assistant
    federated/      The simulated federated programme
    ...             employee, client, public, media, storage, security, validation
  content/        Site copy
  styles/         Brand design tokens
drizzle/          Database migrations (generated, committed)
tests/
  acceptance/     Unit and acceptance tests
  e2e/            Playwright persona journeys
docs/             Access model, threat model, consent, federated design, traceability
```

## Files and folders you may see but did not write

Some folders appear after you run things. None of them is source code, and none is committed (`.gitignore` covers them):

| Path | Why it exists |
|---|---|
| `node_modules/` | Installed dependencies |
| `.next/` | Next.js build and dev cache. Safe to delete |
| `storage/`, `storage-e2e/` | Private uploads and simulated client datasets. Never served as static files; the e2e copy belongs to the test database |
| `test-results/` | Playwright traces and failure artefacts |
| `tsconfig.tsbuildinfo` | TypeScript incremental cache |
| `.env.local` | Your local settings and secrets. Never commit it |

## Troubleshooting

- **No sign-in code shows up.** Use a seeded demo email (see above). Codes appear at `/dev/mailbox`, not in your inbox.
  If `/signin` returns 404 or errors while `/` works, the dev server's cache is stale (this happens if you run
  `npm run build` while `npm run dev` is running). Stop the server, delete `.next`, and start it again:
  `rm -rf .next` (macOS/Linux/Git Bash) or `Remove-Item -Recurse -Force .next` (PowerShell).
- **Cannot connect to the database.** Check `docker compose ps`. The app expects port **5433**; change `DATABASE_URL`
  and `docker-compose.yml` together if you need another port.
- **`password authentication failed`, or Compose says `POSTGRES_PASSWORD` is not set.** The password is read from
  `.env.local`. Postgres sets it only when the data volume is first created, so if you change it afterwards the old
  volume keeps the old password. Either restore the old value, or rebuild the volume (next item). If `.env.local`
  predates `npm run setup`, add a `POSTGRES_PASSWORD=` line with the password the database was created with.
- **Want a clean slate.** `npm run db:seed` resets the data. To rebuild the database itself:
  `npm run db:down -- -v`, then `npm run db:up`, `npm run db:migrate`, `npm run db:seed`.
- **Port 3000 is busy.** `npx next dev --turbopack -p 3100`.

## Documentation

| | |
|---|---|
| [docs/access-model.md](docs/access-model.md) | Personas, grants, audiences, enforcement layers |
| [docs/threat-model.md](docs/threat-model.md) | Threats, mitigations, evidence, residual risks |
| [docs/consent-and-retention.md](docs/consent-and-retention.md) | Consent, withdrawal and its limits, retention |
| [docs/federated-learning-design.md](docs/federated-learning-design.md) | The optional P2 track: design, and what was built |
| [docs/requirements-traceability.md](docs/requirements-traceability.md) | Every requirement: where, how tested, status |

## Known limitations

Stated plainly so nothing is oversold:

- **Email is not delivered.** Production refuses to send until a provider adapter is added. Nothing is ever labelled
  "delivered".
- **AIRA's live Claude call has not been run against the real API** in this build. Without a key, or on any failure,
  it falls back to a clearly labelled retrieval summary. Retrieval is lexical (Postgres full text), not embeddings.
- **The federated programme is a simulation**, as described above.
- **Retention periods are proposed;** automated purge jobs are not implemented.
- **Row-level security** covers the tenant-scoped query paths; connect the web app as a non-owner database role before
  production.
- **Uploaded media** uses local disk and placeholder slates, not real video.
- **A minimum cohort size is not a privacy guarantee.** Production thresholds need approval.
- **Dependency advisories:** `npm audit` reports two issues in PostCSS bundled inside Next 15, fixable only by a major
  Next upgrade, which was deliberately not forced.
- The brief's PDF names an acceptance-test section that its pages do not contain, so the tests here are derived from
  its "must" and "never" statements.

## Licence

No licence file has been added yet.
