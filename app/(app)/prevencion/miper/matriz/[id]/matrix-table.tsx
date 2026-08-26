"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Pagination } from "@/components/ui/pagination"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { RISK_CLASSIFICATIONS, RISK_CLASSIFICATION_BADGE_VARIANT, RISK_CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/risk-engine"
import { RISK_QUICK_FILTERS, RISK_QUICK_FILTER_LABELS, type RiskQuickFilter } from "@/lib/prevention/risk-list-filters"
import type { PaginationState } from "@/lib/pagination"
import type { listRiskEntriesPage } from "@/lib/services/prevention-risk-legal"
import { bulkUpdateRiskControlsAction, generateCapaFromRisksAction } from "../../actions"

type MatrixRow = Awaited<ReturnType<typeof listRiskEntriesPage>>["rows"][number]

const CONTROL_HIERARCHY: Record<string, string> = {
  elimination: "Eliminación", substitution: "Sustitución", engineering: "Ingeniería", administrative: "Administrativo", ppe: "EPP",
}

/**
 * `DataTable` (components/ui/data-table.tsx) declara `enableRowSelection` /
 * `onSelectionChange` en su tipo pero no los implementa (verificado: cero
 * referencias en el componente) — pasarlos no haría nada. La selección se
 * gestiona acá, en `renderRow`, que sí es del llamador.
 */
