"use client";

import { useCallback, useEffect, useState } from "react";

interface C { id: string; body: string; author: string; authorId: string; createdAt: string }

/**
 * Comments live under the content they discuss and inherit its audience. The server decides who can
 * read, write, report or hide; this only renders what it returns.
 */
export function CommentThread({ parentType, parentId, me, admin }: { parentType: string; parentId: string; me: string; admin: boolean }) {
  const [items, setItems] = useState<C[] | null>(null);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?parentType=${parentType}&parentId=${parentId}`);
    setItems(res.ok ? await res.json() : []);
  }, [parentType, parentId]);

  useEffect(() => { void load(); }, [load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentType, parentId, body }) });
    if (res.ok) { setBody(""); await load(); } else setMsg("Couldn't post that comment.");
  }

  async function report(id: string) {
    const reason = window.prompt("Why are you reporting this comment? (misleading, confidential or inappropriate)");
    if (!reason) return;
    const res = await fetch(`/api/comments/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setMsg(res.ok ? "Thanks. A moderator will review it." : "Couldn't send the report.");
  }

  async function hide(id: string) {
    await fetch(`/api/comments/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="mt-4 border-t border-white pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent-text">Comments (visible to your organisation)</p>
      <ul className="mt-2 space-y-2">
        {items?.length === 0 && <li className="text-sm text-muted">No comments yet.</li>}
        {items?.map((c) => (
          <li key={c.id} className="rounded-az bg-white p-3 text-sm text-ink">
            <p><strong>{c.author}</strong> <span className="text-xs text-muted">{new Date(c.createdAt).toUTCString()}</span></p>
            <p className="mt-1 whitespace-pre-line">{c.body}</p>
            <p className="mt-2 flex gap-3 text-xs">
              {c.authorId !== me && <button onClick={() => report(c.id)} className="text-muted underline hover:text-ink">Report</button>}
              {(c.authorId === me || admin) && <button onClick={() => hide(c.id)} className="text-muted underline hover:text-ink">Remove</button>}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={post} className="mt-3 flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required aria-label="Add a comment" placeholder="Add a comment…" className="min-w-0 flex-1 rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm" />
        <button className="rounded-full bg-[var(--az-cta-dark)] px-4 py-2 text-sm font-semibold text-white hover:bg-card">Post</button>
      </form>
      {msg && <p role="status" className="mt-2 text-xs text-text">{msg}</p>}
    </div>
  );
}
