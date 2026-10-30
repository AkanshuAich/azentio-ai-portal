import Link from "next/link";

/** Mint-on-navy micro label, the prototype's section signature. */
export function Eyebrow({ children, dark = true }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${dark ? "text-mint" : "text-accent-text"}`}>
      {children}
    </p>
  );
}

/** Two-line headline whose second line is mint, e.g. "Build Intelligence. / Create Impact." */
export function Headline({ first, second, dark = true, as: Tag = "h2" }: {
  first: string; second?: string; dark?: boolean; as?: "h1" | "h2";
}) {
  return (
    <Tag className={`mt-3 text-4xl font-semibold leading-[1.1] sm:text-5xl ${dark ? "text-white" : "text-ink"}`}>
      {first}
      {second && (
        <>
          <br />
          <span className={dark ? "text-mint" : "text-accent-text"}>{second}</span>
        </>
      )}
    </Tag>
  );
}

export function PageHero({ label, first, second, lead }: { label: string; first: string; second?: string; lead: string }) {
  return (
    <section className="bg-navy text-white">
      <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-16">
        <Eyebrow>{label}</Eyebrow>
        <Headline as="h1" first={first} second={second} />
        <p className="mt-6 max-w-2xl text-lg text-white/75">{lead}</p>
      </div>
    </section>
  );
}

export function Section({ children, tone = "light", className = "" }: {
  children: React.ReactNode; tone?: "light" | "panel" | "dark"; className?: string;
}) {
  const bg = tone === "dark" ? "bg-card text-white" : tone === "panel" ? "bg-panel text-ink" : "bg-white text-ink";
  return (
    <section className={`${bg} ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6 py-20">{children}</div>
    </section>
  );
}

export function PillLink({ href, children, variant = "mint" }: {
  href: string; children: React.ReactNode; variant?: "mint" | "outline" | "dark";
}) {
  const style =
    variant === "mint" ? "bg-mint text-ink hover:bg-green"
    : variant === "dark" ? "bg-[var(--az-cta-dark)] text-white hover:bg-card"
    : "border border-white/40 text-white hover:border-mint hover:text-mint";
  return (
    <Link href={href} className={`inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold transition ${style}`}>
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}

/** Numbered 01..06 card, the prototype's grid language. */
export function NumberedCard({ n, title, text, href }: { n: string; title: string; text: string; href?: string }) {
  const body = (
    <>
      <span className="text-sm font-semibold text-accent-text">{n}</span>
      <h3 className="mt-3 text-xl font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-text">{text}</p>
    </>
  );
  const cls = "block rounded-az-lg bg-white p-6 shadow-[var(--az-shadow-card)] transition hover:-translate-y-0.5";
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function CtaBand() {
  return (
    <section className="bg-navy text-white">
      <div className="mx-auto max-w-[1200px] px-6 py-20 text-center">
        <Eyebrow>Build what&apos;s next</Eyebrow>
        <Headline first="The Next Intelligent Idea" second="Starts Here." />
        <p className="mx-auto mt-5 max-w-xl text-white/75">
          Explore our products, share a challenge, or collaborate to turn ambitious ideas into working AI solutions.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PillLink href="/connect">Start a Conversation</PillLink>
          <PillLink href="/hackathon/register" variant="outline">Register for the hackathon</PillLink>
        </div>
      </div>
    </section>
  );
}
