import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import localFont from "next/font/local"
import "./globals.css"

const exo = localFont({
  variable: "--font-exo",
  display: "swap",
  src: [
    { path: "../fonts/exo/Exo-Regular.otf",   weight: "400", style: "normal" },
    { path: "../fonts/exo/Exo-Medium.otf",    weight: "500", style: "normal" },
    { path: "../fonts/exo/Exo-DemiBold.otf",  weight: "600", style: "normal" },
    { path: "../fonts/exo/Exo-Bold.otf",      weight: "700", style: "normal" },
    { path: "../fonts/exo/Exo-ExtraBold.otf", weight: "800", style: "normal" },
  ],
})

const myriad = localFont({
  variable: "--font-myriad",
  display: "swap",
  src: [
    { path: "../fonts/myriad-pro/myriadpro-light.otf",      weight: "300", style: "normal" },
    { path: "../fonts/myriad-pro/myriadpro-regular.otf",    weight: "400", style: "normal" },
    { path: "../fonts/myriad-pro/myriadpro-semibold.otf",   weight: "600", style: "normal" },
    { path: "../fonts/myriad-pro/myriadpro-bold.otf",       weight: "700", style: "normal" },
  ],
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
      className={`${exo.variable} ${myriad.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
