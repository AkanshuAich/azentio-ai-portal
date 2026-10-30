/** A refusal that is the caller's situation, not a bug: surfaced to the API as 409 with a stable code. */
export type FederatedErrorCode =
  | "cohort_too_small"
  | "not_enrolled"
  | "already_enrolled"
  | "illegal_state"
  | "review_required"
  | "two_person_rule"
  | "no_programme"
  | "consent_required";

export class FederatedError extends Error {
  constructor(public readonly code: FederatedErrorCode, message: string) {
    super(message);
    this.name = "FederatedError";
  }
}
