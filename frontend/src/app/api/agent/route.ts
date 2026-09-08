import { NextResponse } from "next/server";
import { fetchAgentSnapshot } from "@/lib/leash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await fetchAgentSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : snapshot.connected ? 404 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
