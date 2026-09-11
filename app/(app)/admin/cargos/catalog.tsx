"use client"

import { useActionState, useState, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { ArrowsMerge, CheckCircle, PencilSimple, Plus, Tag, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { AliasManager } from "./alias-manager"
import { CapabilityForm } from "./capability-form"
import { MergeDialog } from "./merge-dialog"
import { PositionForm } from "./position-form"
import { reviewWorkerPositionAction, toggleWorkerCapabilityActiveAction, toggleWorkerPositionActiveAction } from "./actions"
import type { WorkerCapabilityCatalogRow, WorkerPositionCatalogRow } from "./types"
import { Badge } from "@/components/ui/badge"
import { MetaBadge } from "@/components/states/state-badge"
import { DataTable } from "@/components/ui/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { useActionStateToast } from "@/lib/hooks/use-action-watchers"
import { INITIAL_STATE } from "@/lib/form-state"

/** Estado del catálogo. Vive acá y no como mapa suelto en cada celda para que
 *  cargos y capacidades no se separen en etiqueta ni en color. */
function catalogStateMeta(isActive: boolean, labels: { on: string; off: string }) {
  return isActive
    ? { label: labels.on, variant: "success" as const }
    : { label: labels.off, variant: "neutral" as const }
}

const POSITION_COLUMNS = [
  { key: "name", label: "Cargo", sortable: true },
  { key: "workerCount", label: "Trabajadores", sortable: true, width: "w-28" },
  { key: "capabilitySearch", label: "Capacidades", sortable: false },
  { key: "status", label: "Estado", sortable: false, width: "w-36" },
  { key: "actions", label: "", sortable: false, width: "w-40" },
]

const CAPABILITY_COLUMNS = [
  { key: "name", label: "Capacidad", sortable: true },
  { key: "positionCount", label: "Cargos", sortable: true, width: "w-24" },
  { key: "overrideCount", label: "Excepciones", sortable: true, width: "w-28" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "actions", label: "", sortable: false, width: "w-24" },
]

/** Acción de fila: sólo icono, así que el nombre accesible va en `aria-label`.
 *  `SubmitButton` no sirve acá porque siempre pinta su `label` como texto. */
function ActionSubmit({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={disabled || pending} aria-busy={pending}>
      {children}
    </Button>
  )
}

function ActionButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  )
}

