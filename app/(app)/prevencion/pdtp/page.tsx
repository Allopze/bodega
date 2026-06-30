import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpSheetView } from "@/lib/services/prevention-pdtp"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { PdtpSheetPicker, PdtpSheetTable, PdtpWorksitePicker } from "./pdtp-sheet-table"

export const metadata: Metadata = { title: "Programa de Trabajo Preventivo SG-SST" }

const SHEET_OPTIONS: Array<{ code: PdtpSheetCode; label: string }> = [
  { code: "pdtp_general", label: "Programa preventivo general" },
  { code: "cphs", label: "Comité Paritario de Higiene y Seguridad" },
  { code: "prf_adm_contrato", label: "Prevencionista de faena y administración de contrato" },
  { code: "sup_jt", label: "Supervisión y jefatura de terreno" },
  { code: "prf", label: "Prevencionista de riesgos en faena" },
  { code: "adm_contrato", label: "Administración de contrato" },
  { code: "subgerente", label: "Subgerencia" },
  { code: "capacitacion", label: "Capacitación" },
]

type PdtpPageProps = {
  searchParams: Promise<{ hoja?: string | string[]; faena?: string | string[] }>
}

export default async function PdtpPage({ searchParams }: PdtpPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const requestedSheet = Array.isArray(query.hoja) ? query.hoja[0] : query.hoja
  const requestedWorksite = Array.isArray(query.faena) ? query.faena[0] : query.faena
  const sheetCode = normalizeSheetCode(requestedSheet) ?? defaultSheetForRoles(session.user.roles)
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)
  const selectedWorksiteId = worksites.some((worksite) => worksite.id === requestedWorksite)
    ? requestedWorksite
    : worksites[0]?.id
  const view = await getPdtpSheetView(2026, sheetCode, selectedWorksiteId)
  const canManage = can(session, "prevention:pdtp:manage")
  const exportHref = `/api/prevencion/pdtp/export?hoja=${sheetCode}${selectedWorksiteId ? `&faena=${selectedWorksiteId}` : ""}`

  return (
    <PageContainer>
      <PageHeader
        title="Programa de Trabajo Preventivo SG-SST"
        description="Programa de Trabajo Preventivo 2026 por hoja oficial, responsable y planificación mensual."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa preventivo SG-SST" },
          ]} />
        }
        actions={<PreventionExportButton href={exportHref} label="Exportar programa" />}
      />

      <div className="space-y-4">
        <PdtpSheetPicker current={sheetCode} options={SHEET_OPTIONS} />
        <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} />

        {view ? (
          <PdtpSheetTable view={view} worksiteId={selectedWorksiteId} canManage={canManage} />
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Catálogo PDTP no cargado</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Ejecuta el seed después de aplicar migraciones para cargar el Programa de Trabajo Preventivo SG-SST 2026.
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  )
}

function normalizeSheetCode(value: string | undefined): PdtpSheetCode | null {
  if (!value) return null
  return SHEET_OPTIONS.some((option) => option.code === value) ? value as PdtpSheetCode : null
}

function defaultSheetForRoles(roles: string[]): PdtpSheetCode {
  if (roles.includes("cphs")) return "cphs"
  if (roles.includes("supervisor_faena") || roles.includes("jefe_terreno")) return "sup_jt"
  if (roles.includes("admin_contrato")) return "prf_adm_contrato"
  if (roles.includes("prevencionista_faena")) return "prf"
  if (roles.includes("jefa_chome")) return "subgerente"
  return "pdtp_general"
}
