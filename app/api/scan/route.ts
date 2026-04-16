import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";

// Allow up to 5 minutes for the scan to complete
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runScan();
    return NextResponse.json({
      success: true,
      scanRunId: result.scanRunId,
      topicsFound: result.topicsFound,
    });
  } catch (error) {
    console.error("Manual scan failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 }
    );
  }
}
