"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "./AuthShell";

/** POSTs JSON, then follows the server's `next` redirect. Authority is decided by the server, not here. */
export function ActionButton({
  url, body, children, className = buttonClass, requireCheck,
}: {
  url: string;
  body: unknown;
  children: React.ReactNode;
  className?: string;
  /** When set, the button stays disabled until the checkbox with this label is ticked. */
  requireCheck?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(!requireCheck);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError("That didn't work. The invitation may be invalid, expired or issued to a different account.");
    router.push(data.next ?? "/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {requireCheck && (
        <label className="flex items-start gap-3 text-sm text-white/80">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[#55ffbe]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>{requireCheck}</span>
        </label>
      )}
      <button className={className} disabled={busy || !checked} onClick={run}>{children}</button>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
