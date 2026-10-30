import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { liveSessions, mediaAssets, releaseNotes } from "@/lib/db/schema";
import type { AudienceKind, Resource } from "@/lib/authz/types";

export const RESOURCE_TYPES = ["media", "release_note", "live_session"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface LoadedResource {
  type: ResourceType;
  id: string;
  title: string;
  href: string;
  /** What the policy engine needs. Always taken from the stored row, never from the request. */
  resource: Resource;
  audience: AudienceKind;
  ownerOrgId: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Loads the stored audience metadata for a resource, or null if it does not exist. */
export async function loadResource(db: Db, type: ResourceType, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  if (type === "media") {
    const [r] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return r ? { type, id, title: r.title, href: `/api/media/${r.id}`, audience: r.audience, ownerOrgId: r.ownerOrgId, resource: { audience: r.audience, orgId: r.ownerOrgId, entitlement: r.productSlug } } : null;
  }
  if (type === "release_note") {
    const [r] = await db.select().from(releaseNotes).where(eq(releaseNotes.id, id));
    return r ? { type, id, title: r.title, href: "/workspace/resources", audience: r.audience, ownerOrgId: r.ownerOrgId, resource: { audience: r.audience, orgId: r.ownerOrgId } } : null;
  }
  const [r] = await db.select().from(liveSessions).where(eq(liveSessions.id, id));
  return r ? { type, id, title: r.title, href: "/workspace/resources", audience: r.audience, ownerOrgId: r.ownerOrgId, resource: { audience: r.audience, orgId: r.ownerOrgId } } : null;
}
