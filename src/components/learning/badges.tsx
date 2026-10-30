import { STATUS_LABEL, type Status } from "@/lib/learning/lifecycle";

const TONE: Record<string, string> = {
  draft: "bg-panel text-ink", submitted: "bg-amber-100 text-amber-900", in_review: "bg-amber-100 text-amber-900",
  returned: "bg-red-100 text-red-900", rejected: "bg-panel text-muted", approved: "bg-green/30 text-ink",
  published: "bg-green/30 text-ink", unpublished_under_review: "bg-amber-100 text-amber-900", withdrawn: "bg-panel text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${TONE[status] ?? "bg-panel"}`}>{STATUS_LABEL[status as Status] ?? status}</span>;
}

/** The two audiences are kept visibly apart: your organisation's private knowledge versus the cross-client feed. */
export function AudienceBanner({ kind }: { kind: "private" | "shared" }) {
  return kind === "private" ? (
    <div role="note" className="mb-8 flex items-start gap-3 rounded-az-lg border-2 border-navy bg-navy p-4 text-white">
      <span aria-hidden className="mt-0.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">Private</span>
      <p className="text-sm">This is your organisation&apos;s own knowledge. Other organisations never see it, and it is not part of the shared learning feed.</p>
    </div>
  ) : (
    <div role="note" className="mb-8 flex items-start gap-3 rounded-az-lg border-2 border-green bg-green/15 p-4 text-ink">
      <span aria-hidden className="mt-0.5 rounded-full bg-green px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink">Shared</span>
      <p className="text-sm">Reviewed and de-identified by a moderator, shared by the learning community. Organisations are not named unless they chose to be. Counts are not evidence of how common something is.</p>
    </div>
  );
}
