import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taskly — your day, in rhythm",
  description: "A calmer way to plan your day, one hour at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
