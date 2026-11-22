import type { Metadata } from "next";
import "@fontsource-variable/inter/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Origen SO₂",
  description: "Alerta y atribución de episodios de dióxido de azufre en el norte de Chile.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
