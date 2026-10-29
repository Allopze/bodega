import type { Metadata, Viewport } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { MantApp } from "@/components/mantencion/app/mant-app"
import { MANT_APP_METADATA, MANT_APP_VIEWPORT } from "./app-metadata"

export const dynamic = "force-dynamic"

export const metadata: Metadata = MANT_APP_METADATA
export const viewport: Viewport = MANT_APP_VIEWPORT

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
    // Sin acceso a la app: su propio login lo explica (no el /forbidden de la plataforma).
    redirect("/m/mantencion/entrar")
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
