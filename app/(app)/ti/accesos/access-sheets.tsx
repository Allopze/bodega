"use client"

import * as React from "react"
import { useActionState } from "react"
import { Plus } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { IT_ACCESS_STATUS_META } from "@/lib/services/ti/constants"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { lookupSystemAccessAction, upsertSystemAccessAction } from "./actions"

/**
 * Estado del acceso como grupo de radios.
 *
 * Antes eran radios `sr-only` dentro de etiquetas: sin foco visible, sin
 * `fieldset`/`legend` (un lector de pantalla oía "Activo" sin saber de qué) y
 * con el borde de `--color-border` (1,3:1, bajo el 3:1 de WCAG 1.4.11 para
 * controles). Acá el grupo se nombra, el foco del radio se dibuja en su
 * etiqueta (`has-[:focus-visible]`) y el borde usa el token de control.
 */
export function AccessStatusFieldset({ defaultValue, error }: { defaultValue: string; error?: string }) {
  const errorId = React.useId()
  return (
    <fieldset aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 text-sm font-medium leading-tight text-[var(--color-text)]">
        Estado <span className="text-[var(--color-danger)]" aria-hidden>*</span>
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(IT_ACCESS_STATUS_META).map(([value, meta]) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-[var(--color-border-control)] px-2 py-2 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-border-control-hover)] has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-tint)] has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] has-[:focus-visible]:ring-offset-2 sm:min-h-9"
          >
            <input type="radio" name="status" value={value} defaultChecked={value === defaultValue} className="sr-only" />
            {meta.label}
          </label>
        ))}
      </div>
      {error && <p id={errorId} className="mt-1 text-xs text-[var(--color-danger-ink)]" role="alert">{error}</p>}
    </fieldset>
  )
}

interface NamedOption { id: string; name: string }

interface AccessSheetProps {
  systems: NamedOption[]
  onClose: () => void
  /**
   * Par fijo, desde una celda de la matriz. `status` y `notes` son los del
   * registro real: la hoja jamás inventa "Activo" sobre un par que ya existe.
   */
  fixed?: { workerId: string; workerName: string; systemId: string; status?: string; notes?: string | null }
  /** Selector de trabajador y sistema, desde la acción del encabezado. */
  workers?: { id: string; name: string; lastName: string }[]
  /** Trabajador preseleccionado en el modo selector (tarjeta móvil). */
  initialWorkerId?: string
}

type Existing = { status: string; notes: string | null } | null

/**
 * Hoja de acceso. Con `fixed` edita un par conocido; con `workers` deja elegir
 * el par y, una vez elegido, consulta el registro actual para mostrar su
 * estado y sus notas reales (TIUX-02) antes de que nadie guarde encima.
 */
export function AccessSheet({ systems, onClose, fixed, workers, initialWorkerId }: AccessSheetProps) {
  const [workerId, setWorkerId] = React.useState(fixed?.workerId ?? initialWorkerId ?? "")
  const [systemId, setSystemId] = React.useState(fixed?.systemId ?? "")
  const pairKey = `${workerId}:${systemId}`
  const [lookup, setLookup] = React.useState<{ key: string; existing: Existing } | null>(null)

  React.useEffect(() => {
    if (fixed || !workerId || !systemId) return
    let cancelled = false
    void lookupSystemAccessAction(workerId, systemId).then((result) => {
      if (!cancelled) setLookup({ key: `${workerId}:${systemId}`, existing: result.access })
    })
    return () => { cancelled = true }
  }, [fixed, workerId, systemId])

  const pairReady = Boolean(workerId && systemId)
  const loaded = fixed ? true : lookup?.key === pairKey
  const existing: Existing = fixed
    ? (fixed.status ? { status: fixed.status, notes: fixed.notes ?? null } : null)
    : loaded ? lookup?.existing ?? null : null

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await upsertSystemAccessAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Acceso actualizado")
      onClose()
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  const systemName = systems.find((s) => s.id === systemId)?.name ?? ""
  const workerName = fixed?.workerName
    ?? (() => {
      const w = workers?.find((item) => item.id === workerId)
      return w ? `${w.name} ${w.lastName}`.trim() : ""
    })()

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="workerId" value={workerId} />
          <input type="hidden" name="systemId" value={systemId} />
          <SheetHeader>
            <div>
              <SheetTitle>{fixed ? `Acceso de ${fixed.workerName}` : "Registrar acceso"}</SheetTitle>
              <SheetDescription>
                {fixed ? `Sistema: ${systemName}` : "Elige a quién y a qué sistema. Si ya tiene un registro, lo verás aquí antes de guardar."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}
            <FieldGroup>
              {!fixed && workers && (
                <>
                  <Field label="Trabajador" required error={state.fieldErrors?.workerId?.[0]}>
                    <OptionSelect
                      value={workerId}
                      onValueChange={setWorkerId}
                      placeholder="Selecciona un trabajador"
                      aria-label="Trabajador"
                      options={workers.map((w) => ({ value: w.id, label: `${w.name} ${w.lastName}`.trim() }))}
                    />
                  </Field>
                  <Field label="Sistema" required error={state.fieldErrors?.systemId?.[0]}>
                    <OptionSelect
                      value={systemId}
                      onValueChange={setSystemId}
                      placeholder="Selecciona un sistema"
                      aria-label="Sistema"
                      options={systems.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </Field>
                </>
              )}

              {!fixed && pairReady && loaded && existing && (
                <p className="rounded-lg bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]" role="status">
                  {workerName} ya tiene registro en {systemName}: {IT_ACCESS_STATUS_META[existing.status]?.label ?? existing.status}. Lo que guardes lo reemplaza.
                </p>
              )}
              {!fixed && pairReady && !loaded && (
                <p className="text-xs text-[var(--color-text-muted)]" role="status">Revisando si ya existe un registro…</p>
              )}

              {/* `key` remonta el formulario cuando llega el registro real: así
                  los `defaultValue` son los del dato y no los de antes de cargar. */}
              <div key={`${pairKey}:${loaded ? "ok" : "wait"}`} className="space-y-4">
                <AccessStatusFieldset
                  defaultValue={existing?.status ?? "activo"}
                  error={state.fieldErrors?.status?.[0]}
                />
                <Field label="Notas" helper="Fecha de alta, ticket asociado, motivo…" error={state.fieldErrors?.notes?.[0]}>
                  <Textarea name="notes" maxLength={300} defaultValue={existing?.notes ?? ""} rows={3} />
                </Field>
              </div>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Guardar acceso" loadingLabel="Guardando..." disabled={!pairReady || !loaded} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Acción de página "Registrar acceso" (`PageHeader.actions`). El botón se
 * construye acá, en el cliente, y no lo recibe la página. `AccessSheet` se
 * monta solo mientras está abierta, así el par elegido y la consulta del
 * registro arrancan limpios cada vez.
 */
export function RegisterAccessCta({ systems, workers }: {
  systems: NamedOption[]
  workers: { id: string; name: string; lastName: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={systems.length === 0}>
        <Plus size={14} className="mr-1.5" /> Registrar acceso
      </Button>
      {open && <AccessSheet systems={systems} workers={workers} onClose={() => setOpen(false)} />}
    </>
  )
}
