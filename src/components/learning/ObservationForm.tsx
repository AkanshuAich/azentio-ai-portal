"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONFIDENCE, CONSENT_COPY, CONSENT_KINDS, EVIDENCE_LABEL, EVIDENCE_TYPES, KINDS, KIND_LABEL, SHARING, SHARING_LABEL, draftSchema,
} from "@/lib/learning/validation";
import { SCAN_DISCLAIMER } from "@/lib/learning/scanner";

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-ink focus:border-green";

export interface ObservationValues {
  kind: string; title: string; body: string; offering: string; industry: string; region: string; observationPeriod: string;
  evidenceType: string; confidence: string; sharingChoice: string;
}

const EMPTY: ObservationValues = {
  kind: "market_observation", title: "", body: "", offering: "", industry: "", region: "", observationPeriod: "",
  evidenceType: "", confidence: "", sharingChoice: "private",
};

/**
 * Capture form. Saving always creates or updates a PRIVATE draft: it never shares anything. Checks here are
 * a convenience and use the same schema as the server, which validates again and is the authority.
 */
export function ObservationForm({
  mode, id, initial, offerings, published = false,
}: { mode: "create" | "edit"; id?: string; initial?: Partial<ObservationValues>; offerings: { slug: string; name: string }[]; published?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<ObservationValues>({ ...EMPTY, offering: offerings[0]?.slug ?? "", ...initial });
  const [consents, setConsents] = useState({ store_process: false, publish_shared: false, attribution: false, model_training: false });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof ObservationValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = { ...v, evidenceType: v.evidenceType || undefined, confidence: v.confidence || undefined };
    const parsed = draftSchema.safeParse(payload);
    if (!parsed.success) return setErrors(parsed.error.flatten().fieldErrors);
    if (mode === "create" && !consents.store_process) return setMsg({ tone: "err", text: "Please allow us to store and process your draft. It stays private to you." });
    setErrors({});
    setBusy(true);
    const res = await fetch(mode === "create" ? "/api/contributions" : `/api/contributions/${id}`, {
      method: mode === "create" ? "POST" : "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "create" ? { fields: payload, consents } : payload),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ tone: "err", text: res.status === 403 ? "You can't edit this right now." : "Please check the details and try again." });
    const flags: string[] = data.sensitiveFlags ?? [];
    if (mode === "create") return router.push(`/workspace/observations/${data.id}`);
    setMsg(flags.length
      ? { tone: "warn", text: `Saved. The scan flagged possible ${flags.join(", ").replace(/_/g, " ")}. Please remove identifying detail. ${SCAN_DISCLAIMER}` }
      : { tone: "ok", text: data.newVersion ? "Saved as a new version and sent for renewed review." : "Saved. It is still private until you choose otherwise." });
    router.refresh();
  }

  const err = (k: string) => errors[k] && <p role="alert" className="mt-1 text-sm text-red-700">{errors[k]![0]}</p>;

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <div role="note" className="rounded-az-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Please leave out</strong> customer names, account numbers, transaction-level data, credentials and confidential contract terms. Use
        synthetic or generalised examples. {SCAN_DISCLAIMER}
      </div>
      {published && (
        <p className="rounded-az-lg border border-green p-4 text-sm text-ink">
          This is shared. Saving a change creates a <strong>new version</strong> that a moderator reviews again. What is already shared stays as it was until then.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="text-sm font-semibold">What kind of contribution is this?</label>
          <select id="kind" value={v.kind} onChange={set("kind")} className={input}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        </div>
        <div>
          <label htmlFor="offering" className="text-sm font-semibold">Which offering does it relate to?</label>
          <select id="offering" value={v.offering} onChange={set("offering")} className={input}>{offerings.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</select>
          {err("offering")}
        </div>
      </div>

      <div>
        <label htmlFor="title" className="text-sm font-semibold">Title</label>
        <input id="title" value={v.title} onChange={set("title")} maxLength={140} className={input} />
        {err("title")}
      </div>
      <div>
        <label htmlFor="body" className="text-sm font-semibold">Describe it</label>
        <textarea id="body" value={v.body} onChange={set("body")} rows={6} maxLength={4000} className={input} />
        <p className="mt-1 text-xs text-muted">{v.body.length} / 4000. At least 30 characters to submit for review.</p>
        {err("body")}
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div><label htmlFor="industry" className="text-sm font-semibold">Industry</label><input id="industry" value={v.industry} onChange={set("industry")} maxLength={80} placeholder="e.g. Banking" className={input} /></div>
        <div><label htmlFor="region" className="text-sm font-semibold">Region</label><input id="region" value={v.region} onChange={set("region")} maxLength={80} placeholder="Broad, e.g. GCC" className={input} /></div>
        <div><label htmlFor="period" className="text-sm font-semibold">Period covered</label><input id="period" value={v.observationPeriod} onChange={set("observationPeriod")} maxLength={40} placeholder="e.g. 2026-H1" className={input} /></div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="evidence" className="text-sm font-semibold">Evidence type</label>
          <select id="evidence" value={v.evidenceType} onChange={set("evidenceType")} className={input}>
            <option value="">Choose…</option>{EVIDENCE_TYPES.map((k) => <option key={k} value={k}>{EVIDENCE_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="confidence" className="text-sm font-semibold">How confident are you?</label>
          <select id="confidence" value={v.confidence} onChange={set("confidence")} className={input}>
            <option value="">Choose…</option>{CONFIDENCE.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Who might see it?</legend>
        <p className="text-xs text-muted">Saving never changes who sees it beyond what you choose here, and a draft stays private to you until you act.</p>
        <div className="mt-2 space-y-2">
          {SHARING.filter((s) => !published || s === "propose_shared").map((s) => (
            <label key={s} className="flex items-start gap-3 text-sm">
              <input type="radio" name="sharing" checked={v.sharingChoice === s} onChange={() => setV((p) => ({ ...p, sharingChoice: s }))} className="mt-1 accent-[#0a6e52]" />
              <span><strong>{SHARING_LABEL[s]}</strong>
                {s === "organisation" && <span className="block text-xs text-muted">Colleagues only see it after you choose &quot;Share with my organisation&quot; on the next screen.</span>}
                {s === "propose_shared" && <span className="block text-xs text-muted">A moderator reviews and de-identifies it first. Nothing is shared until they approve.</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "create" && (
        <fieldset className="rounded-az-lg bg-panel p-5">
          <legend className="px-1 text-sm font-semibold">Your permissions (each one is separate)</legend>
          <div className="mt-2 space-y-3">
            {CONSENT_KINDS.map((k) => (
              <label key={k} className="flex items-start gap-3 text-sm text-ink">
                <input type="checkbox" checked={consents[k]} onChange={(e) => setConsents((c) => ({ ...c, [k]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[#0a6e52]" />
                <span><strong>{CONSENT_COPY[k].label}</strong>{CONSENT_COPY[k].required === "always" && " (needed to save)"}<span className="block text-xs text-text">{CONSENT_COPY[k].text}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Joining a workspace is not consent to share or to train. You can change these later.</p>
        </fieldset>
      )}

      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={`rounded-az p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-800" : msg.tone === "warn" ? "bg-amber-50 text-amber-950" : "bg-green/20 text-ink"}`}>{msg.text}</p>}

      <button disabled={busy} className="rounded-full bg-[var(--az-cta-dark)] px-7 py-3 font-semibold text-white transition hover:bg-card disabled:opacity-50">
        {mode === "create" ? "Save private draft" : "Save changes"}
      </button>
    </form>
  );
}
