import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/SignInForm";
import { getSession } from "@/lib/auth/http";
import { landingFor } from "@/lib/auth/landing";

export const metadata = { title: "Sign in | azentio.ai" };

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect(landingFor(session));
  return (
    <AuthShell label="Secure access" title="Sign in to azentio.ai">
      <SignInForm devMailbox={process.env.NODE_ENV !== "production"} />
    </AuthShell>
  );
}
