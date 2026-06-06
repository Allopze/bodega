import type { Metadata } from "next"
import { Exo_2, Source_Sans_3 } from "next/font/google"
import { GeistMono } from "geist/font/mono"
import "./globals.css"

const exo = Exo_2({
  subsets: ["latin"],
  variable: "--font-exo",
  display: "swap",
  weight: ["400", "500", "600", "700"],
})

// Source Sans 3 is the open-source humanist sans in the Myriad Pro lineage.
// To use licensed Myriad Pro, replace with Adobe Fonts / Typekit integration.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: {
    default: "Chome StockFlow",
    template: "%s — Chome StockFlow",
  },
  description: "Sistema de abastecimiento, compras y bodega — Chome",
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
      className={`${exo.variable} ${sourceSans.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
