import { AtlasMap } from "./AtlasMap";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <AtlasMap webKey={process.env.NEXT_PUBLIC_NESHAN_WEB_KEY ?? ""} />
  );
}
