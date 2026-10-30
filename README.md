# azentio.ai: Website & Intelligent Collaboration Portal

Next.js 15 + Postgres. Access is enforced on the server by one policy engine (`src/lib/authz`).

```bash
cp .env.example .env.local
docker compose up -d
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

```bash
npm test            # policy engine + acceptance tests
npm run typecheck
```

Status: Phases 0-1 complete.
- Phase 0: schema, design tokens, authz policy engine, audit sink, seed.
- Phase 1: email-code sign-in, organiser-approved employee provisioning, single-use invitations,
  terms step, active-workspace switcher, CSRF origin checks.
Not yet built: public site, employee/client portals, learning workflow, AIRA.

Local notes
- Postgres runs on host port 5433 (5432 is often taken by a local install).
- No email provider is wired in: sign-in codes and invitation links land in the outbox and are shown at
  /dev/mailbox in development only. Production refuses to start sending until MAIL_TRANSPORT is set.
- Tests recreate a throwaway `azentio_test` database from the real migrations on every run.