export function MatrixTable({ matrixStatus, rows, total, pagination, assignableUsers, canEdit, canGenerateCapa }: {
  matrixStatus: string
  rows: MatrixRow[]
  total: number
  pagination: PaginationState
  assignableUsers: { id: string; name: string }[]
  canEdit: boolean
  canGenerateCapa: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getFilter, setFilters, clearFilters } = useUrlFilters()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const classification = getFilter("classification") || "all"
  const routine = getFilter("routine") || "all"
  const quick = (getFilter("quick") as RiskQuickFilter | null) ?? "all"
  const editableSelection = matrixStatus === "draft" && canEdit

  // Búsqueda server-side (`listRiskEntriesPage` filtra por peligro, riesgo y
  // código): borrador local + debounce a la URL, mismo patrón que la lista de
  // inspecciones.
  const urlSearch = getFilter("q")
  const [searchDraft, setSearchDraft] = useState(urlSearch)
  useEffect(() => setSearchDraft(urlSearch), [urlSearch])
  useEffect(() => {
    const query = searchDraft.trim()
    if (query === urlSearch) return
    const timer = setTimeout(() => setFilters({ q: query || null }), 350)
    return () => clearTimeout(timer)
  }, [searchDraft, urlSearch, setFilters])

  /* Paginar o filtrar cambia el conjunto visible, pero `setFilters` y
   * `navigatePage` usan replace/push sobre la MISMA ruta: este componente no
   * se remonta y la selección sobreviviría. Una operación masiva se aplicaría
   * entonces a filas que el usuario ya no ve —y "Seleccionar todo" leería
   * `selected.size === rows.length` de un conjunto ajeno—. Se descarta la
   * selección cuando cambia el conjunto visible (patrón de ajuste de estado
   * durante el render, no un efecto: React re-renderiza sin pintar el
   * intermedio). */
  const visibleRowsKey = rows.map((row) => row.entry.id).join("|")
  const [selectionScope, setSelectionScope] = useState(visibleRowsKey)
  if (selectionScope !== visibleRowsKey) {
    setSelectionScope(visibleRowsKey)
    if (selected.size > 0) setSelected(new Set())
  }

  function navigatePage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    router.push(params.toString() ? `?${params.toString()}` : "")
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((row) => row.entry.id)))
  }

  const columns: ColumnDef[] = [
    ...(editableSelection ? [{ key: "select", label: "Seleccionar" }] : []),
    { key: "identity", label: "Proceso / Tarea / Puesto" },
    { key: "hazard", label: "Peligro / Riesgo" },
    { key: "evaluation", label: "P × C = MR", numeric: true },
    { key: "classification", label: "Clasificación" },
    { key: "control", label: "Medida de control" },
    { key: "responsible", label: "Responsable" },
    { key: "capa", label: "Programa de Trabajo" },
  ]

  const activeChips: ActiveFilterChip[] = []
  if (urlSearch) activeChips.push({ key: "q", label: "Búsqueda", value: urlSearch, displayValue: urlSearch })
  if (classification !== "all") activeChips.push({ key: "classification", label: "Clasificación", value: classification, displayValue: RISK_CLASSIFICATION_LABEL[classification as RiskClassification] ?? classification })
  if (routine !== "all") activeChips.push({ key: "routine", label: "Rutinaria", value: routine, displayValue: routine === "routine" ? "Rutinaria" : "No rutinaria" })
  if (quick !== "all") activeChips.push({ key: "quick", label: "Vista", value: quick, displayValue: RISK_QUICK_FILTER_LABELS[quick as Exclude<RiskQuickFilter, "all">] })

  return (
    <div className="space-y-4">
      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={(key) => setFilters({ [key]: null })}
        onClearAll={clearFilters}
        hasActiveFilters={activeChips.length > 0}
      >
        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" />
          <Input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Peligro, riesgo o código" aria-label="Buscar riesgos de la matriz" className="pl-9" />
        </div>
        <OptionSelect id="matrix-filter-classification" value={classification} onValueChange={(value) => setFilters({ classification: value === "all" ? null : value })}
          options={[{ value: "all", label: "Todas las clasificaciones" }, ...RISK_CLASSIFICATIONS.map((item) => ({ value: item, label: RISK_CLASSIFICATION_LABEL[item] }))]} />
        <OptionSelect id="matrix-filter-routine" value={routine} onValueChange={(value) => setFilters({ routine: value === "all" ? null : value })}
          options={[{ value: "all", label: "Rutinaria y no rutinaria" }, { value: "routine", label: "Rutinaria" }, { value: "non_routine", label: "No rutinaria" }]} />
      </FilterToolbar>

      <div className="flex flex-wrap gap-2">
        {RISK_QUICK_FILTERS.map((filter) => (
          <Button key={filter} type="button" size="sm" variant={quick === filter ? "primary" : "secondary"}
            aria-pressed={quick === filter} onClick={() => setFilters({ quick: filter === "all" ? null : filter })}>
            {filter === "all" ? "Todos" : RISK_QUICK_FILTER_LABELS[filter]}
          </Button>
        ))}
      </div>

      {editableSelection && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] p-3">
          <span className="text-sm font-medium">{selected.size} riesgo(s) seleccionado(s)</span>
          {canGenerateCapa && <GenerateCapaBulkDialog riskEntryIds={[...selected]} onDone={() => setSelected(new Set())} />}
          <ReassignResponsibleDialog riskEntryIds={[...selected]} assignableUsers={assignableUsers} onDone={() => setSelected(new Set())} />
          <ChangeDeadlineDialog riskEntryIds={[...selected]} onDone={() => setSelected(new Set())} />
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Deseleccionar</Button>
        </div>
      )}

      <DataTable
        caption={`Riesgos de la matriz — página ${pagination.page}`}
        columns={columns}
        rows={rows}
        searchKeys={[]}
        disableInternalSearch
        pageSize={rows.length || 1}
        stickyFirstColumn
        enableColumnToggle
        viewKey="miper-matriz"
        emptyTitle="Sin riesgos con estos filtros"
        emptyDescription="Ajusta los filtros o revisa que la matriz tenga peligros agregados."
        renderRow={(row) => (
          <tr key={row.entry.id} className="border-b">
            {editableSelection && (
              <td className="p-2"><Checkbox labelHidden label={`Seleccionar ${row.entry.hazard}`} checked={selected.has(row.entry.id)} onChange={() => toggleRow(row.entry.id)} /></td>
            )}
            <td className="p-2 text-sm"><a href={`/prevencion/miper/riesgos/${row.entry.id}`} className="font-medium hover:underline">{row.process.name}</a><p className="text-xs text-[var(--color-text-subtle)]">{row.task.name} → {row.position.name}</p></td>
            <td className="p-2 text-sm"><p className="font-medium">{row.entry.hazard}</p><p className="text-xs text-[var(--color-text-subtle)]">{row.entry.risk ?? "Sin especificar"}</p></td>
            <td className="p-2 text-right font-mono text-sm tabular-nums">{row.entry.probability ?? "—"} × {row.entry.consequence ?? "—"} = {row.entry.riskMagnitude ?? "—"}</td>
            <td className="p-2 text-sm">{row.entry.riskClassification
              ? <Badge variant={RISK_CLASSIFICATION_BADGE_VARIANT[row.entry.riskClassification as RiskClassification]}>{RISK_CLASSIFICATION_LABEL[row.entry.riskClassification as RiskClassification]}</Badge>
              : <Badge variant="outline">Sin evaluar</Badge>}
            </td>
            <td className="p-2 text-sm">{row.controls.length === 0 ? <span className="text-[var(--color-text-subtle)]">Sin controles</span> : <p className="line-clamp-2">{row.controls.map((control) => `${CONTROL_HIERARCHY[control.hierarchy] ?? control.hierarchy}: ${control.description}`).join("; ")}</p>}</td>
            <td className="p-2 text-sm">{row.entry.responsibleSnapshot}</td>
            <td className="p-2 text-sm">{row.openCapaCount > 0 ? <Badge variant="warning">{row.openCapaCount} abierta(s)</Badge> : <span className="text-[var(--color-text-subtle)]">Sin acciones</span>}</td>
          </tr>
        )}
        actions={editableSelection && rows.length > 0 ? <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>{selected.size === rows.length ? "Deseleccionar todo" : "Seleccionar todo"}</Button> : undefined}
      />

      {pagination.totalPages > 1 && (
        <div className="flex justify-center pt-2"><Pagination page={pagination.page} total={total} perPage={pagination.limit} onPage={navigatePage} /></div>
      )}
    </div>
  )
}

