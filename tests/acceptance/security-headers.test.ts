import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "../../src/lib/security/headers";
import nextConfig from "../../next.config";

const get = (hs: { key: string; value: string }[], k: string) => hs.find((h) => h.key === k)?.value;

describe("response security headers", () => {
  const prod = securityHeaders(false);
  const dev = securityHeaders(true);

  it("forbids framing, sniffing and plugins, and limits where the page may connect and post", () => {
    const csp = contentSecurityPolicy(false);
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) expect(csp).toContain(d);
    expect(get(prod, "X-Frame-Options")).toBe("DENY");
    expect(get(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(prod, "Permissions-Policy")).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });

  it("production adds HSTS and upgrades insecure requests, and never allows eval", () => {
    expect(get(prod, "Strict-Transport-Security")).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(get(prod, "Content-Security-Policy")).toContain("upgrade-insecure-requests");
    expect(get(prod, "Content-Security-Policy")).not.toContain("unsafe-eval");
  });

  it("development allows eval and websockets for hot reload only, and sends no HSTS", () => {
    expect(get(dev, "Content-Security-Policy")).toContain("'unsafe-eval'");
    expect(get(dev, "Content-Security-Policy")).toContain("ws:");
    expect(get(dev, "Strict-Transport-Security")).toBeUndefined();
  });

  it("allows no remote script, style, image, font or media origin", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toMatch(/\*/);
  });

  it("is applied to every path, and the framework header is off", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((h) => h.key)).toContain("Content-Security-Policy");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
