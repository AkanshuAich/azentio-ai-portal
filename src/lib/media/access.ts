import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { mediaAssets } from "@/lib/db/schema";
import { can } from "@/lib/authz/policy";
import type { Decision, Principal } from "@/lib/authz/types";
import { getObject } from "@/lib/storage/private";

export type MediaResult =
  | { status: 200; body: Buffer; contentType: string; isPublic: boolean }
  | { status: 401 | 403 | 404; reason: string };

/**
 * The single path by which media bytes leave the server. The asset row's own audience, tenant and
 * product entitlement decide access; nothing about the request URL or a client-supplied value does.
 */
export async function readMedia(db: Db, principal: Principal | null, id: string): Promise<MediaResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 404, reason: "not found" };
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!asset) return { status: 404, reason: "not found" };

  const decision: Decision = can(principal, "read", {
    audience: asset.audience,
    orgId: asset.ownerOrgId,
    entitlement: asset.productSlug,
  });
  if (!decision.allow) {
    return principal ? { status: 403, reason: decision.reason } : { status: 401, reason: decision.reason };
  }

  try {
    return {
      status: 200,
      body: await getObject(asset.storageKey),
      contentType: asset.contentType,
      isPublic: asset.audience === "public",
    };
  } catch {
    return { status: 404, reason: "not found" };
  }
}
