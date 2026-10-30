import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { exportCsv } from "@/lib/learning/feed";

// The export applies the same visibility and the same reviewed-fields-only rule as the feed itself.
export const GET = authedRoute(
  async (req, { db, session, audit }) => {
    const csv = await exportCsv(db, session.principal, audit, Object.fromEntries(new URL(req.url).searchParams));
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="shared-learning.csv"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  { mutating: false },
);
