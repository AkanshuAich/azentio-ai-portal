"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JsonForm } from "@/components/portal/JsonForm";

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm text-ink";

/** Moderators curate themes: create one, then link live approved observations to it. */
export function ThemeCurator({ themes, items, offerings }: { themes: { id: string; title: string }[]; items: { id: string; title: string }[]; offerings: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [pub, setPub] = useState(items[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  async function link(action: "link" | "unlink") {
    setMsg(null);
    const res = await fetch(`/api/moderation/themes/${themeId}/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicationId: pub, action }) });
    setMsg(res.ok ? (action === "link" ? "Linked." : "Unlinked.") : "Not allowed, or that item is no longer live.");
    if (res.ok) router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-az-lg bg-panel p-5 text-ink">
        <h2 className="mb-3 text-lg font-semibold">Create a theme</h2>
        <JsonForm url="/api/moderation/themes" submit="Create theme" fields={[
          { name: "title", label: "Title", required: true, maxLength: 120 },
          { name: "summary", label: "Summary", type: "textarea", required: true, maxLength: 600 },
          { name: "offering", label: "Offering", type: "select", defaultValue: offerings[0]?.slug, options: offerings.map((o) => ({ value: o.slug, label: o.name })) },
          { name: "limitations", label: "Known limitations (optional)", maxLength: 400 },
        ]} />
      </div>
      <div className="rounded-az-lg bg-panel p-5 text-ink">
        <h2 className="mb-3 text-lg font-semibold">Link evidence to a theme</h2>
        <label htmlFor="th" className="text-sm font-semibold">Theme</label>
        <select id="th" value={themeId} onChange={(e) => setThemeId(e.target.value)} className={input}>{themes.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
        <label htmlFor="pb" className="mt-3 block text-sm font-semibold">Approved observation</label>
        <select id="pb" value={pub} onChange={(e) => setPub(e.target.value)} className={input}>{items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
        <div className="mt-4 flex gap-3">
          <button onClick={() => link("link")} disabled={!themeId || !pub} className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card disabled:opacity-50">Link</button>
          <button onClick={() => link("unlink")} disabled={!themeId || !pub} className="rounded-full border border-[#c9d3d9] px-5 py-2 text-sm font-semibold hover:border-green disabled:opacity-50">Unlink</button>
        </div>
        {msg && <p role="status" className="mt-3 text-sm text-text">{msg}</p>}
        <p className="mt-4 text-xs text-muted">Only live approved items can be linked. A withdrawn or paused item drops out of every theme automatically.</p>
      </div>
    </div>
  );
}
