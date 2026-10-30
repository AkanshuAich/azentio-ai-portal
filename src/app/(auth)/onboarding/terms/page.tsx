import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ActionButton } from "@/components/auth/ActionButton";
import { getSession } from "@/lib/auth/http";
import { landingFor } from "@/lib/auth/landing";

export const metadata = { title: "Workspace terms | azentio.ai" };

export default async function TermsPage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  const pending = session.workspaces.find((w) => !w.termsAccepted);
  if (!pending) redirect(landingFor(session));

  return (
    <AuthShell label="Before you enter" title={`Welcome to ${pending.orgName}`}>
      <div className="space-y-5 text-sm leading-relaxed text-white/80">
        <section>
          <h2 className="font-semibold text-white">Workspace terms</h2>
          <p className="mt-1">
            This workspace is for {pending.orgName} only. You will see the offerings and sessions your
            organisation is entitled to, and your organisation&apos;s own contributions. Other organisations&apos;
            private information is never shown here.
          </p>
        </section>
        <section>
          <h2 className="font-semibold text-white">How learning is shared</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Everything you write starts as a <strong>private draft</strong>. Saving never shares it.</li>
            <li>You choose, per contribution: private to you, within your organisation, or proposed to the approved learning community.</li>
            <li>Proposed contributions are reviewed and de-identified by a moderator before anyone outside your organisation sees them.</li>
            <li>You can withdraw a shared contribution at any time. Material already viewed or copied elsewhere cannot be recalled automatically.</li>
          </ul>
        </section>
        <p className="rounded-az border border-mint/40 p-3 text-white">
          Joining a workspace is <strong>not</strong> consent to share your data or to train any model on it.
          Those are separate choices, made per contribution.
        </p>
      </div>
      <div className="mt-6">
        <ActionButton
          url="/api/auth/terms"
          body={{ orgId: pending.orgId, acknowledged: true }}
          requireCheck="I have read the workspace terms and the learning-sharing explanation."
        >
          Enter workspace
        </ActionButton>
      </div>
    </AuthShell>
  );
}
