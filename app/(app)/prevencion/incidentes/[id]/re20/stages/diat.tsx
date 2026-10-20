"use client"

import * as React from "react"
import { CheckCircle, Clock, Info } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { formatDateTime } from "@/lib/utils"
import { recordPreventionIncidentNotificationAction } from "../../../actions"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import { re20DeadlineState, re20RelativeTime } from "../deadlines"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { withRe20TaskStatus } from "../workspace-data"
import { Re20Block, Re20DateTime, Re20Fact, Re20Text, Re20TextArea, Re20YesNo } from "../fields"
import { Re20SensitiveVeil } from "../sensitive-veil"

/* Etapa 3 — DIAT. El borrador interno junta lo que ya se sabe (no se vuelve a
 * escribir) y pide sólo lo que falta. La presentación al organismo
 * administrador reutiliza el carril «diat» de avisos legales del incidente
 * (`recordPreventionIncidentNotificationAction`), no un registro propio. */

const ID = (field: string) => `re20-diat-${field}`

const SEVERITY_OPTIONS = [
  { value: "grave", label: "Grave" },
  { value: "fatal", label: "Fatal" },
  { value: "other", label: "Otro" },
]
const SCOPE_OPTIONS = [
  { value: "work", label: "Accidente del trabajo" },
  { value: "commute", label: "Accidente de trayecto" },
]

const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined
const formText = (ws: Pick<Re20WorkspaceApi, "sensitive">, key: string) => {
  const value = ws.sensitive.diat.form[key]
  return typeof value === "string" ? value : ""
}

function diatLane(ws: Pick<Re20WorkspaceApi, "notifications">) {
  return ws.notifications.find((lane) => lane.notificationType === "diat") ?? null
}
const isPresented = (lane: ReturnType<typeof diatLane>) => lane !== null && ["sent", "acknowledged"].includes(lane.status)

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  if (!ws.sensitiveAvailable) return { done: 0, total: 0, missing: [] }
  const d = ws.sensitive.diat
  const form = d.form
  const checks: Array<{ ok: boolean; label: string; fieldId: string }> = [
    { ok: filled(d.severity), label: "Gravedad del accidente", fieldId: ID("severity") },
    { ok: filled(d.scope), label: "Si fue del trabajo o de trayecto", fieldId: ID("scope") },
    ...(d.scope === "commute" ? [{ ok: filled(d.commuteType), label: "Tipo de accidente de trayecto", fieldId: ID("commuteType") }] : []),
    { ok: filled(d.proofMedium), label: "Medio de prueba", fieldId: ID("proofMedium") },
    { ok: filled(form.activity), label: "Qué hacía la persona", fieldId: ID("activity") },
    { ok: typeof form.usualWork === "boolean", label: "Si hacía su trabajo habitual", fieldId: ID("usualWork") },
    { ok: isPresented(diatLane(ws)) || filled(d.sentAt), label: "Presentación al organismo administrador", fieldId: ID("block-presentation") },
  ]
  return {
    done: checks.filter((check) => check.ok).length,
    total: checks.length,
    missing: checks.filter((check) => !check.ok).map(({ label, fieldId }) => ({ label, fieldId })),
  }
}

