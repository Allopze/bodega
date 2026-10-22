"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { saveMandanteAction, setMandanteActiveAction } from "./actions"
import { ActiveBadge, ConfigSection } from "./config-section"
import type { MandanteRow, Option, WorksiteOption } from "./config-types"

const NO_CLIENT = "_none"

export function MandantesSection({ mandantes, worksites, clients }: { mandantes: MandanteRow[]; worksites: WorksiteOption[]; clients: Option[] }) {
  const [editing, setEditing] = React.useState<MandanteRow | "new" | null>(null)
  const toggle = useOperation({ feedback: "toast" })
  const worksiteNames = new Map(worksites.map((worksite) => [worksite.id, worksite.name]))

  return (
    <ConfigSection
      id="mandantes"
      title="Mandantes"
      description="Un mandante agrupa faenas para conciliar lo que recibe con lo que se entrega, con su propia tolerancia. Una faena pertenece a un solo mandante."
      action={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />Nuevo mandante</Button>}
    >
      {mandantes.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Aún no hay mandantes"
          description="Sin mandantes no hay conciliación por mandante ni el filtro «Mandante» en las vistas. Crea el primero y asígnale sus faenas."
          action={<Button size="sm" onClick={() => setEditing("new")}>Crear el primer mandante</Button>}
        />
      ) : (
        <TableRoot aria-label="Mandantes">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mandante</TableHead>
                <TableHead>Faenas</TableHead>
                <TableHead className="text-right" title="Diferencia de conciliación tolerada, en % de la entrada">Tolerancia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mandantes.map((mandante) => (
                <TableRow key={mandante.id}>
                  <TableCell>
                    <span className="font-medium">{mandante.name}</span>
                    {mandante.clientName ? <span className="block text-xs text-[var(--color-text-muted)]">Cliente: {mandante.clientName}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-md text-[var(--color-text-muted)]">
                    {mandante.worksiteIds.length === 0
                      ? "Sin faenas asignadas"
                      : mandante.worksiteIds.map((id) => worksiteNames.get(id) ?? id).join(", ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(mandante.tolerancePct, undefined, { maximumFractionDigits: 2 })} %</TableCell>
                  <TableCell><ActiveBadge active={mandante.isActive} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(mandante)} aria-label={`Editar ${mandante.name}`}>Editar</Button>
                      <Button
                        variant={mandante.isActive ? "ghost-danger" : "ghost"}
                        size="sm"
                        disabled={toggle.pending}
                        aria-label={`${mandante.isActive ? "Desactivar" : "Activar"} ${mandante.name}`}
                        onClick={() => toggle.run(() => setMandanteActiveAction({ id: mandante.id, isActive: !mandante.isActive }))}
                      >
                        {mandante.isActive ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
      {editing ? (
        <MandanteDialog
          key={editing === "new" ? "new" : editing.id}
          mandante={editing === "new" ? null : editing}
          worksites={worksites}
          clients={clients}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </ConfigSection>
  )
}

function MandanteDialog({ mandante, worksites, clients, onClose }: { mandante: MandanteRow | null; worksites: WorksiteOption[]; clients: Option[]; onClose: () => void }) {
  const op = useOperation()
  const [name, setName] = React.useState(mandante?.name ?? "")
  const [clientId, setClientId] = React.useState(mandante?.clientId ?? NO_CLIENT)
  const [tolerance, setTolerance] = React.useState(mandante ? String(mandante.tolerancePct).replace(".", ",") : "2")
  const [isActive, setIsActive] = React.useState(mandante?.isActive ?? true)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(mandante?.worksiteIds ?? []))
  const [confirmMove, setConfirmMove] = React.useState(false)

  // Faenas marcadas que hoy pertenecen a OTRO mandante: mover exige confirmación explícita.
  const conflicts = worksites.filter((worksite) => selected.has(worksite.id) && worksite.mandanteId && worksite.mandanteId !== mandante?.id)

  function toggleWorksite(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
    setConfirmMove(false)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(
      () => saveMandanteAction({
        id: mandante?.id,
        name,
        clientId: clientId === NO_CLIENT ? null : clientId,
        tolerancePct: tolerance,
        isActive,
        worksiteIds: [...selected],
        confirmMove,
      }),
      (result) => {
        toast.success(result.message ?? "Mandante guardado")
        onClose()
      },
    )
  }

  const nameError = op.fieldError("name")
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mandante ? "Editar mandante" : "Nuevo mandante"}</DialogTitle>
          <DialogDescription>Define la tolerancia de conciliación y las faenas que pertenecen a este mandante.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field label="Nombre" htmlFor="mandante-name" required error={nameError}>
              <Input id="mandante-name" value={name} onChange={(event) => setName(event.target.value)} error={!!nameError} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cliente (opcional)" htmlFor="mandante-client" helper="Vincula el mandante con un cliente de facturación." error={op.fieldError("clientId")}>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="mandante-client"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT}>Sin cliente</SelectItem>
                    {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tolerancia (%)" htmlFor="mandante-tolerance" required helper="Entre 0 y 100. Admite coma decimal." error={op.fieldError("tolerancePct")}>
                <Input id="mandante-tolerance" inputMode="decimal" value={tolerance} onChange={(event) => setTolerance(event.target.value)} error={!!op.fieldError("tolerancePct")} className="tabular-nums" />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Faenas ({selected.size} seleccionadas)</legend>
              <div className="max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
                {worksites.length === 0 ? (
                  <p className="p-2 text-sm text-[var(--color-text-muted)]">No hay faenas activas en tu alcance.</p>
                ) : worksites.map((worksite) => {
                  const elsewhere = worksite.mandanteId && worksite.mandanteId !== mandante?.id ? worksite.mandanteName : null
                  return (
                    <Checkbox
                      key={worksite.id}
                      id={`mandante-worksite-${worksite.id}`}
                      className="py-1"
                      checked={selected.has(worksite.id)}
                      onChange={(event) => toggleWorksite(worksite.id, event.target.checked)}
                      label={<>{worksite.name}{elsewhere ? <span className="ml-2 text-xs text-[var(--color-text-muted)]">hoy en {elsewhere}</span> : null}</>}
                    />
                  )
                })}
              </div>
            </fieldset>
            {conflicts.length > 0 ? (
              <Callout tone="warning" role="alert">
                <p className="mb-2">
                  {conflicts.length === 1 ? "Esta faena pertenece a otro mandante" : "Estas faenas pertenecen a otros mandantes"}: {conflicts.map((worksite) => `${worksite.name} (${worksite.mandanteName})`).join(", ")}.
                  Al guardar dejarán de contar para ellos.
                </p>
                <Checkbox id="mandante-confirm-move" label="Confirmo que se muevan a este mandante" checked={confirmMove} onChange={(event) => setConfirmMove(event.target.checked)} />
              </Callout>
            ) : null}
            <Checkbox id="mandante-active" label="Mandante activo" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            {op.message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{op.message}</p> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={op.pending} disabled={conflicts.length > 0 && !confirmMove}>{mandante ? "Guardar cambios" : "Crear mandante"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
