"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { CONTAINER_STATUS_LABELS, containerStatusVariant, type ContainerStatus } from "@/lib/prevention/containers"
import { createContainerAction, deleteContainerAction, updateContainerAction } from "./actions"

export interface ContainerRow {
  id: string
  worksiteId: string
  worksiteName: string
  code: string
  location: string
  status: string
  notes: string | null
  isActive: boolean
  version: number
  inspectionCount: number
}

export interface WorksiteOption { id: string; name: string }

function statusLabel(status: string) {
  return CONTAINER_STATUS_LABELS[status as ContainerStatus] ?? status
}

export function ContainerPageActions({ worksites, canManage }: { worksites: WorksiteOption[]; canManage: boolean }) {
  if (!canManage) return null
  return <NewContainerDialog worksites={worksites} />
}

export function ContainerList({ rows, worksites, canManage }: {
  rows: ContainerRow[]
  worksites: WorksiteOption[]
  canManage: boolean
}) {
  const { getFilter, setFilters, clearFilters } = useUrlFilters()
  const worksite = getFilter("faena") || "all"
  const status = getFilter("estado") || "all"
  /* La búsqueda vive en estado local y no en la URL: las filas ya vienen
   * cargadas y el filtrado es en cliente, así que sincronizar la query en cada
   * tecla sería un `router.replace` por pulsación sin nada que ganar. */
  const [search, setSearch] = React.useState("")

  const visible = rows.filter((row) =>
    (worksite === "all" || row.worksiteId === worksite)
    && (status === "all" || row.status === status)
    && (search === "" || `${row.code} ${row.location}`.toLocaleLowerCase("es-CL").includes(search.toLocaleLowerCase("es-CL"))))

  const chips: ActiveFilterChip[] = []
  if (worksite !== "all") {
    const name = worksites.find((item) => item.id === worksite)?.name
    if (name) chips.push({ key: "faena", label: "Faena", value: worksite, displayValue: name })
  }
  if (status !== "all") chips.push({ key: "estado", label: "Estado", value: status, displayValue: statusLabel(status) })

  return <div className="space-y-4">
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilters({ [key]: null })}
      onClearAll={() => { clearFilters(); setSearch("") }}
      hasActiveFilters={chips.length > 0 || search !== ""}
    >
      <Input
        placeholder="Filtrar por código o ubicación…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-xs"
        aria-label="Filtrar contenedores"
      />
      <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}>
        <SelectTrigger className="w-52"><SelectValue placeholder="Faena" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las faenas</SelectItem>
          {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value })}>
        <SelectTrigger className="w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {(Object.keys(CONTAINER_STATUS_LABELS) as ContainerStatus[]).map((value) =>
            <SelectItem key={value} value={value}>{CONTAINER_STATUS_LABELS[value]}</SelectItem>)}
        </SelectContent>
      </Select>
    </FilterToolbar>

    {visible.length === 0
      ? <EmptyState
          title="Sin contenedores"
          description="Da de alta los contenedores de la faena para poder inspeccionarlos: la inspección del Anexo 14 exige elegir uno del catálogo."
        />
      : <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Inspecciones</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => <TableRow key={row.id}>
              <TableCell className="font-medium">
                <Link href={`/admin/contenedores/${row.id}`} className="inline-flex items-center gap-1 hover:underline">
                  {row.code}
                  <ArrowSquareOut size={14} aria-hidden="true" />
                </Link>
                {!row.isActive && <Badge variant="neutral" className="ml-2">Retirado</Badge>}
              </TableCell>
              <TableCell>{row.worksiteName}</TableCell>
              <TableCell>{row.location}</TableCell>
              <TableCell><Badge variant={containerStatusVariant(row.status)}>{statusLabel(row.status)}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{row.inspectionCount}</TableCell>
              <TableCell className="text-right">
                {canManage && <div className="flex justify-end gap-1">
                  <EditContainerDialog row={row} worksites={worksites} />
                  <DeleteContainerButton row={row} />
                </div>}
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>}
  </div>
}

