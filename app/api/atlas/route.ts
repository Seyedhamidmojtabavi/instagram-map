import { loadAtlas } from "@/lib/atlas-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { atlas, live } = await loadAtlas();
  return Response.json(atlas, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Atlas-Source": live ? "sync" : "seed",
    },
  });
}
