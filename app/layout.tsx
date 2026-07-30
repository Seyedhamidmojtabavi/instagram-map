import type { Metadata } from "next";
import { Cormorant_Garamond, Vazirmatn } from "next/font/google";
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

const productionOrigin =
  "https://following-atlas-iran-903.s-hamidreza-mojtabav.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(productionOrigin),
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
    images: [{
      url: "/og.png",
      width: 1740,
      height: 900,
      alt: "Following Atlas — Public places across Iran",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Following Atlas",
    description: "A curated map of public places across Iran.",
    images: ["/og.png"],
  },
};

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
