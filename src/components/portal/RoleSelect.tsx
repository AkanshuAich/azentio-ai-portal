"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Changes a member's role. Only client roles are offered, and the server refuses anything else regardless. */
export function RoleSelect({ userId, value }: { userId: string; value: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function change(role: string) {
    setError(null);
    const res = await fetch(`/api/client/members/${userId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    if (!res.ok) return setError(res.status === 403 ? "Not allowed" : "Couldn't change the role");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label="Role" defaultValue={value} onChange={(e) => change(e.target.value)} className="rounded-full border border-[#c9d3d9] bg-white px-3 py-1 text-sm">
        <option value="client_member">Member</option>
        <option value="client_admin">Administrator</option>
      </select>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
