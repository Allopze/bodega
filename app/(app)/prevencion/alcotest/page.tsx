import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listAlcoholTests } from "@/lib/services/prevention-alcohol-tests"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Control de alcotest" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function AlcotestPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:alcohol_tests:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const tests = await listAlcoholTests(scope)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Alcotest" }]} />
      <PageHeader title="Control de alcotest" description="Registro DO-48 y envío de respaldos (N° 31 PDTP)" actions={<PreventionExportButton href="/api/prevencion/alcotest/export" label="Exportar alcotest" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Faena</th>
              <th className="px-3 py-2 text-left">Trabajador</th>
              <th className="px-3 py-2 text-left">Turno</th>
              <th className="px-3 py-2 text-left">Resultado</th>
              <th className="px-3 py-2 text-left">Enviado</th>
              <th className="px-3 py-2 text-left">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {tests.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Sin registros.</td></tr>
            ) : tests.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2">{t.worksiteId}</td>
                <td className="px-3 py-2">{t.testedWorkerId ?? "-"}</td>
                <td className="px-3 py-2">{t.shift}</td>
                <td className="px-3 py-2">{t.result}</td>
                <td className="px-3 py-2">{t.sentAt?.slice(0, 10) ?? "Pendiente"}</td>
                <td className="px-3 py-2">{t.performedAt?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
