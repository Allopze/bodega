"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EPP_REQUIREMENT_SCOPE_LABELS } from "@/lib/prevention/epp"
import { createEppRequirementAction, updateEppRequirementAction, deactivateEppRequirementAction } from "./actions"
import { Field, useOperation } from "./epp-form-kit"

const SCOPE_TYPES = Object.keys(EPP_REQUIREMENT_SCOPE_LABELS).filter((type) => type !== "task")

interface EppTypeOption { id: string; label: string }
interface FamilyOption { id: string; name: string; eppTypeId: string | null }

export function NewRequirementDialog({ eppTypes, families, worksites }: {
  eppTypes: EppTypeOption[]
  families: FamilyOption[]
  worksites: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [scopeType, setScopeType] = React.useState("global")
  const [eppTypeId, setEppTypeId] = React.useState(eppTypes[0]?.id ?? "")
  const [enforcement, setEnforcement] = React.useState("warning")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [preferredFamilyId, setPreferredFamilyId] = React.useState("_none")
  const operation = useOperation()

  const eligibleFamilies = families.filter((family) => family.eppTypeId === eppTypeId)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const scopeValue = String(form.get("scopeValue") ?? "").trim()
    operation.run(() => createEppRequirementAction({
      eppTypeId,
      scopeType,
      scopeValue: scopeValue || null,
      worksiteId: worksiteId || null,
      enforcement,
      reason: form.get("reason"),
      preferredFamilyId: preferredFamilyId === "_none" ? null : preferredFamilyId,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo requisito</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo requisito de EPP obligatorio</DialogTitle>
            <DialogDescription>
              Declara qué tipo de EPP exige un cargo o una faena. La cobertura se compara contra las entregas reales de Bodega.
            </DialogDescription>
          </DialogHeader>
          <Field label="Tipo de EPP">
            <Select value={eppTypeId} onValueChange={setEppTypeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {eppTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Alcance">
              <Select value={scopeType} onValueChange={setScopeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPE_TYPES.map((type) => <SelectItem key={type} value={type}>{EPP_REQUIREMENT_SCOPE_LABELS[type]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Exigibilidad">
              <Select value={enforcement} onValueChange={setEnforcement}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Advertencia</SelectItem>
                  <SelectItem value="blocking">Bloqueante</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="enforcement" value={enforcement} />
            </Field>
          </div>
          {scopeType === "worksite" && (
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={setWorksiteId}>
                <SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
                <SelectContent>
                  {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
          )}
          {scopeType === "position" && (
            <Field label="Cargo" hint="Debe coincidir con el cargo registrado del trabajador."><input name="scopeValue" required className="h-10 rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm" /></Field>
          )}
          {eligibleFamilies.length > 0 && (
            <Field label="Familia de producto sugerida" hint="Opcional. Ayuda a Bodega a saber qué entregar.">
              <Select value={preferredFamilyId} onValueChange={setPreferredFamilyId}>
                <SelectTrigger><SelectValue placeholder="Sin sugerir" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin sugerir</SelectItem>
                  {eligibleFamilies.map((family) => <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Fundamento" hint="Mínimo 10 caracteres. Norma o riesgo que exige este EPP.">
            <Textarea name="reason" required minLength={10} maxLength={2000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditRequirementDialog({ id, currentEnforcement, currentReason }: {
  id: string
  currentEnforcement: string
  currentReason: string
}) {
  const [open, setOpen] = React.useState(false)
  const [enforcement, setEnforcement] = React.useState(currentEnforcement)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => updateEppRequirementAction({
      id,
      enforcement,
      reason: String(form.get("reason") ?? "").trim() || undefined,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-ink)] transition-colors"
        >
          Editar
        </button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar requisito de EPP</DialogTitle>
            <DialogDescription>Actualiza la exigibilidad o el fundamento del requisito.</DialogDescription>
          </DialogHeader>
          <Field label="Exigibilidad">
            <Select value={enforcement} onValueChange={setEnforcement}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">Advertencia</SelectItem>
                <SelectItem value="blocking">Bloqueante</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fundamento" hint="Deja en blanco para mantener el actual.">
            <Textarea name="reason" defaultValue={currentReason} minLength={10} maxLength={2000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar cambios</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeactivateRequirementDialog({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => deactivateEppRequirementAction({
      id,
      reason: String(form.get("reason") ?? "").trim(),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-[var(--color-danger)] hover:text-[var(--color-danger-ink)] transition-colors"
        >
          Desactivar
        </button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Desactivar requisito de EPP</DialogTitle>
            <DialogDescription>
              El requisito dejará de generar brechas de cobertura. Esta acción se puede revertir solo editando la base de datos directamente.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo de desactivación" hint="Mínimo 10 caracteres. Ej: norma derogada, cargo eliminado.">
            <Textarea name="reason" required minLength={10} maxLength={2000} />
          </Field>
          {operation.message && <p role="status" className="text-sm text-[var(--color-danger)]">{operation.message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={operation.pending}>Desactivar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
