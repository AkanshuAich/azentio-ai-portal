import { AuthShell } from "@/components/auth/AuthShell";
import { ActionButton } from "@/components/auth/ActionButton";
import { SignInForm } from "@/components/auth/SignInForm";
import { getSession } from "@/lib/auth/http";
import { describeInvitation } from "@/lib/auth/invitations";
import { getDb } from "@/lib/db";

export const metadata = { title: "Accept invitation | azentio.ai" };

const ROLE_LABEL: Record<string, string> = { client_member: "member", client_admin: "administrator" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await describeInvitation(getDb(), token);

  // Unknown, spent and expired tokens all look the same.
  if (!invite) {
    return (
      <AuthShell label="Invitation" title="This invitation can't be used">
        <p className="text-white/80">
          It may have expired, already been accepted, or been issued to a different account. Ask your
          organisation administrator to send a new one.
        </p>
      </AuthShell>
    );
  }

  const session = await getSession();
  return (
    <AuthShell label="Invitation" title={`Join ${invite.orgName}`}>
      <p className="mb-6 text-white/80">
        You have been invited to join <strong className="text-white">{invite.orgName}</strong> as a{" "}
        {ROLE_LABEL[invite.role] ?? invite.role}. Sign in with the email address the invitation was sent to.
      </p>
      {session ? (
        <ActionButton url="/api/invitations/accept" body={{ token }}>
          Accept as {session.user.email}
        </ActionButton>
      ) : (
        <SignInForm next={`/invite/${token}`} devMailbox={process.env.NODE_ENV !== "production"} />
      )}
    </AuthShell>
  );
}
