import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import OnboardingRedirect from "@/components/OnboardingRedirect";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Empiria Events",
  description: "Discover your next experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <OnboardingRedirect />
        {children}
      </body>
    </html>
  );
}
