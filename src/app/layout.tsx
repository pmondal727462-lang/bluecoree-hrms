import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { product } from "@/config/product";
export const metadata: Metadata = {
  title: product.name,
  description: product.description,
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
