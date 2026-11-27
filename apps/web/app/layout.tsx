import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

const geist = localFont({ src: "./fonts/Geist.woff2", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: { default: "Dawn to Earth", template: "%s · Dawn to Earth" },
  description: "A workspace for aerospace engineering.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={geist.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
