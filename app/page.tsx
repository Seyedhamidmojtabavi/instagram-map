import { AtlasApp } from "./AtlasApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return <AtlasApp webKey={process.env.NEXT_PUBLIC_NESHAN_WEB_KEY ?? ""} />;
}
