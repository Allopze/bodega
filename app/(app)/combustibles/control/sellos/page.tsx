import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Gear } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { controlFiltersToParams, parseControlFilters } from "@/lib/combustibles/control/filters"
import { getMediumCross, getMandante, getReconciliationFlow } from "@/lib/combustibles/control/queries/reconciliation"
import { getSealJustifications, getSupervisorSealSummary, listSealDetail, listSealVehicles } from "@/lib/combustibles/control/queries/seals"
import { taeNavItems } from "@/lib/combustibles/section-nav"
import { resolvePagination } from "@/lib/pagination"
import { ControlFilters } from "../_components/control-filters"
import { loadControlContext } from "../_components/control-context"
import { DetailSection } from "./detail-section"
import { EquipmentSelect } from "./equipment-select"
import { FlowSection } from "./flow-section"
import { MediumSection } from "./medium-section"
import { ControlSection, SectionError } from "./section"
import { SealsExportButton } from "./seals-export-button"
import { SupervisorsSection } from "./supervisors-section"
import { createSourceTracker } from "./track"

export const metadata: Metadata = { title: "Sellos por mandante" }

const PAGE_SIZE = 50
const PATH = "/combustibles/control/sellos"
const BREADCRUMB = [{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos", href: "/combustibles/tae" }, { label: "Sellos por mandante" }]
const NAV_LABEL = "Vistas de TAE y sellos"

export default async function SealsByMandantePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view", PATH) } catch { redirect("/forbidden") }

  const filters = parseControlFilters(await searchParams)
  const ctx = await loadControlContext(session)
  const canViewPersonal = can(session, "combustibles:view_personal")
  const canManage = can(session, "combustibles:manage_control")
  const canExport = can(session, "combustibles:tae_export")
  const partialScope = resolveWorksiteScope(session).mode !== "all"
  const access = { canViewPersonal }
  const exportQuery = controlFiltersToParams({ ...filters, page: 1 }).toString()

  const chrome = (children: ReactNode) => (
    <PageContainer>
      <PageHeader
        title="Sellos por mandante"
        description="Conciliación, sellos y cargas en terreno por mandante"
        breadcrumb={BREADCRUMB}
      />
      <SectionNav items={taeNavItems(session)} activeKey="sellos-mandante" ariaLabel={NAV_LABEL} carryParams={["faena"]} />
      {children}
    </PageContainer>
  )

  if (ctx.mandantes.length === 0) {
    return chrome(
      <EmptyState
        title="Aún no hay mandantes configurados"
        description={canManage
          ? "Un mandante agrupa faenas y define la tolerancia con que se concilia lo que entra y lo que se entrega. Crea el primero para ver esta vista."
          : "Un mandante agrupa faenas y define la tolerancia con que se concilia lo que entra y lo que se entrega. Pide a un administrador del control de combustible que configure los mandantes."}
        action={canManage ? <Button asChild><Link href="/combustibles/control/configuracion"><Gear size={16} className="mr-1" />Configurar mandantes</Link></Button> : undefined}
      />,
    )
  }

  const mandante = filters.mandanteId ? await getMandante(filters.mandanteId) : null
  if (filters.mandanteId && !mandante) {
    return chrome(
      <EmptyState
        title="Ese mandante ya no existe o está inactivo"
        description="El enlace apunta a un mandante que no está disponible. Elige otro en los filtros o vuelve a ver todas las faenas de tu alcance."
        action={<Button asChild variant="secondary"><Link href={PATH}>Ver todas las faenas</Link></Button>}
      />,
    )
  }
  const tolerancePct = mandante?.tolerancePct ?? null

  const { track, degraded, total } = createSourceTracker("control-sellos")
  const emptyTotals = { inputLiters: 0, directLiters: 0, viaTankLiters: 0, deliveredLiters: 0, differenceLiters: 0, differencePct: null, overTolerance: null }
  const offset = (Math.max(1, filters.page) - 1) * PAGE_SIZE
  const [flow, cross, supervisors, justifications, detailResult, vehicles] = await Promise.all([
    track(getReconciliationFlow(session, filters, tolerancePct), { totals: emptyTotals, months: [], assumedDirectLiters: 0 }, "conciliación"),
    track(getMediumCross(session, filters), [], "cruce por medio"),
    track(getSupervisorSealSummary(session, filters, access), [], "supervisores"),
    track(getSealJustifications(session, filters, access), [], "justificaciones"),
    track(listSealDetail(session, filters, { ...access, limit: PAGE_SIZE, offset }), { rows: [], total: 0 }, "detalle"),
    track(listSealVehicles(session, filters), [], "equipos"),
  ])
  const pagination = resolvePagination({ pageParam: String(filters.page), totalItems: detailResult.data.total, pageSize: PAGE_SIZE })
  const hrefForPage = (page: number) => `${PATH}?${controlFiltersToParams({ ...filters, page }).toString()}`

  return (
    <PageContainer>
      <PageHeader
        title="Sellos por mandante"
        description="Conciliación, sellos y cargas en terreno por mandante"
        breadcrumb={BREADCRUMB}
        actions={canExport ? <SealsExportButton query={exportQuery} /> : null}
      />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <SectionNav items={taeNavItems(session)} activeKey="sellos-mandante" ariaLabel={NAV_LABEL} carryParams={["faena"]} />
      <ControlFilters years={ctx.years} defaultYear={ctx.defaultYear} worksites={ctx.worksites} mandantes={ctx.mandantes} extraKeys={["equipo"]} />
      <p className="mb-2 mt-3 text-sm text-[var(--color-text-muted)]">
        {mandante
          ? <>Mandante <strong className="font-semibold text-[var(--color-text)]">{mandante.name}</strong>{mandante.worksiteNames.length > 0 ? ` · ${mandante.worksiteNames.join(", ")}` : ""}{partialScope ? " · solo las faenas de tu alcance." : "."}</>
          : "Sin mandante elegido: se muestran todas las faenas de tu alcance."}
        {mandante && mandante.worksiteNames.length === 0 ? " Este mandante aún no tiene faenas asignadas." : ""}
      </p>

      <ControlSection id="conciliacion" title="Conciliación" question={`¿Lo que entró ${partialScope ? "en tus faenas" : "al mandante"} coincide con lo que se entregó?`}>
        {flow.failed ? <SectionError what="la conciliación" /> : <FlowSection flow={flow.data} tolerancePct={tolerancePct} mandanteName={mandante?.name ?? null} partialScope={partialScope} />}
      </ControlSection>

      <ControlSection id="medios" title="Terreno frente al proveedor" question="¿Cada medio de suministro informa lo mismo que se registró en terreno?">
        {cross.failed ? <SectionError what="el cruce por medio" /> : <MediumSection rows={cross.data} />}
      </ControlSection>

      <ControlSection id="supervisores" title="Cargas y sellos por supervisor" question="¿Quién cargó, y dónde faltaron sellos o se cortó la cadena?">
        {supervisors.failed || justifications.failed ? <SectionError what="el resumen por supervisor" /> : <SupervisorsSection rows={supervisors.data} justifications={justifications.data} />}
      </ControlSection>

      <ControlSection
        id="detalle"
        title="Detalle por equipo"
        question="¿Qué se cargó en cada equipo, con qué sellos y desde dónde?"
        actions={vehicles.failed ? null : <EquipmentSelect options={vehicles.data} value={filters.equipment ?? ""} ariaLabel="Equipo del detalle" allLabel="Todos los equipos" />}
      >
        {detailResult.failed ? <SectionError what="el detalle de cargas" /> : <DetailSection rows={detailResult.data.rows} pagination={pagination} hrefForPage={hrefForPage} canViewPhotos={canViewPersonal} />}
      </ControlSection>
    </PageContainer>
  )
}
