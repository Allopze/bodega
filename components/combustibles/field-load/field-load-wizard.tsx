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
import { StepReview } from "./step-review"
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

  React.useEffect(() => { headingRef.current?.focus() }, [step])

  const stepIndex = FIELD_LOAD_STEPS.findIndex((item) => item.id === step)
  const context = { config, draft, photos, driver, supervisor }

  function patch(changes: Partial<FieldLoadDraft>) {
    setDraft((current) => ({ ...current, ...changes }))
    setErrors({})
    setServerError(null)
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
    setStep(FIELD_LOAD_STEPS[stepIndex + 1]!.id)
  }

  function goBack() {
    setErrors({})
    if (stepIndex > 0) setStep(FIELD_LOAD_STEPS[stepIndex - 1]!.id)
  }

  function startOver() {
    discard()
    setDraft(initialDraft(config))
    setPhotos({})
    setErrors({})
    setServerError(null)
    setStep("vehicle")
    setResumed(false)
    clientIdRef.current = null
    driver.clear()
    supervisor.clear()
  }

  async function send() {
    const invalid = firstInvalidStep(context)
    if (invalid) {
      setStep(invalid)
      setErrors(validateStep(invalid, context))
      return
    }
    if (Object.values(compressing).some(Boolean)) return
    clientIdRef.current ??= newClientId()
    const payload = buildPayload({ config, draft, driver, supervisor, clientSubmissionId: clientIdRef.current })
    setSubmitting(true)
    setServerError(null)
    try {
      const outcome = await submit(payload, buildEvidence(draft, photos))
      onOutcome?.(outcome, resumed)
      if (outcome.kind === "rejected") {
        setServerError(outcome.message)
        setStep(stepForServerField(outcome.field))
        return
      }
      if (outcome.kind === "failed") { setServerError(outcome.message); return }
      if (outcome.kind === "queued") {
        toast.success("Carga guardada en este teléfono. Se enviará sola cuando haya conexión.")
        startOver()
        return
      }
      discard()
      if (outcome.href) { router.push(outcome.href); return }
      setSent(true)
    } finally { setSubmitting(false) }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center" role="status">
        <CheckCircle size={56} weight="fill" aria-hidden="true" className="mx-auto text-[var(--color-success)]" />
        <h2 className="text-2xl font-semibold">Carga registrada</h2>
        <p className="text-base text-[var(--color-text-muted)]">Quedó guardada con la fecha y hora de la plataforma.</p>
        <BigButton type="button" className="w-full" onClick={() => { setSent(false); startOver() }}>Registrar otra carga</BigButton>
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
  const progress = ((stepIndex + 1) / FIELD_LOAD_STEPS.length) * 100

  return (
    <div className="flex flex-col gap-5" aria-busy={submitting}>
      <div>
        <p className="text-base font-semibold text-[var(--color-text-muted)]" aria-live="polite">Paso {stepIndex + 1} de {FIELD_LOAD_STEPS.length}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-label="Avance del formulario" aria-valuemin={1} aria-valuemax={FIELD_LOAD_STEPS.length} aria-valuenow={stepIndex + 1}>
          <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${progress}%` }} />
        </div>
        <h2 ref={headingRef} tabIndex={-1} className="mt-3 text-2xl font-semibold outline-none">{FIELD_LOAD_STEPS[stepIndex]!.title}</h2>
      </div>

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
        {isReview && <StepReview {...viewProps} goTo={(target) => { setErrors({}); setStep(target) }} loadingPointName={config.loadingPoint?.name ?? null} />}
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        {stepIndex > 0 && (
          <BigButton type="button" variant="secondary" onClick={goBack} disabled={submitting}>
            <ArrowLeft size={22} aria-hidden="true" /> Atrás
          </BigButton>
        )}
        {isReview ? (
          <BigButton type="button" className="flex-1" onClick={() => void send()} disabled={submitting || Object.values(compressing).some(Boolean)}>
            {submitting ? <><CircleNotch size={22} className="animate-spin" aria-hidden="true" /> Enviando…</> : "Enviar carga"}
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
