"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { BigButton, StepNotice } from "@/components/combustibles/field-load/big-controls"
import { FieldLoadWizard } from "@/components/combustibles/field-load/field-load-wizard"
import { StepHeader } from "@/components/combustibles/field-load/step-header"
import { FIELD_LOAD_STEPS, type FieldLoadConfig, type FieldLoadPastLoad, type FieldLoadSubmitter, type SubmitOutcome } from "@/components/combustibles/field-load/types"
import { checkPastLoad } from "@/lib/combustibles/field-load-rules"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { CHILE_LOCAL_DATE_TIME_PATTERN } from "@/lib/validation/fuel-tae"
import { chileLocalDateTimeToUtc, formatDateTime } from "@/lib/utils"
import { EMPTY_OTRO_DIA, OtroDia, type OtroDiaValue } from "./otro-dia"
import { useOtroDiaMemory } from "./memoria-otro-dia"
import { RegistrarPicker } from "./registrar-picker"
import { RegistrarResultado, type RegistroResult } from "./registrar-resultado"

interface Option { id: string; name: string }

interface ApiBody {
  ok?: boolean
  code?: string
  message?: string
  field?: string
  data?: RegistroResult
  duplicateOf?: { href: string }
}

/** Un paso más que los del formulario de terreno: el «Dónde» que va primero. */
const STEPS_BEFORE = 1

/** El instante de una hora de Chile escrita a medias: `null` mientras no tenga la forma completa. */
function instantOf(local: string): string | null {
  return CHILE_LOCAL_DATE_TIME_PATTERN.test(local) ? chileLocalDateTimeToUtc(local) : null
}

/**
 * Registro autenticado de una carga: «Dónde» (faena y punto de carga, y si la
 * carga es de otro día) y después el mismo formulario por pasos que usa el QR,
 * enviado directo a la API con la sesión. La faena y el punto viajan en la URL
 * (`?faena=&punto=`) porque los equipos del paso siguiente dependen de ellos.
 */
