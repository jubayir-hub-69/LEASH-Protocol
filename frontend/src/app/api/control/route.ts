import { NextResponse } from "next/server";
import { submitLeashWrite } from "@/lib/leash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ControlBody = {
  action?: "freeze" | "unfreeze";
  newSpendCap?: number | string;
};

export async function POST(request: Request) {
  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body.action === "freeze") {
    const result = await submitLeashWrite({
      functionName: "emergency_freeze",
      callArgs: [],
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (body.action === "unfreeze") {
    const cap = Number(body.newSpendCap ?? 200);
    if (!Number.isFinite(cap) || cap < 0) {
      return NextResponse.json(
        { ok: false, error: "appeal_and_unfreeze requires a non-negative cap" },
        { status: 400 }
      );
    }
    const result = await submitLeashWrite({
      functionName: "appeal_and_unfreeze",
      callArgs: [cap],
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { ok: false, error: "action must be freeze or unfreeze" },
    { status: 400 }
  );
}
