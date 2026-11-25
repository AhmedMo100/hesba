import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteMetadata } from "./site-metadata";

// The title, description, share preview (Open Graph / X) and icons: `site-metadata.ts`.
export const metadata: Metadata = siteMetadata();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFE8D6" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1A15" },
  ],
};

const themeScript = `(function(){try{var s=localStorage.getItem("hesba-theme");var t=(s==="dark"||s==="light"||s==="auto")?s:"light";if(t==="auto"){var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",d?"dark":"light");}else{document.documentElement.setAttribute("data-theme",t);}}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
