import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { listCodeSequences } from "@/lib/code-sequences"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SequenceList } from "./sequence-list"

export const metadata: Metadata = { title: "Folios operativos" }

export default async function FoliosPage() {
  try {
    await requirePermission("admin:folios")
  } catch {
    redirect("/forbidden")
  }

  const rows = await listCodeSequences()

  return (
    <PageContainer>
      <PageHeader
        title="Folios operativos"
        description="Revisa las secuencias de documentos. Corrige desfases de folio solo en casos puntuales: los documentos ya emitidos no se modifican."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Folios" },
        ]}
      />
      <SequenceList
        rows={rows.map((r) => ({
          prefix: r.prefix,
          year: r.year,
          nextValue: r.nextValue,
          updatedAt: r.updatedAt,
        }))}
      />
    </PageContainer>
  )
}
