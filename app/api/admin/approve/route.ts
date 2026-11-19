import { dataPath, isAdmin, readJsonFile, writeJsonFile } from "@/lib/atlas-server";

export const dynamic = "force-dynamic";

type Approval = {
  username: string;
  title?: string;
  address?: string;
  coordinates?: [number, number];
  mapLink?: string;
  hidden?: boolean;
  reason?: string;
  approvedAt: string;
};

function parseCoordinates(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length === 2) {
    const [lng, lat] = value.map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) return [lng, lat];
    return null;
  }
  // "35.7081, 51.4206" as copied from a map app is latitude first.
  const match = String(value ?? "").match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;
  return parseCoordinates([Number(match[2]), Number(match[1])]);
}

export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "Sign in with the admin token." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const username = String(body?.username ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    return Response.json({ error: "Enter a valid Instagram username." }, { status: 400 });
  }

  const approval: Approval = { username, approvedAt: new Date().toISOString(), reason: String(body?.reason ?? "Reviewed in admin") };
  if (body?.hidden === true) {
    approval.hidden = true;
  } else {
    const input = String(body?.location ?? "").trim();
    const coordinates = parseCoordinates(body?.coordinates) ?? parseCoordinates(input);
    if (coordinates) approval.coordinates = coordinates;
    else if (/^https:\/\//i.test(input)) approval.mapLink = input;
    else return Response.json({ error: "Paste a map link or coordinates like 35.7081, 51.4206." }, { status: 400 });
    approval.title = typeof body?.title === "string" ? body.title : undefined;
    approval.address = typeof body?.address === "string" ? body.address : undefined;
  }

  const file = dataPath("approvals.json");
  const current = (await readJsonFile<{ approvals: Approval[] }>(file)) ?? { approvals: [] };
  const approvals = current.approvals.filter((item) => item.username.toLowerCase() !== username.toLowerCase());
  approvals.push(approval);
  await writeJsonFile(file, { approvals });
  await writeJsonFile(dataPath("sync-request.json"), { requestedAt: new Date().toISOString(), reason: "approval" });
  return Response.json({ saved: true, approval });
}
