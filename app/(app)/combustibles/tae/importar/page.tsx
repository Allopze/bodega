import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { listTaeImportBatches } from "@/lib/combustibles/tae-import-ledger"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { TaeImportReportForm } from "./tae-import-report-form"
import { formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Importar histórico TAE" }

export default async function TaeImportPage() {
  let session
  try { session = await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }
  // Mismo contrato que el historial: un rol acotado ve sólo lotes con cargas
  // suyas y cifras recalculadas sobre ellas.
  const batches = await listTaeImportBatches(session, { limit: 10 })

  return (
    <PageContainer width="form">
      <PageHeader
        title="Importar histórico TAE"
        description="Revisa el mapeo del control manual TAE y confirma su importación trazable."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico" }]} />}
        actions={<Button asChild variant="secondary"><Link href="/combustibles/tae/importar/historial">Ver historial</Link></Button>}
      />
      <TaeImportReportForm />
      {batches.length > 0 && <section className="mt-5 border border-(--color-border) bg-(--color-surface) p-5"><p className="text-eyebrow">Lotes recientes</p><ul className="mt-3 divide-y divide-(--color-border)">{batches.map((batch) => <li key={batch.id} className="py-3 text-sm"><div className="flex items-start justify-between gap-3"><Link className="font-medium text-(--color-primary-ink) hover:underline" href={`/combustibles/tae/importar/${batch.id}`}>{batch.fileName}</Link><span className="text-xs text-(--color-text-muted)">{formatDateTime(batch.createdAt)}</span></div><p className="mt-1 text-(--color-text-muted)">{batch.validRows.toLocaleString("es-CL")} importadas · {batch.observedRows.toLocaleString("es-CL")} observadas{batch.invalidRows == null ? "" : ` · ${batch.invalidRows.toLocaleString("es-CL")} inválidas`} · {batch.totalLiters.toLocaleString("es-CL")} L · {batch.importerLabel} · {batch.status === "reverted" ? "Revertido" : "Importado"}</p></li>)}</ul></section>}
    </PageContainer>
  )
}
