"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A small button or select that sends one request and refreshes. The server decides whether it is allowed. */
export function JsonAction({
  url, method = "POST", body, label, tone = "outline",
}: { url: string; method?: "POST" | "PATCH"; body: unknown; label: string; tone?: "outline" | "solid" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function run() {
    setBusy(true);
    setError(false);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(true);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${tone === "solid" ? "bg-[var(--az-cta-dark)] text-white hover:bg-card" : "border border-[#c9d3d9] text-ink hover:border-green"}`}
      >
        {label}
      </button>
      {error && <span role="alert" className="text-xs text-red-700">Not allowed</span>}
    </span>
  );
}

export function StatusSelect({ url, value, options }: { url: string; value: string; options: string[] }) {
  const router = useRouter();
  const [error, setError] = useState(false);
  async function change(next: string) {
    setError(false);
    const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) });
    if (!res.ok) return setError(true);
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label="Status" defaultValue={value} onChange={(e) => change(e.target.value)} className="rounded-full border border-[#c9d3d9] bg-white px-3 py-1 text-sm">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <span role="alert" className="text-xs text-red-700">Not allowed</span>}
    </span>
  );
}
