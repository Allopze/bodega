import type { Metadata, Viewport } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { MantApp } from "@/components/mantencion/app/mant-app"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Mantención",
  description: "Registro de mantención preventiva y correctiva de equipos, con o sin señal.",
  manifest: "/mant-manifest.json",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Mantención", statusBarStyle: "default" },
  icons: { apple: "/mant-icon-192.png" },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Sin `userScalable: false`: bloquear el zoom incumple WCAG 1.4.4.
  maximumScale: 5,
  viewportFit: "cover",
}

/**
 * Esta página sólo entrega QUIEN es el usuario y la versión: ningún dato de
 * negocio. El service worker guarda este HTML para abrir la app sin señal, y
 * los equipos, pautas y registros viajan por la API con la credencial de
 * dispositivo y viven en IndexedDB del teléfono.
 *
 * `renderedAt` deja al cliente distinguir un HTML recién salido del servidor
 * (la sesión es la de ahora) de uno que salió del caché sin señal (la sesión es
 * la de la última vez que hubo señal y no debe decidir nada).
 */
export default async function MantencionAppPage() {
  let session
  try {
    session = await requirePermission("mant:app:use")
  } catch {
    redirect("/forbidden")
  }
  const { id, name, email } = session.user
  return (
    <MantApp
      sessionUser={{ id, name: name?.trim() || email?.trim() || "Mecánico", email: email ?? "" }}
      appVersion={process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) || "dev"}
      renderedAt={new Date().toISOString()}
    />
  )
}