export function RegistrarForm({
  worksites,
  points,
  worksiteId,
  pointId,
  config,
  pastWindow,
  canView,
}: {
  worksites: Option[]
  points: Array<Option & { worksiteId: string }>
  /** Lo que la página resolvió de la URL (y del alcance) como faena y punto. */
  worksiteId: string
  pointId: string
  /** El formulario de esa faena y punto; `null` mientras no estén elegidos. */
  config: FieldLoadConfig | null
  /** Sólo con `combustibles:register_past_load`: el rango en que se puede fechar una carga de otro día. */
  pastWindow: { earliestDay: string; latestDay: string } | null
  canView: boolean
}) {
  const router = useRouter()
  const [phase, setPhase] = React.useState<"where" | "load">("where")
  const [selection, setSelection] = React.useState({ worksiteId, pointId })
  const [seenProps, setSeenProps] = React.useState({ worksiteId, pointId })
  const [otroDia, setOtroDia] = React.useState<OtroDiaValue>(EMPTY_OTRO_DIA)
  const [whereErrors, setWhereErrors] = React.useState<Record<string, string>>({})
  const [selecting, startSelecting] = React.useTransition()
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const leftWhere = React.useRef(false)

  // La URL manda: cuando la página vuelve con otra faena o punto, la selección la sigue.
  if (seenProps.worksiteId !== worksiteId || seenProps.pointId !== pointId) {
    setSeenProps({ worksiteId, pointId })
    setSelection({ worksiteId, pointId })
  }

  const scopeKey = `internal:${selection.worksiteId}:${selection.pointId}`
  const memory = useOtroDiaMemory({ scopeKey, value: otroDia, onRestore: setOtroDia })

  const configReady = config != null && config.worksite.id === selection.worksiteId && config.loadingPoint?.id === selection.pointId
  const pastLoad: FieldLoadPastLoad | null = pastWindow && otroDia.open ? { loadedAt: otroDia.loadedAt, reason: otroDia.reason } : null

  function choose(next: { worksiteId: string; pointId: string }) {
    setSelection(next)
    setWhereErrors({})
    const params = new URLSearchParams()
    if (next.worksiteId) params.set("faena", next.worksiteId)
    if (next.pointId) params.set("punto", next.pointId)
    // Cambiar la faena o el punto es un cambio de vista, no una navegación: sin historial ni salto de scroll.
    startSelecting(() => { router.replace(`${FUEL_PATHS.registrar}${params.size ? `?${params}` : ""}`, { scroll: false }) })
  }

  function continueFromWhere() {
    const errors: Record<string, string> = {}
    if (!selection.worksiteId) errors.worksiteId = "Elige la faena donde cargaste."
    else if (!selection.pointId) errors.pointId = "Elige el punto de carga."
    if (pastLoad) {
      const check = checkPastLoad(pastLoad)
      if (!check.ok) errors[check.issue.field === "pastLoadReason" ? "reason" : "loadedAt"] = check.issue.message
    }
    setWhereErrors(errors)
    if (Object.keys(errors).length > 0 || !configReady) return
    leftWhere.current = true
    setPhase("load")
  }

  const submit = React.useCallback<FieldLoadSubmitter>(async (payload, evidence) => {
    const form = new FormData()
    form.set("payload", JSON.stringify(payload))
    for (const item of evidence) form.set(item.kind, new File([item.blob], item.fileName, { type: item.blob.type }))
    try {
      const response = await fetch("/api/combustibles/cargas", { method: "POST", body: form })
      const body = await response.json().catch(() => ({})) as ApiBody
      if (response.ok && body.ok && body.data) return { kind: "sent", detail: body.data }
      // Una carga parecida a otra del mismo equipo: se muestra la otra y se deja seguir.
      if (response.status === 422 && body.code === "possible_duplicate") {
        return { kind: "confirm", message: body.message ?? "Ya hay una carga muy parecida de este equipo.", link: body.duplicateOf ? { href: body.duplicateOf.href, label: "Ver la otra carga" } : undefined }
      }
      // 4xx: el dato hay que corregirlo; 5xx o sin respuesta: se puede reintentar tal cual.
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        return { kind: "rejected", message: body.message ?? "La plataforma rechazó la carga.", field: body.field }
      }
      return { kind: "failed", message: body.message ?? "No se pudo enviar. Vuelve a intentarlo en un momento." }
    } catch {
      return { kind: "failed", message: "No se pudo enviar. Revisa tu conexión y vuelve a intentarlo: tus datos siguen aquí." }
    }
  }, [])

  const identityTransport = React.useMemo(
    () => ({ url: "/api/combustibles/cargas/identidad", body: (rut: string) => ({ worksiteId: selection.worksiteId, rut }) }),
    [selection.worksiteId],
  )

  function handleOutcome(outcome: SubmitOutcome) {
    if (outcome.kind === "sent") memory.clear()
    // La fecha o el motivo de una carga de otro día se corrigen en el paso 1, no en el resumen.
    if (outcome.kind === "rejected" && outcome.field?.startsWith("pastLoad")) {
      setWhereErrors({ [outcome.field === "pastLoadReason" ? "reason" : "loadedAt"]: outcome.message })
      setPhase("where")
    }
  }

  const pastInstant = pastLoad ? instantOf(pastLoad.loadedAt) : null
  const selectedWorksite = worksites.find((worksite) => worksite.id === selection.worksiteId)
  const selectedPoint = points.find((point) => point.id === selection.pointId)
  const whereLabel = [selectedWorksite?.name, selectedPoint?.name].filter(Boolean).join(" · ")
  const reviewRows = [
    { label: "Dónde", value: whereLabel || "—", onEdit: () => setPhase("where") },
    ...(pastInstant ? [{ label: "Fecha de la carga", value: formatDateTime(pastInstant), onEdit: () => setPhase("where") }] : []),
  ]

  // Al volver al paso 1 el foco va al título, como en cada paso del formulario (no al abrir la página).
  React.useEffect(() => { if (phase === "where" && leftWhere.current) headingRef.current?.focus() }, [phase])

  return (
    <div className="mx-auto w-full max-w-lg">
      {phase === "where" && (
        <div className="flex flex-col gap-5">
          <StepHeader position={1} total={FIELD_LOAD_STEPS.length + STEPS_BEFORE} title="Dónde" headingRef={headingRef} />
          <p className="text-base text-[var(--color-text-muted)]">¿Dónde estás cargando? Si la faena tiene un solo punto de carga, se elige solo.</p>
          <RegistrarPicker
            worksites={worksites}
            points={points}
            worksiteId={selection.worksiteId}
            pointId={selection.pointId}
            onChange={choose}
            errors={{ worksiteId: whereErrors.worksiteId, pointId: whereErrors.pointId }}
          />
          {pastWindow && (
            <OtroDia
              value={otroDia}
              onChange={(next) => { setOtroDia(next); setWhereErrors((current) => ({ ...current, loadedAt: "", reason: "" })) }}
              window={pastWindow}
              errors={{ loadedAt: whereErrors.loadedAt, reason: whereErrors.reason }}
            />
          )}
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            {selection.worksiteId && selection.pointId && !configReady && (
              selecting
                ? <p role="status" className="text-sm text-[var(--color-text-muted)]">Cargando los equipos de la faena…</p>
                : <StepNotice tone="danger">No se pudieron cargar los equipos de esta faena. Vuelve a elegir el punto de carga o recarga la página.</StepNotice>
            )}
            <BigButton type="button" className="w-full" onClick={continueFromWhere} disabled={Boolean(selection.worksiteId && selection.pointId) && !configReady}>
              Siguiente
            </BigButton>
          </div>
        </div>
      )}
      {config && configReady && (
        <div hidden={phase !== "load"}>
          <FieldLoadWizard
            key={scopeKey}
            config={config}
            scopeKey={scopeKey}
            submit={submit}
            identityTransport={identityTransport}
            onOutcome={handleOutcome}
            stepsBefore={STEPS_BEFORE}
            onBackFromFirst={() => setPhase("where")}
            active={phase === "load"}
            pastLoad={pastLoad}
            reviewRows={reviewRows}
            timingNote={pastLoad
              ? "Esta carga queda con la fecha y la hora que indicaste. La plataforma guarda además el día en que la ingresas y el motivo."
              : "Al enviar, la plataforma registra la fecha y la hora."}
            onStartOver={() => { setOtroDia(EMPTY_OTRO_DIA); memory.clear() }}
            renderSent={({ detail, restart }) => (
              <RegistrarResultado
                result={detail as RegistroResult}
                worksiteId={selection.worksiteId}
                pastLoadedAt={pastInstant}
                canView={canView}
                onRestart={() => { setOtroDia(EMPTY_OTRO_DIA); setPhase("where"); restart() }}
              />
            )}
          />
        </div>
      )}
    </div>
  )
}