function NewContainerDialog({ worksites }: { worksites: WorksiteOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const operation = useOperation()
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm">Nuevo contenedor</Button></DialogTrigger>
    <DialogContent>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const text = (key: string) => String(form.get(key) ?? "").trim() || null
        operation.run(() => createContainerAction({
          worksiteId,
          code: text("code"),
          location: text("location"),
          notes: text("notes"),
        }), () => setOpen(false))
      }}>
        <DialogHeader>
          <DialogTitle>Nuevo contenedor</DialogTitle>
          <DialogDescription>El código identifica al contenedor aunque cambie de faena, así que es único en todo el sistema.</DialogDescription>
        </DialogHeader>
        <Field label="Faena" required>
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {/* `htmlFor` + `id` explícitos: con `hint`, Field deja de envolver el
            control en el label, y sin esto el input se queda sin nombre
            accesible (lo destapó e2e/admin-contenedores.spec.ts). */}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Código" required hint="Ej: CT-014" htmlFor="new-container-code">
            <Input id="new-container-code" name="code" required minLength={2} maxLength={60} />
          </Field>
          <Field label="Ubicación" required hint="Punto dentro de la faena" htmlFor="new-container-location">
            <Input id="new-container-location" name="location" required minLength={2} maxLength={300} />
          </Field>
        </div>
        <Field label="Observaciones"><Input name="notes" maxLength={1000} /></Field>
        {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
        <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Agregar</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function EditContainerDialog({ row, worksites }: { row: ContainerRow; worksites: WorksiteOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(row.worksiteId)
  const [status, setStatus] = React.useState(row.status)
  const operation = useOperation()
  return <Dialog open={open} onOpenChange={(next) => {
    setOpen(next)
    if (next) { setWorksiteId(row.worksiteId); setStatus(row.status) }
  }}>
    <DialogTrigger asChild><Button size="sm" variant="ghost">Editar</Button></DialogTrigger>
    <DialogContent>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const text = (key: string) => String(form.get(key) ?? "").trim() || null
        operation.run(() => updateContainerAction({
          containerId: row.id,
          expectedVersion: row.version,
          worksiteId,
          status,
          code: text("code"),
          location: text("location"),
          notes: text("notes"),
          isActive: form.get("isActive") === "on",
        }), () => setOpen(false))
      }}>
        <DialogHeader>
          <DialogTitle>Editar {row.code}</DialogTitle>
          <DialogDescription>
            Cambiar la faena traslada el contenedor y queda en auditoría. Las inspecciones ya ejecutadas conservan su faena y la etiqueta con que se inspeccionó.
          </DialogDescription>
        </DialogHeader>
        <Field label="Faena" required>
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Código" required><Input name="code" defaultValue={row.code} required minLength={2} maxLength={60} /></Field>
          <Field label="Ubicación" required><Input name="location" defaultValue={row.location} required minLength={2} maxLength={300} /></Field>
        </div>
        <Field label="Estado" required>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(CONTAINER_STATUS_LABELS) as ContainerStatus[]).map((value) =>
                <SelectItem key={value} value={value}>{CONTAINER_STATUS_LABELS[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Observaciones"><Input name="notes" defaultValue={row.notes ?? ""} maxLength={1000} /></Field>
        <Field label="Vigente" hint="Un contenedor retirado deja de ofrecerse como sujeto de inspección." htmlFor={`container-active-${row.id}`}>
          <input id={`container-active-${row.id}`} type="checkbox" name="isActive" defaultChecked={row.isActive} className="size-4" />
        </Field>
        {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
        <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function DeleteContainerButton({ row }: { row: ContainerRow }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  if (row.inspectionCount > 0) {
    return <span className="px-2 text-xs text-text-subtle" title="La ficha ya sostiene evidencia y no se puede borrar.">Con historial</span>
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="ghost">Borrar</Button></DialogTrigger>
    <DialogContent>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault()
        operation.run(() => deleteContainerAction({ containerId: row.id }), () => setOpen(false))
      }}>
        <DialogHeader>
          <DialogTitle>Borrar {row.code}</DialogTitle>
          <DialogDescription>Sólo se permite para una ficha sin inspecciones. Si ya fue inspeccionado, márcalo como «fuera de servicio».</DialogDescription>
        </DialogHeader>
        {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
        <DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Borrar</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
