"use client"

import { useRef, useState, useTransition } from "react"
import { CaretLeft, CaretRight, Warning } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import {
  DENOMINATOR_STATUS_LABELS,
  denominatorStatusVariant,
  labelOrRaw,
  RECONCILIATION_LABELS,
  SOURCE_TYPE_LABELS,
} from "./denominator-labels"
import {
  approveSafetyIndicatorDenominatorAction,
  saveSafetyIndicatorDenominatorAction,
} from "./actions"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

const DECISION_REASON_MIN = 10

export interface DenominatorRow {
  id: string
  workerCount: number
  workedHours: number
  sourceType: string
  sourceReference: string
  evidenceReference: string | null
  evidenceChecksumSha256: string | null
  status: string
  reconciliationStatus: string
  reconciliationNotes: string | null
  version: number
  createdByUserId: string
  updatedByUserId: string
  updatedAt: string
}

/**
 * Etiqueta del botón que abre el modal. Depende del permiso además del estado:
 * ofrecer "Revisar" a quien no puede aprobar prometía una acción que el panel
 * de decisión después le niega.
 */
export function denominatorDialogLabel(
  denominator: DenominatorRow | null,
  access: { canManage: boolean; canApprove: boolean },
) {
  if (denominator?.status === "pending_review") return access.canApprove ? "Revisar" : "Ver"
  if (!access.canManage) return "Ver"
  return denominator ? "Gestionar" : "Registrar"
}

/** Qué hacer una vez resuelta la confirmación de cambios sin guardar. */
type PendingIntent = { kind: "navigate"; month: number } | { kind: "close" }

interface Props {
  worksiteId: string
  year: number
  month: number
  denominator: DenominatorRow | null
  canManage: boolean
  canApprove: boolean
  currentUserId: string
  onClose: () => void
  /** Cargar otro mes sin cerrar el modal; si hay cambios sin guardar, pide confirmación. */
  onNavigate?: (month: number) => void
}

