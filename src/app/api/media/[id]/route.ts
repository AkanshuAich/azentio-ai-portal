import { NextResponse } from "next/server";
import { policyRoute } from "@/lib/auth/http";
import { readMedia } from "@/lib/media/access";

// Media is public only when the asset is explicitly marked public; anonymous callers reach exactly those.
// This route is the only way bytes leave private storage, so direct URL access is checked every time.
export const GET = policyRoute(async (_req, { db, session, params }) => {
  const result = await readMedia(db, session?.principal ?? null, params.id);

  if (result.status !== 200) {
    const error = result.status === 404 ? "not_found" : result.status === 401 ? "unauthenticated" : "forbidden";
    return NextResponse.json({ error }, { status: result.status });
  }
  return new NextResponse(new Uint8Array(result.body), {
    headers: {
      "content-type": result.contentType,
      "content-length": String(result.body.length),
      "x-content-type-options": "nosniff",
      // Stops any embedded script in a served file from running with this origin's privileges.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": result.isPublic ? "public, max-age=300" : "private, no-store",
    },
  });
});
