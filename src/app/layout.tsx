import type { Metadata } from "next";
import {
  APPLICATION_NAME,
  APPLICATION_TAGLINE,
} from "@/shared/constants/application";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: APPLICATION_NAME,
    template: `%s | ${APPLICATION_NAME}`,
  },
  description:
    "QastFund provides employer-enabled lending and peer-to-peer funding with clear terms and controlled access.",
  applicationName: APPLICATION_NAME,
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
  openGraph: {
    siteName: APPLICATION_NAME,
    title: APPLICATION_NAME,
    description: APPLICATION_TAGLINE,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
