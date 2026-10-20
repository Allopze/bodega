"use client"

import * as React from "react"
import { ArrowElbowDownRight, ClipboardText, Info } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import {
  INSPECTION_KIND_LABELS,
  inspectionTemplateStatusLabel,
} from "@/lib/prevention/inspections"
import { classifyPdtp2026InspectionWiring } from "@/lib/prevention/inspection-wiring"
import { templateActionState } from "@/lib/prevention/inspection-catalog-logic"
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
import { TemplateRowActions, type TemplateDialogKind, type TemplateOpenDialog } from "./template-actions"
import { TemplateDialogs, type ActiveTemplateDialog } from "./template-dialogs"
import { TemplatePreviewSheet, type PreviewTarget } from "./template-preview-sheet"
import { countHiddenVersions, groupTemplatesByInstrument, type TemplateGroup } from "../template-groups"

const STATUS_OPTIONS: OptionSelectOption[] = [
  { value: "draft", label: "Borradores" },
  { value: "approved", label: "Aprobadas" },
  { value: "superseded", label: "Reemplazadas o retiradas" },
]
const KIND_OPTIONS: OptionSelectOption[] = Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => ({ value, label }))

/* A2: tres filtros primarios en una misma fila de 36 px (en móvil, a 44). */
const SELECT_CLASS = "h-11 w-full text-xs sm:h-9 sm:w-44"
const SEARCH_CLASS = "h-11 w-full pl-8 text-xs sm:h-9 sm:w-64"

type PdtpNotices = {
  silentlyUnwired?: { declares: number[]; draftVersionLabel: string }
  orphanReplacedBy?: string[]
}

/**
 * Catálogo de instrumentos. Antes convivía con la programación en una sola
 * pantalla de pestañas: son dos actos distintos —qué se pregunta y cuándo se
 * pregunta— con permisos y públicos distintos, y la pestaña obligaba a pasar
 * por uno para llegar al otro.
 *
 * Una fila por INSTRUMENTO, no por versión: la aprobada es la fila y un borrador
 * nuevo cuelga de ella como subfila. Lo reemplazado y lo retirado se lee en la
 * vista previa del cuestionario. La acción principal de la fila es el siguiente
 * paso del instrumento; el resto está en «Más acciones».
 */
