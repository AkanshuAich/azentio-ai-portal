import Link from "next/link";
import { getDb } from "@/lib/db";
import { activePublicBanner } from "@/lib/employee/service";

/** Shows the banner a publisher has switched on. Rendered as text and a validated link only. */
export async function PublicBanner() {
  const banner = await activePublicBanner(getDb());
  if (!banner) return null;
  const inner = <span>{banner.message}{banner.href && <span aria-hidden> →</span>}</span>;
  return (
    <div role="region" aria-label="Announcement" className="bg-mint px-6 py-2 text-center text-sm font-semibold text-ink">
      {banner.href ? <Link href={banner.href} className="underline-offset-2 hover:underline">{inner}</Link> : inner}
    </div>
  );
}
