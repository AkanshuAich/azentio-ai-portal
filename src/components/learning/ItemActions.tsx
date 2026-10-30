"use client";

import { useState } from "react";

/** Quality feedback and reporting on a shared item. Feedback is one vote each and is never used to rank or count publicly. */
export function ItemActions({ id, myFeedback }: { id: string; myFeedback: string | null }) {
  const [mine, setMine] = useState(myFeedback);
  const [msg, setMsg] = useState<string | null>(null);

  async function vote(value: "useful" | "needs_evidence") {
    const res = await fetch(`/api/learning/items/${id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
    if (res.ok) { setMine(value); setMsg(null); } else setMsg("Couldn't save that.");
  }

  async function report() {
    const reason = window.prompt("What is wrong with this? (misleading, confidential or inappropriate). You don't need to name any organisation.");
    if (!reason) return;
    const res = await fetch(`/api/learning/items/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setMsg(res.ok ? "Thanks. A moderator will review it. Your identity isn't shared with the contributor." : "Couldn't send the report. Please describe the problem in at least 5 characters.");
  }

  const pill = (on: boolean) => `rounded-full border px-4 py-1.5 text-sm ${on ? "border-green bg-green/30 font-semibold" : "border-[#c9d3d9] hover:border-green"}`;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white pt-3">
      <button onClick={() => vote("useful")} aria-pressed={mine === "useful"} className={pill(mine === "useful")}>Useful</button>
      <button onClick={() => vote("needs_evidence")} aria-pressed={mine === "needs_evidence"} className={pill(mine === "needs_evidence")}>Needs more evidence</button>
      <button onClick={report} className="ml-auto text-sm text-muted underline hover:text-ink">Report</button>
      {msg && <p role="status" className="basis-full text-xs text-text">{msg}</p>}
    </div>
  );
}
