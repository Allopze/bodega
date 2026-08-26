import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { preventionRiskEntries } from "@/db/schema"

/**
 * Existe sólo para fijar el 404 real — mismo patrón que
 * `controles/[id]/layout.tsx`: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, así que su `notFound()` llegaría después de
 * que la cabecera `200 OK` ya se envió. Este layout corre por fuera de esa
 * frontera.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRecord(preventionRiskEntries, preventionRiskEntries.id, id)
  return children
}
