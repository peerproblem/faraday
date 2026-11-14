import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SwProvider } from "@/components/ui/provider";
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="sw-root sw-body flex min-h-full flex-col">
        <SwProvider theme="system">
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-4 sm:px-6 lg:px-10">{children}</main>
          <SiteFooter />
        </SwProvider>
      </body>
    </html>
  );
}
