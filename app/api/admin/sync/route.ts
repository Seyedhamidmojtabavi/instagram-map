import { dataPath, isAdmin, writeJsonFile } from "@/lib/atlas-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "Sign in with the admin token." }, { status: 401 });
  await writeJsonFile(dataPath("sync-request.json"), { requestedAt: new Date().toISOString() });
  return Response.json({ queued: true });
}
