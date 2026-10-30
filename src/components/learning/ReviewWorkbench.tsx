"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONFIDENCE, EVIDENCE_LABEL, EVIDENCE_TYPES, KINDS, KIND_LABEL } from "@/lib/learning/validation";
import { SCAN_DISCLAIMER } from "@/lib/learning/scanner";

interface Flag { kind: string; match: string; hint: string }
export interface ReviewData {
  id: string; status: string; version: number; org: string;
  source: { kind: string; title: string; body: string; offering: string; industry: string | null; region: string | null; observationPeriod: string | null; evidenceType: string | null; confidence: string | null };
  sourceFlags: Flag[]; reviewFlags: Flag[];
  reviewDraft: { title: string; body: string; offering: string; industry: string | null; region: string | null; observationPeriod: string | null; evidenceType: string | null; confidence: string | null; attribution: string; evidenceQuality: string | null; topic: string | null } | null;
  consents: { publish_shared: boolean; attribution: boolean };
  timeline: { at: string; actor: string; from: string | null; to: string; note: string | null }[];
  actions: { at: string; action: string; publicReason: string | null; privateNotes: string | null }[];
}

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm text-ink";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/**
 * Side-by-side review. Left: the PRIVATE source, visible here only because it was submitted for review and
 * this opening is audited. Right: the reviewed copy, the only thing that is ever published. The shared
 * version is built from the right-hand side alone, so redacting here is what protects the author.
 */
