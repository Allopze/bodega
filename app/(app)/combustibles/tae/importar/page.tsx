import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { TaeImportReportForm } from "./tae-import-report-form"

export const metadata: Metadata = { title: "Importar histórico TAE" }

export default async function TaeImportPage() {
  try { await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }
  const batches = await db.query.fuelTaeImportBatches.findMany({ orderBy: [desc(fuelTaeImportBatches.createdAt)], limit: 10, with: { importer: { columns: { name: true } } } })

  return (
    <PageContainer width="form">
      <PageHeader
        title="Importar histórico TAE"
        description="Revisa el mapeo del control manual TAE y confirma su importación trazable."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico" }]} />}
        actions={<Button asChild variant="secondary"><Link href="/combustibles/tae/importar/historial">Ver historial</Link></Button>}
      />
      <TaeImportReportForm />
      {batches.length > 0 && <section className="mt-5 border border-(--color-border) bg-(--color-surface) p-5"><p className="text-eyebrow">Lotes recientes</p><ul className="mt-3 divide-y divide-(--color-border)">{batches.map((batch) => <li key={batch.id} className="py-3 text-sm"><div className="flex items-start justify-between gap-3"><Link className="font-medium text-(--color-primary-ink) hover:underline" href={`/combustibles/tae/importar/${batch.id}`}>{batch.fileName}</Link><span className="text-xs text-(--color-text-muted)">{new Date(batch.createdAt).toLocaleString("es-CL")}</span></div><p className="mt-1 text-(--color-text-muted)">{batch.validRows.toLocaleString("es-CL")} importadas · {batch.observedRows.toLocaleString("es-CL")} observadas · {batch.invalidRows.toLocaleString("es-CL")} inválidas · {Number(batch.totalLiters).toLocaleString("es-CL")} L · {batch.importer?.name ?? "—"} · {batch.status === "reverted" ? "Revertido" : "Importado"}</p></li>)}</ul></section>}
    </PageContainer>
  )
}
