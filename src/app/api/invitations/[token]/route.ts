import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/auth/http";
import { describeInvitation } from "@/lib/auth/invitations";
import { getDb } from "@/lib/db";

// Possession of the unguessable single-use token is the credential. Reveals only the org name and
// proposed role, and nothing at all for an unknown, spent or expired token.
export const GET = publicRoute(
  "invitation preview is gated by the single-use token itself",
  async (_req, { params }) => {
    const { token } = await params;
    const info = await describeInvitation(getDb(), token);
    return info ? NextResponse.json(info) : NextResponse.json({ error: "invalid_invitation" }, { status: 404 });
  },
  { mutating: false },
);
