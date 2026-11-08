import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConvexClientProvider from "./ConvexClientProvider";
import ToastProvider from "./Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "LendLoop - Borrow what you need. Lend what you don't.",
  description: "A neighborhood tool-lending board.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
