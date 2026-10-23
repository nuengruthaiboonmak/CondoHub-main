import type { Metadata } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/shared/ui/Toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-thai",
});

export const metadata: Metadata = {
  title: "CondoHub",
  description: "Condominium community management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${notoSansThai.variable} bg-background font-sans text-foreground antialiased`}
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
