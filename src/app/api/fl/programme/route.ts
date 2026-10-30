import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { employeeOverview } from "@/lib/federated/service";

// Needs federated.coordinate or federated.approve: separate grants, neither implied by being an employee.
export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await employeeOverview(db, session.principal, audit)),
  { mutating: false },
);
