import { dataPath, isAdmin, readJsonFile } from "@/lib/atlas-server";

export const dynamic = "force-dynamic";

type State = { runs?: unknown[]; target?: unknown; owner?: unknown; backoffUntil?: string | null };

export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "Sign in with the admin token." }, { status: 401 });
  const [review, status, state, approvals] = await Promise.all([
    readJsonFile(dataPath("review.json")),
    readJsonFile(dataPath("status.json")),
    readJsonFile<State>(dataPath("state.json")),
    readJsonFile(dataPath("approvals.json")),
  ]);
  return Response.json(
    {
      review: review ?? { count: 0, items: [] },
      status,
      approvals: approvals ?? { approvals: [] },
      owner: state?.owner ?? null,
      target: state?.target ?? null,
      backoffUntil: state?.backoffUntil ?? null,
      runs: (state?.runs ?? []).slice(-10).reverse(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
