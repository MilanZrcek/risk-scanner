import { NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";

// Allow up to 5 minutes for the scan to complete
export const maxDuration = 300;

export async function POST() {
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
