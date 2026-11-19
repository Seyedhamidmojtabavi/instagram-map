import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, Vazirmatn } from "next/font/google";
import "@neshan-maps-platform/mapbox-gl/dist/NeshanMapboxGl.css";
import "./globals.css";

const latin = Schibsted_Grotesk({
  variable: "--font-latin",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const persian = Vazirmatn({
  variable: "--font-persian",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Following Atlas: the places behind the pages you follow",
  description:
    "Every Instagram page you follow, sorted into a searchable directory, with the cafés, shops and studios among them pinned on a map of Iran.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Following Atlas",
    description: "The places behind the pages you follow, on one map.",
    type: "website",
    images: [{ url: "/og.png", width: 1740, height: 900, alt: "Following Atlas map of Tehran" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Following Atlas",
    description: "The places behind the pages you follow, on one map.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1B2A5C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${latin.variable} ${persian.variable}`}>{children}</body>
    </html>
  );
}
