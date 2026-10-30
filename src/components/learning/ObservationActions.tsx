"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONSENT_COPY } from "@/lib/learning/validation";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/** Author actions. The server decides what is allowed; these buttons only reflect what it reported. */
export function ObservationActions({
  id, canSubmit, canWithdraw, sharingChoice, orgShared, consents, published,
}: {
  id: string; canSubmit: boolean; canWithdraw: boolean; sharingChoice: string; orgShared: boolean; published: boolean;
  consents: { publish_shared: boolean; attribution: boolean; model_training: boolean } | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>, ok: (d: Record<string, unknown>) => string) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.ok ? ok(r.data) : r.status === 400 ? "Some required details are missing or too short. Edit it and try again." : "That isn't allowed right now.");
    if (r.ok) router.refresh();
  }

  const btn = "rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {canSubmit && <button disabled={busy} className={`${btn} bg-[var(--az-cta-dark)] text-white hover:bg-card`} onClick={() => act(() => call(`/api/contributions/${id}/submit`, "POST"), (d) => (Array.isArray(d.sensitiveFlags) && d.sensitiveFlags.length ? `Submitted. The scan flagged possible ${(d.sensitiveFlags as string[]).join(", ").replace(/_/g, " ")}, so a moderator will look closely. A scan isn't a guarantee.` : "Submitted for review. You'll be told here when its status changes."))}>Submit for review</button>}
        {sharingChoice === "organisation" && !orgShared && <button disabled={busy} className={`${btn} border border-[#c9d3d9] hover:border-green`} onClick={() => act(() => call(`/api/contributions/${id}/share`, "POST", { share: true }), () => "Shared with your organisation.")}>Share with my organisation</button>}
        {orgShared && <button disabled={busy} className={`${btn} border border-[#c9d3d9] hover:border-green`} onClick={() => act(() => call(`/api/contributions/${id}/share`, "POST", { share: false }), () => "No longer shared with your organisation.")}>Stop sharing with my organisation</button>}
        {canWithdraw && <button disabled={busy} className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`}
          onClick={() => { if (window.confirm(published ? "Withdraw this? It will be removed from search and AIRA straight away. People who already saw it, or copied it elsewhere, can't be reached." : "Withdraw this contribution?")) void act(() => call(`/api/contributions/${id}/withdraw`, "POST"), (d) => `Withdrawn. Removed from ${Number(d.searchEntriesRemoved ?? 0)} search entries and ${Number(d.retrievalChunksRemoved ?? 0)} AIRA passages in ${Number(d.elapsedMs ?? 0)} ms.`); }}>Withdraw</button>}
      </div>

      {consents && (
        <fieldset className="rounded-az-lg bg-panel p-5">
          <legend className="px-1 text-sm font-semibold">Your permissions</legend>
          <div className="mt-2 space-y-3">
            {(["publish_shared", "attribution", "model_training"] as const).map((k) => (
              <label key={k} className="flex items-start gap-3 text-sm text-ink">
                <input type="checkbox" checked={consents[k]} disabled={busy} className="mt-1 h-4 w-4 accent-[#0a6e52]"
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (!on && k === "publish_shared" && published && !window.confirm("Withdrawing this permission also withdraws the shared version.")) return;
                    void act(() => call(`/api/contributions/${id}/consents`, "PATCH", { [k]: on }), () => "Permission updated. The change is recorded in your history.");
                  }} />
                <span><strong>{CONSENT_COPY[k].label}</strong><span className="block text-xs text-text">{CONSENT_COPY[k].text}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Withdrawing a permission can&apos;t undo what has already been viewed or copied elsewhere.</p>
        </fieldset>
      )}
      {msg && <p role="status" className="rounded-az bg-green/20 p-3 text-sm text-ink">{msg}</p>}
    </div>
  );
}
