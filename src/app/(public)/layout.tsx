import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PublicBanner } from "@/components/site/PublicBanner";
import { AiraLauncher } from "@/components/site/AiraLauncher";

export const dynamic = "force-dynamic";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicBanner />
      <SiteHeader />
      <main id="main-content">{children}</main>
      <SiteFooter />
      <AiraLauncher />
    </>
  );
}
