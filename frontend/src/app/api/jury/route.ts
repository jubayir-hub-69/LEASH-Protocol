import { NextResponse } from "next/server";
import { findJuryCase } from "@/lib/cases";
import { submitLeashWrite } from "@/lib/leash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JuryBody = {
  caseId?: string;
  action?: string;
  spendAmount?: number | string;
  receipts?: string;
};

export async function POST(request: Request) {
  let body: JuryBody;
  try {
    body = (await request.json()) as JuryBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const preset = findJuryCase(body.caseId);
  const action = (body.action ?? preset?.action ?? "").trim();
  const receipts = (body.receipts ?? preset?.receipts ?? "").trim();
  const spendAmount = Number(body.spendAmount ?? preset?.spendAmount ?? NaN);

  if (!action || !Number.isFinite(spendAmount) || spendAmount < 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "adjudicate requires proposed_action and a non-negative spend_amount",
      },
      { status: 400 }
    );
  }

  const result = await submitLeashWrite({
    functionName: "adjudicate",
    callArgs: [action, spendAmount, receipts],
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
