"use client";

import { useRouter } from "next/navigation";
import { Wordmark } from "./AuthShell";

interface Workspace {
  orgId: string;
  orgName: string;
  role: string;
  termsAccepted: boolean;
}

/**
 * Shows the active organisation and, for multi-membership users, a switcher. This is display only:
 * every protected page and API still checks the server-side session.
 */
export function PortalHeader({
  displayName, activeOrgId, workspaces,
}: { displayName: string; activeOrgId: string | null; workspaces: Workspace[] }) {
  const router = useRouter();
  const active = workspaces.find((w) => w.orgId === activeOrgId);
  const switchable = workspaces.filter((w) => w.termsAccepted);

  async function switchTo(orgId: string) {
    const res = await fetch("/api/auth/switch-workspace", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(data.next ?? "/");
      router.refresh();
    }
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/signin");
    router.refresh();
  }

  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-white/70">Active organisation:</span>
          {switchable.length > 1 ? (
            <select aria-label="Switch workspace" value={activeOrgId ?? ""} onChange={(e) => switchTo(e.target.value)}
              className="rounded-full border border-white/20 bg-card px-3 py-1.5">
              {!active && <option value="">Choose a workspace</option>}
              {switchable.map((w) => <option key={w.orgId} value={w.orgId}>{w.orgName}</option>)}
            </select>
          ) : (
            <strong className="font-semibold text-mint">{active?.orgName ?? "None"}</strong>
          )}
          <span className="text-white/50">{displayName}</span>
          <button onClick={signOut} className="rounded-full border border-white/30 px-4 py-1.5 hover:border-mint">Sign out</button>
        </div>
      </div>
    </header>
  );
}
