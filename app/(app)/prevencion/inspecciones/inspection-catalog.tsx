"use client"

import * as React from "react"
import Link from "next/link"
import { ClipboardText, MagnifyingGlass } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  FREQUENCY_INTERVAL_DAYS, INSPECTION_FREQUENCY_LABELS, INSPECTION_KIND_LABELS,
  inspectionProgramIsOverdue, nextDueAfter,
} from "@/lib/prevention/inspections"
import {
  AssigneeSelectOptions,
  findWorksiteSuggestedAssignee,
  type InspectionAssigneeOption,
} from "./assignee-picker"
import {
  approveInspectionTemplateAction,
  retireInspectionTemplateAction,
  createInspectionProgramAction,
  importInspectionTemplateAction,
  remindTemplateApprovalAction,
  rollbackInspectionTemplateAction,
  runProgramNowAction,
  setInspectionTemplateParityAction,
  setInspectionTemplatePdtpActivitiesAction,
  promoteUnclassifiedDeviationAction,
  setTemplateDeviationAction,
  updateInspectionProgramAction,
} from "./actions"
import { classifyPdtp2026InspectionWiring } from "@/lib/prevention/inspection-wiring"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatDate, todayInChile } from "@/lib/utils"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import {
  NO_SUBJECT,
  subjectIdsFromRef,
  subjectRefFromIds,
  subjectRefOf,
  templateRequiresContainer,
  type InspectionSubjectOption,
} from "@/lib/prevention/inspection-list-query"

interface Coverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  criticalityInert: boolean
}

export interface TemplateItem {
  id: string
  code: string
  versionLabel: string
  name: string
  kind: string
  status: string
  authorUserId: string
  version: number
  coverage: Coverage
  /** Actividades del PDTP (campo `n`) que acredita al completarse un run. */
  pdtpActivityNumbers: number[] | null
  /** Actividades que acredita al REVISARSE (la firma, no la ejecución). */
  pdtpReviewActivityNumbers: number[] | null
  pdtpCatalogActivityIds?: string[]
  pdtpReviewCatalogActivityIds?: string[]
  /** Desviaciones que este instrumento ofrece al registrar, con su gravedad. */
  deviations: DeviationEntry[]
  /** Desviaciones registradas como "Otra" que aún no están en el catálogo. */
  unclassifiedDeviations: { description: string; criticality: string; occurrences: number }[]
  /** Definición de `lib/sst/definitions` de la que salió el snapshot. */
  sourceDefinitionCode: string | null
  /** Quién es el ejecutante de registro (D04). */
  executorOfRecord: string
  /** El catálogo en código difiere del snapshot congelado (A-03). */
  definitionDrifted: boolean
  /** La definición de origen ya no existe en el catálogo en código. */
  definitionMissing: boolean
  provenanceKind: string
  sourceDocumentVersionId: string | null
  sourceSnapshot: { documentId: string; versionId: string; fileName: string; revision: string | null; effectiveFrom: string | null; checksumSha256: string } | null
  parityReport: { status: string; differences: string[] } | null
  contentHash: string
}

interface DocumentSourceOption {
  id: string
  documentId: string
  documentCode: string | null
  documentTitle: string
  fileName: string
  checksumSha256: string
  status: string
  effectiveFrom: string | null
}

function isOfficialProvenance(value: string) {
  return value === "official_document"
}

function parityStatusLabel(status: string | undefined) {
  if (status === "passed") return "Paridad aprobada"
  if (status === "failed") return "Con diferencias"
  return "Paridad pendiente"
}

/**
 * Una entrada del catálogo maestro, vista desde un instrumento.
 *
 * Trae el maestro entero —no sólo lo que el instrumento ofrece— porque el
 * diálogo es un selector: hay que poder marcar lo que todavía no está.
 */
export interface DeviationEntry {
  id: string
  label: string
  /** La gravedad que propone el maestro. */
  danoPotencial: string
  /** Si el maestro la tiene vigente. Retirarla ahí la apaga en todos lados. */
  isActive: boolean
  /** La criticidad que produciría con la gravedad del maestro. */
  criticality: string
  /** Si este instrumento la ofrece a quien registra en terreno. */
  selected: boolean
  /** Gravedad propia de este instrumento; null = hereda la del maestro. */
  danoPotencialOverride: string | null
  /** La que se aplica realmente al registrar acá. */
  effectiveDano: string
  effectiveCriticality: string
}

interface ProgramItem {
  id: string
  templateId: string
  worksiteId: string
  templateName: string
  worksiteName: string
  frequency: string
  intervalDays: number
  nextDueOn: string
  assignedToUserId: string | null
  assigneeName: string | null
  riskEntryId: string | null
  riskLabel: string | null
  subjectType: string | null
  /** Sujeto del inventario; excluyente con `subjectVehicleId` (INS-04). */
  subjectResourceId: string | null
  subjectVehicleId: string | null
  subjectContainerId: string | null
  /** Define si esta programación exige contenedor del catálogo. */
  templateDefinitionCode: string | null
  isActive: boolean
  /** I-04: la plantilla puede haber quedado `superseded` desde que se creó el programa. */
  templateApproved: boolean
  version: number
}

export interface ImportableDefinition {
  code: string
  title: string
  version: string
  sections: number
  items: number
  coverage: Coverage
  /** Actividades del PDTP que acreditará al ejecutarse (cableado del programa). */
  pdtpActivities: { n: number; name: string }[]
}

export interface PdtpActivityOption { n: number; name: string; year: number }

/**
 * I-20: acciones destructivas (Detener, Retirar) se veían como texto plano
 * idéntico a una acción neutra — "ghost" a secas. Rojo tenue: discreto
 * junto a la acción primaria, pero reconocible como riesgoso.
 */
const GHOST_DANGER_CLASS = "text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"

function templateStatusVariant(status: string): "default" | "success" | "outline" {
  if (status === "approved") return "success"
  if (status === "superseded") return "outline"
  return "default"
}

function coverageLabel(coverage: Coverage) {
  return `${coverage.withDanoPotencial}/${coverage.totalItems} con gravedad`
}

/**
 * Catálogo de instrumentos. Antes convivía con la programación en una sola
 * pantalla de pestañas: son dos actos distintos —qué se pregunta y cuándo se
 * pregunta— con permisos y públicos distintos, y la pestaña obligaba a pasar
 * por uno para llegar al otro.
 */
