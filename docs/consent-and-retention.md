# Consent, sharing, withdrawal and retention

## Sharing choices (what the author controls)

Every contribution starts as a **private draft**. Saving never shares anything. The author chooses:

| Choice | Meaning | What actually makes it visible |
|---|---|---|
| Private to me | only the author | nothing |
| Within my organisation | colleagues in the same client organisation | a **separate, explicit** "Share with my organisation" action (audited). Choosing the option and saving does not do it. |
| Propose to the learning community | a moderator may publish a reviewed, de-identified version | the author **submits** it, and a moderator approves a reviewed copy |

Moving away from "within my organisation" stops sharing at once. Broadening visibility always needs the author's
explicit act, and community sharing also needs moderation.

Once an item is submitted for community review, members of the author's own organisation can read the source (it is
narrower than what the author asked for). The visibility panel on every item says so.

## Four separate permissions

Recorded per contribution, each independent, with an **append-only history** (every change is a new row; the latest
wins; ordered by the database clock):

| Permission | Default | Effect |
|---|---|---|
| Store and process | required to save | holds the private draft so the author can edit and submit it. It cannot be switched off in place; withdraw instead. |
| Publish a reviewed, de-identified version | off | required to submit. Withdrawing it **withdraws the shared version**. |
| Show my organisation's name | off | the shared version names the organisation only if the author opted in **and** a moderator approved it. Withdrawing it anonymises the shared version. |
| Use for model training (future programme) | off | **recorded only.** No model is trained on contributions today. It is a separate choice for any future, separately approved programme. |

Membership of a workspace, publishing consent and training consent are never interchangeable. Accepting the
workspace terms is explicitly not consent to share or to train.

## What each version is, and who sees it

| Version | Who can see it | How it may be used |
|---|---|---|
| Your original | you; your organisation if it was shared with them or proposed for community review | stays in your workspace; never shown to other organisations; never copied into the shared feed |
| Reviewed shared version | authorised members of the learning community (employees and members of a valid client workspace) | searchable feed, grouped into themes, cited by AIRA summaries. Counted as **one organisation** however many items it shares. |
| Reviewer notes | moderators only | never shown to the author or anyone else |

The reviewed version is a separate record built **only from the moderator's reviewed copy**. It holds reviewed fields
only: no tenant id, author, original text, hidden metadata or attachments.

## Withdrawal

The author can withdraw at any time (and a moderator can withdraw unsafe content, after pausing it).

**What happens, in one database transaction:** the shared version is marked withdrawn → its search entries are
deleted → its AIRA retrieval passages are deleted → open reports on it are resolved → the feed cache epoch is bumped
(so cached theme aggregates cannot be served) → the status changes → an audit record and an in-app notice are
written. Every read path also re-applies the visibility rule, so a stale row could not be returned.

**Measured:** synchronous. In the end-to-end run it completed in tens of milliseconds, with zero index rows left.

**Production propagation target (to be confirmed before launch):**

| Layer | Target |
|---|---|
| Primary database, search, AIRA retrieval, feed cache | immediately, within the same transaction (and always under 60 seconds) |
| Read replicas and any separate search/vector index | within 60 seconds, with an alert if exceeded |
| Application caches / CDN | within 5 minutes. In this build, shared-feed responses are dynamic and the only application cache (themes) is keyed on the epoch above; any CDN added later must not cache them. |
| Database backups | expire on the backup schedule below; backups are not edited, and are re-applied against withdrawals on restore |

**What withdrawal cannot do.** It cannot recall material someone has already **viewed**, copied, exported (CSV) or
screenshotted, or text a third party has retained. The interface says so before the author confirms. If a training
programme ever existed, withdrawal would **not** "untrain" a model; that would need its own explicit policy (see
[federated-learning-design.md](federated-learning-design.md)). Nothing here promises otherwise.

## Retention schedule

> **Proposed, and not yet approved by legal or privacy.** The platform does not yet run automated purge jobs; this
> table is the policy those jobs must implement. Periods are placeholders for approval.

| Data | Proposed retention | Notes |
|---|---|---|
| Private drafts never submitted | 12 months after last edit, then deleted | author can delete earlier by withdrawing |
| Private source of a submitted contribution | life of the contribution; 90 days after withdrawal or rejection | kept so the moderation decision remains explicable |
| Reviewed shared version | until withdrawn; then deleted from all indexes immediately and from storage after 30 days | the approved version is retained for the audit period below |
| Consent history | 24 months after withdrawal or the contribution's closure | required to evidence what was agreed |
| Moderation decisions (public reason and private note) | 24 months after closure | private notes stay moderator-only |
| Audit events | 24 months, then archived; privileged actions 7 years | append-only |
| In-app notifications | 90 days after read | |
| Sign-in codes | deleted after expiry; keyed hash only | |
| Sessions | expire after 8 hours; hash only | |
| Invitations | spent or expired tokens deleted after 30 days | |
| Demo enquiries / hackathon registrations | 12 months | contact consent recorded |
| Sandbox runs and saved scenarios | 12 months, or on request | synthetic data only |
| Support requests (local) | 24 months | not a ticketing system |
| Backups | 35 days | |

**Deletion on request.** An author may withdraw a contribution at any time. A full erasure request removes the
private source, drafts and notifications, anonymises moderation records that must be kept, and leaves aggregates that
no longer identify the person or organisation. Anything required for legal reasons is retained and documented.

## Notifications

In-app status is persisted and per user. An email, where added, goes through a persisted outbox with an idempotency
key. A stored notification or a queued email is never described as "delivered": the only states are
`queued`, `dev_logged` (printed locally; nothing left the machine) and `sent` (handed to a provider).

## Data used for AI

AIRA receives only the question and **approved, de-identified** text the asker is already allowed to see. Private
sources, drafts, employee-only content and reviewer notes never enter the retrieval index, the model payload or the
logs. Prompts and passages are not written to the audit trail (metadata only).