function GenerateCapaBulkDialog({ riskEntryIds, onDone }: { riskEntryIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState(false)
  /* `DatePicker` escribe en un input oculto y no admite `required`, así que el
   * navegador no bloquea el envío: sin fecha, `generateCapaFromRisksSchema`
   * respondía con el genérico "Revisa los campos marcados" sin decir cuál.
   * Controlado + botón deshabilitado, mismo criterio que el responsable en
   * `ReassignResponsibleDialog`. */
  const [targetDate, setTargetDate] = useState("")
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!targetDate) return
    const values = new FormData(event.currentTarget)
    const actionDescription = String(values.get("actionDescription") ?? "").trim()
    operation.run(() => generateCapaFromRisksAction({
      riskEntryIds,
      defaults: {
        targetDate,
        groupIntoSingleAction: group,
        ...(actionDescription ? { actionDescription } : {}),
      },
    }), () => { setOpen(false); onDone() })
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" size="sm">Generar acciones preventivas</Button></DialogTrigger>
    <DialogContent><form onSubmit={submit} className="space-y-4">
      <DialogHeader><DialogTitle>Generar acciones preventivas</DialogTitle><DialogDescription>Crea una CAPA por riesgo seleccionado ({riskEntryIds.length}), o agrúpalas en una sola.</DialogDescription></DialogHeader>
      <Checkbox checked={group} onChange={(event) => setGroup(event.target.checked)} label="Agrupar en una sola acción (todos los riesgos deben ser de la misma faena)" />
      <Field label="Descripción de la acción" htmlFor="bulk-capa-description" hint={group ? "Obligatoria al agrupar." : "Si se deja vacía, se usa la primera medida de control de cada riesgo."}>
        <Textarea id="bulk-capa-description" name="actionDescription" required={group} minLength={3} maxLength={3000} />
      </Field>
      <Field label="Fecha objetivo" htmlFor="bulk-capa-date"><DatePicker id="bulk-capa-date" value={targetDate} onChange={setTargetDate} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !targetDate}>Generar</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

function ReassignResponsibleDialog({ riskEntryIds, assignableUsers, onDone }: { riskEntryIds: string[]; assignableUsers: { id: string; name: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [responsibleUserId, setResponsibleUserId] = useState("")
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!responsibleUserId) return
    operation.run(() => bulkUpdateRiskControlsAction({ riskEntryIds, responsibleUserId }), () => { setOpen(false); onDone() })
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary">Reasignar responsable</Button></DialogTrigger>
    <DialogContent><form onSubmit={submit} className="space-y-4">
      <DialogHeader><DialogTitle>Reasignar responsable</DialogTitle><DialogDescription>Aplica a los {riskEntryIds.length} riesgo(s) seleccionados. Sólo en versiones borrador.</DialogDescription></DialogHeader>
      <Field label="Responsable" htmlFor="bulk-responsible">
        <OptionSelect id="bulk-responsible" value={responsibleUserId} onValueChange={setResponsibleUserId} placeholder="Selecciona responsable" options={assignableUsers.map((user) => ({ value: user.id, label: user.name }))} />
      </Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !responsibleUserId}>Reasignar</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

function ChangeDeadlineDialog({ riskEntryIds, onDone }: { riskEntryIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const operation = useOperation()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    operation.run(() => bulkUpdateRiskControlsAction({ riskEntryIds, controlDeadlineText: values.get("controlDeadlineText") }), () => { setOpen(false); onDone() })
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary">Cambiar plazo</Button></DialogTrigger>
    <DialogContent><form onSubmit={submit} className="space-y-4">
      <DialogHeader><DialogTitle>Cambiar plazo</DialogTitle><DialogDescription>Aplica a los {riskEntryIds.length} riesgo(s) seleccionados. Sólo en versiones borrador.</DialogDescription></DialogHeader>
      <Field label="Plazo" htmlFor="bulk-deadline"><Input id="bulk-deadline" name="controlDeadlineText" placeholder="Ej: Mensual, Inmediato, Trimestral" required maxLength={300} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending}>Aplicar</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}
