import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "I/C FieldDocs",
  description: "Private field documentation app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            padding: 16,
            borderBottom: "1px solid #ddd",
            display: "flex",
            gap: 16,
          }}
        >
          <Link href="/">Dashboard</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/reports/new">New Report</Link>
        </nav>

        {children}
      </body>
    </html>
  );
}
