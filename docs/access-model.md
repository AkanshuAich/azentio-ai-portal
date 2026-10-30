# Access model

How azentio.ai decides who may see or do what. Everything here is enforced on the server. A menu link, a
`localStorage` flag, an email suffix, or a tenant id sent by the browser never grants anything (brief IAM-01).

## The one rule

> An authenticated user may access a resource only when its **audience** permits their identity, their
> **active tenant/membership** is valid where applicable, and the requested **action** is authorised.
> Public resources are explicitly marked public; they are not a fallback for missing access metadata.

It is implemented once, in [`src/lib/authz/policy.ts`](../src/lib/authz/policy.ts) as `can(principal, action, resource)`.
Anything not explicitly allowed is denied. A resource with a missing or unrecognised audience is **denied**, never
treated as public (the `audience` column is `NOT NULL` with no default, so such a row cannot even be stored).

## Where authority comes from

`Principal` is built **server-side only**, from the session row, on every request
([`principal.ts`](../src/lib/authz/principal.ts), [`session.ts`](../src/lib/auth/session.ts)):

| Field | Source | Notes |
|---|---|---|
| `userId` | session → user | the cookie holds a random token; only its hash is stored |
| `isEmployee` | verified identity **and** `@azentio.com` **and** an active, organiser-approved membership of the Azentio organisation | the email suffix alone confers nothing |
| `activeOrgId` | the session's active workspace, **re-validated** against an active, terms-accepted membership | never read from a header, query, body or path |
| `permissions` | `platform_grants` rows, expired ones dropped | **inert unless the holder is a verified employee** |
| `entitlements` | the active organisation's `entitlements` | empty without a valid active workspace |

A user with several memberships has **no** active workspace until they choose one. A workspace whose terms are not
yet accepted confers nothing.

## Personas and grants

| Persona | How it is established | What it permits |
|---|---|---|
| Public visitor | no session | public pages, public AIRA, demo enquiries, hackathon registration |
| Employee | verified `@azentio.com` + organiser allowlist + approved membership | the employee portal; the shared learning feed |
| Client member | invitation accepted by the invited, verified account + terms accepted | their own organisation's workspace |
| Client administrator | `client_admin` role in that organisation | invite, change client roles and revoke, **within their own organisation only** |

Platform capabilities are **separate grants**, never roles and never implied by being an employee (IAM-02):

| Grant | Unlocks | Does **not** unlock |
|---|---|---|
| `learning.moderate` | review queue, redaction, publish/unpublish, themes, reported comments | ideas, publishing, drafts |
| `media.publish` | broadcasts, recordings, homepage banner, client-targeted content, release notes | moderation, ideas |
| `ideas.manage` | create and own improvement ideas, client updates | moderation, publishing |
| `members.invite`, `roles.grant` | invite / grant outside a client organisation | each other |
| `platform.administer` | administrator step-in on ideas | any private client content |
| `support.access_private` | time-boxed, audited access to tenant-scoped content | anything without an explicit reason and expiry |

A client administrator can grant only `client_member` / `client_admin`, only in their own organisation. Employee,
moderator, publisher and portal-administrator roles are refused by the policy engine, and a test sweeps this.

## Audiences

| Audience | Who may read | Used for |
|---|---|---|
| `public` | anyone, including anonymous | product pages, public media, banner, public live sessions |
| `employee` | verified, approved employees | internal experiments, knowledge, recordings, Playground |
| `tenant` | members of the **owning** organisation | briefings, tenant webinars, org-shared contributions |
| `tenant_private` | the author, within the owning organisation | drafts and private contributions |
| `entitled` | any client workspace holding the product entitlement | approved demos shared by product |
| `shared_community` | employees and members of a valid client workspace | the approved cross-client feed, themes, AIRA |

Employees get **no automatic access** to any client workspace. A moderator reads a private source only if the
author submitted it for community review, never a draft or an organisation-only item, and each opening is audited.

## Enforcement layers (defence in depth)

1. **Route wrappers.** Every API handler is built with `authedRoute`, `publicRoute` (reason string required) or
   `policyRoute`. Authed routes return 401 without a session; mutating routes refuse a cross-origin request first.
   A test enumerates all routes, rejects any bare handler, and pins the exact list of unauthenticated routes.
2. **Policy engine.** `can()` / `requirePermission()` for every protected read or write. Privileged actions and
   every refusal are written to `audit_events`.
3. **Service layer.** Tenant-scoped queries carry the organisation from the session. Another tenant's record is
   `NotFound`, indistinguishable from one that does not exist.
4. **Page guards.** Layouts do not re-run on client-side navigation, so every protected page calls
   `guardEmployee()` / `guardClient()` itself. A test asserts it for every page.
5. **Postgres row-level security.** Tenant tables (`contributions`, `playground_runs`, `saved_scenarios`,
   `support_requests`, `bookmarks`, `comments`, `saved_searches`) have policies on `org_id`. Reads of private tenant
   data run through `withTenant()`, which sets the organisation and switches to a non-superuser, no-`BYPASSRLS`
   role for that transaction. A query that forgets its `WHERE` still cannot cross a tenant.
   **Scope, stated plainly:** RLS protects the paths that use `withTenant()`. The rest of the application connects as
   the owner. In production, connect the web application as a non-owner role and extend `withTenant()` to every
   tenant read. A test fails if a new table with an organisation column is neither under RLS nor consciously exempt.
6. **Media.** Files sit in private storage and leave only through `/api/media/[id]`, which runs the policy on the
   asset's own audience on every request (401 anonymous, 403 wrong audience, sandboxing CSP, `nosniff`).

## Rules that are easy to get wrong

- The tenant is **never** taken from the request. A forged `orgId` in a body is ignored; a forged workspace switch is
  a 403 and an audit record.
- Authorisation comes **before** body handling (a non-publisher sending a malformed upload gets 403, not 400/500).
- Widening visibility is always an explicit author action: saving never shares, and "within my organisation" needs a
  separate "Share" action. Community sharing needs moderation.
- Shared payloads are built by **whitelisting** fields into a DTO, never by spreading a row, and a recursive check
  asserts no tenant id, author id, reviewer note or attachment appears at any depth.
- Grants held by a non-employee, and expired grants, confer nothing.

## How it is verified

`tests/acceptance/authz.test.ts` (persona × audience matrix), `route-coverage.test.ts` (every route and page,
anonymous and wrong-persona sweeps), `rls.test.ts` (second layer), plus the tenant-isolation suites in
`client.test.ts`, `employee.test.ts`, `learning.test.ts`. Each important rule has been **mutation-checked**: the
control was deliberately broken and a test failed. See [requirements-traceability.md](requirements-traceability.md).

## Known limits

- No per-IP rate limiting (sign-in codes are limited per address; enquiries per email).
- Employee writes to experiments, teams and knowledge are not individually audited (refusals and privileged
  actions are).
- The CSP needs `'unsafe-inline'` for scripts until a nonce middleware is added.
