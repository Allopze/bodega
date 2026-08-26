import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { preventionRiskMatrices } from "@/db/schema"

/**
 * Existe sólo para fijar el 404 real — mismo patrón que
 * `controles/[id]/layout.tsx` y `riesgos/[id]/layout.tsx`.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRecord(preventionRiskMatrices, preventionRiskMatrices.id, id)
  return children
}
