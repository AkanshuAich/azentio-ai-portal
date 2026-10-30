import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";

export const GET = authedRoute(
  async (_req, { session }) =>
    NextResponse.json({
      user: session.user,
      activeOrgId: session.principal.activeOrgId,
      isEmployee: session.principal.isEmployee,
      workspaces: session.workspaces,
    }),
  { mutating: false },
);