export function ReviewWorkbench({ r }: { r: ReviewData }) {
  const router = useRouter();
  const d = r.reviewDraft;
  const [f, setF] = useState({
    title: d?.title ?? r.source.title, body: d?.body ?? r.source.body, offering: d?.offering ?? r.source.offering,
    industry: d?.industry ?? r.source.industry ?? "", region: d?.region ?? r.source.region ?? "", observationPeriod: d?.observationPeriod ?? r.source.observationPeriod ?? "",
    evidenceType: d?.evidenceType ?? r.source.evidenceType ?? "", confidence: d?.confidence ?? r.source.confidence ?? "", attribution: d?.attribution ?? "anonymous",
    evidenceQuality: d?.evidenceQuality ?? "", topic: d?.topic ?? r.source.kind, privateNotes: "",
  });
  const [flags, setFlags] = useState<Flag[]>(r.reviewFlags);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function run(fn: () => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>, ok: string) {
    setBusy(true);
    setMsg(null);
    const x = await fn();
    setBusy(false);
    if (!x.ok) return setMsg({ tone: "err", text: x.status === 409 ? "That move isn't allowed from the current state." : x.status === 403 ? "Not allowed: check the reason, consent and the scan results." : "That didn't work. Check the fields." });
    setMsg({ tone: "ok", text: ok });
    router.refresh();
  }

  const reviewed = () => ({
    title: f.title, body: f.body, offering: f.offering, industry: f.industry || undefined, region: f.region || undefined, observationPeriod: f.observationPeriod || undefined,
    evidenceType: f.evidenceType || undefined, confidence: f.confidence || undefined, attribution: f.attribution, evidenceQuality: f.evidenceQuality || undefined, topic: f.topic || undefined,
  });

  async function save() {
    setBusy(true);
    setMsg(null);
    const x = await call(`/api/moderation/${r.id}/review-draft`, "PUT", { reviewed: reviewed(), privateNotes: f.privateNotes || undefined });
    setBusy(false);
    if (!x.ok) return setMsg({ tone: "err", text: x.status === 403 ? "Not allowed: start the review first, and the author must have agreed before you name their organisation." : "Check the fields." });
    setFlags((x.data.flags as Flag[]) ?? []);
    setMsg({ tone: "ok", text: "Reviewed copy saved. It is not shared until you publish." });
    router.refresh();
  }

  const btn = "rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-50";
  const live = r.status === "published";
  const paused = r.status === "unpublished_under_review";
  const inReview = r.status === "in_review";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900">{r.status.replace(/_/g, " ")}</span>
        <span className="text-muted">Version {r.version} · from {r.org} (visible to moderators only, never in the shared copy)</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Private source" className="rounded-az-lg border-2 border-navy p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Private source (read-only)</h2>
          <h3 className="mt-3 text-lg font-semibold text-ink">{r.source.title}</h3>
          <p className="mt-1 text-xs text-muted">{KIND_LABEL[r.source.kind as keyof typeof KIND_LABEL] ?? r.source.kind} · {r.source.offering} · {[r.source.industry, r.source.region, r.source.observationPeriod].filter(Boolean).join(" · ")}</p>
          <p className="mt-3 whitespace-pre-line text-sm text-ink">{r.source.body}</p>
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-red-800">Scan: possible sensitive content in the source</h4>
            {r.sourceFlags.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing flagged. That does not mean it is safe.</p> : (
              <ul className="mt-1 space-y-1 text-sm">{r.sourceFlags.map((x, i) => <li key={i} className="text-red-900"><code className="rounded bg-red-50 px-1">{x.match}</code> <span className="text-xs">{x.hint}</span></li>)}</ul>
            )}
            <p className="mt-2 text-xs text-muted">{SCAN_DISCLAIMER}</p>
          </div>
          <p className="mt-4 text-xs text-muted">Author permissions: publish a reviewed version {r.consents.publish_shared ? "✓" : "✗"} · name their organisation {r.consents.attribution ? "✓" : "✗ (off)"}</p>
        </section>

        <section aria-label="Reviewed copy" className="rounded-az-lg border-2 border-green p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Reviewed copy (this is what is shared)</h2>
            {inReview && <button type="button" className="text-xs text-muted underline" onClick={() => setF((p) => ({ ...p, title: r.source.title, body: r.source.body }))}>Reset from source</button>}
          </div>
          <div className="mt-3 space-y-3">
            <div><label className="text-xs font-semibold" htmlFor="rv-title">Title</label><input id="rv-title" value={f.title} onChange={set("title")} disabled={!inReview} maxLength={140} className={input} /></div>
            <div><label className="text-xs font-semibold" htmlFor="rv-body">Body (remove names, figures, exact dates, anything identifying)</label><textarea id="rv-body" value={f.body} onChange={set("body")} disabled={!inReview} rows={8} maxLength={4000} className={input} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-semibold" htmlFor="rv-ind">Industry</label><input id="rv-ind" value={f.industry} onChange={set("industry")} disabled={!inReview} className={input} /></div>
              <div><label className="text-xs font-semibold" htmlFor="rv-reg">Region (generalise)</label><input id="rv-reg" value={f.region} onChange={set("region")} disabled={!inReview} className={input} /></div>
              <div><label className="text-xs font-semibold" htmlFor="rv-per">Period</label><input id="rv-per" value={f.observationPeriod} onChange={set("observationPeriod")} disabled={!inReview} className={input} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold" htmlFor="rv-ev">Evidence type</label><select id="rv-ev" value={f.evidenceType} onChange={set("evidenceType")} disabled={!inReview} className={input}><option value="">—</option>{EVIDENCE_TYPES.map((k) => <option key={k} value={k}>{EVIDENCE_LABEL[k]}</option>)}</select></div>
              <div><label className="text-xs font-semibold" htmlFor="rv-conf">Contributor confidence</label><select id="rv-conf" value={f.confidence} onChange={set("confidence")} disabled={!inReview} className={input}><option value="">—</option>{CONFIDENCE.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
              <div><label className="text-xs font-semibold" htmlFor="rv-topic">Topic</label><select id="rv-topic" value={f.topic} onChange={set("topic")} disabled={!inReview} className={input}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
              <div><label className="text-xs font-semibold" htmlFor="rv-q">Reviewer-assessed evidence quality</label><select id="rv-q" value={f.evidenceQuality} onChange={set("evidenceQuality")} disabled={!inReview} className={input}><option value="">Not assessed</option><option value="strong">Strong</option><option value="moderate">Moderate</option><option value="limited">Limited</option></select></div>
            </div>
            <div>
              <label className="text-xs font-semibold" htmlFor="rv-attr">Attribution</label>
              <select id="rv-attr" value={f.attribution} onChange={set("attribution")} disabled={!inReview} className={input}>
                <option value="anonymous">De-identified (default)</option>
                <option value="organisation" disabled={!r.consents.attribution}>Name the organisation{r.consents.attribution ? "" : " (the author has not agreed)"}</option>
              </select>
            </div>
            <div><label className="text-xs font-semibold" htmlFor="rv-notes">Private reviewer note (never shown to the author or anyone else)</label><input id="rv-notes" value={f.privateNotes} onChange={set("privateNotes")} disabled={!inReview} maxLength={2000} className={input} /></div>
          </div>

          {flags.length > 0 && (
            <div role="alert" className="mt-4 rounded-az border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <strong>The reviewed copy still contains possible sensitive content:</strong>
              <ul className="mt-1 space-y-1">{flags.map((x, i) => <li key={i}><code className="rounded bg-white px-1">{x.match}</code> <span className="text-xs">{x.hint}</span></li>)}</ul>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-az-lg bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Decision</h2>
        <div className="mt-3">
          <label htmlFor="reason" className="text-xs font-semibold">Reason shown to the author (required for clarify, reject, unpublish, restore, withdraw)</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={600} className={input} placeholder="e.g. Please confirm the observation period." />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {r.status === "submitted" && <button disabled={busy} className={`${btn} bg-[var(--az-cta-dark)] text-white hover:bg-card`} onClick={() => run(() => call(`/api/moderation/${r.id}/start`, "POST"), "Review started.")}>Start review</button>}
          {inReview && <button disabled={busy} className={`${btn} border border-[#c9d3d9] hover:border-green`} onClick={save}>Save reviewed copy</button>}
          {(r.status === "submitted" || inReview) && <button disabled={busy} className={`${btn} border border-[#c9d3d9] hover:border-green`} onClick={() => run(() => call(`/api/moderation/${r.id}/clarify`, "POST", { reason, privateNotes: f.privateNotes || undefined }), "Returned to the author with your reason.")}>Request clarification</button>}
          {(r.status === "submitted" || inReview) && <button disabled={busy} className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`} onClick={() => run(() => call(`/api/moderation/${r.id}/reject`, "POST", { reason, privateNotes: f.privateNotes || undefined }), "Rejected. The author has been told why.")}>Reject</button>}
          {inReview && (
            <span className="flex items-center gap-3">
              {flags.length > 0 && <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="accent-[#0a6e52]" />I confirm the flagged items are safe to share</label>}
              <button disabled={busy} className={`${btn} bg-mint text-ink hover:bg-green`} onClick={() => run(() => call(`/api/moderation/${r.id}/publish`, "POST", { confirmReviewedCopyIsSafe: confirm }), "Published as a de-identified shared version.")}>Publish reviewed copy</button>
            </span>
          )}
          {live && <button disabled={busy} className={`${btn} border border-amber-500 text-amber-900 hover:bg-amber-50`} onClick={() => run(() => call(`/api/moderation/${r.id}/unpublish`, "POST", { reason }), "Paused: removed from search and AIRA straight away.")}>Unpublish during review</button>}
          {paused && <button disabled={busy} className={`${btn} bg-mint text-ink hover:bg-green`} onClick={() => run(() => call(`/api/moderation/${r.id}/restore`, "POST", { reason }), "Restored to the shared feed.")}>Restore</button>}
          {paused && <button disabled={busy} className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`} onClick={() => run(() => call(`/api/moderation/${r.id}/withdraw`, "POST", { reason }), "Withdrawn. The contributor has been told.")}>Withdraw</button>}
        </div>
        {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={`mt-4 rounded-az p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-800" : "bg-green/20 text-ink"}`}>{msg.text}</p>}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-text">What the author sees</h2>
          <ol className="mt-2 space-y-2 border-l-2 border-panel pl-4 text-sm text-ink">{r.timeline.map((t, i) => <li key={i}><strong>{t.to.replace(/_/g, " ")}</strong>{t.note ? ` — ${t.note}` : ""}</li>)}</ol>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Moderation record (private)</h2>
          <ol className="mt-2 space-y-2 border-l-2 border-panel pl-4 text-sm text-ink">
            {r.actions.length === 0 && <li className="text-muted">No actions yet.</li>}
            {r.actions.map((a, i) => <li key={i}><strong>{a.action.replace(/_/g, " ")}</strong>{a.publicReason ? ` — ${a.publicReason}` : ""}{a.privateNotes && <span className="block text-xs text-muted">Private: {a.privateNotes}</span>}</li>)}
          </ol>
        </div>
      </section>
    </div>
  );
}
