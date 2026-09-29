import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Comércio 360", template: "%s · Comércio 360" },
  description: "Visão central da operação do seu comércio.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
