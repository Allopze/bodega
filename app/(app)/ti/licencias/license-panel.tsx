"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { MetaBadge } from "@/components/states/state-badge"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { formatCLP, formatDate } from "@/lib/utils"
import { IT_LICENSE_PERIODICITY_META } from "@/lib/services/ti/constants"
import { licenseRenewal } from "@/lib/services/ti/license-renewal"
import { useOperation } from "@/lib/hooks/use-operation"
import { assignLicenseAction, revokeLicenseAction } from "./actions"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
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

type TargetKind = "worker" | "asset" | "area" | "worksite"

const TARGET_OPTIONS: { kind: TargetKind; label: string }[] = [
  { kind: "worker", label: "Trabajador" },
  { kind: "asset", label: "Equipo" },
  { kind: "area", label: "Área" },
  { kind: "worksite", label: "Faena" },
]

/** El costo se lee con su periodicidad: "$120.000" a secas no dice si es por mes o por año. */
const COST_SUFFIX: Record<string, string> = { mensual: "por mes", anual: "por año", unica: "pago único" }

/** Una licencia con más de la mitad de los cupos sin usar paga por lo que no se ocupa. */
const IDLE_SEATS_RATIO = 0.5

function assignmentTarget(assignment: Assignment): string {
  return assignment.workerName || assignment.assetCode || assignment.area || assignment.worksiteName || "—"
}

