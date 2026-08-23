"use client"

import * as React from "react"
import { Package } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import {
  createWorksiteResourceAction,
  deleteWorksiteResourceAction,
  importWorksiteResourcesAction,
} from "./actions"

export interface InventoryRow {
  id: string
  worksiteId: string
  worksiteName: string
  name: string
  kind: string
  location: string
  serialNumber: string | null
  nextInspectionAt: string | null
  expiresAt: string | null
  status: string
  /** Plan de emergencias que declara este recurso, si alguno lo declara. */
  planName: string | null
  /** Inspecciones que lo tomaron como sujeto: si hay, la ficha es evidencia. */
  inspectionCount: number
}

const STATUS_LABELS: Record<string, string> = {
  operational: "Operativo",
  needs_maintenance: "Requiere mantención",
  out_of_service: "Fuera de servicio",
}

function statusVariant(status: string): "success" | "warning" | "danger" {
  if (status === "operational") return "success"
  if (status === "out_of_service") return "danger"
  return "warning"
}

export function InventoryList({ rows, worksites, canManage }: {
  rows: InventoryRow[]
  worksites: { id: string; name: string }[]
  canManage: boolean
}) {
  const { getFilter, setFilters, clearFilters } = useUrlFilters()
  const worksite = getFilter("faena") || "all"
  const kind = getFilter("tipo") || "all"

  // Los tipos son texto libre a propósito —el inventario de una faena no cabe en
  // un catálogo cerrado—, así que el filtro se arma con lo que hay cargado.
  const kinds = React.useMemo(
    () => [...new Set(rows.map((row) => row.kind))].sort((a, b) => a.localeCompare(b, "es")),
    [rows],
  )

  const visible = rows.filter((row) =>
    (worksite === "all" || row.worksiteId === worksite) && (kind === "all" || row.kind === kind))

  const chips: ActiveFilterChip[] = []
  if (worksite !== "all") {
    const name = worksites.find((item) => item.id === worksite)?.name
    if (name) chips.push({ key: "faena", label: "Faena", value: worksite, displayValue: name })
  }
  if (kind !== "all") chips.push({ key: "tipo", label: "Tipo", value: kind, displayValue: kind })
  const isFiltered = chips.length > 0

  return (
    <div className="space-y-4">
      <FilterToolbar
        activeChips={chips}
        onRemoveChip={(key) => setFilters({ [key]: null })}
        onClearAll={() => clearFilters()}
        hasActiveFilters={isFiltered}
        actions={canManage ? (
          <div className="flex flex-wrap gap-2">
            <ImportDialog worksites={worksites} />
            <NewResourceDialog worksites={worksites} />
          </div>
        ) : undefined}
      >
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}>
          <SelectTrigger className="w-56" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Tipo de recurso"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {kinds.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Package size={20} />}
          title={isFiltered ? "No hay recursos con estos filtros" : "El inventario está vacío"}
          description={isFiltered
            ? "Ajusta los filtros para ver el resto del inventario."
            : "Carga los extintores, kits de derrame y demás recursos instalados en cada faena. Prevención los usa para declararlos en el plan de emergencias y para inspeccionarlos uno por uno."}
          action={isFiltered
            ? <Button type="button" variant="secondary" onClick={() => clearFilters()}>Ver todo</Button>
            : canManage ? <ImportDialog worksites={worksites} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recurso</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Próxima inspección</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Declarado en</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="block text-sm font-medium">{row.name}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">
                      {row.kind}{row.serialNumber ? ` · serie ${row.serialNumber}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{row.worksiteName}</TableCell>
                  <TableCell className="text-sm">{row.location}</TableCell>
                  <TableCell className="text-sm tabular-nums">{row.nextInspectionAt ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{row.expiresAt ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.planName ?? <span className="text-xs text-[var(--color-text-subtle)]">Ningún plan</span>}
                    {/* El estado y la baja se manejan desde el plan: acá se
                        carga el padrón, no se opera el equipo. */}
                    {row.inspectionCount > 0 && (
                      <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
                        {row.inspectionCount} inspección(es)
                      </span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <DeleteResourceButton row={row} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Alta unitaria ───────────────────────────────────────────────────────── */

function NewResourceDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo recurso</Button></DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const text = (key: string) => String(form.get(key) ?? "").trim() || null
            operation.run(() => createWorksiteResourceAction({
              worksiteId,
              name: text("name"),
              kind: text("kind"),
              location: text("location"),
              serialNumber: text("serialNumber"),
              nextInspectionAt: text("nextInspectionAt"),
              expiresAt: text("expiresAt"),
            }), () => setOpen(false))
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo recurso</DialogTitle>
            <DialogDescription>
              Un equipo instalado en la faena. Nace sin plan asociado: Prevención lo declara después en su plan de
              emergencias si corresponde.
            </DialogDescription>
          </DialogHeader>
          <Field label="Faena" required>
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger aria-label="Faena del recurso"><SelectValue /></SelectTrigger>
              <SelectContent>
                {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nombre" required><Input name="name" required minLength={2} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo" required hint="Ej: Extintor, kit de derrame.">
              <Input name="kind" required minLength={2} maxLength={120} />
            </Field>
            <Field label="Ubicación" required hint="Dónde está instalado.">
              <Input name="location" required minLength={2} maxLength={300} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Serie" hint="Opcional."><Input name="serialNumber" maxLength={120} /></Field>
            <Field label="Próxima inspección" hint="Opcional."><DatePicker name="nextInspectionAt" /></Field>
            <Field label="Vence" hint="Opcional. Recarga o caducidad."><DatePicker name="expiresAt" /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Agregar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Carga masiva ────────────────────────────────────────────────────────── */

/**
 * Pegado desde la planilla. Es lo que hace usable cargar doscientos extintores:
 * copiar las celdas de Excel produce texto tabulado, así que no hace falta subir
 * ni convertir un archivo.
 */
function ImportDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [result, setResult] = React.useState<{ created: number; rejected: { line: number; error: string }[] } | null>(null)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setResult(null) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Cargar desde planilla</Button></DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            form.set("worksiteId", worksiteId)
            setResult(null)
            operation.run(
              () => importWorksiteResourcesAction(form),
              (state) => setResult((state.data as unknown as typeof result) ?? null),
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Cargar inventario desde planilla</DialogTitle>
            <DialogDescription>
              Sube un archivo <span className="font-mono">.xlsx</span> con una fila por recurso. Las columnas se
              buscan por nombre, así que el orden no importa:
              <span className="mt-1 block font-mono text-xs">NOMBRE · TIPO · UBICACION · SERIE · PROXIMA INSPECCION · VENCIMIENTO</span>
              Las tres primeras son obligatorias. Si una fila viene mal, se informa con su número y el resto sí entra.
            </DialogDescription>
          </DialogHeader>
          <Field label="Faena" required>
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger aria-label="Faena de la carga"><SelectValue /></SelectTrigger>
              <SelectContent>
                {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Planilla" required hint="Archivo .xlsx, hasta 6 MB.">
            <Input
              type="file"
              name="file"
              required
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Planilla del inventario"
            />
          </Field>
          {result && (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
              <p>{result.created} recurso(s) creado(s).</p>
              {result.rejected.length > 0 && (
                <>
                  <p className="mt-1 text-[var(--color-warning-ink)]">
                    {result.rejected.length} fila(s) rechazada(s); el resto sí entró:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {result.rejected.slice(0, 15).map((item) => (
                      <li key={item.line}>Fila {item.line}: {item.error}</li>
                    ))}
                  </ul>
                  {result.rejected.length > 15 && <p className="mt-1">…y {result.rejected.length - 15} más.</p>}
                </>
              )}
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Cargar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Baja ────────────────────────────────────────────────────────────────── */

/**
 * Sólo borra lo que nunca se inspeccionó. En cuanto una inspección lo tomó como
 * sujeto, la ficha sostiene evidencia y la baja correcta es dejarlo "fuera de
 * servicio" desde el plan, que conserva el historial. El servicio lo vuelve a
 * comprobar; acá se evita ofrecer un botón que va a fallar.
 */
function DeleteResourceButton({ row }: { row: InventoryRow }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  if (row.inspectionCount > 0) {
    return (
      <span
        className="text-xs text-[var(--color-text-subtle)]"
        title="Ya fue inspeccionado, así que su ficha es evidencia. Déjalo fuera de servicio desde el plan de emergencias."
      >
        Con historial
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Borrar</Button></DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(() => deleteWorksiteResourceAction({ resourceId: row.id }), () => setOpen(false))
          }}
        >
          <DialogHeader>
            <DialogTitle>Borrar {row.name}</DialogTitle>
            <DialogDescription>
              Nunca fue inspeccionado, así que se puede borrar sin perder evidencia. Si el equipo existe pero salió de
              servicio, no lo borres: déjalo «fuera de servicio» desde el plan de emergencias.
            </DialogDescription>
          </DialogHeader>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Borrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
