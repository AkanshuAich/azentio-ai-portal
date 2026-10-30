import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/private";
import { uploadMedia } from "@/lib/employee/service";

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: "upload_rejected", reason: "file is too large" }, { status: 413 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const meta = {
    title: form.get("title"), kind: form.get("kind"), audience: form.get("audience"),
    liveSessionId: form.get("liveSessionId") || undefined,
    orgId: form.get("orgId") || undefined,
    productSlug: form.get("productSlug") || undefined,
  };
  const id = await uploadMedia(db, session.principal, audit, meta, file.type, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
