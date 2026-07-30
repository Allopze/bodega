import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getOperationalWorkQueue, parseOperationalQueueFilters } from "@/lib/services/operational-work-queue"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { WorkQueueWorkbench } from "./work-queue-workbench"

export const metadata: Metadata = { title: "Mis pendientes" }

export default async function PendingWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("operations:view_work") }
  catch { redirect("/forbidden") }
  const filters = parseOperationalQueueFilters(await searchParams)
  const result = await getOperationalWorkQueue(session, filters)
  // La descripción no repite la del `<h2>` de la cola: en móvil el `<h1>` no es
  // `sr-only` y ambas se veían seguidas, casi idénticas (A-27).
  return <PageContainer><PageHeader title="Mis pendientes" description="Todo lo que requiere tu acción, en un solo lugar." /><WorkQueueWorkbench result={result} /></PageContainer>
}
