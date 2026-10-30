import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { createDraft, listMine, listOrganisation } from "@/lib/learning/contributions";
import { requireClientTenant } from "@/lib/client/service";

// The organisation comes from the session's active workspace, never from the request.
export const GET = authedRoute(
  async (req, { db, session, audit }) => {
    await requireClientTenant(session.principal, audit);
    const scope = new URL(req.url).searchParams.get("scope");
    return NextResponse.json(scope === "org" ? await listOrganisation(db, session.principal) : await listMine(db, session.principal));
  },
  { mutating: false },
);

const Body = z.object({ fields: z.unknown(), consents: z.unknown() });

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { fields, consents } = Body.parse(await req.json());
  const r = await createDraft(db, session.principal, audit, fields, consents);
  return NextResponse.json({ ok: true, ...r }, { status: 201 });
});
