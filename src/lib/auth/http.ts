import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/client";
import { dbAuditSink } from "@/lib/audit/log";
import { ForbiddenError, type AuditSink } from "@/lib/authz/guard";
import { InvitationError } from "./invitations";
import { SESSION_COOKIE, loadSession, type SessionContext } from "./session";

export async function getSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return loadSession(getDb(), token);
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** State-changing requests must come from our own origin, on top of SameSite=Lax cookies. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const readCookieToken = async () => (await cookies()).get(SESSION_COOKIE)?.value;

function fail(e: unknown): NextResponse {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (e instanceof InvitationError) {
    const status = e.code === "invalid_invitation" ? 404 : 400;
    return NextResponse.json({ error: e.code }, { status });
  }
  if (e instanceof ZodError) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  console.error(e);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

interface RouteArg {
  params: Promise<Record<string, string>>;
}

/**
 * A route that needs no sign-in (e.g. requesting a code). The reason is mandatory so that every
 * unauthenticated route is a deliberate, reviewable choice; tests assert each route uses one of the
 * wrappers in this file.
 */
export function publicRoute(
  _reason: string,
  handler: (req: Request, arg: RouteArg) => Promise<Response>,
  opts: { mutating?: boolean } = { mutating: true },
) {
  return async (req: Request, arg: RouteArg) => {
    try {
      if (opts.mutating !== false && !sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      return await handler(req, arg);
    } catch (e) {
      return fail(e);
    }
  };
}

export interface AuthedContext {
  db: Db;
  session: SessionContext;
  audit: AuditSink;
  params: Record<string, string>;
}

/** A route that requires a valid session. Authority comes from the session, never from the request. */
export function authedRoute(handler: Handler<AuthedContext>, opts: { mutating?: boolean } = { mutating: true }) {
  return async (req: Request, arg: RouteArg) => {
    try {
      if (opts.mutating !== false && !sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const session = await getSession();
      if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      const db = getDb();
      return await handler(req, { db, session, audit: dbAuditSink(db), params: await arg.params });
    } catch (e) {
      return fail(e);
    }
  };
}
