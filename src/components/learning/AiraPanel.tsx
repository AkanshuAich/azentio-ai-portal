"use client";

import { useState } from "react";

interface Result {
  answer: string;
  citations: { n: number; id: string; title: string; offering: string; observationPeriod: string | null }[];
  mode: "claude" | "retrieval" | "no_evidence";
  model: string | null;
  caveats: string[];
}

const MODE_LABEL = { claude: "AI summary", retrieval: "Plain retrieval summary (no AI model)", no_evidence: "No approved evidence found" } as const;

/** Signed-in AIRA. It answers only from approved shared observations and always shows what it relied on. */
export function AiraPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/aira/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
    setBusy(false);
    if (!res.ok) return setErr("Please ask a question of 3 to 500 characters.");
    setR(await res.json());
  }

  return (
    <section aria-labelledby="aira-h" className="rounded-az-lg bg-navy p-6 text-white">
      <h2 id="aira-h" className="text-lg font-semibold">Ask AIRA <span className="text-mint">about approved learning</span></h2>
      <p className="mt-1 text-sm text-white/70">Answers use only approved, de-identified observations you are allowed to see, and cite them. Withdrawn items are never used.</p>
      <form onSubmit={ask} className="mt-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} required aria-label="Question for AIRA" placeholder="e.g. What are firms saying about seasonal cash flow?"
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-card px-4 py-2.5 text-sm placeholder:text-white/40" />
        <button disabled={busy} className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink hover:bg-green disabled:opacity-50">{busy ? "Thinking…" : "Ask"}</button>
      </form>
      {err && <p role="alert" className="mt-3 text-sm text-red-300">{err}</p>}
      {r && (
        <div className="mt-5 space-y-4 text-sm" aria-live="polite">
          <p className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs">{MODE_LABEL[r.mode]}{r.model ? ` · ${r.model}` : ""}</p>
          <p className="whitespace-pre-line text-white/95">{r.answer}</p>
          {r.citations.length > 0 && (
            <ol className="space-y-1 text-white/80">
              {r.citations.map((c) => <li key={c.id}>[{c.n}] {c.title} <span className="text-white/50">· {c.offering}{c.observationPeriod ? ` · ${c.observationPeriod}` : ""}</span></li>)}
            </ol>
          )}
          <ul className="space-y-1 border-t border-white/15 pt-3 text-xs text-white/60">{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
