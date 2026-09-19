"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowSquareOut, FireExtinguisher, Package, Warning } from "@phosphor-icons/react"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOperation } from "@/lib/hooks/use-operation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { EMERGENCY_RESOURCE_STATUS_LABELS, emergencyResourceStatusVariant } from "@/lib/prevention/emergency"
import {
  assignEmergencyResourceAction,
  confirmEmergencyInventoryImportAction,
  createWorksiteResourceAction,
  deleteWorksiteResourceAction,
  exportEmergencyInventoryAction,
  previewEmergencyInventoryImportAction,
} from "./actions"

export interface InventoryRow {
  id: string
  worksiteId: string
  worksiteName: string
  assetCode: string | null
  typeId: string | null
  canonicalType: string | null
  agent: string | null
  capacity: number | null
  capacityUnit: string | null
  name: string
  kind: string
  location: string
  serialNumber: string | null
  lastMaintenanceAt: string | null
  nextInspectionAt: string | null
  expiresAt: string | null
  status: string
  planName: string | null
  inspectionCount: number
}

export interface CoveragePointRow {
  id: string
  worksiteId: string
  code: string
  label: string
  pointKind: string
  requiredTypeId: string | null
  vehiclePlate: string | null
  vehicleBrand: string | null
  vehicleCategory: string | null
  assignedResourceId: string | null
  assignedAssetCode: string | null
  assignedResourceName: string | null
  state: "covered" | "uncovered" | "attention" | "incomplete"
  reasons: string[]
}

type PreviewRow = {
  line: number
  decision: "create" | "update" | "unchanged" | "conflict"
  assetCode: string
  plate: string | null
  fixedLocation: string | null
  error: string | null
}

type PreviewResult = {
  headerLine: number | null
  rows: PreviewRow[]
  conflicts: { line: number; message: string }[]
  canConfirm: boolean
  counts: Record<"create" | "update" | "unchanged" | "conflict", number>
  alreadyApplied: boolean
}

/** Label + variante en un solo mapa (MetaBadge): el color lo decide el estado. */
const COVERAGE_META: Record<CoveragePointRow["state"], StateMetaInput> = {
  covered:    { label: "Cubierto",   variant: "success" },
  uncovered:  { label: "Brecha",     variant: "danger"  },
  attention:  { label: "Atención",   variant: "warning" },
  incomplete: { label: "Incompleto", variant: "neutral" },
}

function MetricButton({ label, value, onClick, tone }: { label: string; value: string | number; onClick: () => void; tone?: string }) {
  return <button type="button" onClick={onClick} className="rounded-2xl border border-slate-200/70 bg-white p-4 text-left shadow-xs transition-colors hover:border-slate-300">
    <span className="block text-xs font-semibold uppercase tracking-wide text-text-subtle">{label}</span>
    <span className={`mt-1 block text-2xl font-semibold tabular-nums ${tone ?? "text-(--color-text)"}`}>{value}</span>
  </button>
}

export function InventoryPageActions({ worksites, canManage }: { worksites: { id: string; name: string }[]; canManage: boolean }) {
  if (!canManage) return null
  return <div className="flex flex-wrap gap-2"><ImportDialog worksites={worksites} /><ExportButton action={exportEmergencyInventoryAction} /><NewResourceDialog worksites={worksites} /></div>
}

