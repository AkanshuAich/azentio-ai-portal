import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { getSession } from "@/lib/auth/http";

export const metadata = { title: "No workspace | azentio.ai" };

export default async function NoWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  return (
    <AuthShell label="Signed in" title="You don't have a workspace yet">
      <p className="text-white/80">
        {session.user.email} is verified, but it isn&apos;t a member of any organisation. Clients join by
        invitation from their organisation administrator; employees need approved provisioning.
      </p>
    </AuthShell>
  );
}
