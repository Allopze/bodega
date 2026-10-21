"use client"

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { CloudArrowUp, CloudSlash, Siren } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { reportPreventionIncidentAction } from "../actions"
import {
  createIncidentSubmissionId,
  flushIncidentReportQueue,
  listQueuedIncidentReports,
  queueIncidentReport,
  migrateLegacyIncidentReportQueue,
  discardQueuedIncidentReport,
  type QueueEntry,
  type OfflineIncidentReport,
} from "./offline-incident-queue"
import { putRe20OfflineDraft } from "@/lib/prevention/re20-offline-drafts"

interface WorksiteOption {
  id: string
  name: string
  code: string
}

const EVENT_TYPES = [
  ["dangerous_incident", "Incidente o suceso peligroso"],
  ["work_accident", "Accidente del trabajo"],
  ["commute_accident", "Accidente de trayecto"],
  ["suspected_occupational_disease", "Presunta enfermedad profesional"],
  ["material_damage", "Daño material"],
  ["environmental_spill", "Daño ambiental o derrame"],
  ["vehicle_event", "Evento vehicular"],
  ["contractor_or_third_party", "Contratista o tercero"],
] as const

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function getOnlineSnapshot() {
  return navigator.onLine
}

function getServerOnlineSnapshot() {
  return true
}

function localDateTimeToIso(date: string, time: string) {
  const value = new Date(`${date}T${time || "00:00"}:00`)
  if (Number.isNaN(value.getTime())) throw new Error("Fecha u hora inválida.")
  return value.toISOString()
}

