import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — Advanced AI System",
  description: "Just A Rather Very Intelligent System — Your personal AI assistant with system access",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#0a0a0f] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