function Presentation({ ws }: { ws: Re20WorkspaceApi }) {
  const lane = diatLane(ws)
  const [sentAt, setSentAt] = React.useState<string | null>(() => new Date(ws.now).toISOString())
  const [folio, setFolio] = React.useState("")
  const [administrator, setAdministrator] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const deadline = ws.deadlines.diat

  if (!lane) {
    return <p className="text-sm text-[var(--color-text-muted)]">Este evento no tiene un aviso DIAT abierto. Si corresponde presentarla, pide a Prevención de Riesgos que lo habilite.</p>
  }

  if (isPresented(lane)) {
    return (
      <Callout tone="success" icon={<CheckCircle weight="fill" className="size-4" />} title="DIAT presentada">
        <dl className="mt-1 grid gap-3 sm:grid-cols-3">
          <Re20Fact label="Fecha y hora" value={lane.sentAt ? formatDateTime(lane.sentAt) : "—"} mono />
          <Re20Fact label="Folio o comprobante" value={lane.evidenceReference ?? "—"} mono />
          <Re20Fact label="Plazo legal" value={lane.deadlineAt ? formatDateTime(lane.deadlineAt) : "—"} mono />
        </dl>
      </Callout>
    )
  }

  const canRegister = ws.permissions.canNotify && !ws.readOnly
  const valid = sentAt !== null && folio.trim().length >= 3

  async function register() {
    if (!valid || sentAt === null) return
    setBusy(true)
    const result = await ws.runServerAction(() => recordPreventionIncidentNotificationAction({
      incidentId: ws.incident.id,
      expectedVersion: ws.incident.version,
      notificationType: "diat",
      sentAt,
      evidenceReference: folio.trim(),
      administratorName: administrator.trim() || null,
    }), { successMessage: "Presentación de la DIAT registrada" })
    setBusy(false)
    if (result?.ok) void ws.save((data) => withRe20TaskStatus(data, "diat", "completed"))
  }

  const state = deadline ? re20DeadlineState(deadline.dueAt, ws.now) : null
  return (
    <div className="space-y-4">
      {deadline && (
        <p className={state === "overdue" || state === "soon" ? "flex items-center gap-1.5 text-sm text-[var(--color-signal-ink)]" : "text-sm text-[var(--color-text-muted)]"}>
          {(state === "overdue" || state === "soon") && <Clock aria-hidden weight="bold" className="size-4 shrink-0" />}
          <span>
            Plazo legal: {state === "overdue" ? "venció" : "vence"} el <span className="font-mono tabular-nums">{formatDateTime(deadline.dueAt)}</span> ({re20RelativeTime(deadline.dueAt, ws.now)})
          </span>
        </p>
      )}
      {canRegister ? (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">Cuando la DIAT ya esté presentada, anota aquí cuándo y con qué folio. Queda en el registro de avisos legales del caso.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Re20DateTime id={ID("sentAt")} label="Fecha y hora de presentación" required value={sentAt} onChange={setSentAt} />
            <Re20Text id={ID("folio")} label="Folio o comprobante" required value={folio} onChange={setFolio} maxLength={500} helper="Mínimo 3 caracteres." />
            <Re20Text id={ID("administrator")} label="Organismo administrador" value={administrator} onChange={setAdministrator} maxLength={300} placeholder="Por ejemplo: ACHS, Mutual, IST" />
          </div>
          <Button type="button" onClick={() => void register()} disabled={!valid || busy || !ws.online} loading={busy}>Registrar presentación</Button>
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">Aún no se registra la presentación. Solo quien tiene permiso para avisos legales puede anotarla.</p>
      )}
    </div>
  )
}

