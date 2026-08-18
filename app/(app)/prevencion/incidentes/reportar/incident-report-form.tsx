"use client"

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { CloudArrowUp, CloudSlash, Siren } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
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
  type OfflineIncidentReport,
} from "./offline-incident-queue"

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

export function IncidentReportForm({ worksites, defaultDate, defaultTime }: { worksites: WorksiteOption[]; defaultDate: string; defaultTime: string }) {
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

  const synchronize = useCallback(async () => {
    if (!navigator.onLine) return
    const result = await flushIncidentReportQueue(async (payload) => {
      // `ok: false` del servidor es un rechazo permanente (validación, alcance,
      // clave ya usada): la cola no debe gastar reintentos ni dejarlo como
      // pendiente eterno. `retriable: false` lo marca para que se muestre.
      const res = await reportPreventionIncidentAction(payload)
      return res.ok ? res : { ...res, retriable: false }
    })
    setQueued(result.pending)
    setRejected(result.rejected)
    if (result.synchronized > 0) toast.success(`${result.synchronized} reporte(s) offline sincronizado(s)`)
    if (result.rejected > 0) {
      toast.error(`${result.rejected} reporte(s) offline no se pudieron enviar y quedaron rechazados. Revísalos y vuelve a registrarlos.`)
    }
  }, [])

  useEffect(() => {
    window.addEventListener("online", synchronize)
    return () => window.removeEventListener("online", synchronize)
  }, [synchronize])

  // Si la página se abre ya con conexión, el evento "online" nunca dispara: un
  // reporte encolado en una sesión anterior quedaba en IndexedDB sin sincronizar
  // y sin siquiera mostrarse en el contador.
  useEffect(() => {
    let cancelled = false
    if (navigator.onLine) {
      void synchronize()
    } else {
      void listQueuedIncidentReports().then((reports) => {
        if (!cancelled) setQueued(reports.length)
      })
    }
    return () => { cancelled = true }
  }, [synchronize])

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
          offlineSync: !navigator.onLine,
          people: hasPerson && personLabel && personEmployer ? [{
            displayLabel: personLabel,
            employerName: personEmployer,
            relationshipType: eventType === "contractor_or_third_party" ? "contractor" : "employee",
            absenceAtLeastNormalShift: actualSeverity === "lost_time",
            absenceDays: 0,
            chargeDays: 0,
          }] : [],
        }

        if (!navigator.onLine) {
          await queueIncidentReport(payload)
          setQueued((count) => count + 1)
          // Sin limpiar, el formulario lleno invita a reenviar y el
          // `clientSubmissionId` se regenera en cada envío: entraría duplicado.
          form.reset()
          toast.success("Reporte guardado en este dispositivo; se sincronizará al recuperar conexión")
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
          await queueIncidentReport({ ...payload, offlineSync: true })
          setQueued((count) => count + 1)
          form.reset()
          toast.warning("La red falló: el reporte quedó en la cola offline")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo preparar el reporte")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${isOnline ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)]" : "border-[var(--color-warning-line)] bg-[var(--color-warning-tint)]"}`}>
        <div className="flex items-center gap-2">
          {isOnline ? <CloudArrowUp className="size-5" /> : <CloudSlash className="size-5" />}
          <span>{isOnline ? "Con conexión: el reporte se enviará ahora." : "Sin conexión: el reporte mínimo se guardará localmente en este navegador y se sincronizará después. No ingreses datos clínicos."}</span>
        </div>
        {(queued > 0 || isOnline) && (
          <Button type="button" size="sm" variant="secondary" onClick={synchronize} disabled={!isOnline || pending}>
            Sincronizar{queued > 0 ? ` (${queued})` : ""}
          </Button>
        )}
      </div>
      {rejected > 0 && (
        <p className="rounded-lg border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-3 text-sm">
          {rejected} reporte(s) guardado(s) en este dispositivo fueron rechazados por el servidor y no se
          enviarán. Vuelve a registrarlos con los datos corregidos.
        </p>
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
            <SelectTrigger><SelectValue /></SelectTrigger>
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
            <SelectTrigger><SelectValue /></SelectTrigger>
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
          <Siren className="size-4" /> {pending ? "Guardando…" : isOnline ? "Reportar incidente" : "Guardar para sincronizar"}
        </Button>
      </div>
    </form>
  )
}
