import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { compareRiskMatrices, listComparableMatrixVersions } from "@/lib/services/prevention-risk-diff"
import { RISK_CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/risk-engine"
import { Badge } from "@/components/ui/badge"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"

const STATUS_LABEL: Record<string, string> = { added: "Agregado", removed: "Eliminado", modified: "Modificado", unchanged: "Sin cambios" }
const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "default"> = { added: "success", removed: "danger", modified: "warning", unchanged: "default" }
const FIELD_LABEL: Record<string, string> = {
  probability: "Probabilidad", consequence: "Consecuencia", riskMagnitude: "MR", riskClassification: "Clasificación",
  controls: "Medida de control", responsibleSnapshot: "Responsable", controlDeadlineText: "Plazo",
}

function fieldValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (field === "riskClassification") return RISK_CLASSIFICATION_LABEL[value as RiskClassification] ?? String(value)
  return String(value)
}

export default async function CompareRiskMatrixPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ base?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`) }
  if (!can(session, "prevention:risk:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`)
  const { id } = await params
  const { base } = await searchParams
  const access = { scope: resolveWorksiteScope(session), permissions: session.user.permissions }

  let versions
  try { versions = await listComparableMatrixVersions({ matrixId: id, ...access }) }
  catch { notFound() }

  const comparison = base ? await compareRiskMatrices({ baseMatrixId: base, targetMatrixId: id, ...access }) : null

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Comparar revisiones"
        description={`${versions.current.title} · v${versions.current.matrixVersion}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "MIPER", href: "/prevencion/miper" },
          { label: "Vista matriz", href: `/prevencion/miper/matriz/${id}` },
          { label: "Comparar" },
        ]} />}
      />
      {versions.others.length === 0
        ? <EmptyState title="No hay otra versión con la que comparar" description="Esta es la única versión MIPER registrada en esta faena." />
        : (
          <div className="flex flex-wrap gap-2 rounded-lg border p-3 text-sm">
            <span className="text-eyebrow">Comparar contra</span>
            {versions.others.map((version) => (
              <Link
                key={version.id}
                href={`/prevencion/miper/matriz/${id}/comparar?base=${version.id}`}
                className={`rounded px-2 py-1 ${base === version.id ? "bg-[var(--color-surface-2)] font-semibold" : "underline"}`}
              >
                v{version.matrixVersion} ({version.status})
              </Link>
            ))}
          </div>
        )}

      {comparison && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3"><span className="text-eyebrow">Agregados</span><strong className="block text-xl">{comparison.summary.added}</strong></div>
            <div className="rounded-lg border p-3"><span className="text-eyebrow">Eliminados</span><strong className="block text-xl">{comparison.summary.removed}</strong></div>
            <div className="rounded-lg border p-3"><span className="text-eyebrow">Modificados</span><strong className="block text-xl">{comparison.summary.modified}</strong></div>
            <div className="rounded-lg border p-3"><span className="text-eyebrow">Sin cambios</span><strong className="block text-xl">{comparison.summary.unchanged}</strong></div>
          </div>
          <div className="space-y-2">
            {comparison.entries.filter((row) => row.status !== "unchanged").length === 0
              ? <EmptyState title="Sin diferencias" description="Ningún peligro cambió entre estas dos versiones." />
              : comparison.entries.filter((row) => row.status !== "unchanged").map((row) => (
                <div key={row.identityKey} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    <strong>{row.hazardCode} · {row.hazard}</strong>
                  </div>
                  {row.fieldDiffs.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-[var(--color-text-subtle)]"><th className="pr-4">Campo</th><th className="pr-4">v{comparison.base.matrixVersion}</th><th>v{comparison.target.matrixVersion}</th></tr></thead>
                        <tbody>
                          {row.fieldDiffs.map((diff) => (
                            <tr key={diff.field}>
                              <td className="pr-4 py-1 font-medium">{FIELD_LABEL[diff.field] ?? diff.field}</td>
                              <td className="pr-4 py-1">{fieldValue(diff.field, diff.before)}</td>
                              <td className="py-1">{fieldValue(diff.field, diff.after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </>
      )}
    </PageContainer>
  )
}
