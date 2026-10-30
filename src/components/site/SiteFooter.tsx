import Link from "next/link";
import { NAV } from "@/content/site";

export function SiteFooter() {
  return (
    <footer className="bg-[var(--az-footer)] text-white">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-14 md:grid-cols-3">
        <div>
          <p className="text-2xl font-semibold">azentio<span className="text-mint">.ai</span></p>
          <p className="mt-3 max-w-xs text-sm text-[#9bb2b2]">Build intelligence. Create shared value.</p>
          <p className="mt-6 text-xs text-[#9bb2b2]">
            Part of the Azentio family.{" "}
            <a className="underline hover:text-mint" href="https://www.azentio.com/" target="_blank" rel="noreferrer">azentio.com</a>
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="text-[#9bb2b2] hover:text-mint">{n.label}</Link>)}
          <Link href="/connect" className="text-[#9bb2b2] hover:text-mint">Connect</Link>
          <Link href="/hackathon/register" className="text-[#9bb2b2] hover:text-mint">Hackathon</Link>
        </nav>
        <div className="text-sm text-[#9bb2b2]">
          <p className="font-semibold text-white">Portals</p>
          <p className="mt-2">Employees and clients sign in to their own workspaces.</p>
          <Link href="/signin" className="mt-4 inline-block rounded-full border border-white/30 px-5 py-2 text-white hover:border-mint">Sign in</Link>
        </div>
      </div>
      <div className="border-t border-[#1d2b2b] px-6 py-5 text-center text-xs text-[#9bb2b2]">
        Demonstrations use synthetic data. Product capabilities and release readiness must be validated before public commitments.
      </div>
    </footer>
  );
}
