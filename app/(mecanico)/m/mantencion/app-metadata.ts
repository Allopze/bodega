import type { Metadata, Viewport } from "next"

/**
 * Lo que hace de `/m/mantencion` una app instalable y no una página de la
 * plataforma: su propio manifest, nombre e ícono en la pantalla de inicio. Lo
 * comparten la app y su login, para que el teléfono tome el mismo ícono y
 * nombre aunque se agregue desde la pantalla de entrar.
 */
export const MANT_APP_METADATA: Metadata = {
  title: "Mantención · Chome",
  description: "Registro de mantención preventiva y correctiva de equipos, con o sin señal.",
  manifest: "/mant-manifest.json",
  applicationName: "Chome Mantención",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Mantención", statusBarStyle: "default" },
  icons: { apple: "/mant-icon-192.png", icon: "/mant-icon-192.png" },
}

export const MANT_APP_VIEWPORT: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Sin `userScalable: false`: bloquear el zoom incumple WCAG 1.4.4.
  maximumScale: 5,
  viewportFit: "cover",
}
