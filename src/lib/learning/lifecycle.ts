export const STATUSES = [
  "draft", "submitted", "in_review", "returned", "rejected", "approved",
  "published", "unpublished_under_review", "withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];
export type Actor = "author" | "moderator" | "system";

interface Edge { to: Status; actors: Actor[] }

/**
 * The only legal transitions. Anything not listed is refused, so the state machine cannot be walked
 * sideways by a crafted request. Every transition also writes an audit event and an author-visible event.
 */
const TRANSITIONS: Record<Status, Edge[]> = {
  draft: [{ to: "submitted", actors: ["author"] }],
  submitted: [
    { to: "in_review", actors: ["moderator"] },
    { to: "returned", actors: ["moderator"] },
    { to: "rejected", actors: ["moderator"] },
    { to: "approved", actors: ["moderator"] },
    { to: "withdrawn", actors: ["author"] },
  ],
  in_review: [
    { to: "returned", actors: ["moderator"] },
    { to: "rejected", actors: ["moderator"] },
    { to: "approved", actors: ["moderator"] },
    { to: "withdrawn", actors: ["author"] },
  ],
  returned: [
    { to: "submitted", actors: ["author"] },
    { to: "withdrawn", actors: ["author"] },
  ],
  approved: [{ to: "published", actors: ["moderator"] }],
  published: [
    { to: "withdrawn", actors: ["author"] },
    { to: "unpublished_under_review", actors: ["moderator"] },
    // A material edit creates a new version that needs renewed review. Never an automatic re-publish.
    { to: "submitted", actors: ["author"] },
  ],
  unpublished_under_review: [
    { to: "published", actors: ["moderator"] },
    { to: "withdrawn", actors: ["author", "moderator"] },
    { to: "rejected", actors: ["moderator"] },
  ],
  rejected: [],
  withdrawn: [],
};

export class LifecycleError extends Error {
  constructor(public readonly from: Status, public readonly to: Status, public readonly actor: Actor) {
    super(`illegal transition ${from} -> ${to} by ${actor}`);
    this.name = "LifecycleError";
  }
}

export function canTransition(from: Status, to: Status, actor: Actor): boolean {
  return (TRANSITIONS[from] ?? []).some((e) => e.to === to && e.actors.includes(actor));
}

export function assertTransition(from: Status, to: Status, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new LifecycleError(from, to, actor);
}

export function allowedNext(from: Status, actor: Actor): Status[] {
  return (TRANSITIONS[from] ?? []).filter((e) => e.actors.includes(actor)).map((e) => e.to);
}

/** Terminal states: nothing leaves them. */
export const isTerminal = (s: Status) => (TRANSITIONS[s] ?? []).length === 0;

/** The author may edit content only while it is private to them or has been returned for changes. */
export const authorCanEdit = (s: Status) => s === "draft" || s === "returned";

/** States in which the moderation boundary may read the private source. Drafts are never readable. */
export const moderatorMayRead = (s: Status) => s !== "draft";

/** Plain-language labels for the author. */
export const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft (private to you)",
  submitted: "Submitted for review",
  in_review: "In review",
  returned: "Returned to you",
  rejected: "Not accepted",
  approved: "Approved",
  published: "Shared with the community",
  unpublished_under_review: "Paused while being reviewed",
  withdrawn: "Withdrawn",
};