export function InspectionTemplatesPanel({ templates, pdtpOptions, catalogActivities = [], canManage, canApprove }: {
  templates: TemplateItem[]
  pdtpOptions: PdtpActivityOption[]
  catalogActivities?: import("@/components/prevention/pdtp-activity-picker").PdtpActivityPickerOption[]
  canManage: boolean
  canApprove: boolean
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja — se perdían al refrescar.
  const { getFilter, setFilters } = useUrlFilters()
  const kind = getFilter("tipo") || "all"
  const status = getFilter("estado") || "all"
  const urlQuery = getFilter("q")
  const [query, setQueryDraft] = React.useState(urlQuery)
  React.useEffect(() => setQueryDraft(urlQuery), [urlQuery])
  React.useEffect(() => {
    const next = query.trim()
    if (next === urlQuery) return
    const timer = setTimeout(() => setFilters({ q: next || null }), 350)
    return () => clearTimeout(timer)
  }, [query, urlQuery, setFilters])
  const visibleTemplates = React.useMemo(() => templates.filter((item) => {
    const normalized = urlQuery.trim().toLocaleLowerCase("es-CL")
    return (!normalized || `${item.code} ${item.name} ${item.versionLabel}`.toLocaleLowerCase("es-CL").includes(normalized))
      && (kind === "all" || item.kind === kind)
      && (status === "all" || item.status === status)
  }), [templates, urlQuery, kind, status])
  // I-22: en el diálogo de importación el PDTP se muestra por número y
  // nombre; acá sólo salía el número — el dato ya está en `pdtpOptions`.
  const pdtpNameByNumber = React.useMemo(() => new Map(pdtpOptions.map((option) => [option.n, option.name])), [pdtpOptions])
  const pdtpLabel = (n: number) => `N° ${n}${pdtpNameByNumber.has(n) ? ` — ${pdtpNameByNumber.get(n)}` : ""}`

  /**
   * El estado del cableado, con la misma función que usa el preflight del
   * despliegue. Compartirla es el punto: una pantalla que opine distinto del
   * informe del deploy es peor que no tener pantalla.
   */
  const wiring = React.useMemo(() => classifyPdtp2026InspectionWiring(templates.map((item) => ({
    id: item.id,
    code: item.code,
    versionLabel: item.versionLabel,
    status: item.status,
    sourceDefinitionCode: item.sourceDefinitionCode,
    pdtpActivityNumbers: item.pdtpActivityNumbers,
    executorOfRecord: item.executorOfRecord,
  }))), [templates])

  /** Por plantilla vigente mal cableada: qué declara el borrador que la espera. */
  const silentlyUnwiredById = React.useMemo(() => {
    const map = new Map<string, { declares: number[]; draftVersionLabel: string }>()
    for (const gap of wiring.gaps) {
      if (gap.kind !== "silently_unwired") continue
      map.set(gap.approved.id, { declares: gap.draft.declares, draftVersionLabel: gap.draft.versionLabel })
    }
    return map
  }, [wiring])

  /** Vigentes cuyo reemplazo cambió de código: aprobar el borrador no las retira. */
  const orphanApprovedById = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const gap of wiring.gaps) {
      if (gap.kind !== "orphan_approved") continue
      map.set(gap.approved.id, gap.replacedByCodes)
    }
    return map
  }, [wiring])

  const pendingApprovalCount = wiring.gaps.filter((gap) => gap.kind === "pending_approval").length
  const silentCount = silentlyUnwiredById.size + orphanApprovedById.size

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar código o nombre" aria-label="Buscar plantillas" className="pl-9" />
        </div>
        <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="draft">Borradores</SelectItem><SelectItem value="approved">Aprobadas</SelectItem><SelectItem value="superseded">Reemplazadas</SelectItem></SelectContent></Select>
      </div>

      {silentCount > 0 && (
        <div className="rounded-lg border border-[var(--color-danger-border,var(--color-border))] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger-ink)]">
          <p className="font-medium">
            {silentCount === 1 ? "Un instrumento vigente no acredita" : `${silentCount} instrumentos vigentes no acreditan`} en el programa anual.
          </p>
          <p className="mt-0.5 text-xs">
            Se pueden ejecutar y cerrar con normalidad, y el PDTP no se entera. Su borrador sí declara la actividad: aprobarlo lo corrige.
          </p>
        </div>
      )}
      {pendingApprovalCount > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          <p>
            {pendingApprovalCount === 1
              ? "Un instrumento del programa 2026 está en borrador."
              : `${pendingApprovalCount} instrumentos del programa 2026 están en borrador.`}{" "}
            Mientras no se aprueben, sus actividades del PDTP no acreditan.
          </p>
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setFilters({ estado: "draft" })}>
            Ver borradores
          </Button>
        </div>
      )}
            {visibleTemplates.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={templates.length === 0 ? "No hay instrumentos incorporados" : "No hay plantillas con estos filtros"}
          description={templates.length === 0 ? "Una persona administradora debe incorporar un instrumento desde el catálogo SST y luego enviarlo a aprobación." : "Ajusta la búsqueda, el tipo o el estado."}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visibleTemplates.map((item) => (
            <article key={item.id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><span className="font-mono text-xs text-[var(--color-text-subtle)]">{item.code} · {item.versionLabel}</span><h2 className="mt-0.5 text-sm font-semibold">{item.name}</h2><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{INSPECTION_KIND_LABELS[item.kind] ?? item.kind}</p></div>
                <div className="flex flex-col items-end gap-1">
                  <MetaBadge meta={{ label: `${item.status === "approved" ? "Aprobada" : item.status === "superseded" ? "Reemplazada" : "Borrador"}`, variant: templateStatusVariant(item.status) }} />
                  {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
                  {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} />}
                </div>
              </div>
              {item.definitionMissing && <p className="rounded-lg bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">La fuente fue retirada del catálogo, pero esta versión {item.status === "approved" ? "sigue ejecutable desde su checklist congelado hasta que la retires" : "se conserva sólo como historial"}.</p>}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {/* I-29: la fracción no se explicaba por sí sola. */}
                <div><dt className="text-[var(--color-text-subtle)]" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">Gravedad declarada</dt><dd className="mt-0.5 font-medium">{coverageLabel(item.coverage)}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">PDTP</dt><dd className="mt-0.5 font-medium">{
                  item.pdtpActivityNumbers?.length
                    ? item.status === "approved"
                      ? `Ejecutar ${item.pdtpActivityNumbers.map(pdtpLabel).join(", ")}`
                      : `Acreditará ${item.pdtpActivityNumbers.map(pdtpLabel).join(", ")} al aprobarse`
                    : silentlyUnwiredById.has(item.id)
                      ? `No acredita · el borrador v${silentlyUnwiredById.get(item.id)!.draftVersionLabel} sí declara`
                      : orphanApprovedById.has(item.id)
                        ? "No acredita · reemplazada por un código nuevo, retírala"
                        : "No acredita"
                }</dd></div>
                <div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Fuente y paridad</dt><dd className="mt-0.5 font-medium">{item.sourceSnapshot ? <><a className="underline" href={`/api/prevencion/documentacion/${item.sourceSnapshot.documentId}/version/${item.sourceSnapshot.versionId}`}>{item.sourceSnapshot.fileName}</a> · {item.sourceSnapshot.revision ?? "sin revisión"} · {parityStatusLabel(item.parityReport?.status)}{item.parityReport?.status === "failed" && (item.parityReport.differences?.length ?? 0) > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 font-normal text-[var(--color-warning-ink)]">
                    {item.parityReport.differences.map((difference) => <li key={difference}>{difference}</li>)}
                  </ul>
                )}</> : isOfficialProvenance(item.provenanceKind) ? "Documento oficial pendiente" : "Definición propia de plataforma"}</dd></div>
              </dl>
              <TemplateActions item={item} templates={templates} catalogActivities={catalogActivities} canManage={canManage} canApprove={canApprove} />
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Fuente / paridad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Gravedad declarada</TableHead>
                <TableHead>Acredita PDTP</TableHead>
                <TableHead>Desviaciones</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTemplates.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                    {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
                    {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} className="mt-1" />}
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.kind] ?? item.kind}</TableCell>
                  <TableCell className="font-mono text-xs">{item.versionLabel}</TableCell>
                  <TableCell className="max-w-64 text-xs">
                    {item.sourceSnapshot ? <>
                      <a className="underline" href={`/api/prevencion/documentacion/${item.sourceSnapshot.documentId}/version/${item.sourceSnapshot.versionId}`}>{item.sourceSnapshot.fileName}</a>
                      <span className="block">{item.sourceSnapshot.revision ?? "Sin revisión"} · {parityStatusLabel(item.parityReport?.status)}</span>
                      {/* Las diferencias se guardaban y no se mostraban en ninguna
                          parte: una plantilla con veinte decía sólo «Con diferencias». */}
                      {item.parityReport?.status === "failed" && (item.parityReport.differences?.length ?? 0) > 0 && (
                        <ul className="mt-0.5 list-disc pl-4 text-[var(--color-warning-ink)]">
                          {item.parityReport.differences.map((difference) => <li key={difference}>{difference}</li>)}
                        </ul>
                      )}
                      <span className="block font-mono" title={item.sourceSnapshot.checksumSha256}>SHA-256 {item.sourceSnapshot.checksumSha256.slice(0, 12)}…</span>
                      <span className="block font-mono" title={item.contentHash}>JSON {item.contentHash.slice(0, 12)}…</span>
                    </> : isOfficialProvenance(item.provenanceKind) ? <span className="text-[var(--color-warning-ink)]">Documento oficial pendiente</span> : "Definición de plataforma"}
                  </TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: `${item.status === "approved" ? "Aprobada" : item.status === "superseded" ? "Reemplazada" : "Borrador"}`, variant: templateStatusVariant(item.status) }} />
                    {/* A-03: el snapshot está congelado a propósito, así que la
                        deriva no es un error — es la señal de que toca publicar
                        una versión nueva. Sólo interesa mientras la plantilla
                        esté vigente; una ya reemplazada deriva por definición. */}
                    {item.status !== "superseded" && item.definitionDrifted && (
                      <span className="mt-1 block text-xs text-[var(--color-warning-ink)]" title="El contenido en código difiere del snapshot aprobado. No implica que el checklist haya cambiado de fondo.">
                        Catálogo actualizado
                      </span>
                    )}
                    {item.definitionMissing && (
                      <span className="mt-1 block max-w-48 text-xs text-[var(--color-warning-ink)]" title="La fuente fue retirada; el snapshot de esta versión se conserva.">
                        Fuente retirada · {item.status === "approved" ? "sigue ejecutable desde su checklist congelado" : "sólo historial"}
                      </span>
                    )}
                  </TableCell>
                  {/* I-29: la fracción no se explicaba por sí sola. */}
                  <TableCell className="text-sm" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">
                    {coverageLabel(item.coverage)}
                    {item.coverage.criticalityInert && <span className="ml-1 text-xs text-[var(--color-warning-ink)]">sin gravedad: toda falla saldrá de criticidad media</span>}
                  </TableCell>
                  {/* Tres casos distintos que antes se pintaban igual:
                      - un borrador imprimía sus números como si ya rigieran;
                      - una vigente sin números por estar reemplazada se leía
                        igual que la auditoría del SGSST, que legítimamente no
                        acredita ninguna actividad del programa. */}
                  <TableCell className="text-sm">
                    {item.pdtpActivityNumbers && item.pdtpActivityNumbers.length > 0 ? (
                      <span className={item.status === "approved" ? "font-mono text-xs" : "text-xs text-[var(--color-text-subtle)]"}>
                        {item.status === "approved"
                          ? item.pdtpActivityNumbers.map(pdtpLabel).join(", ")
                          : `Acreditará ${item.pdtpActivityNumbers.map(pdtpLabel).join(", ")} al aprobarse`}
                      </span>
                    ) : silentlyUnwiredById.has(item.id) ? (
                      <span className="text-xs text-[var(--color-danger-ink)]">
                        No acredita · el borrador v{silentlyUnwiredById.get(item.id)!.draftVersionLabel} declara{" "}
                        {silentlyUnwiredById.get(item.id)!.declares.map((n) => `N° ${n}`).join(", ")}
                      </span>
                    ) : orphanApprovedById.has(item.id) ? (
                      <span className="text-xs text-[var(--color-danger-ink)]">
                        No acredita · reemplazada por {orphanApprovedById.get(item.id)!.join(" y ")}, retírala a mano
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-text-subtle)]">No acredita</span>
                    )}
                    {/* Al revisar es otra ocurrencia y otro responsable: la
                        n=25 la ejecuta el operador, la n=26 la firma el Sup/JT. */}
                    {item.pdtpReviewActivityNumbers && item.pdtpReviewActivityNumbers.length > 0 && (
                      <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
                        al revisar: <span className="font-mono">{item.pdtpReviewActivityNumbers.map(pdtpLabel).join(", ")}</span>
                      </span>
                    )}
                  </TableCell>
                  {/* El catálogo de desviaciones sólo tiene sentido en los
                      instrumentos que no puntúan ítems: ahí la gravedad no la
                      declara ningún ítem y tiene que declararla el catálogo. */}
                  <TableCell className="text-sm">
                    {item.deviations.some((entry) => entry.selected)
                      ? `${item.deviations.filter((entry) => entry.selected).length} ofrecida(s)`
                      : <span className="text-xs text-[var(--color-text-subtle)]">Ninguna ofrecida</span>}
                    {item.unclassifiedDeviations.length > 0 && (
                      <span className="mt-1 block text-xs text-[var(--color-warning-ink)]">
                        {item.unclassifiedDeviations.length} por clasificar
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <TemplateActions item={item} templates={templates} catalogActivities={catalogActivities} canManage={canManage} canApprove={canApprove} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

/**
 * I-15: quien incorpora un borrador (`manage`) puede no tener `approve` — sin
 * esto podía crear una plantilla que nunca podría habilitar ella misma, sin
 * forma de avisarle a quien sí puede.
 */
function RequestApprovalButton({ templateId }: { templateId: string }) {
  const operation = useOperation()
  return (
    <div className="text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => operation.run(
          () => remindTemplateApprovalAction({ templateId }),
          (result) => {
            const names = result.data?.notified
            if (Array.isArray(names) && names.length > 0) operation.setMessage(`Solicitud enviada a ${names.join(", ")}.`)
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Solicitar aprobación"}
      </Button>
      {operation.message && <p role="status" className="max-w-64 text-xs">{operation.message}</p>}
    </div>
  )
}

function TemplateActions({ item, templates, catalogActivities, canManage, canApprove }: {
  item: TemplateItem
  templates: TemplateItem[]
  catalogActivities: PdtpActivityPickerOption[]
  canManage: boolean
  canApprove: boolean
}) {
  const previous = templates.find((candidate) => candidate.code === item.code && candidate.status === "superseded")
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {item.status !== "superseded" && canManage && <DeviationCatalogDialog templateCode={item.code} name={item.name} entries={item.deviations} unclassified={item.unclassifiedDeviations} />}
      {item.status !== "superseded" && canManage && <PdtpActivitiesDialog templateId={item.id} name={item.name} expectedVersion={item.version} current={item.pdtpCatalogActivityIds ?? []} currentReview={item.pdtpReviewCatalogActivityIds ?? []} options={catalogActivities} />}
      {item.status === "draft" && canApprove && isOfficialProvenance(item.provenanceKind) && item.sourceDocumentVersionId && <ParityDialog item={item} />}
      {item.status === "draft" && canApprove && <ApproveDialog templateId={item.id} name={item.name} expectedVersion={item.version} />}
      {item.status === "draft" && canManage && !canApprove && <RequestApprovalButton templateId={item.id} />}
      {item.status !== "superseded" && canApprove && <RetireDialog templateId={item.id} name={item.name} />}
      {item.status === "approved" && previous && canApprove && <RollbackTemplateDialog current={item} previous={previous} />}
    </div>
  )
}

/**
 * Declara si la transcripción digital coincide con la planilla oficial.
 *
 * Antes esto se afirmaba con una casilla en el diálogo de importación que
 * comparaba la definición consigo misma y sólo sabía decir «sí». Quien no la
 * marcaba dejaba la plantilla en `pending`, y nada podía sacarla de ahí. Acá se
 * declara contra el documento ya vinculado, se pueden enumerar las diferencias,
 * y queda la traza de quién lo hizo.
 */
function ParityDialog({ item }: { item: TemplateItem }) {
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<"passed" | "failed">(
    item.parityReport?.status === "failed" ? "failed" : "passed",
  )
  const operation = useOperation()
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Declarar paridad</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const toCount = (name: string) => {
        const raw = String(form.get(name) ?? "").trim()
        return raw === "" ? null : Number(raw)
      }
      const differences = String(form.get("differences") ?? "")
        .split("\n").map((line) => line.trim()).filter(Boolean)
      operation.run(() => setInspectionTemplateParityAction({
        templateId: item.id,
        expectedVersion: item.version,
        status,
        expectedItems: toCount("expectedItems"),
        actualItems: toCount("actualItems"),
        differences: status === "failed" ? differences : [],
        reason: String(form.get("reason") ?? ""),
      }), () => setOpen(false))
    }}>
      <DialogHeader>
        <DialogTitle>Paridad de {item.name}</DialogTitle>
        <DialogDescription>
          Contrasta la definición digital con {item.sourceSnapshot?.fileName ?? "el anexo vinculado"}. Sin paridad aprobada el instrumento no puede habilitarse.
        </DialogDescription>
      </DialogHeader>
      <Field label="Resultado" required>
        <Select value={status} onValueChange={(value) => setStatus(value as "passed" | "failed")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="passed">Coincide, sin diferencias</SelectItem>
            <SelectItem value="failed">Tiene diferencias</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ítems del anexo"><Input name="expectedItems" type="number" min={0} inputMode="numeric" /></Field>
        <Field label="Ítems transcritos"><Input name="actualItems" type="number" min={0} inputMode="numeric" /></Field>
      </div>
      {status === "failed" && (
        <Field label="Diferencias, una por línea" required>
          <Textarea name="differences" required rows={4} placeholder={"Falta el ítem «Estado del cinturón»\nLa columna N/A no existe en el anexo"} />
        </Field>
      )}
      <Field label="Motivo" required><Textarea name="reason" required minLength={10} maxLength={3000} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar paridad</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

function RollbackTemplateDialog({ current, previous }: { current: TemplateItem; previous: TemplateItem }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Revertir versión</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      operation.run(() => rollbackInspectionTemplateAction({ currentTemplateId: current.id, previousTemplateId: previous.id, reason }), () => setOpen(false))
    }}>
      <DialogHeader><DialogTitle>Volver a {previous.versionLabel}</DialogTitle><DialogDescription>Programas y ejecuciones todavía planificadas volverán a la versión anterior. Las iniciadas o cerradas conservarán {current.versionLabel}.</DialogDescription></DialogHeader>
      <Field label="Motivo de la reversión" required><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending}>Confirmar reversión</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

