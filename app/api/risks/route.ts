import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const scanRunId = searchParams.get("scanRunId");

  try {
    // Get the latest completed scan if no specific scanRunId requested
    let targetScanRunId = scanRunId;
    if (!targetScanRunId) {
      const latestScan = await prisma.scanRun.findFirst({
        where: { status: "completed" },
        orderBy: { startedAt: "desc" },
      });
      targetScanRunId = latestScan?.id ?? null;
    }

    if (!targetScanRunId) {
      return NextResponse.json({ topics: [], scanRun: null, scanRuns: [] });
    }

    const [topics, scanRun, scanRuns] = await Promise.all([
      prisma.riskTopic.findMany({
        where: {
          scanRunId: targetScanRunId,
          ...(category ? { category } : {}),
        },
        include: { articles: true },
        orderBy: { impactScore: "desc" },
      }),
      prisma.scanRun.findUnique({ where: { id: targetScanRunId } }),
      prisma.scanRun.findMany({
        where: { status: "completed" },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: { id: true, startedAt: true, topicsFound: true },
      }),
    ]);

    return NextResponse.json({ topics, scanRun, scanRuns });
  } catch (error) {
    console.error("Failed to fetch risks:", error);
    return NextResponse.json(
      { error: "Failed to fetch risks" },
      { status: 500 }
    );
  }
}
