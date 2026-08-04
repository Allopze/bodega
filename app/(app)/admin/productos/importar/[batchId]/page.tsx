import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getEppImportBatch } from "@/lib/services/epp-import"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { EppImportReview } from "./epp-import-review"

export default async function EppImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  try { await requirePermission("admin:epp_import_review") } catch { redirect(`/forbidden?desde=${encodeURIComponent("/admin/productos/importar")}`) }
  const { batchId } = await params
  const batch = await getEppImportBatch(batchId)
  if (!batch) notFound()
  return (
    <PageContainer>
      <PageHeader
        title="Revisar importación EPP"
        description={`${batch.fileName} · ${batch.rows.length} filas`}
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Productos", href: "/admin/productos" }, { label: "Importación EPP" }]} />}
      />
      <EppImportReview batch={{
        id: batch.id, status: batch.status, fileName: batch.fileName,
        rows: batch.rows.map((row) => ({
          id: row.id, rowNumber: row.rowNumber, originalJson: row.originalJson, normalizedJson: row.normalizedJson,
          severity: row.severity, decision: row.decision, targetProductId: row.targetProductId, reviewReason: row.reviewReason,
          corrections: row.corrections.map((correction) => ({ id: correction.id, field: correction.field, originalValue: correction.originalValue, proposedValue: correction.proposedValue, ruleId: correction.ruleId, confidence: correction.confidence, disposition: correction.disposition })),
          matches: row.matches.map((match) => ({ id: match.id, productId: match.productId, score: match.score, reasonsJson: match.reasonsJson, productName: match.product.name, productSku: match.product.sku })),
        })),
      }} />
    </PageContainer>
  )
}
