import type { Metadata } from "next";
import "@fontsource-variable/inter/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ojo Satelital del Diésel",
  description: "Actividad diésel de la gran minería chilena observada desde el espacio (Sentinel-5P, NO2).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