export function IndicatorDenominatorDialog({ worksiteId, year, month, denominator, canManage, canApprove, currentUserId, onClose, onNavigate }: Props) {
  const [pending, startTransition] = useTransition()
  const [sourceType, setSourceType] = useState(denominator?.sourceType ?? "rrhh")
  const [reconciliationStatus, setReconciliationStatus] = useState(denominator?.reconciliationStatus ?? "pending")
  const [decisionReason, setDecisionReason] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const formRef = useRef<HTMLFormElement>(null)

  const preparedByCurrentUser = denominator?.createdByUserId === currentUserId || denominator?.updatedByUserId === currentUserId
  const isPendingReview = denominator?.status === "pending_review"
  const isApproved = denominator?.status === "approved"
  const showForm = canManage && !isPendingReview
  const notesRequired = reconciliationStatus !== "matched"
  const fieldId = (suffix: string) => `denominator-${month}-${suffix}`
  const err = (field: string) => fieldErrors[field]?.[0]

  function clearFieldError(field: string) {
    if (!field) return
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function submitDenominator(formData: FormData, after: () => void) {
    const submitForReview = formData.get("submitForReview") === "on"
    startTransition(async () => {
      const result = await saveSafetyIndicatorDenominatorAction({
        worksiteId,
        year,
        month,
        workerCount: Number(formData.get("workerCount") ?? 0),
        workedHours: Number(formData.get("workedHours") ?? 0),
        sourceType,
        sourceReference: formData.get("sourceReference"),
        evidenceReference: formData.get("evidenceReference"),
        // Ya no hay input que lo produzca —ver DenominatorSummary—, pero leerlo
        // del form mandaría `null` y borraría el hash de los registros que sí
        // lo tienen. Se reenvía el valor guardado hasta que exista una carga de
        // evidencia que lo calcule.
        evidenceChecksumSha256: denominator?.evidenceChecksumSha256 ?? null,
        reconciliationStatus,
        reconciliationNotes: formData.get("reconciliationNotes") || null,
        submitForReview,
        expectedVersion: denominator?.version ?? null,
        correctionReason: formData.get("correctionReason") || null,
      })
      if (result.ok) {
        setFieldErrors({})
        setDirty(false)
        // Enviar a revisión cambia el estado del flujo y te bloquea de seguir
        // editando; decirlo con el mismo texto que un borrador guardado ocultaba
        // la mitad importante de lo que acababa de pasar.
        toast.success(submitForReview ? "Denominador enviado a revisión" : "Denominador guardado en borrador")
        after()
      } else {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.message ?? "No se pudo guardar el denominador")
      }
    })
  }

  function save(formData: FormData) {
    submitDenominator(formData, onClose)
  }

  function runIntent(intent: PendingIntent) {
    if (intent.kind === "close") onClose()
    else onNavigate?.(intent.month)
  }

  /** Toda salida del modal —cerrar o cambiar de mes— pasa por acá. */
  function requestIntent(intent: PendingIntent) {
    if (dirty) setPendingIntent(intent)
    else runIntent(intent)
  }

  function saveAndRun() {
    if (!formRef.current || !pendingIntent) return
    const intent = pendingIntent
    // Se baja el aviso antes de enviar: si la validación falla, los errores se
    // pintan sobre los campos y el aviso taparía justo lo que hay que corregir.
    setPendingIntent(null)
    submitDenominator(new FormData(formRef.current), () => runIntent(intent))
  }

  function discardAndRun() {
    if (!pendingIntent) return
    const intent = pendingIntent
    setDirty(false)
    setPendingIntent(null)
    runIntent(intent)
  }

  function decide(decision: "approved" | "rejected") {
    if (!denominator) return
    startTransition(async () => {
      const result = await approveSafetyIndicatorDenominatorAction({
        denominatorId: denominator.id,
        expectedVersion: denominator.version,
        decision,
        reason: decisionReason,
      })
      if (result.ok) {
        toast.success(decision === "approved" ? "Denominador aprobado" : "Denominador rechazado")
        onClose()
      } else toast.error(result.message ?? "No se pudo registrar la decisión")
    })
  }

  const missingReasonChars = Math.max(0, DECISION_REASON_MIN - decisionReason.trim().length)
  const blockedByReconciliation = denominator?.reconciliationStatus === "pending"

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestIntent({ kind: "close" }) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Denominador · {MONTHS[month - 1]} {year}</DialogTitle>
              <MetaBadge
                meta={{
                  label: denominator ? labelOrRaw(DENOMINATOR_STATUS_LABELS, denominator.status) : "Sin registro",
                  variant: denominatorStatusVariant(denominator?.status),
                }}
              />
            </div>
            {onNavigate && (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={pending || month <= 1} onClick={() => requestIntent({ kind: "navigate", month: month - 1 })} aria-label="Mes anterior">
                  <CaretLeft size={16} />
                </Button>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">{month}/12</span>
                <Button type="button" variant="ghost" size="sm" disabled={pending || month >= 12} onClick={() => requestIntent({ kind: "navigate", month: month + 1 })} aria-label="Mes siguiente">
                  <CaretRight size={16} />
                </Button>
              </div>
            )}
          </div>
          <DialogDescription>Dotación y horas requieren fuente, evidencia, conciliación y aprobación segregada antes del cierre.</DialogDescription>
          <span className="sr-only" role="status" aria-live="polite">Mostrando datos de {MONTHS[month - 1]} de {year}</span>
        </DialogHeader>

        {pendingIntent && (
          <div role="alertdialog" aria-label="Cambios sin guardar" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm">
            <p>Hay cambios sin guardar. ¿Qué deseas hacer antes de {pendingIntent.kind === "close" ? "cerrar" : `ir a ${MONTHS[pendingIntent.month - 1]}`}?</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setPendingIntent(null)}>Seguir editando</Button>
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={discardAndRun}>Descartar</Button>
              <Button type="button" size="sm" disabled={pending} onClick={saveAndRun}>Guardar y continuar</Button>
            </div>
          </div>
        )}

        {showForm && isApproved && (
          <div role="alert" className="flex gap-2 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm">
            <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-warning-ink)]" />
            <div>
              <p className="font-medium text-[var(--color-warning-ink)]">Este denominador ya está aprobado.</p>
              <p className="mt-1">Guardar una corrección reabre el período cerrado y revoca la acreditación PDTP de {MONTHS[month - 1]}. El registro vuelve a borrador y necesita una aprobación nueva.</p>
            </div>
          </div>
        )}

        {showForm && (
          <form
            ref={formRef}
            // `onSubmit` y no `action={save}`: React reinicia un formulario con
            // `action` al terminar, también cuando el servidor rechaza el
            // guardado, y el error quedaba sobre campos ya vaciados.
            onSubmit={(event) => {
              event.preventDefault()
              save(new FormData(event.currentTarget))
            }}
            onChange={(event) => {
              setDirty(true)
              // El target real es el control que cambió, no el form que React tipa.
              const { name } = event.target as unknown as { name?: string }
              clearFieldError(name ?? "")
            }}
            className="grid gap-4 md:grid-cols-2"
          >
            <Field label="Dotación del mes" htmlFor={fieldId("workers")} required error={err("workerCount")} helper="Personas con contrato vigente en el mes.">
              <Input id={fieldId("workers")} name="workerCount" type="number" min={0} step="1" required defaultValue={denominator?.workerCount ?? ""} error={!!err("workerCount")} />
            </Field>

            <Field label="Horas trabajadas" htmlFor={fieldId("hours")} required error={err("workedHours")} helper="HH del mes. Un mes con accidentes y 0 horas no podrá cerrarse.">
              <Input id={fieldId("hours")} name="workedHours" type="number" min={0} step="0.01" required defaultValue={denominator?.workedHours ?? ""} error={!!err("workedHours")} />
            </Field>

            <Field label="Procedencia" htmlFor={fieldId("source-type")} required error={err("sourceType")}>
              <Select value={sourceType} onValueChange={(value) => { setSourceType(value); setDirty(true); clearFieldError("sourceType") }}>
                <SelectTrigger id={fieldId("source-type")} aria-label="Procedencia" error={!!err("sourceType")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Referencia de fuente" htmlFor={fieldId("source")} required error={err("sourceReference")}>
              <Input id={fieldId("source")} name="sourceReference" required minLength={3} defaultValue={denominator?.sourceReference ?? ""} placeholder="Nómina RR.HH. julio 2026" error={!!err("sourceReference")} />
            </Field>

            <Field label="Evidencia" htmlFor={fieldId("evidence")} required error={err("evidenceReference")} className="md:col-span-2">
              <Input id={fieldId("evidence")} name="evidenceReference" required minLength={3} defaultValue={denominator?.evidenceReference ?? ""} placeholder="Documento, folio o ruta controlada" error={!!err("evidenceReference")} />
            </Field>

            <Field label="Conciliación" htmlFor={fieldId("reconciliation")} required error={err("reconciliationStatus")}>
              <Select value={reconciliationStatus} onValueChange={(value) => { setReconciliationStatus(value); setDirty(true); clearFieldError("reconciliationStatus") }}>
                <SelectTrigger id={fieldId("reconciliation")} aria-label="Conciliación" error={!!err("reconciliationStatus")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RECONCILIATION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Notas"
              htmlFor={fieldId("notes")}
              required={notesRequired}
              error={err("reconciliationNotes")}
              helper={notesRequired ? "Mínimo 5 caracteres: la conciliación no cuadra y hay que explicarlo." : "Opcional cuando la conciliación cuadra con la fuente."}
            >
              <Textarea id={fieldId("notes")} name="reconciliationNotes" required={notesRequired} minLength={5} defaultValue={denominator?.reconciliationNotes ?? ""} rows={2} error={!!err("reconciliationNotes")} />
            </Field>

            {isApproved && (
              <Field label="Motivo de corrección del aprobado" htmlFor={fieldId("correction")} required error={err("correctionReason")} helper="Mínimo 10 caracteres. Queda en la bitácora de auditoría." className="md:col-span-2">
                <Textarea id={fieldId("correction")} name="correctionReason" required minLength={10} rows={2} error={!!err("correctionReason")} />
              </Field>
            )}

            <div className="md:col-span-2">
              <Checkbox id={fieldId("submit")} name="submitForReview" label="Enviar a revisión al guardar" aria-describedby={fieldId("submit-help")} />
              <p id={fieldId("submit-help")} className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Al enviarlo dejas de poder editarlo: la aprobación la hace otra persona con permiso de cierre.
              </p>
            </div>

            <DialogFooter className="md:col-span-2">
              <Button type="submit" disabled={pending}>Guardar denominador</Button>
            </DialogFooter>
          </form>
        )}

        {isPendingReview && denominator && (
          <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
            <DenominatorSummary denominator={denominator} />
            {canApprove && !preparedByCurrentUser ? (
              <>
                {blockedByReconciliation && (
                  <p role="alert" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
                    No se puede aprobar con la conciliación pendiente. Recházalo para que quien lo preparó la resuelva.
                  </p>
                )}
                <Field label="Fundamento de decisión" htmlFor={fieldId("decision")} required helper={`Mínimo ${DECISION_REASON_MIN} caracteres. Queda en la bitácora junto a tu nombre.`}>
                  <Textarea id={fieldId("decision")} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={3} />
                </Field>
                {/* Los botones se deshabilitan hasta cumplir el mínimo; sin este
                    aviso el usuario veía dos botones grises y ninguna pista. */}
                <p aria-live="polite" className="text-xs text-[var(--color-text-subtle)]">
                  {missingReasonChars > 0
                    ? `Faltan ${missingReasonChars} caracteres para poder decidir.`
                    : "Fundamento suficiente para decidir."}
                </p>
                <DialogFooter>
                  <Button type="button" variant="destructive" disabled={pending || missingReasonChars > 0} onClick={() => decide("rejected")}>Rechazar</Button>
                  <Button type="button" disabled={pending || missingReasonChars > 0 || blockedByReconciliation} onClick={() => decide("approved")}>Aprobar</Button>
                </DialogFooter>
              </>
            ) : (
              <p className="text-sm text-[var(--color-warning-ink)]">
                {preparedByCurrentUser
                  ? "No puedes aprobar un denominador que preparaste tú: la segregación exige otro usuario con permiso de cierre."
                  : "La aprobación requiere un usuario con permiso de cierre."}
              </p>
            )}
          </div>
        )}

        {/* Sin este bloque el modal quedaba literalmente vacío para quien puede
            aprobar pero no gestionar y abre un mes en borrador: ni formulario
            ni panel de decisión, sólo el encabezado. */}
        {!showForm && !isPendingReview && (
          denominator ? (
            <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
              <DenominatorSummary denominator={denominator} />
              <p className="text-sm text-[var(--color-text-subtle)]">Sólo lectura: editar el denominador exige el permiso de gestión de indicadores.</p>
            </div>
          ) : (
            <EmptyState
              compact
              title="Sin denominador registrado"
              description={`Nadie ha cargado la dotación ni las horas de ${MONTHS[month - 1]} de ${year}. Registrarlos exige el permiso de gestión de indicadores.`}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Resumen de solo lectura. Antes el panel de aprobación mostraba cuatro campos
 * —dotación, horas, fuente y evidencia— y ocultaba justamente los que deciden
 * la revisión: el estado de conciliación y su nota. Se aprobaba a ciegas.
 */
function DenominatorSummary({ denominator }: { denominator: DenominatorRow }) {
  const rows: Array<{ label: string; value: React.ReactNode; wide?: boolean }> = [
    { label: "Dotación", value: denominator.workerCount },
    { label: "Horas trabajadas", value: denominator.workedHours.toLocaleString("es-CL") },
    { label: "Procedencia", value: labelOrRaw(SOURCE_TYPE_LABELS, denominator.sourceType) },
    { label: "Conciliación", value: labelOrRaw(RECONCILIATION_LABELS, denominator.reconciliationStatus) },
    { label: "Fuente", value: denominator.sourceReference },
    { label: "Evidencia", value: denominator.evidenceReference ?? "—" },
    { label: "Notas", wide: true, value: denominator.reconciliationNotes ?? "—" },
    { label: "Última actualización", value: formatDateTime(denominator.updatedAt) },
  ]

  // Sólo si el registro trae hash. No hay formulario que lo produzca —pedirle a
  // un prevencionista que corra `sha256sum` y transcriba 64 caracteres no es un
  // control de integridad, es un campo vacío— así que una fila permanente
  // "Sin hash registrado" sería ruido en cada mes. Cuando la evidencia sea un
  // archivo cargado, el sistema lo calculará como ya se hace en TAE e
  // inspecciones, y esta fila se llena sola.
  if (denominator.evidenceChecksumSha256) {
    rows.push({
      label: "Huella del archivo de evidencia",
      wide: true,
      value: (
        <span className="font-mono text-xs" title={`SHA-256: ${denominator.evidenceChecksumSha256}`}>
          SHA-256 {denominator.evidenceChecksumSha256.slice(0, 12)}…
        </span>
      ),
    })
  }
  return (
    <dl className="grid gap-3 text-sm md:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className={row.wide ? "md:col-span-2" : undefined}>
          <dt className="text-[var(--color-text-subtle)]">{row.label}</dt>
          <dd className="mt-0.5">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
