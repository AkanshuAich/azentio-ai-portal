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

Status: Phase 0 (foundation) complete: schema, design tokens, authz core with tests, audit sink, seed.
Not yet built: auth flows, public site, employee/client portals, learning workflow, AIRA.
