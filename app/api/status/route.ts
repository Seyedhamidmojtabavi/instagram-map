import { dataPath, loadAtlas, readJsonFile } from "@/lib/atlas-server";

export const dynamic = "force-dynamic";

type SchedulerStatus = {
  scheduler?: string;
  running?: boolean;
  nextRunAt?: string | null;
  intervalMinutes?: number;
};

export async function GET() {
  const [{ atlas, live }, status] = await Promise.all([
    loadAtlas(),
    readJsonFile<SchedulerStatus>(dataPath("status.json")),
  ]);
  return Response.json(
    {
      source: live ? "sync" : "seed",
      lastSyncAt: atlas.lastSyncAt,
      scheduler: status?.scheduler ?? "off",
      running: Boolean(status?.running),
      nextRunAt: status?.nextRunAt ?? null,
      intervalMinutes: status?.intervalMinutes ?? null,
      stats: atlas.stats,
      message: atlas.sync?.message ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
