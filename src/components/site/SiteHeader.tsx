import Link from "next/link";
import { NAV } from "@/content/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/95 text-white backdrop-blur">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-mint focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="text-2xl font-semibold tracking-tight" aria-label="azentio.ai home">
          azentio<span className="text-mint">.ai</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 text-sm lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-white/80 transition hover:text-mint">{n.label}</Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/signin" className="text-sm text-white/80 transition hover:text-mint">Sign in</Link>
          <Link href="/connect?topic=demo" className="rounded-full bg-mint px-5 py-2 text-sm font-semibold text-ink transition hover:bg-green">
            Request Demo
          </Link>
        </div>

        {/* No-JS mobile menu */}
        <details className="group relative lg:hidden">
          <summary className="cursor-pointer list-none rounded-full border border-white/30 px-4 py-2 text-sm">Menu</summary>
          <div className="absolute right-0 mt-2 w-64 rounded-az-lg bg-card p-4 shadow-xl">
            <nav aria-label="Mobile" className="flex flex-col gap-3 text-sm">
              {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
              <Link href="/signin" className="text-white/70">Sign in</Link>
              <Link href="/connect?topic=demo" className="rounded-full bg-mint px-4 py-2 text-center font-semibold text-ink">Request Demo</Link>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