export function InspectionTemplatesPanel({ templates, catalogActivities = [], documentSources = [], canManage, canApprove, currentUserId = null, emptyAction }: {
  templates: TemplateItem[]
  catalogActivities?: PdtpActivityPickerOption[]
  /** Versiones de la Biblioteca SST elegibles como fuente; sólo las trae quien administra. */
  documentSources?: DocumentSourceOption[]
  canManage: boolean
  canApprove: boolean
  /** Quien mira: la paridad la declara alguien distinto de quien incorporó la plantilla. */
  currentUserId?: string | null
  /** La acción que llena un catálogo vacío (incorporar el primer instrumento). */
  emptyAction?: React.ReactNode
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja — se perdían al refrescar.
  const { getFilter, setFilters } = useUrlFilters()
  const kind = getFilter("tipo")
  const status = getFilter("estado") || "all"
  const urlQuery = getFilter("q")

  const matching = React.useMemo(() => {
    const normalized = urlQuery.trim().toLocaleLowerCase("es-CL")
    return templates.filter((item) =>
      (!normalized || `${item.code} ${item.name} ${item.versionLabel}`.toLocaleLowerCase("es-CL").includes(normalized))
      && (!kind || item.kind === kind))
  }, [templates, urlQuery, kind])
  const groups = React.useMemo(() => groupTemplatesByInstrument(matching, status), [matching, status])
  const hiddenVersions = countHiddenVersions(matching, status)

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

  /* ── Diálogos y vista previa: uno de cada, montados una sola vez ─────────── */
  const [active, setActive] = React.useState<ActiveTemplateDialog | null>(null)
  const [preview, setPreview] = React.useState<{ target: PreviewTarget; nonce: number; open: boolean } | null>(null)
  const openPreview = React.useCallback((item: TemplateItem) => {
    setPreview((previous) => ({
      target: { id: item.id, name: item.name, versionLabel: item.versionLabel, kind: item.kind },
      nonce: (previous?.nonce ?? 0) + 1,
      open: true,
    }))
  }, [])
  const openDialog: TemplateOpenDialog = React.useCallback((dialogKind: TemplateDialogKind, item: TemplateItem) => {
    if (dialogKind === "preview") return openPreview(item)
    const kind = dialogKind
    setActive((previous) => ({ kind, item, nonce: (previous?.nonce ?? 0) + 1, open: true }))
  }, [openPreview])

  const ctx = { canManage, canApprove, currentUserId }
  const previousOf = (item: TemplateItem) => templates.find((candidate) => candidate.supersededByTemplateId === item.id) ?? null

  /* ── Filtros ─────────────────────────────────────────────────────────────── */
  const chips: ActiveFilterChip[] = []
  if (urlQuery) chips.push({ key: "q", label: "Búsqueda", value: urlQuery, displayValue: urlQuery })
  const kindOption = KIND_OPTIONS.find((option) => option.value === kind)
  if (kindOption) chips.push({ key: "tipo", label: "Tipo", value: kind, displayValue: String(kindOption.label) })
  const statusOption = STATUS_OPTIONS.find((option) => option.value === status)
  if (statusOption) chips.push({ key: "estado", label: "Estado", value: status, displayValue: String(statusOption.label) })
  const clearAll = () => setFilters({ q: null, tipo: null, estado: null })

  const rowProps = { ctx, silentlyUnwiredById, orphanApprovedById, onOpen: openDialog, previousOf }

  return (
    <div className="space-y-4">
      <FilterToolbar
        className="mb-0"
        activeChips={chips}
        onRemoveChip={(key) => setFilters({ [key]: null })}
        onClearAll={clearAll}
      >
        <FilterSearchInput param="q" pageKeys={[]} placeholder="Buscar código o nombre" ariaLabel="Buscar plantillas" className={SEARCH_CLASS} />
        <OptionSelect
          aria-label="Filtrar plantillas por tipo"
          className={SELECT_CLASS}
          emptyLabel="Todos los tipos"
          options={KIND_OPTIONS}
          value={kind}
          onValueChange={(value) => setFilters({ tipo: value || null })}
        />
        <OptionSelect
          aria-label="Filtrar plantillas por estado"
          className={SELECT_CLASS}
          emptyLabel="Todos los estados"
          options={STATUS_OPTIONS}
          value={statusOption ? status : ""}
          onValueChange={(value) => setFilters({ estado: value || null })}
        />
      </FilterToolbar>

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

      {groups.length === 0 ? (
        <TemplatesEmpty
          hasTemplates={templates.length > 0}
          onlyHiddenVersions={hiddenVersions > 0 && chips.length === 0}
          hasFilters={chips.length > 0}
          onClear={clearAll}
          onShowRetired={() => setFilters({ estado: "superseded" })}
          emptyAction={emptyAction}
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {groups.flatMap((group) => cardsOf(group, status, rowProps, canManage, wiringNotices(group.primary, silentlyUnwiredById, orphanApprovedById)))}
          </div>
          <div className="hidden md:block">
            <TableRoot aria-label="Instrumentos de inspección">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrumento</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Acredita PDTP
                        <HeaderHint label="Qué es el PDTP" content="Programa de trabajo preventivo: las actividades del programa anual que esta plantilla acredita al ejecutarse y, si corresponde, al revisarse." />
                      </span>
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">
                      <span className="inline-flex items-center gap-1">
                        Gravedad
                        <HeaderHint label="Qué es la gravedad declarada" content="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos." />
                      </span>
                    </TableHead>
                    {canManage && <TableHead className="hidden xl:table-cell">Desviaciones</TableHead>}
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.flatMap((group) => {
                    const grouped = status === "all"
                    const rows = [
                      <TemplateTableRow key={group.primary.id} item={group.primary} joinsDraft={group.pendingDraft !== null} ambiguousName={!grouped} {...rowProps} canManage={canManage} />,
                    ]
                    if (group.pendingDraft) {
                      rows.push(<TemplateTableRow key={group.pendingDraft.id} item={group.pendingDraft} subrow {...rowProps} canManage={canManage} />)
                    }
                    return rows
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          </div>
          {hiddenVersions > 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {hiddenVersions === 1 ? "Una versión reemplazada o retirada no se lista" : `${hiddenVersions} versiones reemplazadas o retiradas no se listan`}: están en el historial del cuestionario de cada instrumento.{" "}
              <button type="button" className="inline-flex min-h-11 items-center font-medium text-[var(--color-primary-ink)] underline underline-offset-2 md:min-h-0" onClick={() => setFilters({ estado: "superseded" })}>
                Ver reemplazadas o retiradas
              </button>
            </p>
          )}
        </>
      )}

      <TemplateDialogs
        active={active}
        onOpenChange={(open) => setActive((current) => (current ? { ...current, open } : current))}
        templates={templates}
        catalogActivities={catalogActivities}
        documentSources={documentSources}
        onPreview={openPreview}
      />
      {preview && (
        <TemplatePreviewSheet
          key={preview.nonce}
          target={preview.target}
          open={preview.open}
          onOpenChange={(open) => setPreview((current) => (current ? { ...current, open } : current))}
        />
      )}
    </div>
  )
}

function wiringNotices(
  item: TemplateItem,
  silentlyUnwiredById: Map<string, { declares: number[]; draftVersionLabel: string }>,
  orphanApprovedById: Map<string, string[]>,
): PdtpNotices {
  return { silentlyUnwired: silentlyUnwiredById.get(item.id), orphanReplacedBy: orphanApprovedById.get(item.id) }
}

type RowShared = {
  ctx: { canManage: boolean; canApprove: boolean; currentUserId: string | null }
  silentlyUnwiredById: Map<string, { declares: number[]; draftVersionLabel: string }>
  orphanApprovedById: Map<string, string[]>
  onOpen: TemplateOpenDialog
  previousOf: (item: TemplateItem) => TemplateItem | null
}

/* ── Tabla ─────────────────────────────────────────────────────────────────── */

function TemplateTableRow({ item, subrow = false, joinsDraft = false, ambiguousName = false, canManage, ctx, silentlyUnwiredById, orphanApprovedById, onOpen, previousOf }: RowShared & {
  item: TemplateItem
  /** Un borrador nuevo que cuelga de la fila aprobada de su instrumento. */
  subrow?: boolean
  /** La fila principal que tiene una subfila debajo: no lleva borde inferior, es un solo bloque. */
  joinsDraft?: boolean
  /** Hay más de una fila del mismo instrumento: el menú dice de cuál versión es. */
  ambiguousName?: boolean
  canManage: boolean
}) {
  const state = templateActionState(item, ctx)
  const kindLabel = INSPECTION_KIND_LABELS[item.kind] ?? item.kind
  return (
    <TableRow className={[subrow ? "bg-[var(--color-surface-2)]/60" : "", joinsDraft ? "border-b-0!" : ""].filter(Boolean).join(" ")}>
      <TableCell className="min-w-56 align-top">
        {subrow ? (
          <div className="flex items-start gap-2 pl-4">
            <ArrowElbowDownRight size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Nueva versión en borrador</p>
              <button
                type="button"
                className="max-w-full text-left text-sm font-medium text-[var(--color-text)] underline-offset-4 hover:underline"
                aria-label={`Ver cuestionario de ${item.name} ${item.versionLabel}`}
                onClick={() => onOpen("preview", item)}
              >
                <span className="font-mono text-xs">{item.versionLabel}</span>
              </button>
              <span className="text-xs text-[var(--color-text-muted)]"> · {kindLabel}</span>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <button
              type="button"
              className="max-w-full text-left text-sm font-medium text-[var(--color-text)] underline-offset-4 hover:underline"
              onClick={() => onOpen("preview", item)}
            >
              {item.name}
            </button>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              <span className="font-mono">{item.versionLabel}</span> · {kindLabel}
            </p>
            {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
            {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} className="mt-1" />}
          </div>
        )}
      </TableCell>
      <TableCell className="min-w-44 max-w-64 align-top">
        <StatusLines item={item} notice={state.notice} />
      </TableCell>
      <TableCell className="align-top">
        <PdtpAccreditationSummary item={item} {...wiringNotices(item, silentlyUnwiredById, orphanApprovedById)} />
      </TableCell>
      <TableCell className="hidden align-top xl:table-cell">
        <GravityCell item={item} />
      </TableCell>
      {/* El catálogo de desviaciones sólo tiene sentido en los instrumentos que no
          puntúan ítems: ahí la gravedad no la declara ningún ítem y tiene que
          declararla el catálogo. */}
      {canManage && (
        <TableCell className="hidden align-top xl:table-cell">
          <DeviationsCell item={item} canManage={canManage} />
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap text-right align-top">
        <TemplateRowActions
          item={item}
          ctx={ctx}
          previous={previousOf(item)}
          onOpen={onOpen}
          menuLabelOf={subrow || ambiguousName ? `${item.name} ${item.versionLabel}` : item.name}
        />
      </TableCell>
    </TableRow>
  )
}

/** El nombre del encabezado de columna con su aclaración: un botón enfocable, porque un `title` no se alcanza con teclado. */
function HeaderHint({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip content={content}>
      <button type="button" aria-label={label} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:text-[var(--color-text)]">
        <Info size={14} aria-hidden />
      </button>
    </Tooltip>
  )
}

/* ── Tarjetas (móvil) ──────────────────────────────────────────────────────── */

function cardsOf(group: TemplateGroup<TemplateItem>, status: string, row: RowShared, canManage: boolean, notices: PdtpNotices) {
  const cards = [
    <TemplateCard key={group.primary.id} item={group.primary} ambiguousName={status !== "all"} canManage={canManage} notices={notices} {...row} />,
  ]
  if (group.pendingDraft) {
    const draft = group.pendingDraft
    cards.push(
      <TemplateCard
        key={draft.id}
        item={draft}
        draftOf={group.primary}
        canManage={canManage}
        notices={wiringNotices(draft, row.silentlyUnwiredById, row.orphanApprovedById)}
        {...row}
      />,
    )
  }
  return cards
}

function TemplateCard({ item, draftOf, ambiguousName = false, canManage, notices, ctx, onOpen, previousOf }: RowShared & {
  item: TemplateItem
  /** Es el borrador nuevo de la versión aprobada que la antecede. */
  draftOf?: TemplateItem
  ambiguousName?: boolean
  canManage: boolean
  notices: PdtpNotices
}) {
  const state = templateActionState(item, ctx)
  const kindLabel = INSPECTION_KIND_LABELS[item.kind] ?? item.kind
  return (
    <ResponsiveDataListCard
      title={
        <button type="button" className="block w-full min-h-11 truncate text-left" onClick={() => onOpen("preview", item)}>
          {item.name}
        </button>
      }
      description={
        <>
          {draftOf && <span className="block font-medium">Nueva versión en borrador</span>}
          <span className="font-mono">{item.versionLabel}</span> · {kindLabel}
        </>
      }
      status={<TemplateStatusBadge item={item} />}
      actions={
        <TemplateRowActions
          item={item}
          ctx={ctx}
          previous={previousOf(item)}
          onOpen={onOpen}
          menuLabelOf={draftOf || ambiguousName ? `${item.name} ${item.versionLabel}` : item.name}
          mobile
        />
      }
    >
      <ResponsiveDataListField label="Acredita PDTP">
        <PdtpAccreditationSummary item={item} plain {...notices} />
      </ResponsiveDataListField>
      <ResponsiveDataListField label="Gravedad declarada">
        <GravityCell item={item} />
      </ResponsiveDataListField>
      {canManage && (
        <ResponsiveDataListField label="Desviaciones">
          <DeviationsCell item={item} canManage={canManage} />
        </ResponsiveDataListField>
      )}
      {(isOfficialProvenance(item.provenanceKind) || state.notice || item.definitionMissing || item.definitionDrifted || !item.sourceDefinitionCode) && (
        <ResponsiveDataListField label="Fuente y paridad" className="col-span-2">
          {item.status !== "superseded" && item.definitionDrifted && (
            <p className="text-[var(--color-warning-ink)]">Catálogo actualizado</p>
          )}
          <SourceLines item={item} notice={state.notice} />
          {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
          {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} className="mt-1" />}
          {item.definitionMissing && (
            <Callout tone="warning" className="mt-1 text-xs">
              La fuente fue retirada del catálogo, pero esta versión {item.status === "approved" ? "sigue ejecutable desde su checklist congelado hasta que la retires" : "se conserva sólo como historial"}.
            </Callout>
          )}
        </ResponsiveDataListField>
      )}
    </ResponsiveDataListCard>
  )
}

/* ── Piezas de las celdas ──────────────────────────────────────────────────── */

/** «Retirada» es un `superseded` que nadie reemplazó: «Reemplazada» afirmaba una versión nueva que no existe. */
function TemplateStatusBadge({ item }: { item: TemplateItem }) {
  return <MetaBadge meta={{ label: inspectionTemplateStatusLabel(item.status, item.supersededByTemplateId), variant: templateStatusVariant(item.status) }} />
}

/** El estado y, debajo, lo que hay que saber de su fuente y su paridad: sin hashes, que viven en la vista previa. */
function StatusLines({ item, notice }: { item: TemplateItem; notice: string | null }) {
  return (
    <div className="space-y-1">
      <TemplateStatusBadge item={item} />
      {/* A-03: el snapshot está congelado a propósito, así que la deriva no es un
          error — es la señal de que toca publicar una versión nueva. Sólo
          interesa mientras la plantilla esté vigente; una ya reemplazada deriva
          por definición. */}
      {item.status !== "superseded" && item.definitionDrifted && (
        <p className="text-xs text-[var(--color-warning-ink)]" title="El contenido en código difiere del snapshot aprobado. No implica que el checklist haya cambiado de fondo.">
          Catálogo actualizado
        </p>
      )}
      {item.definitionMissing && (
        <p className="text-xs text-[var(--color-warning-ink)]" title={`La fuente fue retirada del catálogo; el snapshot de esta versión se conserva. ${item.status === "approved" ? "Sigue ejecutable desde su checklist congelado." : "Sólo queda como historial."}`}>
          Fuente retirada del catálogo
        </p>
      )}
      <SourceLines item={item} notice={notice} />
    </div>
  )
}

/**
 * Sólo los instrumentos que transcriben un anexo oficial tienen una fuente y una
 * paridad que decir; los de plataforma no llevan nada. Las diferencias de la
 * paridad se cuentan acá y se leen enteras en la vista previa.
 */
function SourceLines({ item, notice }: { item: TemplateItem; notice: string | null }) {
  if (!isOfficialProvenance(item.provenanceKind)) return null
  const differences = item.parityReport?.differences?.length ?? 0
  return (
    <div className="space-y-0.5 text-xs">
      {item.sourceSnapshot ? (
        <p className={item.parityReport?.status === "failed" ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text-muted)]"}>
          {parityStatusLabel(item.parityReport?.status)}
          {item.parityReport?.status === "failed" && differences > 0 ? ` · ${differences} ${differences === 1 ? "diferencia" : "diferencias"}` : ""}
        </p>
      ) : !notice ? (
        <p className="text-[var(--color-warning-ink)]">Documento oficial pendiente</p>
      ) : null}
      {notice && <p className="text-[var(--color-warning-ink)]">{notice}</p>}
    </div>
  )
}

/** Lo corto en la fila («N° 41 +1») y lo entero en el tooltip. */
const shortPdtpLabel = (label: string) => label.split(" — ")[0]!

/**
 * Qué acredita la plantilla en el programa anual, desde `pdtpAccreditation` (la
 * misma lectura que edita el diálogo). Tres casos distintos que antes se pintaban
 * igual:
 * - un borrador imprimía sus actividades como si ya rigieran;
 * - una vigente sin actividades por estar mal cableada se leía igual que la
 *   auditoría del SGSST, que legítimamente no acredita ninguna;
 * - una versión reemplazada o retirada ya no acredita.
 *
 * La celda es corta a propósito: «N° 41 +1» y, debajo, «Al revisar: N° 26». La
 * prosa completa —los nombres de las actividades, y por qué una vigente no
 * acredita— va en un tooltip: antes era ella la que fijaba la altura de la fila.
 */
function PdtpAccreditationSummary({ item, silentlyUnwired, orphanReplacedBy, plain = false }: { item: TemplateItem; plain?: boolean } & PdtpNotices) {
  const { execute, review, executeSource } = item.pdtpAccreditation
  const byNumber = executeSource === "numbers"
    ? "Acredita por número de actividad; edita la acreditación para vincularla al catálogo."
    : null
  const full = (labels: string[]) => (
    <span className="block space-y-0.5">
      {labels.map((label) => <span key={label} className="block">{label}</span>)}
      {byNumber && <span className="block pt-1 opacity-80">{byNumber}</span>}
    </span>
  )

  const executeText = execute.length === 0
    ? null
    : `${shortPdtpLabel(execute[0]!)}${execute.length > 1 ? ` +${execute.length - 1}` : ""}`
  const trailing = item.status === "draft" ? "al aprobarse" : item.status === "superseded" ? "ya no acredita" : null

  // La tarjeta móvil no tiene tooltips (no hay hover): lleva lo corto en mono y,
  // debajo, el nombre de la primera actividad en una sola línea. La prosa entera
  // de cada actividad volvería a fijar la altura de la tarjeta.
  if (plain) {
    const firstName = execute[0]?.split(" — ").slice(1).join(" — ") ?? ""
    return (
      <div className="space-y-0.5 text-xs">
        {execute.length > 0 ? (
          <>
            <p className={`font-mono ${item.status === "approved" ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>{executeText}</p>
            {firstName && <p className="truncate text-[var(--color-text-muted)]" title={execute.join("\n")}>{firstName}</p>}
            {trailing && <p>{trailing}</p>}
          </>
        ) : silentlyUnwired ? (
          <p className="text-[var(--color-danger-ink)]">No acredita · el borrador {silentlyUnwired.draftVersionLabel} declara {silentlyUnwired.declares.map((n) => `N° ${n}`).join(", ")}</p>
        ) : orphanReplacedBy ? (
          <p className="text-[var(--color-danger-ink)]">No acredita · reemplazada por {orphanReplacedBy.join(" y ")}, retírala a mano</p>
        ) : (
          <p>No acredita</p>
        )}
        {review.length > 0 && <p>Al revisar: <span className="font-mono">{`${shortPdtpLabel(review[0]!)}${review.length > 1 ? ` +${review.length - 1}` : ""}`}</span></p>}
      </div>
    )
  }

  return (
    <div className="space-y-0.5 text-xs">
      {executeText ? (
        <>
          <Tooltip content={full(execute)}>
            <button
              type="button"
              aria-label={`Acredita ${execute.join(", ")}`}
              className={`-my-1 cursor-help rounded-sm py-1 text-left underline decoration-dotted underline-offset-4 ${item.status === "approved" ? "font-mono text-[var(--color-text)]" : "font-mono text-[var(--color-text-muted)]"}`}
            >
              {executeText}
            </button>
          </Tooltip>
          {trailing && <p className="text-[var(--color-text-muted)]">{trailing}</p>}
        </>
      ) : silentlyUnwired ? (
        <Tooltip content={`El borrador ${silentlyUnwired.draftVersionLabel} declara ${silentlyUnwired.declares.map((n) => `N° ${n}`).join(", ")}: aprobarlo lo corrige.`}>
          <button type="button" className="-my-1 cursor-help rounded-sm py-1 text-left text-[var(--color-danger-ink)] underline decoration-dotted underline-offset-4">No acredita</button>
        </Tooltip>
      ) : orphanReplacedBy ? (
        <Tooltip content={`Reemplazada por ${orphanReplacedBy.join(" y ")}: retírala a mano.`}>
          <button type="button" className="-my-1 cursor-help rounded-sm py-1 text-left text-[var(--color-danger-ink)] underline decoration-dotted underline-offset-4">No acredita</button>
        </Tooltip>
      ) : (
        <span className="text-[var(--color-text-muted)]">No acredita</span>
      )}
      {/* Al revisar es otra ocurrencia y otro responsable: la n=25 la ejecuta el
          operador, la n=26 la firma el Sup/JT. */}
      {review.length > 0 && (
        <p className="text-[var(--color-text-muted)]">
          Al revisar:{" "}
          <Tooltip content={full(review)}>
            <button type="button" className="-my-1 cursor-help rounded-sm py-1 font-mono underline decoration-dotted underline-offset-4">
              {`${shortPdtpLabel(review[0]!)}${review.length > 1 ? ` +${review.length - 1}` : ""}`}
            </button>
          </Tooltip>
        </p>
      )}
    </div>
  )
}

/** I-29: la fracción no se explicaba por sí sola. */
function GravityCell({ item }: { item: TemplateItem }) {
  return (
    <div className="whitespace-nowrap text-sm" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">
      {coverageLabel(item.coverage)}
      {item.coverage.criticalityInert && (
        <p className="text-xs text-[var(--color-warning-ink)]" title="Sin gravedad por ítem, toda falla saldrá de criticidad media.">
          Sin gravedad por ítem
        </p>
      )}
    </div>
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
    <div className="whitespace-nowrap text-sm">
      {offered > 0
        ? `${offered} ofrecida(s)`
        : <span className="text-xs text-[var(--color-text-subtle)]">Ninguna ofrecida</span>}
      {item.unclassifiedDeviations.length > 0 && (
        <p className="text-xs text-[var(--color-warning-ink)]">
          {item.unclassifiedDeviations.length} por clasificar
        </p>
      )}
    </div>
  )
}

/** A4: qué significa el vacío, cómo se llena y un botón real que lo hace. */
function TemplatesEmpty({ hasTemplates, onlyHiddenVersions, hasFilters, onClear, onShowRetired, emptyAction }: {
  hasTemplates: boolean
  onlyHiddenVersions: boolean
  hasFilters: boolean
  onClear: () => void
  onShowRetired: () => void
  emptyAction?: React.ReactNode
}) {
  if (!hasTemplates) {
    return (
      <EmptyState
        icon={<ClipboardText size={20} />}
        title="No hay instrumentos incorporados"
        description="Una persona administradora debe incorporar un instrumento desde el catálogo SST y luego enviarlo a aprobación."
        action={emptyAction}
      />
    )
  }
  if (onlyHiddenVersions) {
    return (
      <EmptyState
        icon={<ClipboardText size={20} />}
        title="No hay instrumentos vigentes ni borradores"
        description="Todas las versiones están reemplazadas o retiradas."
        action={<Button variant="secondary" onClick={onShowRetired}>Ver reemplazadas o retiradas</Button>}
      />
    )
  }
  return (
    <EmptyState
      icon={<ClipboardText size={20} />}
      title="No hay plantillas con estos filtros"
      description="Ajusta la búsqueda, el tipo o el estado."
      action={hasFilters ? <Button variant="secondary" onClick={onClear}>Limpiar filtros</Button> : undefined}
    />
  )
}
