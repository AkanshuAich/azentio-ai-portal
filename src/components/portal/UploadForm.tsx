"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-ink focus:border-green";

export function UploadForm({ sessions, orgs, products }: { sessions: { id: string; title: string }[]; orgs: { id: string; name: string }[]; products: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState("busy");
    const res = await fetch("/api/publishing/media", { method: "POST", body: new FormData(form) });
    if (res.ok) {
      form.reset();
      setState("done");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setState("error");
    setMessage(res.status === 403 ? "You don't have permission to publish." : data.reason ?? "Upload failed.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="up-title" className="text-sm font-semibold">Title</label>
        <input id="up-title" name="title" required maxLength={140} className={input} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="up-kind" className="text-sm font-semibold">Kind</label>
          <select id="up-kind" name="kind" defaultValue="recording" className={input}>
            <option value="recording">Recording</option><option value="video">Video</option>
            <option value="image">Image</option><option value="document">Document</option>
          </select>
        </div>
        <div>
          <label htmlFor="up-aud" className="text-sm font-semibold">Audience</label>
          <select id="up-aud" name="audience" defaultValue="employee" className={input}>
            <option value="employee">Employees only</option><option value="public">Public</option>
            <option value="tenant">One client organisation</option><option value="entitled">Clients entitled to a product</option>
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="up-org" className="text-sm font-semibold">Client organisation</label>
          <select id="up-org" name="orgId" defaultValue="" className={input}>
            <option value="">(only for One client organisation)</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="up-product" className="text-sm font-semibold">Product</label>
          <select id="up-product" name="productSlug" defaultValue="" className={input}>
            <option value="">(only for Clients entitled to a product)</option>
            {products.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="up-session" className="text-sm font-semibold">Attach to live session (optional)</label>
        <select id="up-session" name="liveSessionId" defaultValue="" className={input}>
          <option value="">None</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="up-file" className="text-sm font-semibold">File</label>
        <input id="up-file" name="file" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm" className={input} />
        <p className="mt-1 text-xs text-muted">PNG, JPEG, WebP, PDF, MP4 or WebM, up to 25 MB. The type is checked from the file contents. Stored privately.</p>
      </div>
      <button disabled={state === "busy"} className="rounded-full bg-[var(--az-cta-dark)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-card disabled:opacity-50">Upload</button>
      {state === "done" && <p role="status" className="text-sm text-accent-text">Uploaded.</p>}
      {state === "error" && <p role="alert" className="text-sm text-red-700">{message}</p>}
    </form>
  );
}
