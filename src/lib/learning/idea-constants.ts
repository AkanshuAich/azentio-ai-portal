// Pure constants, safe to import from client components (no server or database code).
export const IDEA_STATUSES = ["proposed", "under_review", "planned", "in_progress", "released", "not_proceeding"] as const;
export const IDEA_LABEL: Record<(typeof IDEA_STATUSES)[number], string> = {
  proposed: "Proposed", under_review: "Under review", planned: "Planned", in_progress: "In progress", released: "Released", not_proceeding: "Not proceeding",
};
