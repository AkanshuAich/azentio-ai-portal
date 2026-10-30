"use client";

import { useState } from "react";
import { demoEnquirySchema, hackathonSchema } from "@/lib/validation/forms";

type Kind = "demo" | "hackathon";
type Errors = Record<string, string[] | undefined>;

const field = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-4 py-3 text-ink focus:border-green";

function Field({ id, label, error, children, hint }: {
  id: string; label: string; error?: string[]; children: React.ReactNode; hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">{error[0]}</p>}
    </div>
  );
}

export function PublicForm({ kind, defaultProduct, products }: {
  kind: Kind;
  defaultProduct?: string;
  products?: { slug: string; name: string }[];
}) {
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const demo = kind === "demo";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      ...Object.fromEntries(fd.entries()),
      contactConsent: fd.get("contactConsent") === "on",
    };

    // Same schema as the server: the server remains the authority, this just saves a round trip.
    const parsed = (demo ? demoEnquirySchema : hackathonSchema).safeParse(raw);
    if (!parsed.success) return setErrors(parsed.error.flatten().fieldErrors as Errors);

    setErrors({});
    setState("busy");
    const res = await fetch(demo ? "/api/enquiries" : "/api/hackathon/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw),
    });
    if (res.ok) return setState("done");
    const data = await res.json().catch(() => ({}));
    if (data.fields) setErrors(data.fields);
    setState("failed");
  }

  if (state === "done") {
    return (
      <div role="status" className="rounded-az-lg border border-green bg-white p-8">
        <h2 className="text-2xl font-semibold text-ink">{demo ? "Thanks, we've recorded your enquiry." : "You're on the list."}</h2>
        <p className="mt-2 text-text">
          {demo
            ? "Your request is saved for the team. We'll use the email you gave to follow up about it."
            : "We've recorded your interest. Dates and participation details will be announced."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-az-lg bg-white p-6 shadow-[var(--az-shadow-card)] sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" error={errors.name}>
          <input id="name" name="name" autoComplete="name" maxLength={100} className={field} aria-describedby="name-error" />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={254} className={field} aria-describedby="email-error" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="organisation" label={demo ? "Organisation" : "Organisation (optional)"} error={errors.organisation}>
          <input id="organisation" name="organisation" autoComplete="organization" maxLength={150} className={field} />
        </Field>
        {demo && (
          <Field id="role" label="Your role (optional)" error={errors.role}>
            <input id="role" name="role" maxLength={100} className={field} />
          </Field>
        )}
      </div>

      {demo && (
        <Field id="productSlug" label="Product of interest (optional)" error={errors.productSlug}>
          <select id="productSlug" name="productSlug" defaultValue={defaultProduct ?? ""} className={field}>
            <option value="">Not sure yet</option>
            {products?.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </Field>
      )}

      <Field
        id={demo ? "message" : "interest"}
        label={demo ? "What would you like to see?" : "What would you like to build?"}
        error={demo ? errors.message : errors.interest}
        hint="Please don't include customer names, account numbers or other confidential details."
      >
        <textarea id={demo ? "message" : "interest"} name={demo ? "message" : "interest"} rows={5} maxLength={demo ? 2000 : 1000} className={field} />
      </Field>

      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <div>
        <label className="flex items-start gap-3 text-sm text-text">
          <input type="checkbox" name="contactConsent" className="mt-1 h-4 w-4 accent-[#0a6e52]" />
          <span>
            {demo
              ? "You may contact me about this enquiry. This is only for follow-up, not marketing."
              : "You may contact me about the hackathon."}
          </span>
        </label>
        {errors.contactConsent && <p role="alert" className="mt-1 text-sm text-red-700">{errors.contactConsent[0]}</p>}
      </div>

      {state === "failed" && !Object.keys(errors).length && (
        <p role="alert" className="text-sm text-red-700">Something went wrong. Please try again in a moment.</p>
      )}
      <button disabled={state === "busy"} className="rounded-full bg-[var(--az-cta-dark)] px-7 py-3 font-semibold text-white transition hover:bg-card disabled:opacity-50">
        {demo ? "Send enquiry" : "Register interest"}
      </button>
    </form>
  );
}
