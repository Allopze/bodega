"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { WorkerForm } from "./worker-form"
import { BulkAssignBar } from "./bulk-assign-bar"
import { BulkAssignDialog, type AssignablePosition } from "./bulk-assign-dialog"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { toggleWorkerActive } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"
import { Badge } from "@/components/ui/badge"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"
import type { SizeFamilyOption } from "@/app/(app)/admin/productos/product-form.types"
import type { WorkerPositionOption } from "@/app/(app)/admin/cargos/types"

interface WorksiteOption { id: string; name: string }

type WorkerRow = {
  id:          string
  rut:         string | null
  firstName:   string
  lastName:    string
  sex:         string | null
  position:    string | null
  positionId:  string | null
  positionNeedsReview: boolean
  /** Sin cargo, o en «Sin clasificar»: no se sabe qué hace, así que tampoco si conduce. */
  unclassified: boolean
  /** Tiene una licencia de conducir registrada (para anticipar quién quedará «sin licencia»). */
  hasDriverLicense: boolean
  worksiteId:  string
  worksiteName: string
  isActive:    boolean
  createdAt:   string
  sizeTop:     string | null
  sizeBottom:  string | null
  sizeShoe:    string | null
  sizeGloves:  string | null
  sizeHelmet:  string | null
}

/**
 * Las tres vistas viajan en la URL (`?vista=`) para que el enlace de
 * Conductores —«Asignar cargos»— caiga directo en «Sin cargo» y para que
 * volver atrás conserve la pestaña. «Activos» es la vista base y no escribe
 * parámetro.
 */
const VISTAS = ["activos", "inactivos", "sin-cargo"] as const
type Vista = (typeof VISTAS)[number]

function parseVista(raw: string | null): Vista {
  return (VISTAS as readonly string[]).includes(raw ?? "") ? (raw as Vista) : "activos"
}

/** Cuánto dura el desvanecimiento de las filas recién clasificadas (≈ `--duration-default`). */
const LEAVE_MS = 220

/** Columnas de «Sin cargo»: nadie está inactivo ahí, así que el estado sobra; en su lugar, elegir. */
const SELECTABLE_COLUMNS = [
  { key: "_sel", label: "Elegir", sortable: false, width: "w-16" },
  ...COLUMNS.filter((column) => column.key !== "isActive"),
]

/** Misma regla que el filtro interno de `DataTable`: se replica para saber qué filas ve la persona. */
function matchesSearch(row: WorkerRow, query: string): boolean {
  if (!query.trim()) return true
  const needle = query.toLowerCase()
  return (CONTRACT.searchKeys as (keyof WorkerRow)[]).some((key) => {
    const value = row[key]
    return value != null && String(value).toLowerCase().includes(needle)
  })
}

