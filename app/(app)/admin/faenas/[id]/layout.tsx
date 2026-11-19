import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { worksites } from "@/db/schema"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, así que su `notFound()` llegaría con el
 * `200 OK` ya enviado. Este layout se renderiza por fuera y comprueba que la
 * faena exista antes. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRecord(worksites, worksites.id, id)
  return children
}
