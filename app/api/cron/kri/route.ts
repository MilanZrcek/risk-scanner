import { NextRequest, NextResponse } from "next/server";
import { runKriScan } from "@/lib/scanner";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runKriScan();
    return NextResponse.json({ success: true, scanRunId: result.scanRunId });
  } catch (error) {
    console.error("KRI cron failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "KRI scan failed" },
      { status: 500 }
    );
  }
}
