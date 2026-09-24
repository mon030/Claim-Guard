import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ClaimGuard · Meridian Insurance",
  description: "Review claim photo evidence with a human always in control.",
  robots: { index: false, follow: false, noarchive: true },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="caramellatte"><body className="min-h-screen bg-base-200">{children}</body></html>;
}