export function InventoryList({ rows, points, worksites, canManage, canService, today }: {
  rows: InventoryRow[]
  points: CoveragePointRow[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  canService: boolean
  today: string
}) {
  const { getFilter, setFilters, clearFilters } = useUrlFilters()
  const worksite = getFilter("faena") || "all"
  const kind = getFilter("tipo") || "all"
  const view = getFilter("vista") === "puntos" ? "puntos" : "activos"
  const coverageFilter = getFilter("cobertura") || "all"
  const kinds = React.useMemo(() => [...new Set(rows.map((row) => row.kind))].sort((a, b) => a.localeCompare(b, "es")), [rows])
  const visibleAssets = rows.filter((row) => (worksite === "all" || row.worksiteId === worksite) && (kind === "all" || row.kind === kind))
  const visiblePoints = points.filter((point) => (worksite === "all" || point.worksiteId === worksite) && (coverageFilter === "all" || point.state === coverageFilter || (coverageFilter === "gap" && ["uncovered", "incomplete"].includes(point.state))))

  const chips: ActiveFilterChip[] = []
  if (worksite !== "all") {
    const name = worksites.find((item) => item.id === worksite)?.name
    if (name) chips.push({ key: "faena", label: "Faena", value: worksite, displayValue: name })
  }
  if (kind !== "all" && view === "activos") chips.push({ key: "tipo", label: "Tipo", value: kind, displayValue: kind })
  if (coverageFilter !== "all" && view === "puntos") chips.push({ key: "cobertura", label: "Cobertura", value: coverageFilter, displayValue: coverageFilter === "gap" ? "Brechas" : COVERAGE_META[coverageFilter as CoveragePointRow["state"]]?.label ?? coverageFilter })

  const covered = points.filter((point) => point.state === "covered" || point.state === "attention").length
  const gaps = points.filter((point) => point.state === "uncovered" || point.state === "incomplete").length
  const maintenance = rows.filter((row) => row.status === "needs_maintenance").length
  const soonLimit = new Date(`${today}T12:00:00`)
  soonLimit.setDate(soonLimit.getDate() + 30)
  const soonLimitText = `${soonLimit.getFullYear()}-${String(soonLimit.getMonth() + 1).padStart(2, "0")}-${String(soonLimit.getDate()).padStart(2, "0")}`
  const expiring = rows.filter((row) => row.expiresAt && row.expiresAt >= today && row.expiresAt <= soonLimitText).length
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricButton label="Cobertura" value={points.length ? `${covered}/${points.length}` : "Sin puntos"} onClick={() => setFilters({ vista: "puntos", cobertura: null })} />
      <MetricButton label="Brechas críticas" value={gaps} onClick={() => setFilters({ vista: "puntos", cobertura: "gap" })} tone={gaps ? "text-(--color-danger)" : undefined} />
      <MetricButton label="En mantención" value={maintenance} onClick={() => setFilters({ vista: null, tipo: null })} />
      <MetricButton label="Vencen en 30 días" value={expiring} onClick={() => setFilters({ vista: null, tipo: null })} tone={expiring ? "text-(--color-warning-ink)" : undefined} />
    </div>
    <Tabs value={view} onValueChange={(value) => setFilters({ vista: value === "activos" ? null : value, cobertura: null })}>
      <TabsList><TabsTrigger value="activos">Activos ({rows.length})</TabsTrigger><TabsTrigger value="puntos">Puntos de cobertura ({points.length})</TabsTrigger></TabsList>
      <FilterToolbar activeChips={chips} onRemoveChip={(key) => setFilters({ [key]: null })} onClearAll={() => clearFilters()} hasActiveFilters={chips.length > 0}>
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}>
          <SelectTrigger className="w-56" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {view === "activos" ? <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Tipo de recurso"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{kinds.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
        </Select> : <Select value={coverageFilter} onValueChange={(value) => setFilters({ cobertura: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Estado de cobertura"><SelectValue placeholder="Cobertura" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Toda la cobertura</SelectItem><SelectItem value="gap">Brechas críticas</SelectItem><SelectItem value="attention">Atención</SelectItem><SelectItem value="covered">Cubiertos</SelectItem></SelectContent>
        </Select>}
      </FilterToolbar>
      {/* Antes este contenido vivía fuera de `<Tabs>`, condicionado a mano por
          `view === "..."`. El trigger activo ya emitía `aria-controls` hacia un
          panel que nunca existió (axe `aria-valid-attr-value`); envolverlo en
          `TabsContent` real hace exactamente la misma poda —Radix desmonta el
          panel inactivo— pero con el id que el trigger sí referencia. */}
      <TabsContent value="activos"><AssetsTable rows={visibleAssets} canManage={canManage} canService={canService} /></TabsContent>
      <TabsContent value="puntos"><CoverageTable points={visiblePoints} resources={rows} canService={canService} today={today} /></TabsContent>
    </Tabs>
  </div>
}

function AssetsTable({ rows, canManage, canService }: { rows: InventoryRow[]; canManage: boolean; canService: boolean }) {
  if (rows.length === 0) return <EmptyState icon={<Package size={20} />} title="No hay activos con estos filtros" description="Ajusta los filtros o carga el padrón supervisado desde Excel." />
  return <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-xs"><Table>
    <TableHeader><TableRow><TableHead>Activo</TableHead><TableHead>Faena / ubicación</TableHead><TableHead>Especificación</TableHead><TableHead>Mantención</TableHead><TableHead>Vence</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((row) => <TableRow key={row.id}>
      <TableCell><Link href={`/admin/inventario-faena/${row.id}`} className="font-semibold text-(--color-primary) hover:underline">{row.assetCode ?? row.name}</Link><span className="block text-xs text-text-subtle">{row.assetCode ? row.name : "Por clasificar"}</span></TableCell>
      <TableCell className="text-sm"><span className="block">{row.worksiteName}</span><span className="text-xs text-text-subtle">{row.location}</span></TableCell>
      <TableCell className="text-sm">{row.canonicalType ?? row.kind}<span className="block text-xs text-text-subtle">{row.agent && row.capacity ? `${row.agent} · ${row.capacity} ${row.capacityUnit ?? ""}` : "Especificación pendiente"}</span></TableCell>
      <TableCell className="text-sm tabular-nums">{row.lastMaintenanceAt ?? "—"}</TableCell><TableCell className="text-sm tabular-nums">{row.expiresAt ?? "—"}</TableCell>
      <TableCell><MetaBadge meta={{ label: EMERGENCY_RESOURCE_STATUS_LABELS[row.status] ?? row.status, variant: emergencyResourceStatusVariant(row.status) }} /></TableCell>
      <TableCell><div className="flex justify-end gap-1">
        {canService && row.status !== "out_of_service" && row.typeId && <Button asChild size="sm" variant="secondary"><Link href={`/solicitudes/nueva?tipo=otro&faena=${encodeURIComponent(row.worksiteId)}&recursoEmergencia=${encodeURIComponent(row.id)}`}>Solicitar recarga</Link></Button>}
        <Button asChild size="sm" variant="ghost"><Link href={`/admin/inventario-faena/${row.id}`} aria-label={`Abrir ${row.assetCode ?? row.name}`}><ArrowSquareOut size={16} /></Link></Button>
        {canManage && <DeleteResourceButton row={row} />}
      </div></TableCell>
    </TableRow>)}</TableBody>
  </Table></div>
}

function CoverageTable({ points, resources, canService, today }: { points: CoveragePointRow[]; resources: InventoryRow[]; canService: boolean; today: string }) {
  if (points.length === 0) return <EmptyState icon={<FireExtinguisher size={20} />} title="No hay puntos con estos filtros" description="Carga el Excel real para crear los puntos obligatorios y sus asignaciones." />
  return <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-xs"><Table>
    <TableHeader><TableRow><TableHead>Punto requerido</TableHead><TableHead>Destino</TableHead><TableHead>Activo asignado</TableHead><TableHead>Cobertura</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
    <TableBody>{points.map((point) => <TableRow key={point.id}>
      <TableCell><span className="font-medium">{point.label}</span><span className="block text-xs text-text-subtle">{point.code}</span></TableCell>
      <TableCell className="text-sm">{point.pointKind === "vehicle" ? [point.vehiclePlate, point.vehicleBrand, point.vehicleCategory].filter(Boolean).join(" · ") : point.label}</TableCell>
      <TableCell className="text-sm">{point.assignedResourceId ? <Link href={`/admin/inventario-faena/${point.assignedResourceId}`} className="text-(--color-primary) hover:underline">{point.assignedAssetCode ?? point.assignedResourceName}</Link> : <span className="text-(--color-danger)">Sin reemplazo</span>}</TableCell>
      <TableCell><MetaBadge meta={COVERAGE_META[point.state]} />{point.reasons.length > 0 && <span className="mt-1 block max-w-64 text-xs text-text-subtle">{point.reasons.join(" · ")}</span>}</TableCell>
      <TableCell className="text-right">{canService && <AssignResourceDialog point={point} resources={resources} today={today} />}</TableCell>
    </TableRow>)}</TableBody>
  </Table></div>
}

function AssignResourceDialog({ point, resources, today }: { point: CoveragePointRow; resources: InventoryRow[]; today: string }) {
  const [open, setOpen] = React.useState(false)
  const [resourceId, setResourceId] = React.useState("")
  const operation = useOperation()
  const available = resources.filter((resource) => resource.worksiteId === point.worksiteId && resource.typeId === point.requiredTypeId && resource.status === "operational" && Boolean(resource.expiresAt && resource.expiresAt >= today))
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant={point.assignedResourceId ? "ghost" : "secondary"}>{point.assignedResourceId ? "Reasignar" : "Asignar reemplazo"}</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); operation.run(() => assignEmergencyResourceAction({ pointId: point.id, resourceId, reason: String(form.get("reason") ?? "") }), () => setOpen(false)) }}>
      <DialogHeader><DialogTitle>Asignar activo a {point.label}</DialogTitle><DialogDescription>La operación conserva la vigencia histórica y exige compatibilidad técnica.</DialogDescription></DialogHeader>
      <Field label="Activo operativo compatible" required><Select value={resourceId} onValueChange={setResourceId}><SelectTrigger><SelectValue placeholder="Selecciona un activo" /></SelectTrigger><SelectContent>{available.map((resource) => <SelectItem key={resource.id} value={resource.id}>{resource.assetCode ?? resource.name} · {resource.location}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Motivo" required><Input name="reason" required minLength={3} maxLength={300} placeholder="Reemplazo por recarga, traslado…" /></Field>
      {available.length === 0 && <p className="text-sm text-(--color-warning-ink)">No hay activos operativos, vigentes y compatibles en esta faena.</p>}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !resourceId}>Confirmar asignación</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

function NewResourceDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const operation = useOperation()
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm">Nuevo recurso</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const text = (key: string) => String(form.get(key) ?? "").trim() || null
      operation.run(() => createWorksiteResourceAction({ worksiteId, name: text("name"), kind: text("kind"), location: text("location"), serialNumber: text("serialNumber"), nextInspectionAt: text("nextInspectionAt"), expiresAt: text("expiresAt") }), () => setOpen(false))
    }}>
      <DialogHeader><DialogTitle>Nuevo recurso</DialogTitle><DialogDescription>Alta manual compatible con el padrón histórico. Sin especificación técnica quedará por clasificar.</DialogDescription></DialogHeader>
      <Field label="Faena" required><Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Nombre" required><Input name="name" required minLength={2} maxLength={200} /></Field>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Tipo histórico" required><Input name="kind" required minLength={2} maxLength={120} /></Field><Field label="Ubicación" required><Input name="location" required minLength={2} maxLength={300} /></Field></div>
      <div className="grid gap-3 md:grid-cols-3"><Field label="Serie"><Input name="serialNumber" maxLength={120} /></Field><Field label="Próxima inspección"><DatePicker name="nextInspectionAt" /></Field><Field label="Vence"><DatePicker name="expiresAt" /></Field></div>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Agregar</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}

function ImportDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<PreviewResult | null>(null)
  const operation = useOperation()
  function formData() { const form = new FormData(); form.set("worksiteId", worksiteId); if (file) form.set("file", file); return form }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setPreview(null); setFile(null) } }}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Importar</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Importar inventario supervisado</DialogTitle><DialogDescription>Primero se compara el Excel con Flota y el padrón. La confirmación es transaccional y una huella impide aplicar el mismo archivo dos veces.</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Faena" required><Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setPreview(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Planilla Excel" required hint=".xlsx, hasta 6 MB"><Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null) }} /></Field></div>
      {preview && <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["create", "update", "unchanged", "conflict"] as const).map((key) => <div key={key} className="rounded-lg border border-(--color-border) bg-(--color-surface-2) p-3"><span className="block text-xs text-text-subtle">{{ create: "Altas", update: "Actualizaciones", unchanged: "Sin cambios", conflict: "Conflictos" }[key]}</span><strong className="text-lg tabular-nums">{preview.counts[key]}</strong></div>)}</div>
        {preview.alreadyApplied && <p className="rounded-lg border border-(--color-warning-line) bg-(--color-warning-tint) p-3 text-sm text-(--color-warning-ink)">Este mismo archivo ya fue aplicado a la faena.</p>}
        {preview.conflicts.length > 0 && <div className="rounded-lg border border-(--color-danger-line) bg-(--color-danger-tint) p-3"><p className="flex items-center gap-2 text-sm font-semibold text-(--color-danger-ink)"><Warning size={16} />Conflictos que bloquean la confirmación</p><ul className="mt-2 space-y-1 text-xs text-(--color-danger-ink)">{preview.conflicts.map((item) => <li key={`${item.line}-${item.message}`}>Fila {item.line}: {item.message}</li>)}</ul><p className="mt-2 text-xs text-(--color-danger-ink)">Corrige la patente en Flota o en el Excel y vuelve a ejecutar el preview.</p></div>}
        <div className="max-h-64 overflow-auto rounded-lg border border-(--color-border)"><Table><TableHeader><TableRow><TableHead>Fila</TableHead><TableHead>Activo</TableHead><TableHead>Punto</TableHead><TableHead>Decisión</TableHead></TableRow></TableHeader><TableBody>{preview.rows.map((row) => <TableRow key={row.line}><TableCell>{row.line}</TableCell><TableCell>{row.assetCode}</TableCell><TableCell>{row.plate ?? row.fixedLocation ?? "—"}</TableCell><TableCell><MetaBadge meta={{ label: row.decision, variant: row.decision === "conflict" ? "danger" : row.decision === "create" ? "success" : "neutral" }} />{row.error && <span className="block text-xs text-(--color-danger)">{row.error}</span>}</TableCell></TableRow>)}</TableBody></Table></div>
      </div>}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter>{!preview ? <Button type="button" disabled={operation.pending || !file || !worksiteId} onClick={() => operation.run(() => previewEmergencyInventoryImportAction(formData()), (state) => setPreview(state.data as unknown as PreviewResult))}>Generar preview</Button> : <><Button type="button" variant="secondary" onClick={() => setPreview(null)}>Cambiar archivo</Button><Button type="button" disabled={operation.pending || !preview.canConfirm || preview.alreadyApplied} onClick={() => operation.run(() => confirmEmergencyInventoryImportAction(formData()), () => setOpen(false))}>Confirmar lote</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>
}

function DeleteResourceButton({ row }: { row: InventoryRow }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  if (row.inspectionCount > 0) return <span className="px-2 text-xs text-text-subtle" title="La ficha ya sostiene evidencia y no se puede borrar.">Con historial</span>
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="ghost">Borrar</Button></DialogTrigger><DialogContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); operation.run(() => deleteWorksiteResourceAction({ resourceId: row.id }), () => setOpen(false)) }}><DialogHeader><DialogTitle>Borrar {row.assetCode ?? row.name}</DialogTitle><DialogDescription>Sólo se permite para una ficha sin inspecciones ni evidencia histórica.</DialogDescription></DialogHeader>{operation.message && <p role="status" className="text-sm">{operation.message}</p>}<DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Borrar</Button></DialogFooter></form></DialogContent></Dialog>
}