function DiatStage({ ws }: Re20StageProps) {
  const d = ws.sensitive.diat
  const p = ws.data.preliminary
  const lane = diatLane(ws)
  const injured = ws.involvedPeople.filter((person) => /accident|injur|lesion|afectad/i.test(person.relationshipType))
  const injuredNames = (injured.length > 0 ? injured : ws.involvedPeople.slice(0, 1)).map((person) => person.displayLabel).join(", ")
  const injuredDeclaration = ws.sensitive.declarations.find((item) => item.kind === "injured_person")
  const rut = injuredDeclaration?.nationalId?.trim() || null
  const set = (field: string) => (value: unknown) => ws.patchSensitive(["diat", field], value)
  const setForm = (field: string) => (value: unknown) => ws.patchSensitive(["diat", "form", field], value)
  const missing = progress(ws).missing
  const has = (fieldId: string) => !missing.some((item) => item.fieldId === fieldId)
  const classificationDone = ["severity", "scope", "proofMedium", "activity", "usualWork"].every((field) => has(ID(field))) && has(ID("commuteType"))

  return (
    <Re20SensitiveVeil title="Datos de la DIAT" description="La DIAT lleva el nombre y el RUT de la persona accidentada. Para verla, indica para qué la necesitas: queda registrado.">
      <div className="space-y-2">
        <Callout tone="info" icon={<Info weight="fill" className="size-4" />} title="Este es un borrador interno">
          <p>La DIAT válida es la que se presenta al organismo administrador dentro de 24 horas desde que se conoce el accidente.</p>
        </Callout>

        <div>
          <Re20Block id={ID("block-known")} title="Lo que ya sabemos" summary={`${injuredNames || "Sin persona registrada"} · ocurrió ${formatDateTime(ws.incident.occurredAt)}`} complete defaultOpen>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Re20Fact label="Persona accidentada" value={injuredNames || "Sin persona en el reporte"} />
              <Re20Fact label="RUT" value={rut ?? "Se anota en su declaración"} mono />
              <Re20Fact label="Hora de ocurrencia" value={formatDateTime(ws.incident.occurredAt)} mono />
              <Re20Fact label="Se conoció el accidente" value={formatDateTime(d.knownAt ?? ws.incident.knownAt)} mono />
              <Re20Fact label="Ingreso al turno" value={p.shiftEntryTime || "—"} mono />
              <Re20Fact label="Salida del turno" value={p.shiftExitTime || "—"} mono />
              <Re20Fact label="Lugar" value={ws.incident.location || "—"} />
            </dl>
            <div>
              <p className="text-xs text-[var(--color-text-subtle)]">Relato del informe preliminar</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-[var(--color-text)]">{p.eventDescription?.trim() || "Aún no hay relato. Se escribe en la etapa Aviso y preliminar."}</p>
            </div>
            <p className="text-xs text-[var(--color-text-subtle)]">Estos datos vienen del reporte y del preliminar. Si están mal, corrígelos allí.</p>
          </Re20Block>

          <Re20Block id={ID("block-classification")} title="Clasificación y trabajo" summary={classificationDone ? "Completo" : `Faltan ${missing.filter((item) => item.fieldId !== ID("block-presentation")).length}`} complete={classificationDone} defaultOpen={!classificationDone}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Gravedad" htmlFor={ID("severity")} required>
                <OptionSelect id={ID("severity")} options={SEVERITY_OPTIONS} value={d.severity ?? ""} onValueChange={(value) => set("severity")(value || null)} emptyLabel="Sin indicar" placeholder="Elige la gravedad" />
              </Field>
              <Field label="Origen del accidente" htmlFor={ID("scope")} required>
                <OptionSelect
                  id={ID("scope")}
                  options={SCOPE_OPTIONS}
                  value={d.scope ?? ""}
                  onValueChange={(value) => set("scope")(value || null)}
                  emptyLabel="Sin indicar"
                  placeholder="Trabajo o trayecto"
                />
              </Field>
              {d.scope === "commute" && (
                <Re20Text id={ID("commuteType")} label="Tipo de accidente de trayecto" required value={d.commuteType} onChange={set("commuteType")} maxLength={300} placeholder="Por ejemplo: a pie, en vehículo, en transporte público" className="md:col-span-2" />
              )}
              <Re20Text id={ID("proofMedium")} label="Medio de prueba" required value={d.proofMedium} onChange={set("proofMedium")} maxLength={500} placeholder="Por ejemplo: testigos, parte de Carabineros" />
              <Re20Text id={ID("proofDetail")} label="Detalle del medio de prueba" value={formText(ws, "proofDetail")} onChange={setForm("proofDetail")} maxLength={2000} />
            </div>
            <Re20TextArea id={ID("activity")} label="Qué hacía la persona al momento del accidente" required rows={3} value={formText(ws, "activity")} onChange={setForm("activity")} maxLength={2000} />
            <Re20YesNo id={ID("usualWork")} label="¿Hacía su trabajo habitual?" required value={typeof d.form.usualWork === "boolean" ? d.form.usualWork : null} onChange={setForm("usualWork")} />
            {d.form.usualWork === false && (
              <Re20TextArea id={ID("usualWorkDetail")} label="Cuál era su trabajo habitual" rows={2} value={formText(ws, "usualWorkDetail")} onChange={setForm("usualWorkDetail")} maxLength={2000} />
            )}
          </Re20Block>

          <Re20Block id={ID("block-presentation")} title="Presentación al organismo administrador" summary={isPresented(lane) ? `Presentada el ${lane?.sentAt ? formatDateTime(lane.sentAt) : "—"}` : "Aún no presentada"} complete={isPresented(lane)} defaultOpen={!isPresented(lane)}>
            <Presentation ws={ws} />
          </Re20Block>
        </div>
      </div>
    </Re20SensitiveVeil>
  )
}

export const diatStage: Re20StageModule = { Component: DiatStage, progress }
