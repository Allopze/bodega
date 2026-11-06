"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceChips, type ChoiceChipOption } from "@/components/ui/choice-chips"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import { Field } from "@/components/ui/field"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Textarea } from "@/components/ui/textarea"
import { expiryState } from "@/lib/expiry"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import type { DriverCandidate, DriverLicenseRecord, DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { toast } from "@/lib/toast"
import { addMonths } from "@/lib/utils"
import {
  DRIVER_LICENSE_CLASSES,
  DRIVER_LICENSE_CLASS_GROUPS,
  DRIVER_LICENSE_CLASS_INFO,
  DRIVER_LICENSE_NOTES_MAX,
  DRIVER_STATUS_LABEL,
  formatLicenseClassList,
  type DriverLicenseClass,
} from "@/lib/validation/driver-licenses"
import { removeDriverLicenseAction, saveDriverLicenseAction } from "./actions"
import { displayPosition } from "./drivers-view"

/** A quién pertenece la licencia que se edita: sale de una fila de la lista o de un candidato sin licencia. */
export interface LicenseSubject {
  workerId: string
  name: string
  rut: string | null
  worksiteName: string
  positionName: string | null
  /** Clases que exige el cargo (basta una): sólo sugeridas, nunca marcadas por la pantalla. */
  requiredClasses: DriverLicenseClass[]
  license: DriverLicenseRecord | null
}

export type LicenseSheetTarget =
  | { kind: "edit"; subject: LicenseSubject }
  | { kind: "register" }

export function subjectFromRow(row: DriverRosterRow): LicenseSubject {
  return {
    workerId: row.workerId,
    name: row.name,
    rut: row.rut,
    worksiteName: row.worksiteName,
    positionName: row.positionName,
    requiredClasses: row.requiredClasses,
    license: row.license,
  }
}

export function subjectFromCandidate(candidate: DriverCandidate): LicenseSubject {
  return {
    workerId: candidate.workerId,
    name: candidate.name,
    rut: candidate.rut,
    worksiteName: candidate.worksiteName,
    positionName: candidate.positionName,
    requiredClasses: candidate.requiredClasses,
    license: null,
  }
}

const CLASS_OPTIONS: ChoiceChipOption[] = DRIVER_LICENSE_CLASSES.map((code) => {
  const info = DRIVER_LICENSE_CLASS_INFO[code]
  return { value: code, label: info.short, description: info.name, group: info.group }
})

/**
 * Atajos de fecha, en años desde hoy. El calendario avanza de mes en mes y una
 * licencia profesional vence a los cuatro años (la B, a los seis): llegar con
 * flechas eran más de cuarenta clics. El atajo deja la fecha cerca y el
 * calendario, que abre en ese mes, sólo la afina.
 */
const YEAR_SHORTCUTS = [1, 4, 6] as const

export function DriverLicenseSheet({
  open,
  target,
  candidates,
  today,
  warningDays,
  onClose,
}: {
  open: boolean
  /** Se conserva mientras la hoja se cierra, para que no se vacíe a mitad de la animación de salida. */
  target: LicenseSheetTarget | null
  candidates: DriverCandidate[]
  today: string
  warningDays: number
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      {/* `stableHeight`: la hoja no cambia de alto al elegir a la persona ni al quitar o marcar clases. */}
      <SheetContent stableHeight className="sm:max-w-xl">
        {target && (
          <DriverLicenseForm
            key={target.kind === "edit" ? target.subject.workerId : "registrar"}
            target={target}
            candidates={candidates}
            today={today}
            warningDays={warningDays}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Vive dentro del contenido de la hoja, así que se monta de nuevo cada vez que
 * ésta se abre: ni los errores del envío anterior ni lo que se marcó sin guardar
 * sobreviven al cierre.
 */
function DriverLicenseForm({
  target,
  candidates,
  today,
  warningDays,
  onClose,
}: {
  target: LicenseSheetTarget
  candidates: DriverCandidate[]
  today: string
  warningDays: number
  onClose: () => void
}) {
  const isRegister = target.kind === "register"
  const [workerId, setWorkerId] = React.useState(target.kind === "edit" ? target.subject.workerId : "")
  const subject = React.useMemo<LicenseSubject | null>(() => {
    if (target.kind === "edit") return target.subject
    const candidate = candidates.find((item) => item.workerId === workerId)
    return candidate ? subjectFromCandidate(candidate) : null
  }, [target, candidates, workerId])

  const [classes, setClasses] = React.useState<string[]>(() => (target.kind === "edit" ? [...(target.subject.license?.classes ?? [])] : []))
  const [expiresAt, setExpiresAt] = React.useState(() => (target.kind === "edit" ? target.subject.license?.expiresAt ?? "" : ""))
  const [notes, setNotes] = React.useState(() => (target.kind === "edit" ? target.subject.license?.notes ?? "" : ""))
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const candidateOptions = React.useMemo<ComboboxOption[]>(
    () => candidates.map((candidate) => ({
      value: candidate.workerId,
      label: candidate.name,
      hint: [candidate.rut, candidate.worksiteName].filter(Boolean).join(" · "),
    })),
    [candidates],
  )

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveDriverLicenseAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Licencia guardada")
      onClose()
    }
    return result
  }, INITIAL_STATE)

  const removal = useOperation()
  const hasLicense = subject?.license != null
  const requiredClasses = subject?.requiredClasses ?? []
  const classesHelper = requiredClasses.length > 0
    ? `Marca todas las que tenga. Su cargo exige ${formatLicenseClassList(requiredClasses)}.`
    : "Marca todas las que tenga."

  const preview = expiryState(expiresAt || null, today, warningDays)

  return (
    <>
      <form action={formAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="workerId" value={workerId} />

        <SheetHeader>
          <div>
            <SheetTitle>Licencia de conducir</SheetTitle>
            <SheetDescription>
              {isRegister ? "Elige a la persona y registra su licencia." : "Actualiza las clases y la fecha de vencimiento."}
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <SheetBody className="flex flex-col gap-5">
          {isRegister && (
            <Field
              label="Trabajador"
              htmlFor="driver-worker"
              required
              error={state.fieldErrors?.workerId ? "Elige a la persona a la que pertenece la licencia." : undefined}
              helper={candidates.length === 0
                ? "Todos los trabajadores de tus faenas ya tienen una licencia registrada."
                : "Busca por nombre, RUT o faena."}
            >
              <Combobox
                id="driver-worker"
                options={candidateOptions}
                value={workerId}
                onChange={setWorkerId}
                placeholder="Buscar trabajador…"
                disabled={candidates.length === 0}
              />
            </Field>
          )}

          {subject && <IdentityBlock subject={subject} showName={!isRegister} />}

          <Field
            label="Clases"
            required
            error={state.fieldErrors?.classes?.[0]}
            helper={classesHelper}
          >
            <ChoiceChips
              name="classes"
              options={CLASS_OPTIONS}
              groups={DRIVER_LICENSE_CLASS_GROUPS}
              value={classes}
              onChange={setClasses}
              suggested={requiredClasses}
              invalid={Boolean(state.fieldErrors?.classes)}
            />
          </Field>

          <div>
            <Field
              label="Válida hasta"
              htmlFor="driver-expires"
              error={state.fieldErrors?.expiresAt?.[0]}
              helper="Si tiene prórroga, la fecha de la prórroga."
            >
              <DatePicker
                id="driver-expires"
                name="expiresAt"
                ariaLabel="Válida hasta"
                value={expiresAt}
                onChange={setExpiresAt}
                error={Boolean(state.fieldErrors?.expiresAt)}
              />
            </Field>
            <div role="group" aria-label="Atajos de fecha, contados desde hoy" className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--color-text-subtle)]">Desde hoy:</span>
              {YEAR_SHORTCUTS.map((years) => (
                <Button
                  key={years}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setExpiresAt(addMonths(today, years * 12))}
                >
                  En {years} {years === 1 ? "año" : "años"}
                </Button>
              ))}
            </div>
            <div aria-live="polite" className="mt-3 flex min-h-6 flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span>Quedará:</span>
              <ExpiryStatus
                status={preview}
                warningDays={warningDays}
                label={preview.state === "vencido" ? DRIVER_STATUS_LABEL.vencida : undefined}
                emptyText="no se podrá controlar su vencimiento"
              />
            </div>
          </div>

          <div>
            <Field
              label="Observación"
              htmlFor="driver-notes"
              error={state.fieldErrors?.notes?.[0]}
              helper="Opcional. Por ejemplo: prórroga por 6 meses."
            >
              <Textarea
                id="driver-notes"
                name="notes"
                rows={3}
                maxLength={DRIVER_LICENSE_NOTES_MAX}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <p aria-hidden className="mt-1 text-right text-xs tabular-nums text-[var(--color-text-subtle)]">
              {notes.length}/{DRIVER_LICENSE_NOTES_MAX}
            </p>
          </div>
        </SheetBody>

        {state.message && !state.ok && (
          <p
            role="alert"
            className="shrink-0 border-t border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-6 py-2.5 text-sm text-[var(--color-danger-ink)]"
          >
            {state.message}
          </p>
        )}

        <SheetFooter>
          {hasLicense && (
            <Button type="button" variant="ghost-danger" className="mr-auto" onClick={() => setConfirmOpen(true)}>
              Quitar licencia
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <SubmitButton label="Guardar" loadingLabel="Guardando…" />
        </SheetFooter>
      </form>

      {subject && hasLicense && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(next) => {
            if (removal.pending) return
            if (next) removal.setMessage("")
            setConfirmOpen(next)
          }}
          title="Quitar licencia"
          description={`Se borrará la licencia registrada de ${subject.name}. Quedará anotado en la auditoría quién lo hizo.`}
          confirmLabel="Quitar licencia"
          variant="destructive"
          loading={removal.pending}
          error={removal.message || undefined}
          onConfirm={() => {
            removal.run(
              () => removeDriverLicenseAction(subject.workerId),
              () => {
                toast.success(`Licencia de ${subject.name} quitada`)
                setConfirmOpen(false)
                onClose()
              },
            )
          }}
        />
      )}
    </>
  )
}

/** Quién es: nombre, RUT, faena y cargo. En el alta el nombre ya está en el buscador y no se repite. */
function IdentityBlock({ subject, showName }: { subject: LicenseSubject; showName: boolean }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] px-4 py-3">
      {showName && <p className="text-base font-semibold text-[var(--color-text)]">{subject.name}</p>}
      <p className={showName ? "mt-0.5 text-xs tabular-nums text-[var(--color-text-muted)]" : "text-xs tabular-nums text-[var(--color-text-muted)]"}>
        {subject.rut ?? "Sin RUT"}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Faena</dt>
          <dd className="text-[var(--color-text)]">{subject.worksiteName}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Cargo</dt>
          <dd className="text-[var(--color-text)]">{displayPosition(subject.positionName)}</dd>
        </div>
      </dl>
    </div>
  )
}