export function LicensePanel({ license, canManage, workers, worksites, assets, suppliers, users }: LicensePanelProps) {
  const [open, setOpen] = React.useState(false)
  const [targetKind, setTargetKind] = React.useState<TargetKind>("worker")
  const available = Math.max(0, license.purchasedQuantity - license.assignedQuantity)
  const renewal = licenseRenewal(license.renewalDate, license.isActive)
  const idleSeats = license.isActive && license.purchasedQuantity > 0 && available / license.purchasedQuantity > IDLE_SEATS_RATIO
    ? available
    : 0

  const [assignState, assignAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await assignLicenseAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Licencia asignada")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  // Revocar libera un cupo, pero un clic suelto en un enlace de 41×16 px no es
  // una decisión: se confirma diciendo qué pierde la persona y cuántos cupos
  // quedan (TIUX-08).
  const [pendingRevoke, setPendingRevoke] = React.useState<Assignment | null>(null)
  const revoke = useOperation({ feedback: "toast" })

  const active = license.assignments.filter((a) => !a.revokedAt)
  const revoked = license.assignments.filter((a) => a.revokedAt)

  // Los cuatro destinos comparten una sola regla en el servidor ("al menos
  // uno"); el error viene en `workerId`, así que se pinta en el campo visible.
  const targetError = assignState.fieldErrors?.workerId?.[0]
    ?? assignState.fieldErrors?.assetId?.[0]
    ?? assignState.fieldErrors?.area?.[0]
    ?? assignState.fieldErrors?.worksiteId?.[0]

  const meta = [
    license.supplierName,
    license.type,
    IT_LICENSE_PERIODICITY_META[license.periodicity],
    license.cost != null ? `${formatCLP(license.cost)} ${COST_SUFFIX[license.periodicity] ?? ""}`.trim() : null,
  ].filter(Boolean).join(" · ")

  const assignmentRow = (assignment: Assignment) => {
    const isRevoked = Boolean(assignment.revokedAt)
    return (
      <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">
        <span className="min-w-0 text-[var(--color-text)]">
          {assignmentTarget(assignment)}
          {assignment.workerName && assignment.assetCode ? ` · equipo ${assignment.assetCode}` : ""}
          {assignment.worksiteName && assignment.worksiteName !== assignmentTarget(assignment) && (
            <span className="block text-xs text-[var(--color-text-muted)]">{assignment.worksiteName}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {isRevoked
            ? <MetaBadge meta={{ label: `Revocada el ${formatDate(assignment.revokedAt!)}`, variant: "default" }} />
            : <MetaBadge meta={{ label: "Activa", variant: "success" }} dot />}
          {canManage && !isRevoked && (
            <button
              type="button"
              onClick={() => setPendingRevoke(assignment)}
              aria-label={`Revocar ${license.name} a ${assignmentTarget(assignment)}`}
              className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--color-danger-ink)] hover:underline sm:min-h-0 sm:px-0"
            >
              Revocar
            </button>
          )}
        </span>
      </li>
    )
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{license.name}</h2>
            {!license.isActive && <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
            {renewal.urgent && <MetaBadge meta={renewal} />}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{meta || "—"}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {license.renewalDate
              ? `Renueva el ${formatDate(license.renewalDate)}`
              : "Sin fecha de renovación"}
            {license.responsibleName && ` · Responsable: ${license.responsibleName}`}
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
              trigger={<Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0">Editar</Button>}
              suppliers={suppliers}
              users={users}
              editLicense={license}
            />
          )}
        </div>
      </div>

      {idleSeats > 0 && (
        <p className="mt-2 text-xs text-[var(--color-warning-ink)]">
          {idleSeats} {idleSeats === 1 ? "cupo sin asignar" : "cupos sin asignar"} de {license.purchasedQuantity}: revisa si conviene bajar la compra.
        </p>
      )}

      {active.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {active.map(assignmentRow)}
        </ul>
      )}
      {active.length === 0 && (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">Sin asignaciones vigentes.</p>
      )}

      {revoked.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:min-h-0">
            Ver revocadas ({revoked.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {revoked.map(assignmentRow)}
          </ul>
        </details>
      )}

      {canManage && (
        <Button variant="secondary" size="sm" className="mt-4 min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
          Asignar licencia
        </Button>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(v) => { if (!v) setPendingRevoke(null) }}
        title={`¿Revocar ${license.name}?`}
        description={pendingRevoke
          ? `${assignmentTarget(pendingRevoke)} perderá ${license.name}; quedarán ${available + 1} ${available + 1 === 1 ? "cupo disponible" : "cupos disponibles"}.`
          : ""}
        confirmLabel="Revocar"
        variant="destructive"
        loading={revoke.pending}
        onConfirm={() => {
          const target = pendingRevoke
          if (!target) return
          setPendingRevoke(null)
          void revoke.run(async () => {
            const formData = new FormData()
            formData.set("assignmentId", target.id)
            return revokeLicenseAction(INITIAL_STATE, formData)
          })
        }}
      />

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={assignAction} className="flex flex-col flex-1 min-h-0">
            <input type="hidden" name="licenseId" value={license.id} />
            <SheetHeader>
              <div>
                <SheetTitle>Asignar {license.name}</SheetTitle>
                <SheetDescription>
                  Elige a quién se asigna y luego el destino. Disponibles: {available}.
                </SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {assignState.message && !assignState.ok && !assignState.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{assignState.message}</p>
              )}
              <FieldGroup>
                <SegmentedControl
                  ariaLabel="¿A quién se asigna?"
                  eyebrow="¿A quién se asigna?"
                  variant="segmented"
                  items={TARGET_OPTIONS.map((option) => ({
                    key: option.kind,
                    label: option.label,
                    active: option.kind === targetKind,
                    onClick: () => setTargetKind(option.kind),
                  }))}
                />
                {/* Un solo campo a la vez: los cuatro juntos, todos "opcionales",
                    dejaban enviar el formulario vacío y el error caía en un
                    campo que no lo mostraba (TIUX-06). */}
                {targetKind === "worker" && (
                  <Field label="Trabajador" required error={targetError}>
                    <OptionSelect name="workerId" placeholder="Selecciona un trabajador" aria-label="Trabajador" options={workers.map((worker) => ({ value: worker.id, label: `${worker.name} ${worker.lastName}` }))} />
                  </Field>
                )}
                {targetKind === "asset" && (
                  <Field label="Equipo" required error={targetError}>
                    <OptionSelect name="assetId" placeholder="Selecciona un equipo" aria-label="Equipo" options={assets.map((asset) => ({ value: asset.id, label: asset.code }))} />
                  </Field>
                )}
                {targetKind === "area" && (
                  <Field label="Área" required helper="Texto libre: gerencia, prevención, TI…" error={targetError}>
                    <Input name="area" maxLength={80} />
                  </Field>
                )}
                {targetKind === "worksite" && (
                  <Field label="Faena" required error={targetError}>
                    <OptionSelect name="worksiteId" placeholder="Selecciona una faena" aria-label="Faena" options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))} />
                  </Field>
                )}
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