export function WorkerPositionCatalog({ positions, capabilities }: { positions: WorkerPositionCatalogRow[]; capabilities: WorkerCapabilityCatalogRow[] }) {
  const [positionToEdit, setPositionToEdit] = useState<WorkerPositionCatalogRow | null>(null)
  const [capabilityToEdit, setCapabilityToEdit] = useState<WorkerCapabilityCatalogRow | null>(null)
  const [aliasPosition, setAliasPosition] = useState<WorkerPositionCatalogRow | null>(null)
  const [mergePosition, setMergePosition] = useState<WorkerPositionCatalogRow | null>(null)
  // El alta también vive en la cabecera; desde el catálogo vacío hace falta una
  // salida propia, porque ahí es donde el usuario descubre que no hay nada.
  const [creating, setCreating] = useState<"position" | "capability" | null>(null)
  const [positionToggleState, positionToggleAction] = useActionState(toggleWorkerPositionActiveAction, INITIAL_STATE)
  const [capabilityToggleState, capabilityToggleAction] = useActionState(toggleWorkerCapabilityActiveAction, INITIAL_STATE)
  const [reviewState, reviewAction] = useActionState(reviewWorkerPositionAction, INITIAL_STATE)

  useActionStateToast([positionToggleState, capabilityToggleState, reviewState])

  const positionRows = positions.map((position) => ({
    ...position,
    capabilitySearch: position.capabilities.map((capability) => capability.name).join(" "),
    status: `${position.isActive ? "Activo" : "Inactivo"} ${position.needsReview ? "Pendiente de revisión" : "Revisado"}`,
  }))

  function positionActions(position: WorkerPositionCatalogRow) {
    return (
      <div className="flex items-center justify-end gap-1" role="group" aria-label={`Acciones de ${position.name}`}>
        <ActionButton label={`Editar cargo ${position.name}`} onClick={() => setPositionToEdit(position)} disabled={position.isSystem}>
          <PencilSimple size={16} />
        </ActionButton>
        <ActionButton label={`Gestionar alias de ${position.name}`} onClick={() => setAliasPosition(position)}>
          <Tag size={16} />
        </ActionButton>
        <ActionButton label={`Fusionar cargo ${position.name} en otro`} onClick={() => setMergePosition(position)} disabled={position.isSystem}>
          <ArrowsMerge size={16} />
        </ActionButton>
        {position.needsReview && !position.isSystem && (
          <form action={reviewAction}>
            <input type="hidden" name="id" value={position.id} />
            <input type="hidden" name="code" value={position.code} />
            <input type="hidden" name="name" value={position.name} />
            <input type="hidden" name="isActive" value={String(position.isActive)} />
            <ActionSubmit label={`Marcar ${position.name} como revisado`}><CheckCircle size={18} /></ActionSubmit>
          </form>
        )}
        {!position.isSystem && (
          <form action={positionToggleAction}>
            <input type="hidden" name="id" value={position.id} />
            <input type="hidden" name="code" value={position.code} />
            <input type="hidden" name="name" value={position.name} />
            <input type="hidden" name="needsReview" value={String(position.needsReview)} />
            <input type="hidden" name="activate" value={String(!position.isActive)} />
            <ActionSubmit label={`${position.isActive ? "Desactivar" : "Activar"} cargo ${position.name}`}>
              {position.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
            </ActionSubmit>
          </form>
        )}
      </div>
    )
  }

  function renderPositionRow(position: (typeof positionRows)[number]) {
    return (
      <TableRow key={position.id}>
        <TableCell>
          <p className="text-sm font-semibold text-[var(--color-text)]">{position.name}</p>
          <p className="font-mono text-xs text-[var(--color-text-subtle)]">{position.code}</p>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">{position.workerCount}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {position.capabilities.length > 0
              ? position.capabilities.map((capability) => <Badge key={capability.id} variant="info" size="sm">{capability.name}</Badge>)
              : <span className="text-xs text-[var(--color-text-subtle)]">Sin capacidades</span>}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            <MetaBadge meta={catalogStateMeta(position.isActive, { on: "Activo", off: "Inactivo" })} size="sm" />
            {position.needsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
          </div>
        </TableCell>
        <TableCell>{positionActions(position)}</TableCell>
      </TableRow>
    )
  }

  function renderPositionCard(position: (typeof positionRows)[number]) {
    return (
      <article className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-[var(--color-text)]">{position.name}</h2><p className="font-mono text-xs text-[var(--color-text-subtle)]">{position.code}</p></div>
          {position.needsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{position.workerCount} trabajador(es)</p>
        <div className="mt-2 flex flex-wrap gap-1">{position.capabilities.map((capability) => <Badge key={capability.id} variant="info" size="sm">{capability.name}</Badge>)}</div>
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">{positionActions(position)}</div>
      </article>
    )
  }

  function capabilityActions(capability: WorkerCapabilityCatalogRow) {
    return (
      <div className="flex items-center justify-end gap-1" role="group" aria-label={`Acciones de ${capability.name}`}>
        <ActionButton label={`Editar capacidad ${capability.name}`} onClick={() => setCapabilityToEdit(capability)}><PencilSimple size={16} /></ActionButton>
        <form action={capabilityToggleAction}>
          <input type="hidden" name="id" value={capability.id} />
          <input type="hidden" name="code" value={capability.code} />
          <input type="hidden" name="name" value={capability.name} />
          <input type="hidden" name="description" value={capability.description ?? ""} />
          <input type="hidden" name="activate" value={String(!capability.isActive)} />
          <ActionSubmit label={`${capability.isActive ? "Desactivar" : "Activar"} capacidad ${capability.name}`}>
            {capability.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
          </ActionSubmit>
        </form>
      </div>
    )
  }

  function renderCapabilityRow(capability: WorkerCapabilityCatalogRow) {
    return (
      <TableRow key={capability.id}>
        <TableCell><p className="text-sm font-semibold text-[var(--color-text)]">{capability.name}</p><p className="font-mono text-xs text-[var(--color-text-subtle)]">{capability.code}</p>{capability.description && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{capability.description}</p>}</TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">{capability.positionCount}</TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">{capability.overrideCount}</TableCell>
        <TableCell><MetaBadge meta={catalogStateMeta(capability.isActive, { on: "Activa", off: "Inactiva" })} size="sm" /></TableCell>
        <TableCell>{capabilityActions(capability)}</TableCell>
      </TableRow>
    )
  }

  function renderCapabilityCard(capability: WorkerCapabilityCatalogRow) {
    return (
      <article className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--color-text)]">{capability.name}</h2><p className="font-mono text-xs text-[var(--color-text-subtle)]">{capability.code}</p></div><MetaBadge meta={catalogStateMeta(capability.isActive, { on: "Activa", off: "Inactiva" })} size="sm" /></div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{capability.positionCount} cargo(s) · {capability.overrideCount} excepción(es)</p>
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">{capabilityActions(capability)}</div>
      </article>
    )
  }

  return (
    <>
      <Tabs defaultValue="positions">
        <TabsList className="mb-3">
          <TabsTrigger value="positions">Cargos <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{positions.length}</span></TabsTrigger>
          <TabsTrigger value="capabilities">Capacidades <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{capabilities.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          <DataTable caption="Catálogo de cargos" columns={POSITION_COLUMNS} rows={positionRows} searchKeys={["name", "code", "capabilitySearch", "status"]} pageSize={25} emptyTitle="Sin cargos" emptyDescription="Crea el primer cargo para asignarlo a los trabajadores." emptyAction={<Button size="sm" onClick={() => setCreating("position")}><Plus size={14} />Nuevo cargo</Button>} renderRow={renderPositionRow} renderMobileCard={renderPositionCard} />
        </TabsContent>
        <TabsContent value="capabilities">
          <DataTable caption="Catálogo de capacidades" columns={CAPABILITY_COLUMNS} rows={capabilities} searchKeys={["name", "code", "description"]} pageSize={25} emptyTitle="Sin capacidades" emptyDescription="Crea una capacidad para clasificar las funciones de los cargos." emptyAction={<Button size="sm" onClick={() => setCreating("capability")}><Plus size={14} />Nueva capacidad</Button>} renderRow={renderCapabilityRow} renderMobileCard={renderCapabilityCard} />
        </TabsContent>
      </Tabs>
      <PositionForm key={positionToEdit?.id ?? "closed-position"} open={Boolean(positionToEdit)} onClose={() => setPositionToEdit(null)} editPosition={positionToEdit} capabilities={capabilities} />
      <PositionForm key="nuevo-cargo" open={creating === "position"} onClose={() => setCreating(null)} capabilities={capabilities} />
      <CapabilityForm key={capabilityToEdit?.id ?? "closed-capability"} open={Boolean(capabilityToEdit)} onClose={() => setCapabilityToEdit(null)} editCapability={capabilityToEdit} />
      <CapabilityForm key="nueva-capacidad" open={creating === "capability"} onClose={() => setCreating(null)} />
      <AliasManager key={aliasPosition?.id ?? "closed-alias"} position={aliasPosition} open={Boolean(aliasPosition)} onClose={() => setAliasPosition(null)} />
      <MergeDialog key={mergePosition?.id ?? "closed-merge"} position={mergePosition} positions={positions} open={Boolean(mergePosition)} onClose={() => setMergePosition(null)} />
    </>
  )
}