export function WorkerList({
  workers, worksites, sizeFamilies, positions, assignablePositions,
}: {
  workers:   WorkerRow[]
  worksites: WorksiteOption[]
  sizeFamilies: SizeFamilyOption[]
  positions: WorkerPositionOption[]
  /** Cargos que se pueden asignar en bloque, con lo que cada uno implica. */
  assignablePositions: AssignablePosition[]
}) {
  const {
    sheetOpen, editRow: editWorker,
    openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<WorkerRow>(toggleWorkerActive)

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { searchQuery } = useSafeShellHeader()
  const reducedMotion = useReducedMotion()

  // La pestaña sale de la URL, pero se cambia de inmediato: `useOptimistic`
  // sostiene la elegida mientras el servidor resuelve la navegación y se alinea
  // sola con la URL cuando termina. Sin esto el cambio esperaba el viaje al
  // servidor (la página se vuelve a renderizar con cada parámetro).
  const urlVista = parseVista(searchParams.get("vista"))
  const [, startTransition] = React.useTransition()
  const [vista, setOptimisticVista] = React.useOptimistic(urlVista)

  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [assignOpen, setAssignOpen] = React.useState(false)
  // La selección se congela al abrir el diálogo: al clasificar se vacía y el
  // diálogo todavía anima su cierre; sin copia mostraría «0 trabajadores».
  const [assignTargets, setAssignTargets] = React.useState<WorkerRow[]>([])
  const [leavingIds, setLeavingIds] = React.useState<ReadonlySet<string>>(() => new Set())

  const tabsRef = React.useRef<HTMLDivElement>(null)
  const selectAllRef = React.useRef<HTMLInputElement>(null)
  const restoreFocusRef = React.useRef(false)

  // El desvanecimiento dura `LEAVE_MS`; después las filas se retiran de verdad.
  React.useEffect(() => {
    if (leavingIds.size === 0) return
    const timer = setTimeout(() => setLeavingIds(new Set()), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leavingIds])

  const activeWorkers   = React.useMemo(() => workers.filter((w) => w.isActive),  [workers])
  const inactiveWorkers = React.useMemo(() => workers.filter((w) => !w.isActive), [workers])
  const unclassifiedCount = React.useMemo(
    () => workers.filter((w) => w.isActive && w.unclassified).length,
    [workers],
  )
  // Quien acaba de recibir cargo se queda unos instantes, ya desvanecido, para
  // que salga con una transición corta en vez de desaparecer de golpe.
  const unclassifiedRows = React.useMemo(
    () => workers.filter((w) => w.isActive && (w.unclassified || leavingIds.has(w.id))),
    [workers, leavingIds],
  )
  // La selección vale sólo para lo que se ve: filtrar con la barra superior no
  // deja filas ocultas dentro de una operación masiva.
  const visibleUnclassified = React.useMemo(
    () => unclassifiedRows.filter((w) => matchesSearch(w, searchQuery)),
    [unclassifiedRows, searchQuery],
  )
  const selectedRows = React.useMemo(
    () => visibleUnclassified.filter((w) => selectedIds.has(w.id) && !leavingIds.has(w.id)),
    [visibleUnclassified, selectedIds, leavingIds],
  )
  const selectableCount = visibleUnclassified.filter((w) => !leavingIds.has(w.id)).length
  const allSelected = selectableCount > 0 && selectedRows.length === selectableCount
  const someSelected = selectedRows.length > 0 && !allSelected

  // `indeterminate` no existe como atributo HTML: se fija sobre el nodo.
  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected, vista])

  function changeVista(next: Vista) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "activos") params.delete("vista")
    else params.set("vista", next)
    const query = params.toString()
    setSelectedIds(new Set())
    startTransition(() => {
      setOptimisticVista(next)
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    })
  }

  function toggleSelected(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      for (const row of visibleUnclassified) {
        if (leavingIds.has(row.id)) continue
        if (allSelected) next.delete(row.id)
        else next.add(row.id)
      }
      return next
    })
  }

  function openAssign() {
    setAssignTargets(selectedRows)
    setAssignOpen(true)
  }

  function handleAssigned(ids: string[]) {
    setSelectedIds(new Set())
    restoreFocusRef.current = true
    if (reducedMotion) return
    setLeavingIds(new Set(ids))
  }

  // Al clasificar, la barra y el botón que abrió el diálogo desaparecen: el foco
  // vuelve a la pestaña activa en vez de caer al `body` (WCAG 2.4.3).
  function handleDialogCloseAutoFocus(event: Event) {
    if (!restoreFocusRef.current) return
    restoreFocusRef.current = false
    const tab = tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!tab) return
    event.preventDefault()
    tab.focus()
  }

  const renderMobileCard = (w: WorkerRow, selectable = false) => {
    const isLeaving = leavingIds.has(w.id)
    const isSelected = selectable && selectedIds.has(w.id)
    return (
      <article
        className={cn(
          "rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4",
          isSelected && "ring-2 ring-[var(--color-primary)]",
          isLeaving && "opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {selectable && (
              <Checkbox
                labelHidden
                label={`Seleccionar a ${w.firstName} ${w.lastName}`}
                checked={isSelected}
                disabled={isLeaving}
                onChange={() => toggleSelected(w.id)}
              />
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-[var(--color-text)] truncate">
                {w.firstName} {w.lastName}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{w.rut ?? "—"}</p>
            </div>
          </div>
          <MetaBadge meta={{ label: `${w.isActive ? "Activo" : "Inactivo"}`, variant: w.isActive ? "success" : "default" }} dot />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-[var(--color-text-subtle)]">Cargo</dt>
            <dd className="text-[var(--color-text-muted)] truncate">{w.position ?? "—"}</dd>
            {w.positionNeedsReview && <Badge variant="warning" size="sm" className="mt-1">Por revisar</Badge>}
          </div>
          <div className="text-right">
            <dt className="text-[var(--color-text-subtle)]">Faena</dt>
            <dd className="text-[var(--color-text-muted)] truncate">{w.worksiteName}</dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
          <CatalogRowActions
            id={w.id}
            isActive={w.isActive}
            label={`trabajador ${w.firstName} ${w.lastName}`}
            onEdit={() => openEdit(w)}
            toggleAction={toggleAction}
          />
        </div>
      </article>
    )
  }

  const renderRow = (w: WorkerRow, selectable = false) => {
    const isLeaving = leavingIds.has(w.id)
    const isSelected = selectable && selectedIds.has(w.id)
    return (
      <TableRow
        key={w.id}
        data-selected={selectable ? isSelected : undefined}
        className={cn(isLeaving && "opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none")}
      >
        {selectable && (
          <TableCell>
            <Checkbox
              labelHidden
              label={`Seleccionar a ${w.firstName} ${w.lastName}`}
              checked={isSelected}
              disabled={isLeaving}
              onChange={() => toggleSelected(w.id)}
            />
          </TableCell>
        )}
        <TableCell>
          <p className="text-sm font-medium text-[var(--color-text)]">
            {w.firstName} {w.lastName}
          </p>
        </TableCell>
        <TableCell>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {w.rut ?? "—"}
          </span>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            {w.position ?? "—"}
            {w.positionNeedsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
          </span>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">
          {w.worksiteName}
        </TableCell>
        {!selectable && (
          <TableCell>
            <MetaBadge meta={{ label: `${w.isActive ? "Activo" : "Inactivo"}`, variant: w.isActive ? "success" : "default" }} dot className="w-20 justify-center" />
          </TableCell>
        )}
        <TableCell>
          <div className="flex items-center gap-2 justify-end">
            <CatalogRowActions
              id={w.id}
              isActive={w.isActive}
              label={`trabajador ${w.firstName} ${w.lastName}`}
              onEdit={() => openEdit(w)}
              toggleAction={toggleAction}
            />
          </div>
        </TableCell>
      </TableRow>
    )
  }

  const selectAllLabel = searchQuery.trim()
    ? `Seleccionar los ${selectableCount} que coinciden`
    : `Seleccionar todos (${selectableCount})`

  return (
    <>
      <Tabs ref={tabsRef} value={vista} onValueChange={(next) => changeVista(parseVista(next))}>
        <TabsList className="mb-3">
          <TabsTrigger value="activos">
            Activos
            <span className="ml-1.5 text-xs text-text-subtle">{activeWorkers.length}</span>
          </TabsTrigger>
          <TabsTrigger value="inactivos">
            Inactivos
            <span className="ml-1.5 text-xs text-text-subtle">{inactiveWorkers.length}</span>
          </TabsTrigger>
          <TabsTrigger value="sin-cargo">
            Sin cargo
            {/* Lo pendiente va en `signal-ink` (regla 8): el token base no
                alcanza contraste de texto sobre el fondo de la pestaña. */}
            <span className={cn("ml-1.5 text-xs", unclassifiedCount > 0 ? "font-semibold text-[var(--color-signal-ink)]" : "text-text-subtle")}>
              {unclassifiedCount}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activos">
          <DataTable
            caption="Trabajadores activos"
            columns={COLUMNS}
            rows={activeWorkers}
            searchKeys={CONTRACT.searchKeys as (keyof WorkerRow)[]}
            pageSize={25}
            emptyTitle="Sin trabajadores activos"
            emptyDescription="Registra el primer trabajador para gestionar entregas de EPP."
            renderMobileCard={(w) => renderMobileCard(w)}
            renderRow={(w) => renderRow(w)}
          />
        </TabsContent>

        <TabsContent value="inactivos">
          <DataTable
            caption="Trabajadores inactivos"
            columns={COLUMNS}
            rows={inactiveWorkers}
            searchKeys={CONTRACT.searchKeys as (keyof WorkerRow)[]}
            pageSize={25}
            emptyTitle="Sin trabajadores inactivos"
            emptyDescription="Nadie dado de baja. Su historial de entregas y capacitaciones se conserva al desactivarlos."
            renderMobileCard={(w) => renderMobileCard(w)}
            renderRow={(w) => renderRow(w)}
          />
        </TabsContent>

        <TabsContent value="sin-cargo">
          {unclassifiedRows.length === 0 ? (
            <EmptyState
              tone="success"
              icon={<CheckCircle size={22} weight="bold" aria-hidden />}
              title="Todos los trabajadores tienen cargo"
              description="No queda nadie por clasificar. Si llega alguien sin cargo, lo verás acá."
              action={<Button type="button" variant="secondary" size="sm" onClick={() => changeVista("activos")}>Ver trabajadores activos</Button>}
            />
          ) : (
            <>
              <div className="mb-3">
                <Checkbox
                  ref={selectAllRef}
                  checked={allSelected}
                  disabled={selectableCount === 0}
                  onChange={toggleAll}
                  label={<span className="text-xs text-[var(--color-text-muted)]">{selectAllLabel}</span>}
                />
              </div>
              <DataTable
                caption="Trabajadores sin cargo"
                columns={SELECTABLE_COLUMNS}
                rows={unclassifiedRows}
                searchKeys={CONTRACT.searchKeys as (keyof WorkerRow)[]}
                pageSize={25}
                emptyTitle="Sin resultados"
                emptyDescription="Ningún trabajador sin cargo coincide con la búsqueda."
                renderMobileCard={(w) => renderMobileCard(w, true)}
                renderRow={(w) => renderRow(w, true)}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      {vista === "sin-cargo" && (
        <BulkAssignBar
          count={selectedRows.length}
          onAssign={openAssign}
          onClear={() => {
            setSelectedIds(new Set())
            selectAllRef.current?.focus()
          }}
        />
      )}

      <BulkAssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        workers={assignTargets}
        positions={assignablePositions}
        onAssigned={handleAssigned}
        onCloseAutoFocus={handleDialogCloseAutoFocus}
      />

      {/* `key` por trabajador: el formulario guarda cargo, faena y tallas en
          estado local y nunca se desmonta, así que sin esto editar a alguien
          después de otro arrastraba los valores del anterior. */}
      <WorkerForm
        key={editWorker?.id ?? "nuevo"}
        open={sheetOpen}
        onClose={closeSheet}
        editWorker={editWorker}
        worksites={worksites}
        sizeFamilies={sizeFamilies}
        positions={positions}
      />
    </>
  )
}
