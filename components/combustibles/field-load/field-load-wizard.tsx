"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CheckCircle, CircleNotch } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { compressPhoto } from "@/lib/pwa/image-compress"
import { suggestSupplyMedium } from "@/lib/combustibles/field-load-media"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import { BigButton, StepNotice } from "./big-controls"
import { buildEvidence, buildPayload, draftFromPayload, newClientId, photosFromEvidence } from "./payload"
import { StepLiters, StepMeter } from "./step-meter-liters"
import { StepPeople } from "./step-people"
import { StepReview, type ReviewExtraRow } from "./step-review"
import { StepHeader } from "./step-header"
import { StepSeals } from "./step-seals"
import { StepVehicle } from "./step-vehicle"
import { useFieldDraft } from "./use-field-draft"
import { useFieldIdentity } from "./use-field-identity"
import { firstInvalidStep, stepForServerField, validateStep, type StepErrors } from "./validate"
import {
  EMPTY_DRAFT,
  FIELD_LOAD_STEPS,
  type FieldLoadConfig,
  type FieldLoadDraft,
  type FieldLoadPastLoad,
  type FieldLoadPhotos,
  type FieldLoadStep,
  type FieldLoadSubmitter,
  type IdentityTransport,
  type SubmitOutcome,
} from "./types"
import type { QueuedTaeEvidence } from "@/lib/pwa/tae-offline-queue"

/** Una carga rechazada por el servidor que el operador quiere corregir y reenviar. */
export interface ResumeRequest {
  nonce: string
  payload: Record<string, unknown>
  evidence: QueuedTaeEvidence[]
  message: string
  field?: string
}

/** La pantalla final del anfitrión, montada como componente para que reciba su «registrar otra» como cualquier otra propiedad. */
function SentScreen({
  render,
  detail,
  onRestart,
}: {
  render: (info: { detail: unknown; restart: () => void }) => React.ReactNode
  detail: unknown
  onRestart: () => void
}) {
  return <>{render({ detail, restart: onRestart })}</>
}

function initialDraft(config: FieldLoadConfig): FieldLoadDraft {
  return { ...EMPTY_DRAFT, supplyMediumId: suggestSupplyMedium(config.loadingPoint?.name, config.supplyMedia) ?? "" }
}

/**
 * Formulario de carga en terreno, una pregunta por pantalla. Lo usan la PWA
 * pública (enlace QR, con cola sin conexión) y el registro autenticado: lo que
 * cambia entre ambos —a dónde se envía y cómo se verifica el RUT— entra por
 * `submit` e `identityTransport`.
 */
