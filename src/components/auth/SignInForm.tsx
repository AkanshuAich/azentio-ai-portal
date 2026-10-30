"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "./AuthShell";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function SignInForm({ next, devMailbox }: { next?: string; devMailbox: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    await post("/api/auth/request-code", { email });
    setBusy(false);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/auth/verify-code", { email, code });
    setBusy(false);
    if (!ok) return setError("That code is not valid or has expired.");
    router.push(next ?? data.next ?? "/");
    router.refresh();
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode} className="space-y-4">
        <label className="block text-sm text-white/80" htmlFor="email">Work or invited email address</label>
        <input id="email" type="email" required autoComplete="email" className={inputClass}
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <button className={buttonClass} disabled={busy}>Email me a sign-in code</button>
        <p className="text-xs text-white/60">
          Employees sign in with an approved @azentio.com address. Clients join by invitation.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {/* Identical wording for every address, so this screen cannot be used to discover who has an account. */}
      <p className="text-sm text-white/80">
        If this address is eligible to sign in, a six-digit code has been queued for it. Enter it below.
        The code expires in 10 minutes.
      </p>
      <label className="block text-sm text-white/80" htmlFor="code">Sign-in code</label>
      <input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code"
        className={`${inputClass} tracking-[0.5em]`} value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex items-center gap-4">
        <button className={buttonClass} disabled={busy || code.length !== 6}>Sign in</button>
        <button type="button" className="text-sm text-white/70 underline" onClick={() => setStep("email")}>
          Use a different address
        </button>
      </div>
      {devMailbox && (
        <p className="text-xs text-white/50">
          Development only: no email is sent. Read the code in the{" "}
          <a className="underline" href="/dev/mailbox" target="_blank" rel="noreferrer">dev mailbox</a>.
        </p>
      )}
    </form>
  );
}
