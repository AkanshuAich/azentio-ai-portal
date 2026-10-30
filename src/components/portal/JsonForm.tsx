"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "date" | "datetime-local" | "url" | "checkbox";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string | boolean;
  hint?: string;
}

const input = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-ink focus:border-green";

/**
 * Posts JSON and refreshes the page. Client-side checks are conveniences only: the server validates
 * every field again and is the authority, including for any field this form does not show.
 */
export function JsonForm({
  url, method = "POST", fields, submit, extra,
}: { url: string; method?: "POST" | "PATCH"; fields: FormField[]; submit: string; extra?: Record<string, unknown> }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      if (f.type === "checkbox") body[f.name] = fd.get(f.name) === "on";
      else {
        const v = String(fd.get(f.name) ?? "").trim();
        if (v !== "") body[f.name] = f.type === "datetime-local" ? new Date(v).toISOString() : v;
      }
    }
    setState("busy");
    setMessage(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      form.reset();
      setState("done");
      router.refresh();
      return;
    }
    setState("error");
    setMessage(res.status === 403 ? "You don't have permission to do that." : "Please check the details and try again.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields.map((f) => (
        <div key={f.name}>
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name={f.name} defaultChecked={Boolean(f.defaultValue)} className="h-4 w-4 accent-[#0a6e52]" />
              {f.label}
            </label>
          ) : (
            <>
              <label htmlFor={`${url}-${f.name}`} className="text-sm font-semibold text-ink">{f.label}</label>
              {f.type === "textarea" ? (
                <textarea id={`${url}-${f.name}`} name={f.name} rows={4} required={f.required} maxLength={f.maxLength} placeholder={f.placeholder} defaultValue={String(f.defaultValue ?? "")} className={input} />
              ) : f.type === "select" ? (
                <select id={`${url}-${f.name}`} name={f.name} defaultValue={String(f.defaultValue ?? "")} className={input}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={`${url}-${f.name}`} name={f.name} type={f.type ?? "text"} required={f.required} maxLength={f.maxLength} placeholder={f.placeholder} defaultValue={String(f.defaultValue ?? "")} className={input} />
              )}
            </>
          )}
          {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
        </div>
      ))}
      <button disabled={state === "busy"} className="rounded-full bg-[var(--az-cta-dark)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-card disabled:opacity-50">
        {submit}
      </button>
      {state === "done" && <p role="status" className="text-sm text-accent-text">Saved.</p>}
      {state === "error" && <p role="alert" className="text-sm text-red-700">{message}</p>}
    </form>
  );
}
