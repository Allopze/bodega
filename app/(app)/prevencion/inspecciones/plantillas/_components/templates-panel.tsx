"use client"

import * as React from "react"
import { ClipboardText, MagnifyingGlass } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_PROVENANCE_LABELS,
  inspectionTemplateStatusLabel,
} from "@/lib/prevention/inspections"
import { classifyPdtp2026InspectionWiring } from "@/lib/prevention/inspection-wiring"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import {
  coverageLabel,
  isOfficialProvenance,
  parityStatusLabel,
  templateStatusVariant,
  type DocumentSourceOption,
  type TemplateItem,
} from "../../_components/catalog-types"
import { TemplateActions } from "./template-actions"

/**
 * Catálogo de instrumentos. Antes convivía con la programación en una sola
 * pantalla de pestañas: son dos actos distintos —qué se pregunta y cuándo se
 * pregunta— con permisos y públicos distintos, y la pestaña obligaba a pasar
 * por uno para llegar al otro.
 */
export function InspectionTemplatesPanel({ templates, catalogActivities = [], documentSources = [], canManage, canApprove, currentUserId = null }: {
  templates: TemplateItem[]
  catalogActivities?: PdtpActivityPickerOption[]
  /** Versiones de la Biblioteca SST elegibles como fuente; sólo las trae quien administra. */
  documentSources?: DocumentSourceOption[]
  canManage: boolean
  canApprove: boolean
  /** Quien mira: la paridad la declara alguien distinto de quien incorporó la plantilla. */
  currentUserId?: string | null
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

  const actionProps = { templates, catalogActivities, documentSources, canManage, canApprove, currentUserId }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar código o nombre" aria-label="Buscar plantillas" className="pl-9" />
        </div>
        <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="draft">Borradores</SelectItem><SelectItem value="approved">Aprobadas</SelectItem><SelectItem value="superseded">Reemplazadas o retiradas</SelectItem></SelectContent></Select>
      </div>

      {silentCount > 0 && (
        <Callout
          tone="danger"
          title={`${silentCount === 1 ? "Un instrumento vigente no acredita" : `${silentCount} instrumentos vigentes no acreditan`} en el programa anual.`}
        >
          <span className="text-xs">
            Se pueden ejecutar y cerrar con normalidad, y el PDTP no se entera. Su borrador sí declara la actividad: aprobarlo lo corrige.
          </span>
        </Callout>
      )}
      {pendingApprovalCount > 0 && (
        <Callout tone="warning">
          <p>
            {pendingApprovalCount === 1
              ? "Un instrumento del programa 2026 está en borrador."
              : `${pendingApprovalCount} instrumentos del programa 2026 están en borrador.`}{" "}
            Mientras no se aprueben, sus actividades del PDTP no acreditan.
          </p>
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setFilters({ estado: "draft" })}>
            Ver borradores
          </Button>
        </Callout>
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
                  <TemplateStatusBadge item={item} />
                  {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
                  {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} />}
                </div>
              </div>
              {item.definitionMissing && <Callout tone="warning" className="text-xs">La fuente fue retirada del catálogo, pero esta versión {item.status === "approved" ? "sigue ejecutable desde su checklist congelado hasta que la retires" : "se conserva sólo como historial"}.</Callout>}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {/* I-29: la fracción no se explicaba por sí sola. */}
                <div><dt className="text-[var(--color-text-subtle)]" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">Gravedad declarada</dt><dd className="mt-0.5 font-medium">{coverageLabel(item.coverage)}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">PDTP</dt><dd className="mt-0.5 font-medium"><PdtpAccreditationSummary item={item} silentlyUnwired={silentlyUnwiredById.get(item.id)} orphanReplacedBy={orphanApprovedById.get(item.id)} /></dd></div>
                <div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Fuente y paridad</dt><dd className="mt-0.5 font-medium">{item.sourceSnapshot ? <><a className="underline" href={`/api/prevencion/documentacion/${item.sourceSnapshot.documentId}/version/${item.sourceSnapshot.versionId}`}>{item.sourceSnapshot.fileName}</a> · {item.sourceSnapshot.revision ?? "sin revisión"} · {parityStatusLabel(item.parityReport?.status)}{item.parityReport?.status === "failed" && (item.parityReport.differences?.length ?? 0) > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 font-normal text-[var(--color-warning-ink)]">
                    {item.parityReport.differences.map((difference) => <li key={difference}>{difference}</li>)}
                  </ul>
                )}</> : isOfficialProvenance(item.provenanceKind) ? "Documento oficial pendiente" : INSPECTION_PROVENANCE_LABELS.platform_definition}</dd></div>
              </dl>
              <TemplateActions item={item} {...actionProps} />
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
                    </> : isOfficialProvenance(item.provenanceKind) ? <span className="text-[var(--color-warning-ink)]">Documento oficial pendiente</span> : INSPECTION_PROVENANCE_LABELS.platform_definition}
                  </TableCell>
                  <TableCell>
                    <TemplateStatusBadge item={item} />
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
                  <TableCell className="text-sm">
                    <PdtpAccreditationSummary item={item} silentlyUnwired={silentlyUnwiredById.get(item.id)} orphanReplacedBy={orphanApprovedById.get(item.id)} />
                  </TableCell>
                  {/* El catálogo de desviaciones sólo tiene sentido en los
                      instrumentos que no puntúan ítems: ahí la gravedad no la
                      declara ningún ítem y tiene que declararla el catálogo. */}
                  <TableCell className="text-sm">
                    <DeviationsCell item={item} canManage={canManage} />
                  </TableCell>
                  <TableCell className="text-right">
                    <TemplateActions item={item} {...actionProps} />
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

/** «Retirada» es un `superseded` que nadie reemplazó: «Reemplazada» afirmaba una versión nueva que no existe. */
function TemplateStatusBadge({ item }: { item: TemplateItem }) {
  return <MetaBadge meta={{ label: inspectionTemplateStatusLabel(item.status, item.supersededByTemplateId), variant: templateStatusVariant(item.status) }} />
}

/**
 * Qué acredita la plantilla en el programa anual, desde `pdtpAccreditation` (la
 * misma lectura que edita el diálogo). Tres casos distintos que antes se pintaban
 * igual:
 * - un borrador imprimía sus actividades como si ya rigieran;
 * - una vigente sin actividades por estar mal cableada se leía igual que la
 *   auditoría del SGSST, que legítimamente no acredita ninguna;
 * - una versión reemplazada o retirada ya no acredita.
 */
function PdtpAccreditationSummary({ item, silentlyUnwired, orphanReplacedBy }: {
  item: TemplateItem
  silentlyUnwired?: { declares: number[]; draftVersionLabel: string }
  orphanReplacedBy?: string[]
}) {
  const { execute, review, executeSource } = item.pdtpAccreditation
  const byNumber = executeSource === "numbers"
    ? "Acredita por número de actividad; edita la acreditación para vincularla al catálogo."
    : undefined
  return (
    <>
      {execute.length > 0 ? (
        <span
          className={item.status === "approved" ? "font-mono text-xs" : "text-xs text-[var(--color-text-subtle)]"}
          title={byNumber}
        >
          {item.status === "approved"
            ? execute.join(", ")
            : item.status === "draft"
              ? `Acreditará ${execute.join(", ")} al aprobarse`
              : `Acreditaba ${execute.join(", ")}`}
        </span>
      ) : silentlyUnwired ? (
        <span className="text-xs text-[var(--color-danger-ink)]">
          No acredita · el borrador v{silentlyUnwired.draftVersionLabel} declara{" "}
          {silentlyUnwired.declares.map((n) => `N° ${n}`).join(", ")}
        </span>
      ) : orphanReplacedBy ? (
        <span className="text-xs text-[var(--color-danger-ink)]">
          No acredita · reemplazada por {orphanReplacedBy.join(" y ")}, retírala a mano
        </span>
      ) : (
        <span className="text-xs text-[var(--color-text-subtle)]">No acredita</span>
      )}
      {/* Al revisar es otra ocurrencia y otro responsable: la
          n=25 la ejecuta el operador, la n=26 la firma el Sup/JT. */}
      {review.length > 0 && (
        <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
          al revisar: <span className="font-mono">{review.join(", ")}</span>
        </span>
      )}
    </>
  )
}

/**
 * El catálogo de desviaciones sólo existe en los instrumentos que las registran
 * y sólo lo administra quien puede gestionar plantillas. En el resto no hay
 * nada que mostrar: «Ninguna ofrecida» sugería un catálogo vacío que arreglar.
 */
function DeviationsCell({ item, canManage }: { item: TemplateItem; canManage: boolean }) {
  if (!item.recordsDeviations || !canManage) {
    return (
      <span
        className="text-xs text-[var(--color-text-subtle)]"
        title={item.recordsDeviations ? "Sólo quien administra las plantillas ve y ajusta las desviaciones." : "Este instrumento no registra desviaciones."}
      >
        No aplica
      </span>
    )
  }
  const offered = item.deviations.filter((entry) => entry.selected).length
  return (
    <>
      {offered > 0
        ? `${offered} ofrecida(s)`
        : <span className="text-xs text-[var(--color-text-subtle)]">Ninguna ofrecida</span>}
      {item.unclassifiedDeviations.length > 0 && (
        <span className="mt-1 block text-xs text-[var(--color-warning-ink)]">
          {item.unclassifiedDeviations.length} por clasificar
        </span>
      )}
    </>
  )
}
