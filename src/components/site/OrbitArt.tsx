/** Decorative mint line-art, echoing the prototype hero. Purely presentational. */
export function OrbitArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" fill="none" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#55ffbe" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#55ffbe" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#glow)" />
      <g stroke="#55ffbe" strokeWidth="1.2" strokeOpacity="0.7">
        <ellipse cx="200" cy="200" rx="185" ry="70" transform="rotate(-25 200 200)" />
        <ellipse cx="200" cy="200" rx="185" ry="70" transform="rotate(35 200 200)" strokeOpacity="0.45" />
        <circle cx="200" cy="200" r="150" strokeOpacity="0.25" />
      </g>
      <g stroke="#55ffbe" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M200 110 L278 155 V245 L200 290 L122 245 V155 Z" />
        <path d="M200 110 V200 M122 155 L200 200 L278 155 M200 200 V290" strokeOpacity="0.6" />
      </g>
      <circle cx="200" cy="200" r="6" fill="#55ffbe" />
      <circle cx="338" cy="140" r="5" fill="#55ffbe" />
      <circle cx="62" cy="262" r="4" fill="#55ffbe" fillOpacity="0.7" />
    </svg>
  );
}