export function FieldLoadWizard({
  config,
  scopeKey,
  submit,
  identityTransport,
  resume,
  onOutcome,
  shellSearch = false,
  stepsBefore = 0,
  onBackFromFirst,
  active = true,
  pastLoad = null,
  reviewRows,
  timingNote,
  renderSent,
  onStartOver,
}: {
  config: FieldLoadConfig
  /** Clave del borrador en el dispositivo (faena + lugar). `null`: sin borrador. */
  scopeKey: string | null
  submit: FieldLoadSubmitter
  identityTransport: IdentityTransport | null
  resume?: ResumeRequest | null
  onOutcome?: (outcome: SubmitOutcome, resumed: boolean) => void
  /** Dentro de la app, el filtro de equipos es el de la barra superior en vez de un campo propio. */
  shellSearch?: boolean
  /**
   * Pasos que el anfitrión pinta antes del primero del formulario (el «Dónde» del
   * registro autenticado): sólo cambian la cuenta de «Paso N de M».
   */
  stepsBefore?: number
  /** Con esto, el primer paso ofrece «Atrás» y lo manda al anfitrión. */
  onBackFromFirst?: () => void
  /** `false` mientras el anfitrión muestra otro paso: el formulario sigue montado (conserva lo escrito) pero no toma el foco. */
  active?: boolean
  /** Carga de otro día: la hora no la sella el servidor y las fotos son opcionales. */
  pastLoad?: FieldLoadPastLoad | null
  /** Datos que el anfitrión suma arriba del resumen final, cada uno con su «Cambiar». */
  reviewRows?: ReviewExtraRow[]
  /** Lo que el resumen dice al pie sobre la fecha y la hora de la carga. */
  timingNote?: string
  /** Pantalla final propia; sin ella se muestra el «Carga registrada» de siempre. */
  renderSent?: (info: { detail: unknown; restart: () => void }) => React.ReactNode
  /** Se avisa cuando se descarta lo escrito (empezar de nuevo o registrar otra carga), para que el anfitrión olvide lo suyo. */
  onStartOver?: () => void
}) {
  const router = useRouter()
  const [step, setStep] = React.useState<FieldLoadStep>("vehicle")
  const [draft, setDraft] = React.useState<FieldLoadDraft>(() => initialDraft(config))
  const [photos, setPhotos] = React.useState<FieldLoadPhotos>({})
  const [compressing, setCompressing] = React.useState<Partial<Record<TaeEvidenceKind, boolean>>>({})
  const [errors, setErrors] = React.useState<StepErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [sentDetail, setSentDetail] = React.useState<unknown>(undefined)
  const [confirmation, setConfirmation] = React.useState<Extract<SubmitOutcome, { kind: "confirm" }> | null>(null)
  const [resumed, setResumed] = React.useState(false)
  const clientIdRef = React.useRef<string | null>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const identityScope = scopeKey
  const driver = useFieldIdentity("driver", identityTransport, identityScope)
  const supervisor = useFieldIdentity("supervisor", identityTransport, identityScope)

  const { restored, discard, ready } = useFieldDraft({
    scopeKey,
    draft,
    step,
    photos,
    enabled: !sent,
    onRestore: (value) => {
      if (!config.vehicles.some((vehicle) => vehicle.id === value.draft.vehicleId)) return false
      setDraft(value.draft)
      setPhotos(value.photos)
      setStep(value.step)
      return true
    },
  })

  const resumeNonce = resume?.nonce
  React.useEffect(() => {
    if (!resume) return
    setDraft(draftFromPayload(resume.payload))
    setPhotos(photosFromEvidence(resume.evidence))
    setStep(stepForServerField(resume.field))
    setServerError(resume.message)
    setErrors({})
    setResumed(true)
    setSent(false)
    clientIdRef.current = null
    // Solo cuando llega una carga nueva a corregir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeNonce])

  React.useEffect(() => { if (active) headingRef.current?.focus() }, [step, active])

  const stepIndex = FIELD_LOAD_STEPS.findIndex((item) => item.id === step)
  const totalSteps = FIELD_LOAD_STEPS.length + stepsBefore
  const context = { config, draft, photos, driver, supervisor, photosOptional: pastLoad != null }

  function patch(changes: Partial<FieldLoadDraft>) {
    setDraft((current) => ({ ...current, ...changes }))
    setErrors({})
    setServerError(null)
    setConfirmation(null)
  }

  async function selectPhoto(kind: TaeEvidenceKind, file: File | undefined) {
    if (!file) { setPhotos((current) => ({ ...current, [kind]: undefined })); return }
    setCompressing((current) => ({ ...current, [kind]: true }))
    try {
      const compressed = await compressPhoto(file)
      setPhotos((current) => ({ ...current, [kind]: compressed }))
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== kind)))
    } catch {
      setPhotos((current) => ({ ...current, [kind]: undefined }))
      toast.error("No se pudo procesar la foto. Toma otra o elige una imagen JPG o PNG.")
    } finally {
      setCompressing((current) => ({ ...current, [kind]: false }))
    }
  }

  function goNext() {
    const found = validateStep(step, context)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setServerError(null)
    setConfirmation(null)
    setStep(FIELD_LOAD_STEPS[stepIndex + 1]!.id)
  }

  function goBack() {
    setErrors({})
    setConfirmation(null)
    if (stepIndex > 0) setStep(FIELD_LOAD_STEPS[stepIndex - 1]!.id)
    else onBackFromFirst?.()
  }

  function startOver() {
    onStartOver?.()
    discard()
    setDraft(initialDraft(config))
    setPhotos({})
    setErrors({})
    setServerError(null)
    setConfirmation(null)
    setStep("vehicle")
    setResumed(false)
    clientIdRef.current = null
    driver.clear()
    supervisor.clear()
  }

  function restartAfterSent() {
    setSent(false)
    startOver()
  }

  async function send(options: { acknowledgeDuplicate?: boolean } = {}) {
    const invalid = firstInvalidStep(context)
    if (invalid) {
      setStep(invalid)
      setErrors(validateStep(invalid, context))
      return
    }
    if (Object.values(compressing).some(Boolean)) return
    clientIdRef.current ??= newClientId()
    const payload = buildPayload({ config, draft, driver, supervisor, clientSubmissionId: clientIdRef.current, pastLoad, acknowledgeDuplicate: options.acknowledgeDuplicate })
    setSubmitting(true)
    setServerError(null)
    setConfirmation(null)
    try {
      const outcome = await submit(payload, buildEvidence(draft, photos))
      onOutcome?.(outcome, resumed)
      if (outcome.kind === "rejected") {
        setServerError(outcome.message)
        setStep(stepForServerField(outcome.field))
        return
      }
      if (outcome.kind === "confirm") { setStep("review"); setConfirmation(outcome); return }
      if (outcome.kind === "failed") { setServerError(outcome.message); return }
      if (outcome.kind === "queued") {
        toast.success("Carga guardada en este teléfono. Se enviará sola cuando haya conexión.")
        startOver()
        return
      }
      discard()
      if (outcome.href) { router.push(outcome.href); return }
      setSentDetail(outcome.detail)
      setSent(true)
    } finally { setSubmitting(false) }
  }

  if (sent && renderSent) return <SentScreen render={renderSent} detail={sentDetail} onRestart={restartAfterSent} />
  if (sent) {
    return (
      <div className="space-y-4 text-center" role="status">
        <CheckCircle size={56} weight="fill" aria-hidden="true" className="mx-auto text-[var(--color-success)]" />
        <h2 className="text-2xl font-semibold">Carga registrada</h2>
        <p className="text-base text-[var(--color-text-muted)]">Quedó guardada con la fecha y hora de la plataforma.</p>
        <BigButton type="button" className="w-full" onClick={restartAfterSent}>Registrar otra carga</BigButton>
      </div>
    )
  }

  const viewProps = {
    ...context,
    errors,
    patch,
    selectPhoto: (kind: TaeEvidenceKind, file: File | undefined) => { void selectPhoto(kind, file) },
    compressing,
  }
  const isReview = step === "review"

  return (
    <div className="flex flex-col gap-5" aria-busy={submitting}>
      <StepHeader position={stepIndex + 1 + stepsBefore} total={totalSteps} title={FIELD_LOAD_STEPS[stepIndex]!.title} headingRef={headingRef} />

      {restored && ready && (
        <StepNotice tone="info">
          Recuperamos la carga que dejaste a medias.{" "}
          <button type="button" className="font-semibold underline" onClick={startOver}>Empezar de nuevo</button>
        </StepNotice>
      )}
      {serverError && (
        <StepNotice tone="danger">
          <strong>No se pudo enviar la carga.</strong> {serverError}{" "}
          {step === "review" ? "Toca «Cambiar» en el dato que corresponda y vuelve a enviarla." : "Corrígelo y sigue hasta «Revisar y enviar»."}
        </StepNotice>
      )}

      <div>
        {step === "vehicle" && <StepVehicle {...viewProps} shellSearch={shellSearch} />}
        {step === "meter" && <StepMeter {...viewProps} />}
        {step === "liters" && <StepLiters {...viewProps} />}
        {step === "seals" && <StepSeals {...viewProps} />}
        {step === "people" && <StepPeople {...viewProps} canVerifyIdentity={identityTransport != null} />}
        {isReview && (
          <StepReview
            {...viewProps}
            goTo={(target) => { setErrors({}); setConfirmation(null); setStep(target) }}
            loadingPointName={reviewRows?.length ? null : config.loadingPoint?.name ?? null}
            extraRows={reviewRows}
            timingNote={timingNote}
          />
        )}
        {isReview && confirmation && (
          <div className="mt-5">
            <StepNotice tone="info">
              <p>{confirmation.message}</p>
              {confirmation.link && (
                <p className="mt-2">
                  <a href={confirmation.link.href} target="_blank" rel="noreferrer" className="font-semibold text-[var(--color-primary-ink)] underline">{confirmation.link.label}<span className="sr-only"> (se abre en otra pestaña)</span></a>
                </p>
              )}
            </StepNotice>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        {(stepIndex > 0 || onBackFromFirst) && (
          <BigButton type="button" variant="secondary" onClick={goBack} disabled={submitting}>
            <ArrowLeft size={22} aria-hidden="true" /> Atrás
          </BigButton>
        )}
        {isReview ? (
          <BigButton type="button" className="flex-1" onClick={() => void send(confirmation ? { acknowledgeDuplicate: true } : {})} disabled={submitting || Object.values(compressing).some(Boolean)}>
            {submitting ? <><CircleNotch size={22} className="animate-spin" aria-hidden="true" /> Enviando…</> : confirmation ? "Registrar de todos modos" : "Enviar carga"}
          </BigButton>
        ) : (
          <BigButton type="button" className="flex-1" onClick={goNext}>
            Siguiente <ArrowRight size={22} aria-hidden="true" />
          </BigButton>
        )}
      </div>
    </div>
  )
}