export function IncidentReportForm({ worksites, defaultDate, defaultTime, userId, offlineOnly = false }: { worksites: WorksiteOption[]; defaultDate: string; defaultTime: string; userId: string; offlineOnly?: boolean }) {
  const router = useRouter()
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot)
  const [pending, startTransition] = useTransition()
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number][0]>("dangerous_incident")
  const [occurredDate, setOccurredDate] = useState(defaultDate)
  const [occurredTime, setOccurredTime] = useState(defaultTime)
  const [knownDate, setKnownDate] = useState(defaultDate)
  const [knownTime, setKnownTime] = useState(defaultTime)
  const [actualSeverity, setActualSeverity] = useState<OfflineIncidentReport["actualSeverity"]>("none")
  const [potentialSeverity, setPotentialSeverity] = useState<OfflineIncidentReport["potentialSeverity"]>("low")
  const [operationsSuspended, setOperationsSuspended] = useState(false)
  const [evacuated, setEvacuated] = useState(false)
  const [hasPerson, setHasPerson] = useState(false)
  const [queued, setQueued] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [queuedEntries, setQueuedEntries] = useState<QueueEntry[]>([])

  /** Lo guardado en este equipo: `queued` son los que esperan señal; los rechazados por el servidor se cuentan aparte. */
  const refreshLocalQueue = useCallback(async () => {
    const entries = await listQueuedIncidentReports(userId)
    setQueuedEntries(entries)
    setQueued(entries.filter((entry) => !entry.rejected).length)
    setRejected(entries.filter((entry) => entry.rejected).length)
  }, [userId])

  const synchronize = useCallback(async () => {
    if (!navigator.onLine || offlineOnly) return
    const result = await flushIncidentReportQueue(userId, async (payload) => {
      // `ok: false` del servidor es un rechazo permanente (validación, alcance,
      // clave ya usada): la cola no debe gastar reintentos ni dejarlo como
      // pendiente eterno. `retriable: false` lo marca para que se muestre.
      const res = await reportPreventionIncidentAction(payload)
      return res.ok ? res : { ...res, retriable: false }
    })
    await refreshLocalQueue()
    if (result.synchronized > 0) toast.success(`${result.synchronized} ${result.synchronized === 1 ? "reporte guardado sin conexión se envió" : "reportes guardados sin conexión se enviaron"}`)
    if (result.rejected > 0) {
      toast.error(`${result.rejected} ${result.rejected === 1 ? "reporte guardado no se pudo enviar y quedó rechazado" : "reportes guardados no se pudieron enviar y quedaron rechazados"}. Revísalos y vuelve a registrarlos.`)
    }
  }, [userId, offlineOnly, refreshLocalQueue])

  // Cuando vuelve la señal, lo guardado en este equipo se envía solo.
  useEffect(() => {
    const onOnline = () => { void synchronize().catch(() => {}) }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [synchronize])

  // Las faenas quedan guardadas para poder reportar desde la pantalla sin conexión.
  useEffect(() => {
    if (offlineOnly) return
    void putRe20OfflineDraft(userId, {
      id: "incident-report-config",
      kind: "incident_report_config",
      payload: { worksites, defaultDate, defaultTime },
      attempts: 0,
    }).catch(() => {})
  }, [userId, offlineOnly, worksites, defaultDate, defaultTime])

  // Si la página se abre ya con conexión, el evento "online" nunca dispara: un
  // reporte guardado en una sesión anterior quedaba en IndexedDB sin enviar y
  // sin siquiera mostrarse. Al cargar se pasa la cola antigua al almacén de
  // esta persona, se muestra lo pendiente y, con conexión, se envía.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!offlineOnly) await migrateLegacyIncidentReportQueue(userId).catch(() => 0)
      if (cancelled) return
      await refreshLocalQueue()
      if (!cancelled && !offlineOnly && navigator.onLine) await synchronize()
    })().catch(() => {})
    return () => { cancelled = true }
  }, [userId, offlineOnly, refreshLocalQueue, synchronize])

  // `onSubmit` y no `action=`: React 19 pide el reset del formulario ANTES de
  // correr la acción, así que con `action={handleSubmit}` un rechazo del
  // servidor ({ ok: false }: hora de conocimiento anterior a la ocurrencia,
  // grave/fatal sin operación suspendida…) borraba el relato ya escrito. Acá el
  // reset se repone a mano sólo cuando el reporte fue aceptado o encolado.
  // Sin JS este formulario no puede funcionar de todos modos: faena, tipo,
  // fechas, gravedades y los checkboxes son estado de React y nunca entran al
  // FormData.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // `event.currentTarget` se anula al terminar el evento; la referencia local no.
    const form = event.currentTarget
    const formData = new FormData(form)
    startTransition(async () => {
      try {
        const fatalOrSerious = ["serious", "fatal"].includes(actualSeverity)
        const personLabel = String(formData.get("personLabel") ?? "").trim()
        const personEmployer = String(formData.get("personEmployer") ?? "").trim()
        const payload: OfflineIncidentReport = {
          clientSubmissionId: createIncidentSubmissionId(),
          worksiteId,
          companyName: String(formData.get("companyName") ?? ""),
          eventType,
          occurredAt: localDateTimeToIso(occurredDate, occurredTime),
          knownAt: localDateTimeToIso(knownDate, knownTime),
          location: String(formData.get("location") ?? ""),
          initialNarrative: String(formData.get("initialNarrative") ?? ""),
          actualSeverity,
          potentialSeverity,
          immediateMeasures: String(formData.get("immediateMeasures") ?? "").trim() || null,
          operationsSuspended,
          evacuated,
          isFatalOrSerious: fatalOrSerious,
          offlineSync: offlineOnly || !navigator.onLine,
          people: hasPerson && personLabel && personEmployer ? [{
            displayLabel: personLabel,
            employerName: personEmployer,
            relationshipType: eventType === "contractor_or_third_party" ? "contractor" : "employee",
            absenceAtLeastNormalShift: actualSeverity === "lost_time",
            absenceDays: 0,
            chargeDays: 0,
          }] : [],
        }

        if (offlineOnly || !navigator.onLine) {
          await queueIncidentReport(userId, payload)
          await refreshLocalQueue().catch(() => {})
          // Sin limpiar, el formulario lleno invita a reenviar y el
          // `clientSubmissionId` se regenera en cada envío: entraría duplicado.
          form.reset()
          toast.success(offlineOnly
            ? "Reporte guardado en este equipo; se enviará cuando abras la aplicación con conexión."
            : "Reporte guardado en este equipo; se enviará solo al volver la conexión.")
          return
        }
        try {
          const result = await reportPreventionIncidentAction(payload)
          if (!result.ok) {
            toast.error(result.message)
            return
          }
          form.reset()
          toast.success(result.message)
          if (result.incidentId) router.push(`/prevencion/incidentes/${result.incidentId}`)
        } catch (error) {
          // Sólo se encola ante un fallo de RED. El `catch` era ciego, así que
          // una excepción del servidor dejaba encolado un reporte que iba a ser
          // rechazado en cada reintento. Mismo predicado que el camino PPA.
          const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
          const isNetworkError = !navigator.onLine
            || /failed to fetch|networkerror|network request failed|load failed/i.test(message)
          if (!isNetworkError) {
            toast.error(message || "No se pudo enviar el reporte")
            return
          }
          await queueIncidentReport(userId, { ...payload, offlineSync: true })
          await refreshLocalQueue().catch(() => {})
          form.reset()
          toast.warning("La red falló: el reporte quedó guardado en este equipo y se enviará solo al volver la conexión.")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo preparar el reporte")
      }
    })
  }

  const offlineMode = offlineOnly || !isOnline
  const pendingLabel = `${queued} ${queued === 1 ? "reporte guardado" : "reportes guardados"} en este equipo`

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Avisos sólo cuando corresponden: sin conexión o con reportes guardados esperando. */}
      {(offlineMode || queued > 0) && (
        <Callout tone="info" role="status" icon={offlineMode ? <CloudSlash className="size-5" /> : <CloudArrowUp className="size-5" />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              {offlineMode && (
                <p>
                  {offlineOnly
                    ? "Lo que escribas se guarda en este equipo y se envía cuando abras la aplicación con conexión."
                    : "Sin conexión: lo que escribas se guarda en este equipo y se envía al volver la señal. No cierres sesión hasta entonces."}
                </p>
              )}
              {queued > 0 && <p>{offlineMode ? `${pendingLabel}, se enviarán al volver la conexión.` : `${pendingLabel}, sin enviar.`}</p>}
            </div>
            {queued > 0 && !offlineMode && (
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void synchronize().catch(() => {})}>
                Enviar ahora
              </Button>
            )}
          </div>
        </Callout>
      )}
      {rejected > 0 && (
        <Callout tone="danger" role="alert">
          {rejected} {rejected === 1 ? "reporte fue rechazado" : "reportes fueron rechazados"} por el servidor. Siguen guardados en este equipo hasta que los descartes expresamente.
        </Callout>
      )}
      {queuedEntries.length > 0 && (
        <ul className="space-y-2">
          {queuedEntries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
              <div>
                <p className="font-medium">Reporte en {entry.payload.location || "lugar sin indicar"}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Guardado {formatDateTime(entry.createdAt)}{entry.rejected ? " · rechazado por el servidor" : entry.attempts > 0 ? ` · ${entry.attempts} ${entry.attempts === 1 ? "intento" : "intentos"}` : ""}{entry.lastError ? ` · ${entry.lastError}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  try {
                    await discardQueuedIncidentReport(userId, entry.id)
                    await refreshLocalQueue()
                    toast.success("Reporte guardado descartado")
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "No se pudo descartar el reporte guardado")
                  }
                }}
              >
                Descartar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="incident-worksite">Faena</Label>
          <Select value={worksiteId} onValueChange={setWorksiteId} required>
            <SelectTrigger id="incident-worksite"><SelectValue placeholder="Seleccionar faena" /></SelectTrigger>
            <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.code}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="incident-company">Empresa o empleador</Label>
          <Input id="incident-company" name="companyName" required minLength={2} placeholder="Razón social" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="incident-type">Tipo de evento</Label>
          <Select value={eventType} onValueChange={(value) => setEventType(value as typeof eventType)} required>
            <SelectTrigger id="incident-type"><SelectValue /></SelectTrigger>
            <SelectContent>{EVENT_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Ocurrencia</Label>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <DatePicker value={occurredDate} onChange={setOccurredDate} max={defaultDate} />
            <Input aria-label="Hora de ocurrencia" type="time" value={occurredTime} onChange={(event) => setOccurredTime(event.target.value)} required />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Conocimiento</Label>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <DatePicker value={knownDate} onChange={setKnownDate} max={defaultDate} />
            <Input aria-label="Hora de conocimiento" type="time" value={knownTime} onChange={(event) => setKnownTime(event.target.value)} required />
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="incident-location">Lugar exacto</Label>
          <Input id="incident-location" name="location" required minLength={2} placeholder="Área, frente o referencia operacional" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="incident-narrative">¿Qué ocurrió?</Label>
          <Textarea id="incident-narrative" name="initialNarrative" required minLength={10} rows={5} placeholder="Relato factual inicial, sin conclusiones ni diagnósticos" />
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Gravedad real conocida</Label>
          <Select value={actualSeverity} onValueChange={setActualSeverity}>
            <SelectTrigger aria-label="Gravedad real conocida"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin lesión conocida</SelectItem>
              <SelectItem value="minor">Menor</SelectItem>
              <SelectItem value="medical_treatment">Tratamiento médico</SelectItem>
              <SelectItem value="lost_time">Con tiempo perdido</SelectItem>
              <SelectItem value="serious">Grave</SelectItem>
              <SelectItem value="fatal">Fatal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Gravedad potencial</Label>
          <Select value={potentialSeverity} onValueChange={setPotentialSeverity}>
            <SelectTrigger aria-label="Gravedad potencial"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baja</SelectItem>
              <SelectItem value="medium">Media</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="critical">Crítica</SelectItem>
              <SelectItem value="fatal">Fatal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="incident-measures">Medidas inmediatas</Label>
          <Textarea id="incident-measures" name="immediateMeasures" rows={3} required={["serious", "fatal"].includes(actualSeverity)} placeholder="Primeros auxilios, aislamiento, contención, detención u otras medidas" />
        </div>
        <Checkbox label="Operación suspendida" checked={operationsSuspended} onChange={(event) => setOperationsSuspended(event.target.checked)} />
        <Checkbox label="Hubo evacuación" checked={evacuated} onChange={(event) => setEvacuated(event.target.checked)} />
      </section>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <Checkbox label={<span className="font-medium">Hay una persona involucrada</span>} checked={hasPerson} onChange={(event) => setHasPerson(event.target.checked)} />
        {hasPerson && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="person-label">Referencia mínima</Label><Input id="person-label" name="personLabel" required placeholder="Ej. Trabajador involucrado 1" /></div>
            <div className="space-y-2"><Label htmlFor="person-employer">Empleador</Label><Input id="person-employer" name="personEmployer" required defaultValue="" /></div>
            <p className="text-xs text-[var(--color-text-subtle)] md:col-span-2">La identificación, lesión y antecedentes de salud se completan sólo en la vista reservada, con propósito y permiso nominativo.</p>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !worksiteId}>
          <Siren className="size-4" /> {pending ? "Guardando…" : offlineOnly ? "Guardar en este equipo" : isOnline ? "Reportar incidente" : "Guardar para enviar después"}
        </Button>
      </div>
    </form>
  )
}
