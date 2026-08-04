import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { ppaSubmissions } from "@/db/schema"

/**
 * Existe sólo para fijar el 404 real.
 *
 * La página de detalle vive dentro de la frontera de Suspense que crea su
 * `loading.tsx`, así que su `notFound()` llega cuando la cabecera `200 OK` ya
 * se envió. Este layout se renderiza por fuera de esa frontera: comprueba la
 * existencia primero y el estado HTTP dice la verdad, sin sacrificar el
 * esqueleto de carga. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRecord(ppaSubmissions, ppaSubmissions.id, id)
  return children
}
