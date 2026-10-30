import Link from "next/link";

export function Wordmark() {
  return (
    <Link href="/" className="text-2xl font-semibold tracking-tight text-white">
      azentio<span className="text-mint">.ai</span>
    </Link>
  );
}

/** Shared navy shell for sign-in, invitation and onboarding screens. */
export function AuthShell({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-navy px-6 py-10 text-white">
      <div className="mx-auto max-w-[480px]">
        <Wordmark />
        <p className="mt-14 text-xs font-semibold uppercase tracking-[0.2em] text-mint">{label}</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight">{title}</h1>
        <div className="mt-8 rounded-az-lg bg-card p-6 shadow-[0_2px_12px_rgba(0,0,0,0.25)]">{children}</div>
      </div>
    </main>
  );
}

export const inputClass =
  "w-full rounded-az border border-white/20 bg-navy px-4 py-3 text-white placeholder:text-white/40 focus:border-mint";
export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-mint px-6 py-3 font-semibold text-ink transition hover:bg-green disabled:opacity-50";
