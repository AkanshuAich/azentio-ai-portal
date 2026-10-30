import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { clientView } from "@/lib/federated/service";

// A client sees its own participation and the deployed model only. The organisation comes from the session.
export const GET = authedRoute(
  async (_req, { db, session }) => NextResponse.json(await clientView(db, session.principal)),
  { mutating: false },
);
