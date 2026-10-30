"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MESSAGES: Record<string, string> = {
  cohort_too_small: "Not enough organisations are enrolled to run. The minimum cohort protects individual participants.",
  two_person_rule: "Someone other than the person who registered this model must approve it.",
  review_required: "This model is flagged for review. Clear the flag with a recorded note first.",
  illegal_state: "That step is not allowed from the model's current state.",
  already_enrolled: "This organisation is already enrolled.",
  not_enrolled: "This organisation is not enrolled.",
  consent_required: "Please tick the acknowledgement first.",
  forbidden: "Not allowed. This needs a grant (or role) you do not hold.",
};

async function send(url: string, body?: unknown): Promise<{ ok: boolean; message: string; data?: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, message: "Done.", data };
  const code = String(data.error ?? "error");
  return { ok: false, message: MESSAGES[code] ?? (typeof data.message === "string" ? data.message : "The request was refused.") };
}

const field = "rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm";

/** Starts a simulated run. Injected faults are for demonstration only and are labelled wherever the run appears. */
export function RunForm({ enrolled }: { enrolled: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [fault, setFault] = useState({ kind: "", slot: "0" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const noise = String(f.get("noise") ?? "");
    setBusy(true);
    const r = await send("/api/fl/runs", {
      rounds: Number(f.get("rounds")),
      method: f.get("method"),
      weightCap: Number(f.get("cap")),
      noiseMultiplier: noise ? Number(noise) : null,
      faults: fault.kind ? [{ slot: Number(fault.slot), kind: fault.kind }] : [],
    });
    setBusy(false);
    setStatus(r.ok ? { ok: true, message: "Run complete. A candidate model was registered; it is not in use." } : r);
    if (r.ok) router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Rounds<input name="rounds" type="number" min={1} max={20} defaultValue={8} className={`${field} mt-1 w-full`} /></label>
      <label className="text-sm">Aggregation
        <select name="method" defaultValue="fedavg" className={`${field} mt-1 w-full`}>
          <option value="fedavg">Weighted average (FedAvg, capped weights)</option>
          <option value="trimmed_mean">Coordinate-wise trimmed mean</option>
        </select>
      </label>
      <label className="text-sm">Largest share one client may hold
        <select name="cap" defaultValue="0.5" className={`${field} mt-1 w-full`}>
          <option value="1">No cap (100%)</option><option value="0.5">50%</option><option value="0.35">35%</option><option value="0.25">25%</option>
        </select>
      </label>
      <label className="text-sm">Noise on the aggregate
        <select name="noise" defaultValue="" className={`${field} mt-1 w-full`}>
          <option value="">Off: no privacy guarantee claimed</option>
          <option value="3">Gaussian, multiplier 3 (stronger)</option><option value="1.5">Gaussian, multiplier 1.5</option><option value="1">Gaussian, multiplier 1 (weaker)</option>
        </select>
      </label>
      <fieldset className="rounded-az border border-dashed border-[#c9d3d9] p-3 text-sm sm:col-span-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Injected fault (demonstration only)</legend>
        <div className="flex flex-wrap gap-3">
          <select aria-label="Fault" value={fault.kind} onChange={(e) => setFault({ ...fault, kind: e.target.value })} className={field}>
            <option value="">None</option>
            <option value="dropout">Client drops out</option>
            <option value="sign_flip">Poisoning: reversed and amplified update</option>
            <option value="scale_up">Poisoning: update scaled 100×</option>
            <option value="wrong_model_version">Invalid: stale model version</option>
            <option value="wrong_schema">Invalid: different feature schema</option>
            <option value="non_finite">Invalid: contains NaN</option>
          </select>
          <select aria-label="Which participant" value={fault.slot} onChange={(e) => setFault({ ...fault, slot: e.target.value })} className={field} disabled={!fault.kind}>
            {Array.from({ length: enrolled }, (_, i) => <option key={i} value={i}>Participant {i + 1}</option>)}
          </select>
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <button disabled={busy} className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card disabled:opacity-50">{busy ? "Running…" : "Run simulated programme"}</button>
        {status && <p role={status.ok ? "status" : "alert"} className={`mt-2 text-sm ${status.ok ? "text-accent-text" : "text-red-700"}`}>{status.message}</p>}
      </div>
    </form>
  );
}

/** Registry actions for one model version. The server enforces the grant, the two-person rule and the review flag. */
export function DecisionPanel({ id, status, needsReview, canApprove, isRegistrar }: { id: string; status: string; needsReview: boolean; canApprove: boolean; isRegistrar: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!canApprove) return <p className="text-xs text-muted">Deciding needs the federated.approve grant.</p>;

  async function act(action: string) {
    const r = await send(`/api/fl/models/${id}/decision`, { action, note: note || undefined });
    setMsg(r.ok ? null : r.message);
    if (r.ok) { setNote(""); router.refresh(); }
  }
  const btn = "rounded-full border border-[#c9d3d9] px-3 py-1 text-xs font-semibold hover:border-green disabled:opacity-40";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "candidate" && <button className={btn} onClick={() => act("approve")} disabled={isRegistrar || needsReview} title={isRegistrar ? "Two-person rule: you registered this model" : undefined}>Approve</button>}
        {(status === "candidate" || status === "approved") && <button className={btn} onClick={() => act("reject")}>Reject</button>}
        {status === "approved" && <button className={btn} onClick={() => act("deploy")} disabled={needsReview}>Deploy (registry state)</button>}
        {status === "deployed" && <button className={btn} onClick={() => act("rollback")}>Roll back</button>}
      </div>
      {needsReview && (
        <div className="flex flex-wrap gap-2">
          <input aria-label="Review note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record why this is safe to use (10+ characters)" className={`${field} min-w-[16rem] flex-1`} />
          <button className={btn} onClick={() => act("clear_review")}>Clear review flag</button>
        </div>
      )}
      {msg && <p role="alert" className="text-xs text-red-700">{msg}</p>}
    </div>
  );
}

/** The client administrator's enrolment control, with the four statements they acknowledge. */
export function EnrolPanel({ enrolled }: { enrolled: boolean }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enrol() {
    const r = await send("/api/client/federated/enrol", { acknowledge: ack });
    setMsg(r.ok ? null : r.message);
    if (r.ok) router.refresh();
  }
  async function leave() {
    if (!window.confirm("Withdraw from the programme? Future runs will exclude you. Models you already contributed to are flagged for review, but their training is not undone.")) return;
    const r = await send("/api/client/federated/withdraw");
    setMsg(r.ok ? null : r.message);
    if (r.ok) router.refresh();
  }
  return (
    <div className="space-y-3">
      {!enrolled && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          <span>I have read the four statements above and agree to enrol this organisation in the simulated programme.</span>
        </label>
      )}
      {enrolled
        ? <button onClick={leave} className="rounded-full border border-[#c9d3d9] px-5 py-2 text-sm font-semibold hover:border-red-700">Withdraw this organisation</button>
        : <button onClick={enrol} disabled={!ack} className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card disabled:opacity-50">Enrol this organisation</button>}
      {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
