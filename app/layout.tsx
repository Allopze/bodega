import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Chome Solicitudes y Bodega",
    template: "%s — Chome Solicitudes y Bodega",
  },
  description: "Sistema de abastecimiento, órdenes de compra y bodega — Chome",
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="es-CL"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
