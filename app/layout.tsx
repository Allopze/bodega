import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { Plus_Jakarta_Sans } from "next/font/google"
import "./globals.css"

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
})

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
      className={`${jakarta.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
