"use client";

import { useState } from "react";
import Link from "next/link";

interface Answer {
  answer: string;
  citations: { title: string; href: string }[];
}

export function AiraLauncher() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/aira/public", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }),
    });
    setBusy(false);
    if (!res.ok) return setError("Please ask a question of 2 to 300 characters.");
    setResult(await res.json());
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <section aria-label="AIRA assistant" className="mb-3 w-[min(92vw,380px)] rounded-az-lg bg-card p-4 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">AIRA</p>
              <p className="text-xs text-white/60">Answers from public azentio.ai pages only.</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close AIRA" className="text-white/60 hover:text-white">✕</button>
          </div>
          <form onSubmit={ask} className="mt-3 flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} required aria-label="Ask AIRA"
              placeholder="Ask about our products…"
              className="min-w-0 flex-1 rounded-full border border-white/20 bg-navy px-4 py-2 text-sm placeholder:text-white/40" />
            <button disabled={busy} className="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">Ask</button>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          {result && (
            <div className="mt-4 text-sm">
              <p className="whitespace-pre-line text-white/90">{result.answer}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {result.citations.map((c) => (
                  <li key={c.href + c.title}>
                    <Link href={c.href} className="rounded-full border border-mint/50 px-3 py-1 text-xs text-mint hover:bg-mint hover:text-ink">{c.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="ml-auto grid h-14 w-14 place-items-center rounded-full bg-mint text-sm font-semibold text-ink shadow-xl transition hover:bg-green">
        AIRA
      </button>
    </div>
  );
}
