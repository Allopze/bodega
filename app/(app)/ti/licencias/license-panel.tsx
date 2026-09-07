"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { MetaBadge } from "@/components/states/state-badge"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { formatCLP, formatDate } from "@/lib/utils"
import { IT_LICENSE_PERIODICITY_META } from "@/lib/services/ti/constants"
import { assignLicenseAction, revokeLicenseAction } from "./actions"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { LicenseSheet } from "./license-sheet"

interface Assignment {
  id: string
  workerId: string | null
  workerName: string | null
  assetId: string | null
  assetCode: string | null
  area: string | null
  worksiteId: string | null
  worksiteName: string | null
  assignedAt: string
  revokedAt: string | null
  notes: string | null
}

interface LicensePanelProps {
  license: {
    id: string
    name: string
    supplierId: string | null
    supplierName: string | null
    type: string | null
    purchasedQuantity: number
    assignedQuantity: number
    cost: number | null
    periodicity: string
    startDate: string | null
    renewalDate: string | null
    responsibleName: string | null
    responsibleUserId: string | null
    notes: string | null
    isActive: boolean
    assignments: Assignment[]
  }
  canManage: boolean
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  assets: { id: string; code: string; typeName: string }[]
  suppliers: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

export function LicensePanel({ license, canManage, workers, worksites, assets, suppliers, users }: LicensePanelProps) {
  const [open, setOpen] = React.useState(false)
  const available = Math.max(0, license.purchasedQuantity - license.assignedQuantity)

  const [assignState, assignAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await assignLicenseAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Licencia asignada")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [revokeState, revokeAction] = useActionState(revokeLicenseAction, INITIAL_STATE)

  React.useEffect(() => {
    if (revokeState.message) {
      if (revokeState.ok) toast.success(revokeState.message)
      else toast.error(revokeState.message)
    }
  }, [revokeState])

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{license.name}</h2>
            {!license.isActive && <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {[license.supplierName, license.type, IT_LICENSE_PERIODICITY_META[license.periodicity]].filter(Boolean).join(" · ") || "—"}
            {license.renewalDate && ` · renueva ${formatDate(license.renewalDate)}`}
            {license.cost != null && ` · ${formatCLP(license.cost)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-4 text-center">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Compradas</p>
            <p className="font-mono text-lg font-bold text-[var(--color-text)]">{license.purchasedQuantity}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Asignadas</p>
            <p className="font-mono text-lg font-bold text-[var(--color-text)]">{license.assignedQuantity}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Disponibles</p>
            <p className={`font-mono text-lg font-bold ${available === 0 && license.purchasedQuantity > 0 ? "text-[var(--color-danger-ink)]" : "text-[var(--color-success-ink)]"}`}>{available}</p>
          </div>
          {canManage && (
            <LicenseSheet
              trigger={<Button type="button" variant="secondary" size="sm">Editar</Button>}
              suppliers={suppliers}
              users={users}
              editLicense={license}
            />
          )}
        </div>
      </div>

      {license.assignments.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {license.assignments.map((assignment) => (
            <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">
              <span className="text-[var(--color-text)]">
                {assignment.workerName ?? assignment.assetCode ?? assignment.area ?? assignment.worksiteName ?? "—"}
                {assignment.workerName && assignment.assetCode ? ` · equipo ${assignment.assetCode}` : ""}
              </span>
              <span className="flex items-center gap-2">
                {assignment.revokedAt
                  ? <MetaBadge meta={{ label: "Revocada", variant: "default" }} />
                  : <MetaBadge meta={{ label: "Activa", variant: "success" }} dot />}
                {canManage && !assignment.revokedAt && (
                  <form action={revokeAction}>
                    <input type="hidden" name="assignmentId" value={assignment.id} />
                    <button type="submit" className="text-xs font-semibold text-[var(--color-danger)] hover:underline">Revocar</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          Asignar licencia
        </Button>
      )}

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={assignAction} className="flex flex-col flex-1 min-h-0">
            <input type="hidden" name="licenseId" value={license.id} />
            <SheetHeader>
              <div>
                <SheetTitle>Asignar {license.name}</SheetTitle>
                <SheetDescription>
                  Asigna a un trabajador, equipo, área o faena. Disponibles: {available}.
                </SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {assignState.message && !assignState.ok && !assignState.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{assignState.message}</p>
              )}
              <FieldGroup>
                <Field label="Trabajador">
                  <OptionSelect name="workerId" emptyLabel="Sin trabajador" placeholder="Sin trabajador" aria-label="Trabajador" options={workers.map((worker) => ({ value: worker.id, label: `${worker.name} ${worker.lastName}` }))} />
                </Field>
                <Field label="Equipo">
                  <OptionSelect name="assetId" emptyLabel="Sin equipo" placeholder="Sin equipo" aria-label="Equipo" options={assets.map((asset) => ({ value: asset.id, label: asset.code }))} />
                </Field>
                <Field label="Área" helper="Texto libre: gerencia, prevención, TI…">
                  <Input name="area" maxLength={80} />
                </Field>
                <Field label="Faena">
                  <OptionSelect name="worksiteId" emptyLabel="Sin faena" placeholder="Sin faena" aria-label="Faena" options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))} />
                </Field>
                <Field label="Notas">
                  <Textarea name="notes" maxLength={300} rows={3} />
                </Field>
              </FieldGroup>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Asignar" loadingLabel="Asignando..." />
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}
