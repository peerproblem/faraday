import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Faraday: live crisis boards from one sentence",
  description:
    "Describe a crisis in one sentence. Faraday reads the live web through Context.dev and builds a situation board that keeps itself up to date.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-faint">
          <a href={`${SITE_URL}/privacy`} className="hover:text-text">
            Privacy
          </a>
          <span className="mx-3">/</span>
          <a href={`${SITE_URL}/terms`} className="hover:text-text">
            Terms
          </a>
          <span className="mx-3">/</span>
          <a href="https://github.com/peerproblem/faraday" className="hover:text-text">
            GitHub
          </a>
        </footer>
      </body>
    </html>
  );
}
