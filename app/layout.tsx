import type { Metadata } from "next";
import { Cormorant_Garamond, Vazirmatn } from "next/font/google";
import { headers } from "next/headers";
import "@neshan-maps-platform/mapbox-gl/dist/NeshanMapboxGl.css";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const vazirmatn = Vazirmatn({
  variable: "--font-sans",
  subsets: ["arabic", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host =
    incoming.get("x-forwarded-host") ??
    incoming.get("host") ??
    "localhost:3000";
  const protocol =
    incoming.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const imageUrl = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: "Following Atlas — Public places across Iran",
    description:
      "A curated, filterable map of public businesses and venues discovered through 903 Instagram profiles.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Following Atlas",
      description: "A curated map of public places across Iran.",
      type: "website",
      images: [{ url: imageUrl, width: 1740, height: 900, alt: "Following Atlas — Public places across Iran" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Following Atlas",
      description: "A curated map of public places across Iran.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${cormorant.variable} ${vazirmatn.variable}`}>{children}</body>
    </html>
  );
}
