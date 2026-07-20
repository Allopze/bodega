"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { EPP_REQUIREMENT_SCOPE_LABELS } from "@/lib/prevention/epp"
import { createEppRequirementAction } from "./actions"
import { Field, selectClass, useOperation } from "./epp-form-kit"

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
  const operation = useOperation()

  const eligibleFamilies = families.filter((family) => family.eppTypeId === eppTypeId)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const scopeValue = String(form.get("scopeValue") ?? "").trim()
    const worksiteId = String(form.get("worksiteId") ?? "").trim()
    const preferredFamilyId = String(form.get("preferredFamilyId") ?? "").trim()
    operation.run(() => createEppRequirementAction({
      eppTypeId,
      scopeType,
      scopeValue: scopeValue || null,
      worksiteId: worksiteId || null,
      enforcement: form.get("enforcement"),
      reason: form.get("reason"),
      preferredFamilyId: preferredFamilyId || null,
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
            <select value={eppTypeId} onChange={(event) => setEppTypeId(event.target.value)} className={selectClass} required>
              {eppTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Alcance">
              <select value={scopeType} onChange={(event) => setScopeType(event.target.value)} className={selectClass}>
                {SCOPE_TYPES.map((type) => <option key={type} value={type}>{EPP_REQUIREMENT_SCOPE_LABELS[type]}</option>)}
              </select>
            </Field>
            <Field label="Exigibilidad">
              <select name="enforcement" className={selectClass} defaultValue="warning">
                <option value="warning">Advertencia</option>
                <option value="blocking">Bloqueante</option>
              </select>
            </Field>
          </div>
          {scopeType === "worksite" && (
            <Field label="Faena">
              <select name="worksiteId" className={selectClass} required>
                {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
          {scopeType === "position" && (
            <Field label="Cargo" hint="Debe coincidir con el cargo registrado del trabajador."><input name="scopeValue" required className={selectClass + " px-3"} /></Field>
          )}
          {eligibleFamilies.length > 0 && (
            <Field label="Familia de producto sugerida" hint="Opcional. Ayuda a Bodega a saber qué entregar.">
              <select name="preferredFamilyId" className={selectClass} defaultValue="">
                <option value="">Sin sugerir</option>
                {eligibleFamilies.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
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
