import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BEAN Intelligence — Brand-Owned AI Platform",
  description:
    "BEAN Intelligence is a brand-owned AI platform: RIISHE conversational AI, LAXII image generation, JAZMII video generation and CODE GIFTZ coding intelligence.",
  icons: {
    icon:
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230a0a0c'/><ellipse cx='16' cy='16' rx='9' ry='7' fill='none' stroke='%23d4af37' stroke-width='2.4' transform='rotate(-18 16 16)'/><path d='M9.5 19.5 Q16 15 22.5 12.5' stroke='%23f0c75e' stroke-width='1.6' fill='none' transform='rotate(-18 16 16)'/></svg>`,
      ),
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
