import { NextResponse } from "next/server";
import { submitLeashWrite } from "@/lib/leash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ControlBody = {
  action?: "freeze" | "unfreeze" | "update_policy" | "ai_appeal";
  newSpendCap?: number | string;
  mandate?: string;
  spendCap?: number | string;
  deadline?: number | string;
  justification?: string;
  requestedCap?: number | string;
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

  if (body.action === "update_policy") {
    const mandate = (body.mandate ?? "").trim();
    const spendCap = Number(body.spendCap);
    const deadline = Number(body.deadline ?? 0);
    if (!mandate || !Number.isFinite(spendCap) || spendCap < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "update_policy requires a mandate and a non-negative spend cap",
        },
        { status: 400 }
      );
    }
    if (!Number.isInteger(deadline) || deadline < 0) {
      return NextResponse.json(
        { ok: false, error: "update_policy requires a non-negative integer deadline" },
        { status: 400 }
      );
    }
    const result = await submitLeashWrite({
      functionName: "update_policy",
      callArgs: [mandate, spendCap, deadline],
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (body.action === "ai_appeal") {
    const justification = (body.justification ?? "").trim();
    const requestedCap = Number(body.requestedCap);
    if (!justification || !Number.isFinite(requestedCap) || requestedCap <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "submit_ai_appeal requires a justification and a spend cap greater than zero",
        },
        { status: 400 }
      );
    }
    const result = await submitLeashWrite({
      functionName: "submit_ai_appeal",
      callArgs: [justification, requestedCap],
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { ok: false, error: "action must be freeze, unfreeze, update_policy, or ai_appeal" },
    { status: 400 }
  );
}