/**
 * Programación: qué instrumento se ejecuta, en qué faena y con qué frecuencia.
 * El cron diario materializa desde acá, y "Ejecutar ahora" usa el mismo camino.
 */
export function InspectionProgramsPanel({ programs, assignees, subjectsByWorksite = {}, riskEntriesByWorksite = {}, canManage, initialView = "all" }: {
  programs: ProgramItem[]
  assignees: InspectionAssigneeOption[]
  /** Inventario por faena, para declarar QUÉ se inspecciona (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite?: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  canManage: boolean
  initialView?: "all" | "overdue"
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja — sólo `vista` sobrevivía al refresh.
  const { getFilter, setFilter, setFilters } = useUrlFilters()
  const today = todayInChile()
  const status = getFilter("estado") || "all"
  const worksite = getFilter("faena") || "all"
  const urlQuery = getFilter("q")
  const [query, setQueryDraft] = React.useState(urlQuery)
  React.useEffect(() => setQueryDraft(urlQuery), [urlQuery])
  React.useEffect(() => {
    const next = query.trim()
    if (next === urlQuery) return
    const timer = setTimeout(() => setFilters({ q: next || null }), 350)
    return () => clearTimeout(timer)
  }, [query, urlQuery, setFilters])
  const worksites = React.useMemo(() => Array.from(
    new Map(programs.map((item) => [item.worksiteId, item.worksiteName])).entries(),
  ).map(([id, name]) => ({ id, name })), [programs])
  const visiblePrograms = React.useMemo(() => programs.filter((item) => {
    const normalized = urlQuery.trim().toLocaleLowerCase("es-CL")
    const searchable = `${item.templateName} ${item.worksiteName} ${item.subjectType ?? ""} ${item.riskLabel ?? ""} ${item.assigneeName ?? ""}`.toLocaleLowerCase("es-CL")
    const overdue = inspectionProgramIsOverdue(item, today)
    return (!normalized || searchable.includes(normalized))
      && (worksite === "all" || item.worksiteId === worksite)
      && (status === "all" || (status === "active" ? item.isActive : status === "paused" ? !item.isActive : overdue))
      && (initialView !== "overdue" || overdue)
  }), [programs, urlQuery, status, worksite, initialView, today])

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem_auto]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar plantilla, sujeto o riesgo" aria-label="Buscar programaciones" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar programaciones por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="active">Activas</SelectItem><SelectItem value="overdue">Vencidas</SelectItem><SelectItem value="paused">Detenidas</SelectItem></SelectContent></Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar programaciones por faena"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
        <Button
          type="button"
          size="sm"
          variant={initialView === "overdue" ? "primary" : "secondary"}
          aria-pressed={initialView === "overdue"}
          onClick={() => setFilter("vista", initialView === "overdue" ? null : "vencidas")}
        >
          {initialView === "overdue" ? "Ver todas" : "Sólo vencidas"}
        </Button>
      </div>
      <p className="text-eyebrow">{visiblePrograms.length} {visiblePrograms.length === 1 ? "programación" : "programaciones"}</p>

      {visiblePrograms.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={programs.length === 0 ? "Aún no hay programación" : initialView === "overdue" ? "No hay programaciones vencidas" : "No hay programaciones con estos filtros"}
          description={programs.length === 0 ? "Crea la primera desde la acción «Nuevo programa» del encabezado." : initialView === "overdue" ? "Todas las programaciones activas tienen su próxima fecha al día." : "Ajusta la búsqueda, el estado o la faena."}
          action={initialView === "overdue" ? <Button type="button" variant="secondary" onClick={() => setFilter("vista", null)}>Ver todas</Button> : undefined}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visiblePrograms.map((item) => {
            const overdue = inspectionProgramIsOverdue(item, today)
            return (
              <article key={item.id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-sm font-semibold">{item.templateName}</h2><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</p></div>
                  <MetaBadge meta={{ label: `${!item.templateApproved ? "Plantilla reemplazada" : !item.isActive ? "Detenida" : overdue ? "Vencida" : "Activa"}`, variant: !item.templateApproved ? "warning" : !item.isActive ? "outline" : overdue ? "warning" : "success" }} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-[var(--color-text-subtle)]">Cadencia</dt><dd className="mt-0.5 font-medium">{INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency} · {item.intervalDays} días</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Próxima</dt><dd className="mt-0.5 font-medium tabular-nums">{formatDate(item.nextDueOn)}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Asignada a</dt><dd className="mt-0.5 font-medium">{item.assigneeName ?? "Sin asignar"}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Sujeto</dt><dd className="mt-0.5 font-medium">{item.subjectType ?? "No especificado"}</dd></div>
                </dl>
                {item.riskLabel && <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs"><span className="text-[var(--color-text-subtle)]">Riesgo MIPER:</span> {item.riskLabel}</p>}
                {canManage && <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />}
              </article>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Frecuencia</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Asignada a</TableHead>
                <TableHead>Contexto</TableHead>
                <TableHead>Activa</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePrograms.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.templateName}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-sm">
                    {INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency}
                    <span className="block text-xs text-[var(--color-text-subtle)]">cada {item.intervalDays} {item.intervalDays === 1 ? "día" : "días"}</span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatDate(item.nextDueOn)}
                    {inspectionProgramIsOverdue(item, today) && (
                      <span className="block text-xs text-[var(--color-warning-ink)]">Vencida</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.assigneeName ?? "Sin asignar"}</TableCell>
                  <TableCell className="max-w-64 text-sm">
                    <span>{item.subjectType ?? "—"}</span>
                    {item.riskLabel && <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">MIPER · {item.riskLabel}</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {!item.templateApproved
                      ? <MetaBadge meta={{ label: "Plantilla reemplazada", variant: "warning" }} />
                      : item.isActive ? "Sí" : "No"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

function ProgramActions({ program, assignees, subjectsByWorksite, riskEntriesByWorksite }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <EditProgramDialog
        program={program}
        assignees={assignees}
        subjects={subjectsByWorksite[program.worksiteId] ?? []}
        riskEntries={riskEntriesByWorksite[program.worksiteId] ?? []}
      />
      <ToggleProgramButton program={program} />
      {program.isActive && (program.templateApproved
        ? <RunProgramNowButton program={program} />
        // I-04: un botón deshabilitado no avisa de forma fiable por teclado/
        // lector de pantalla ni en móvil (sin hover); el texto siempre visible
        // dice lo mismo en ambos casos, sin JS.
        : <p className="max-w-64 text-right text-xs text-[var(--color-warning-ink)]">
            No producirá inspecciones: su plantilla ya no está aprobada. Detén este programa y crea uno nuevo apuntando a una plantilla vigente.
          </p>)}
    </div>
  )
}

/* ── Creador de desviaciones ──────────────────────────────────────────────── */

/** La gravedad que corresponde a una criticidad ya registrada, para sugerirla. */
const DANO_BY_CRITICALITY: Record<string, string> = {
  low: "leve",
  medium: "moderado",
  high: "grave",
  critical: "fatal",
}

const DANO_LABELS: Record<string, string> = {
  leve: "Leve → hallazgo bajo · 30 días",
  moderado: "Moderado → hallazgo medio · 15 días",
  grave: "Grave → hallazgo alto · 7 días",
  fatal: "Fatal → hallazgo crítico · 3 días y detención",
}

/**
 * Elige qué desviaciones del catálogo maestro ofrece este instrumento.
 *
 * Es lo que permite que quien registra en terreno NO decida la gravedad: elige
 * de esta lista y el plazo de la acción correctiva sale solo. La única excepción
 * es "Otra desviación", donde sí la elige — y esas aparecen acá abajo para que
 * Prevención las incorpore y dejen de depender de un criterio individual.
 *
 * La lista en sí se mantiene en Administración; acá sólo se marca cuáles
 * aplican y, si hace falta, se ajusta la gravedad para este instrumento. La
 * selección cuelga del CÓDIGO del instrumento, así que versionarlo no la pierde.
 */
function DeviationCatalogDialog({ templateCode, name, entries, unclassified }: {
  templateCode: string
  name: string
  entries: DeviationEntry[]
  unclassified: { description: string; criticality: string; occurrences: number }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle))
  }, [entries, query])
  // Lo ofrecido primero: es lo que se viene a revisar, y con un maestro largo
  // quedaba disperso entre decenas de casillas vacías.
  const ordered = React.useMemo(
    () => [...visible].sort((a, b) => Number(b.selected) - Number(a.selected) || a.label.localeCompare(b.label)),
    [visible],
  )
  const offered = entries.filter((entry) => entry.selected).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Desviaciones{unclassified.length > 0 ? ` (${unclassified.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desviaciones · {name}</DialogTitle>
          <DialogDescription>
            Lo que este instrumento ofrece al registrar una desviación, con la gravedad que le corresponde. Quien
            registra en terreno elige de esta lista; el plazo de la acción correctiva sale de acá y no de su criterio.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar desviación…"
            aria-label="Buscar en el catálogo maestro"
            className="h-8 text-sm"
          />
          <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">{offered} ofrecida(s)</span>
        </div>

        {ordered.length > 0 ? (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {ordered.map((entry) => (
              <DeviationRow key={entry.id} templateCode={templateCode} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-subtle)]">
            {entries.length === 0
              ? "El catálogo maestro está vacío. Se arma en Administración → Desviaciones."
              : "Ninguna desviación coincide con la búsqueda."}
          </p>
        )}

        {unclassified.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
            <p className="font-medium">Registradas como «Otra», sin catalogar</p>
            <p className="mt-1 text-[var(--color-text-subtle)]">
              Su gravedad la eligió quien registró. Incorpóralas al maestro y dejarán de depender de un criterio
              individual.
            </p>
            <ul className="mt-2 space-y-1">
              {unclassified.slice(0, 12).map((item) => (
                <UnclassifiedRow key={item.description} templateCode={templateCode} item={item} />
              ))}
            </ul>
            {unclassified.length > 12 && <p className="mt-1">…y {unclassified.length - 12} más.</p>}
          </div>
        )}

        <p className="text-xs text-[var(--color-text-subtle)]">
          La lista maestra —crear, redactar y retirar desviaciones— se mantiene en{" "}
          <Link href="/admin/desviaciones" className="underline">Administración → Desviaciones</Link>.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Una desviación del maestro con su casilla y su gravedad en este instrumento. */
function DeviationRow({ templateCode, entry }: { templateCode: string; entry: DeviationEntry }) {
  const operation = useOperation()
  const retirada = !entry.isActive

  return (
    <div className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1.5 text-sm">
      <Checkbox
        className="min-w-0"
        checked={entry.selected}
        disabled={operation.pending || retirada}
        onChange={(event) => operation.run(() => setTemplateDeviationAction({
          templateCode,
          entryId: entry.id,
          selected: event.target.checked,
          danoPotencialOverride: entry.danoPotencialOverride,
        }))}
        label={
          <span className={retirada ? "text-[var(--color-text-subtle)] line-through" : undefined}>
            {entry.label}
          </span>
        }
      />
      <span className="flex shrink-0 items-center gap-2">
        {/* Recalibrar acá no reescribe los hallazgos ya levantados: su
            criticidad es evidencia del plazo que tuvieron. */}
        <Select
          value={entry.effectiveDano}
          disabled={!entry.selected}
          onValueChange={(value) => operation.run(() => setTemplateDeviationAction({
            templateCode,
            entryId: entry.id,
            selected: true,
            // Volver al valor del maestro borra el ajuste en vez de fijarlo:
            // así la entrada sigue heredando futuras recalibraciones.
            danoPotencialOverride: value === entry.danoPotencial ? null : value,
          }))}
        >
          <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad de ${entry.label}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* La consecuencia va en la etiqueta: acá salía "grave" pelado,
                para la misma decisión. */}
            {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {entry.danoPotencialOverride && (
          <span className="text-xs text-[var(--color-warning-ink)]" title={`El maestro propone ${entry.danoPotencial}`}>
            ajustada
          </span>
        )}
        {retirada && <span className="text-xs text-[var(--color-text-subtle)]">retirada del maestro</span>}
      </span>
    </div>
  )
}

/** Una desviación fuera de catálogo, con el botón que la incorpora al maestro. */
function UnclassifiedRow({ templateCode, item }: {
  templateCode: string
  item: { description: string; criticality: string; occurrences: number }
}) {
  const operation = useOperation()
  const [dano, setDano] = React.useState(DANO_BY_CRITICALITY[item.criticality] ?? "moderado")

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1">
        {item.description}
        {item.occurrences > 1 ? ` · ${item.occurrences} veces` : ""}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Select value={dano} onValueChange={setDano}>
          <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad oficial de ${item.description}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={operation.pending}
          onClick={() => operation.run(() => promoteUnclassifiedDeviationAction({
            templateCode,
            label: item.description,
            danoPotencial: dano,
          }))}
        >
          Incorporar
        </Button>
      </span>
      {operation.message && <p role="status" className="w-full">{operation.message}</p>}
    </li>
  )
}

/* ── Incorporar plantilla ─────────────────────────────────────────────────── */

/** Centinela de "sin actividad": `Select` reserva el string vacío. */
const NO_ACTIVITY = "__none__"

export function ImportTemplateDialog({ importable, templates, documentSources }: {
  importable: ImportableDefinition[]
  templates: TemplateItem[]
  documentSources: DocumentSourceOption[]
}) {
  const versionsByDefinition = React.useMemo(() => {
    const map = new Map<string, { approved?: TemplateItem; latest?: TemplateItem }>()
    for (const template of templates) {
      if (!template.sourceDefinitionCode) continue
      const entry = map.get(template.sourceDefinitionCode) ?? {}
      if (template.status === "approved") entry.approved = template
      if (!entry.latest) entry.latest = template
      map.set(template.sourceDefinitionCode, entry)
    }
    return map
  }, [templates])
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState(importable[0]?.code ?? "")
  const [kind, setKind] = React.useState("inspection")
  /** Actividad elegida cuando la definición sirve a más de una. */
  const [activity, setActivity] = React.useState(NO_ACTIVITY)
  const [sourceVersionId, setSourceVersionId] = React.useState(NO_ACTIVITY)
  const operation = useOperation()
  const definition = importable.find((item) => item.code === code)
  const existing = versionsByDefinition.get(code)
  const ambiguous = (definition?.pdtpActivities.length ?? 0) > 1

  // Cambiar de definición invalida la actividad elegida para la anterior.
  React.useEffect(() => { setActivity(NO_ACTIVITY); setSourceVersionId(NO_ACTIVITY) }, [code])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const versionLabel = String(form.get("versionLabel") ?? "").trim()
    const sourceRevision = String(form.get("sourceRevision") ?? "").trim()
    operation.run(() => importInspectionTemplateAction({
      definitionCode: code,
      kind: form.get("kind"),
      versionLabel: versionLabel || undefined,
      sourceDocumentVersionId: sourceVersionId === NO_ACTIVITY ? undefined : sourceVersionId,
      sourceRevision: sourceRevision || undefined,
      // Sólo se manda cuando hay que desempatar. Omitirlo deja que el servicio
      // aplique el cableado por defecto, que es el caso de las nueve
      // definiciones con una sola actividad.
      ...(ambiguous && activity !== NO_ACTIVITY ? { pdtpActivityNumbers: [Number(activity)] } : {}),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Incorporar borrador</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Incorporar nueva versión como borrador</DialogTitle>
            <DialogDescription>
              Se crea como borrador y todavía no puede programarse ni ejecutarse. Otra persona con permiso de aprobación debe revisarla y habilitarla.
            </DialogDescription>
          </DialogHeader>
          <Field label="Definición del catálogo SST">
            <Select value={code} onValueChange={setCode}><SelectTrigger aria-label="Definición del catálogo SST"><SelectValue /></SelectTrigger><SelectContent>{importable.map((item) => <SelectItem key={item.code} value={item.code}>{item.title}</SelectItem>)}</SelectContent></Select>
          </Field>
          {/* Combobox y no Select: la Biblioteca SST sembrada son 99+ versiones
              y en una lista desplegable sin buscar no se encuentra ninguna. El
              nombre del archivo viaja como `hint` para que también se pueda
              buscar por él, que suele ser lo que la persona recuerda. */}
          <Field label="Fuente documental de la Biblioteca SST" hint="Obligatoria para aprobar anexos oficiales; puede vincularse al crear el borrador.">
            <Combobox
              id="import-source-version"
              options={documentSources.map((source) => ({
                value: source.id,
                label: source.documentCode ?? source.documentTitle,
                hint: source.fileName,
              }))}
              value={sourceVersionId === NO_ACTIVITY ? "" : sourceVersionId}
              onChange={(value) => setSourceVersionId(value === "" ? NO_ACTIVITY : value)}
              placeholder="Buscar por código o nombre de archivo…"
              clearLabel="Sin fuente vinculada"
            />
          </Field>
          {sourceVersionId !== NO_ACTIVITY && <>
            <Field label="Revisión impresa"><Input name="sourceRevision" placeholder="Ej. Rev. 02" maxLength={120} /></Field>
            <p className="text-xs text-[var(--color-text-muted)]">La paridad con el anexo se declara después, desde «Declarar paridad» en el catálogo. Hasta entonces la plantilla no puede habilitarse.</p>
          </>}
          {definition && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              {definition.sections} secciones · {definition.items} ítems · {coverageLabel(definition.coverage)}
              {definition.coverage.criticalityInert && " · sin gravedad por ítem, ningún hallazgo alcanzará criticidad alta."}
            </p>
          )}
          {/* Qué acredita en el programa anual. Una sola actividad se cablea
              sola; dos exigen elegir, porque la misma definición de EPP la
              ejecutan el JT (n=64) y el PRF (n=65) por separado. */}
          {definition && (definition.pdtpActivities.length === 1 && definition.pdtpActivities[0] ? (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Acredita la actividad PDTP <span className="font-mono">N° {definition.pdtpActivities[0].n}</span> — {definition.pdtpActivities[0].name}.
            </p>
          ) : definition.pdtpActivities.length > 1 ? (
            // La misma definición de EPP la ejecutan el JT (n=64) y el PRF
            // (n=65) por separado: cablear las dos haría que un run de uno
            // cerrara la ocurrencia del otro, así que se elige una.
            <Field
              label="Actividad del PDTP que acredita"
              hint="Esta definición sirve a más de una; elige la del responsable que la va a ejecutar."
            >
              <Select value={activity} onValueChange={setActivity}>
                <SelectTrigger aria-label="Actividad del PDTP que acredita"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTIVITY}>No acredita</SelectItem>
                  {definition.pdtpActivities.map((item) => (
                    <SelectItem key={item.n} value={String(item.n)}>N° {item.n} — {item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-xs text-[var(--color-text-subtle)]">
              No acredita ninguna actividad del programa anual.
            </p>
          ))}
          {existing?.approved && (
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
              Ya hay una versión vigente de esta definición: <span className="font-mono">{existing.approved.versionLabel}</span>.
              El nuevo borrador no reemplaza esta versión. El reemplazo ocurre recién cuando se aprueba, después de revisar su contenido.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo">
              <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label="Tipo de instrumento"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="kind" value={kind} />
            </Field>
            <Field
              label="Etiqueta de versión"
              hint={existing?.latest
                ? `Ya existe ${existing.latest.versionLabel}; usa otra etiqueta.`
                : `Vacío = ${definition?.version ?? "versión de la definición"}.`}
            >
              <Input name="versionLabel" maxLength={80} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Incorporar como borrador</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Acreditación PDTP ─────────────────────────────────────────────────────── */

/**
 * Declara qué actividades del programa anual acredita la plantilla. Sin esto
 * el conector `onInspectionCompleted` no hace nada y la inspección jamás llega
 * al PDTP — que fue el estado de todas las plantillas hasta 2026-08-04.
 */
function PdtpActivitiesDialog({ templateId, name, expectedVersion, current, currentReview, options }: {
  templateId: string
  name: string
  expectedVersion: number
  current: string[]
  currentReview: string[]
  options: PdtpActivityPickerOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [execution, setExecution] = React.useState<string[]>(current)
  const [review, setReview] = React.useState<string[]>(currentReview)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setExecution(current); setReview(currentReview) } }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Acreditación PDTP</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(
              () => setInspectionTemplatePdtpActivitiesAction({
                templateId,
                expectedVersion,
                pdtpActivityNumbers: [],
                pdtpReviewActivityNumbers: [],
                catalogActivityIds: execution,
                reviewCatalogActivityIds: review,
              }),
              () => setOpen(false),
            )
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Acreditación PDTP · {name}</DialogTitle>
            <DialogDescription>
              Elige qué identidad corporativa acredita la ejecución y cuál acredita la revisión segregada.
            </DialogDescription>
          </DialogHeader>
          {options.length === 0 && (
            <p className="rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
              No hay actividades publicadas en el catálogo corporativo.
            </p>
          )}
          {options.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <PdtpActivityPicker multiple label="Al declarar ejecutada" options={options} value={execution} onChange={setExecution} />
              <PdtpActivityPicker multiple label="Al revisar y cerrar" options={options} value={review} onChange={setReview} />
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || options.length === 0}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Aprobar plantilla ─────────────────────────────────────────────────────── */

function ApproveDialog({ templateId, name, expectedVersion }: { templateId: string; name: string; expectedVersion: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Aprobar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => approveInspectionTemplateAction({ templateId, expectedVersion, reason: form.get("reason") }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Aprobar {name}</DialogTitle>
            <DialogDescription>Congela el contenido y reemplaza la versión aprobada anterior del mismo código.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres."><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Aprobar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Retirar plantilla ─────────────────────────────────────────────────────── */

/**
 * Saca un instrumento de circulación.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca reemplazada. Esa asimetría la resuelve el servidor, no esta pantalla:
 * la plantilla guarda el cuestionario congelado con el que se firmaron sus
 * inspecciones, y borrarla las dejaría sin las preguntas que respondieron.
 */
function RetireDialog({ templateId, name }: { templateId: string; name: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className={GHOST_DANGER_CLASS}>Retirar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => retireInspectionTemplateAction({ templateId, reason: form.get("reason") }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Retirar {name}</DialogTitle>
            <DialogDescription>
              Deja de poder programarse y ejecutarse. Si nunca se usó, se elimina; si tiene
              inspecciones hechas, se conserva como reemplazada — sus respuestas son evidencia.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres."><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Retirar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Gestión de una programación existente ────────────────────────────────
 * A-10/A-11: el diálogo de alta no ofrecía `intervalDays` (pese a que el Zod y
 * el CHECK lo soportan) y, una vez creada, la programación no se podía editar,
 * reasignar ni desactivar.
 */

function EditProgramDialog({ program, assignees, subjects, riskEntries }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjects: InspectionSubjectOption[]
  riskEntries: { id: string; hazardCode: string; hazard: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [frequency, setFrequency] = React.useState(program.frequency)
  const [intervalDays, setIntervalDays] = React.useState(program.intervalDays)
  const [assignedToUserId, setAssignedToUserId] = React.useState(program.assignedToUserId ?? "_none")
  const [nextDueOn, setNextDueOn] = React.useState(program.nextDueOn)
  const [subjectRef, setSubjectRef] = React.useState(subjectRefFromIds(program))
  // INS-16: el servicio siempre aceptó cambiar el peligro y el formulario no lo ofrecía.
  const [riskEntryId, setRiskEntryId] = React.useState(program.riskEntryId ?? "_none")
  const operation = useOperation()

  const requiresContainer = templateRequiresContainer(program.templateDefinitionCode)
  const subjectOptions = requiresContainer
    ? subjects.filter((subject) => subject.source === "container")
    : subjects

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    // Quitarle el contenedor a un programa de contenedores lo dejaría
    // generando inspecciones sin sujeto; el servicio también lo rechaza.
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.")
      return
    }
    operation.run(() => updateInspectionProgramAction({
      programId: program.id,
      expectedVersion: program.version,
      frequency,
      intervalDays,
      nextDueOn,
      assignedToUserId: assignedToUserId === "_none" ? null : assignedToUserId,
      subjectType: subjectType || null,
      riskEntryId: riskEntryId === "_none" ? null : riskEntryId,
      ...subjectIdsFromRef(subjectRef),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (value) {
        setFrequency(program.frequency)
        setIntervalDays(program.intervalDays)
        setAssignedToUserId(program.assignedToUserId ?? "_none")
        setNextDueOn(program.nextDueOn)
        setSubjectRef(subjectRefFromIds(program))
        setRiskEntryId(program.riskEntryId ?? "_none")
      }
      setOpen(value)
    }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Editar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar programación</DialogTitle>
            <DialogDescription>{program.templateName} · {program.worksiteName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Frecuencia">
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar.">
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Próxima ejecución">
              <DatePicker value={nextDueOn} onChange={setNextDueOn} />
            </Field>
            <Field label="Asignada a" hint="Opcional.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={program.worksiteId} noneLabel="Sin asignar" /></SelectContent></Select>
            </Field>
          </div>
          {(subjectOptions.length > 0 || requiresContainer) && (
            <Field
              label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}
              required={requiresContainer}
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo; un recurso del inventario actualiza su última inspección al completarse."}
            >
              <Select value={subjectRef} onValueChange={setSubjectRef}>
                <SelectTrigger aria-label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}>
                  <SelectValue placeholder={requiresContainer ? "Selecciona un contenedor" : "Sin sujeto del inventario"} />
                </SelectTrigger>
                <SelectContent>
                  {!requiresContainer && <SelectItem value={NO_SUBJECT}>Sin sujeto del inventario</SelectItem>}
                  {subjectOptions.map((subject) => (
                    <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
                      {subject.source === "vehicle" ? "Equipo" : subject.source === "container" ? "Contenedor" : "Recurso"} · {subject.name}
                      {subject.source !== "container" && subject.location ? ` · ${subject.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {requiresContainer && subjectOptions.length === 0 && (
                <p role="status" className="mt-2 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
                  Esta faena todavía no tiene contenedores en el catálogo. Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.
                </p>
              )}
            </Field>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor.">
              <Input name="subjectType" maxLength={120} defaultValue={program.subjectType ?? ""} />
            </Field>
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de esta faena.">
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {riskEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Desactivar es el borrado: los runs ya creados conservan su origen. */
function ToggleProgramButton({ program }: { program: ProgramItem }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* I-20: "Detener" es destructivo (frena la generación futura); "Reactivar" no. */}
        <Button type="button" size="sm" variant="ghost" className={program.isActive ? GHOST_DANGER_CLASS : undefined}>{program.isActive ? "Detener" : "Reactivar"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim()
          operation.run(() => updateInspectionProgramAction({
            programId: program.id,
            expectedVersion: program.version,
            isActive: !program.isActive,
            reason,
          }), () => setOpen(false))
        }}>
          <DialogHeader>
            <DialogTitle>{program.isActive ? "¿Detener esta programación?" : "¿Reactivar esta programación?"}</DialogTitle>
            <DialogDescription>{program.isActive
              ? "No se crearán futuras inspecciones automáticas. Las ya creadas se conservan y pueden seguir ejecutándose."
              : "Volverán a generarse inspecciones desde la próxima fecha configurada."}</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" required hint="Quedará registrado en el historial. Mínimo 10 caracteres."><Textarea name="reason" required minLength={10} maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={operation.pending}>{program.isActive ? "Detener programación" : "Reactivar programación"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Materializa la ejecución del período por el mismo camino que el cron. */
function RunProgramNowButton({ program }: { program: ProgramItem }) {
  const operation = useOperation()
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const today = todayInChile()
  // I-01: cada ejecución avanza `nextDueOn` un intervalo completo
  // (materializeProgramRuns), sin exigir que el programa esté vencido cuando
  // se llama con `programId` explícito. Regularizar una vencida es el camino
  // correcto y no debe pedir confirmación; crearla fuera de ciclo sí consume
  // un ciclo del programa anual y merece decirlo antes, no después.
  const outOfCycle = program.frequency !== "on_demand" && program.nextDueOn > today
  const nextAfter = nextDueAfter(program.nextDueOn, program.intervalDays, today)

  function create() {
    setConfirming(false)
    operation.run(() => runProgramNowAction({ programId: program.id }), (result) => {
      const runId = result.data?.runId
      if (typeof runId === "string") router.push(`/prevencion/inspecciones/${runId}`)
    })
  }

  return (
    <div className="space-y-1 text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => (outOfCycle ? setConfirming(true) : create())}
      >
        {operation.pending ? "Creando…" : "Crear y abrir inspección"}
      </Button>
      {operation.message && <p role="status" className="max-w-64 text-xs">{operation.message}</p>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="warning"
        title="Esta programación aún no vence"
        description={`La próxima inspección de "${program.templateName}" está programada para el ${formatDate(program.nextDueOn)}. Crearla ahora consume ese ciclo: la próxima pasará al ${formatDate(nextAfter)}. ¿Crear de todos modos?`}
        confirmLabel="Crear igual y mover la fecha"
        cancelLabel="No crear"
        onConfirm={create}
        loading={operation.pending}
      />
    </div>
  )
}

/* ── Alta de programación ─────────────────────────────────────────────────── */

export function ProgramDialog({ templates, worksites, assignees, riskEntriesByWorksite, subjectsByWorksite = {} }: {
  templates: { id: string; name: string; versionLabel: string; sourceDefinitionCode?: string | null }[]
  worksites: { id: string; name: string }[]
  assignees: InspectionAssigneeOption[]
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  /** Inventario por faena: declarar QUÉ se inspecciona, no sólo con qué instrumento (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
}) {
  const [open, setOpen] = React.useState(false)
  const [startsOn, setStartsOn] = React.useState("")
  const [templateId, setTemplateId] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [frequency, setFrequency] = React.useState("monthly")
  const [intervalDays, setIntervalDays] = React.useState(FREQUENCY_INTERVAL_DAYS.monthly)
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  const [riskEntryId, setRiskEntryId] = React.useState("_none")
  const [subjectRef, setSubjectRef] = React.useState(NO_SUBJECT)
  const operation = useOperation()

  /* La programación de contenedores exige sujeto por el mismo motivo que la
   * ejecución: un programa sin contenedor produce runs sin sujeto. */
  const requiresContainer = templateRequiresContainer(
    templates.find((item) => item.id === templateId)?.sourceDefinitionCode)
  const worksiteSubjects = subjectsByWorksite[worksiteId] ?? []
  const subjectOptions = requiresContainer
    ? worksiteSubjects.filter((subject) => subject.source === "container")
    : worksiteSubjects

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const assignee = String(form.get("assignedToUserId") ?? "").trim()
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const riskEntry = String(form.get("riskEntryId") ?? "").trim()
    if (!templateId || !worksiteId || !startsOn) {
      operation.setMessage("Selecciona conscientemente la plantilla, la faena y la primera fecha.")
      return
    }
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.")
      return
    }
    operation.run(() => createInspectionProgramAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      frequency: form.get("frequency"),
      // A-10: el Zod y el CHECK siempre lo soportaron; el formulario no lo ofrecía.
      intervalDays,
      startsOn: form.get("startsOn"),
      assignedToUserId: assignee || null,
      subjectType: subjectType || null,
      riskEntryId: riskEntry || null,
      ...subjectIdsFromRef(subjectRef),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (value) {
        setTemplateId("")
        setWorksiteId("")
        setStartsOn(todayInChile())
        setFrequency("monthly")
        setIntervalDays(FREQUENCY_INTERVAL_DAYS.monthly)
        setAssignedToUserId("_none")
        setRiskEntryId("_none")
        setSubjectRef(NO_SUBJECT)
        operation.setMessage("")
      }
      setOpen(value)
    }}>
      <DialogTrigger asChild><Button size="sm">Nuevo programa</Button></DialogTrigger>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={submit} className="flex max-h-[min(90dvh,54rem)] flex-col">
          <DialogHeader className="mb-0 shrink-0 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
            <DialogTitle>Nueva programación</DialogTitle>
            <DialogDescription>Elige explícitamente el instrumento y la faena. Sólo las plantillas aprobadas pueden programarse.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="Plantilla">
            <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Plantilla"><SelectValue placeholder="Selecciona una plantilla" /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={(value) => {
                setWorksiteId(value)
                setRiskEntryId("_none")
                setSubjectRef(NO_SUBJECT)
                setAssignedToUserId(findWorksiteSuggestedAssignee(assignees, value))
              }}><SelectTrigger aria-label="Faena del programa"><SelectValue placeholder="Selecciona la faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
            <Field label="Frecuencia">
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="frequency" value={frequency} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Primera fecha" required>
              <DatePicker name="startsOn" value={startsOn} onChange={setStartsOn} />
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar.">
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
            <Field label="Asignada a" hint="Opcional. El prevencionista de la faena se sugiere automáticamente al elegirla.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={worksiteId} noneLabel="Sin asignar" /></SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          {/* Con plantilla de contenedores el campo se muestra siempre, incluso
              sin opciones: desaparecer dejaba pasar el alta sin sujeto. */}
          {(subjectOptions.length > 0 || requiresContainer) && (
            <Field
              label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}
              required={requiresContainer}
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo, y el prevencionista sabrá qué va a inspeccionar."}
            >
              <Select value={subjectRef} onValueChange={setSubjectRef}>
                <SelectTrigger aria-label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}>
                  <SelectValue placeholder={requiresContainer ? "Selecciona un contenedor" : "Sin sujeto del inventario"} />
                </SelectTrigger>
                <SelectContent>
                  {!requiresContainer && <SelectItem value={NO_SUBJECT}>Sin sujeto del inventario</SelectItem>}
                  {subjectOptions.map((subject) => (
                    <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
                      {subject.source === "vehicle" ? "Equipo" : subject.source === "container" ? "Contenedor" : "Recurso"} · {subject.name}
                      {subject.source !== "container" && subject.location ? ` · ${subject.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {requiresContainer && subjectOptions.length === 0 && (
                <p role="status" className="mt-2 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
                  Esta faena todavía no tiene contenedores en el catálogo. Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.
                </p>
              )}
            </Field>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor."><Input name="subjectType" maxLength={120} /></Field>
            {/* A-09: antes era un `<Input>` donde el usuario debía escribir el
                UUID del peligro a mano, sin validar existencia ni faena. */}
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de la faena seleccionada.">
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {(riskEntriesByWorksite[worksiteId] ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="riskEntryId" value={riskEntryId === "_none" ? "" : riskEntryId} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          </div>
          <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4"><Button type="submit" disabled={operation.pending || !templateId || !worksiteId || !startsOn}>{operation.pending ? "Programando…" : "Programar"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
