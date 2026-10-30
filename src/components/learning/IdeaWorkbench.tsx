"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IDEA_LABEL, IDEA_STATUSES } from "@/lib/learning/idea-constants";

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm text-ink";

/** Status changes are audited with their from and to. A client update is scanned and notifies supporting contributors. */
export function IdeaWorkbench({ id, status, evidence, available }: { id: string; status: string; evidence: { id: string; title: string }[]; available: { id: string; title: string }[] }) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [pick, setPick] = useState(available[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function call(url: string, method: string, body: unknown, ok: string) {
    setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setMsg({ tone: "ok", text: typeof data.notified === "number" ? `${ok} ${data.notified} contributor${data.notified === 1 ? "" : "s"} notified in-app.` : ok }); router.refresh(); }
    else setMsg({ tone: "err", text: res.status === 403 ? "Not allowed. This idea may be assigned to someone else, or the update contains likely-sensitive content." : "Check the details." });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-az-lg bg-panel p-5 text-ink">
        <h2 className="text-lg font-semibold">Status</h2>
        <div className="mt-2 flex items-center gap-3">
          <select aria-label="Status" value={status} onChange={(e) => call(`/api/ideas/${id}`, "PATCH", { status: e.target.value }, "Status updated and audited.")} className="rounded-full border border-[#c9d3d9] bg-white px-4 py-2 text-sm">
            {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_LABEL[s]}</option>)}
          </select>
          <span className="text-xs text-muted">Every change is audited with its from and to.</span>
        </div>
      </section>

      <section className="rounded-az-lg bg-panel p-5 text-ink">
        <h2 className="text-lg font-semibold">Supporting evidence</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {evidence.length === 0 && <li className="text-muted">No approved evidence linked yet.</li>}
          {evidence.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 rounded-az bg-white p-3">
              <span>{e.title}</span>
              <button className="text-xs text-muted underline" onClick={() => call(`/api/ideas/${id}/evidence`, "POST", { publicationId: e.id, action: "unlink" }, "Unlinked.")}>Unlink</button>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <div className="mt-3 flex gap-2">
            <select aria-label="Approved observation" value={pick} onChange={(e) => setPick(e.target.value)} className={input}>{available.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select>
            <button className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card" onClick={() => call(`/api/ideas/${id}/evidence`, "POST", { publicationId: pick, action: "link" }, "Linked.")}>Link</button>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Only the reviewed, de-identified copy is linked. You never see a private source. A withdrawn item drops out automatically.</p>
      </section>

      <section className="rounded-az-lg bg-panel p-5 text-ink">
        <h2 className="text-lg font-semibold">Close the loop with clients</h2>
        <p className="mt-1 text-sm text-text">Publish a plain-language update. It names no client, carries no private detail, and is not a delivery promise. Contributors whose approved observations support this idea are notified in-app.</p>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={500} aria-label="Client-facing update" className={`${input} mt-3`} placeholder="e.g. We are exploring a seasonality-aware comparison. This is under review, not a delivery commitment." />
        <button className="mt-3 rounded-full bg-mint px-6 py-2 text-sm font-semibold text-ink hover:bg-green" onClick={() => call(`/api/ideas/${id}/client-update`, "POST", { summary }, "Update published.")}>Publish update to clients</button>
      </section>

      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={`rounded-az p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-800" : "bg-green/20 text-ink"}`}>{msg.text}</p>}
    </div>
  );
}
