"use client"

import { useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { INCIDENT_STATUS_LABELS, notificationStatusLabel } from "@/lib/prevention/incidents"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"
import { formatDateTime } from "@/lib/utils"
import {
  addPreventionIncidentEvidenceAction,
  authorizePreventionIncidentRestartAction,
  classifyIncidentPersonForIndicatorsAction,
  createPreventionIncidentCapaAction,
  recordPreventionIncidentNotificationAction,
  savePreventionIncidentInvestigationAction,
  transitionPreventionIncidentAction,
  triagePreventionIncidentAction,
} from "../actions"

interface IncidentSnapshot {
  id: string
  status: string
  version: number
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
  operationsSuspended: boolean
  evacuated: boolean
  immediateMeasures: string | null
}

interface Lane {
  id: string
  notificationType: string
  deadlineAt: string | null
  status: string
  evidenceReference: string | null
  sentAt: string | null
  escalatedAt: string | null
  restartAuthorizedAt: string | null
}

interface CapaItem {
  id: string
  code: string
  status: string
}

interface IncidentPersonForIndicators {
  id: string
  displayLabel: string
  absenceAtLeastNormalShift: boolean
  absenceDays: number
  absenceStartDate?: string | null
  returnToWorkDate?: string | null
  chargeDays: number
  administratorQualification: string | null
  indicatorInclusionStatus: string
  version: number
}

/** Lo guardado de la investigación que el formulario precarga y reenvía. */
export interface IncidentInvestigationSnapshot {
  id: string
  status: string
  methodology: string
  team: Array<{ userId: string; role: string }>
  evidenceSummary: string | null
  immediateCauses: string[]
  basicCauses: string[]
  organizationalCauses: string[]
  failedControls: string[]
  conclusions: string | null
  miperUpdateRequired: boolean
  miperUpdatedAt: string | null
  procedureUpdateRequired: boolean
  procedureUpdatedAt: string | null
  trainingRequired: boolean
  trainingCompletedAt: string | null
}

interface Props {
  incident: IncidentSnapshot
  notifications: Lane[]
  investigation: IncidentInvestigationSnapshot | null
  capa: CapaItem[]
  people: IncidentPersonForIndicators[]
  responsibles: Array<{ id: string; name: string; email: string }>
  currentUser: { id: string; name: string }
  permissions: string[]
  defaultTargetDate: string
}

const NEXT_STATUS: Partial<Record<IncidentStatus, IncidentStatus>> = {
  triage: "immediate_measures",
  under_investigation: "pending_capa",
  pending_capa: "pending_verification",
  pending_verification: "closed",
}

function splitLines(value: FormDataEntryValue | null) {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
}

/*
 * Los formularios envían con `onSubmit` y no con `action={fn}`: React reinicia
 * un formulario con `action` al terminar, también cuando el servidor lo rechaza,
 * y se perdía lo tecleado; las `Select` no controladas, además, quedaban
 * mostrando una opción y enviando la del montaje. Tras un guardado exitoso, la
 * clave por versión vuelve a montar el formulario con lo que quedó guardado.
 */
function onSubmitWith(handler: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handler(new FormData(event.currentTarget))
  }
}

export function IncidentWorkflowPanel({ incident, notifications, investigation, capa, people, responsibles, currentUser, permissions, defaultTargetDate }: Props) {
  const [pending, startTransition] = useTransition()
  const [actualSeverity, setActualSeverity] = useState(incident.actualSeverity)
  const [potentialSeverity, setPotentialSeverity] = useState(incident.potentialSeverity)
  const [fatalOrSerious, setFatalOrSerious] = useState(incident.isFatalOrSerious)
  const [operationsSuspended, setOperationsSuspended] = useState(incident.operationsSuspended)
  const [evacuated, setEvacuated] = useState(incident.evacuated)
  const [responsibleId, setResponsibleId] = useState(responsibles[0]?.id ?? "unassigned")
  const [targetDate, setTargetDate] = useState(defaultTargetDate)

  const can = (permission: string) => permissions.includes(permission)
  function run(operation: () => Promise<{ ok: boolean; message?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(result.message)
        onSuccess?.()
      } else toast.error(result.message)
    })
  }

  const next = NEXT_STATUS[incident.status as IncidentStatus]
  return (
    <div className="space-y-4">
      {incident.status === "reported" && can("prevention:incidents:triage") && (
        <details open className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer font-semibold">Realizar triage</summary>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={onSubmitWith((formData) => run(() => triagePreventionIncidentAction({
            incidentId: incident.id,
            expectedVersion: incident.version,
            actualSeverity,
            potentialSeverity,
            isFatalOrSerious: fatalOrSerious || ["serious", "fatal"].includes(actualSeverity),
            operationsSuspended,
            evacuated,
            immediateMeasures: String(formData.get("immediateMeasures") ?? ""),
            notificationResponsibleUserId: responsibleId === "unassigned" ? null : responsibleId,
            administratorName: String(formData.get("administratorName") ?? "") || null,
            reason: String(formData.get("reason") ?? ""),
          })))}>
            <div className="space-y-2"><Label>Gravedad real</Label><Select value={actualSeverity} onValueChange={setActualSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin lesión</SelectItem><SelectItem value="minor">Menor</SelectItem><SelectItem value="medical_treatment">Tratamiento médico</SelectItem><SelectItem value="lost_time">Tiempo perdido</SelectItem><SelectItem value="serious">Grave</SelectItem><SelectItem value="fatal">Fatal</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Gravedad potencial</Label><Select value={potentialSeverity} onValueChange={setPotentialSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baja</SelectItem><SelectItem value="medium">Media</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem><SelectItem value="fatal">Fatal</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Responsable DIAT/DIEP</Label><Select value={responsibleId} onValueChange={setResponsibleId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Sin asignar (requiere regularización)</SelectItem>{responsibles.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="administrator">Organismo administrador</Label><Input id="administrator" name="administratorName" placeholder="Mutualidad / ISL" /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="triage-measures">Medidas inmediatas</Label><Textarea id="triage-measures" name="immediateMeasures" required defaultValue={incident.immediateMeasures ?? ""} rows={3} /></div>
            <Checkbox label="Clasificación fatal/grave" checked={fatalOrSerious} onChange={(event) => setFatalOrSerious(event.target.checked)} />
            <Checkbox label="Operación suspendida" checked={operationsSuspended} onChange={(event) => setOperationsSuspended(event.target.checked)} />
            <Checkbox label="Evacuación" checked={evacuated} onChange={(event) => setEvacuated(event.target.checked)} />
            <div className="space-y-2 md:col-span-2"><Label htmlFor="triage-reason">Fundamento de clasificación</Label><Input id="triage-reason" name="reason" required minLength={5} /></div>
            <div className="md:col-span-2"><Button type="submit" disabled={pending}>Guardar triage</Button></div>
          </form>
        </details>
      )}

      {next && incident.status !== "pending_verification" && can(next === "immediate_measures" ? "prevention:incidents:triage" : "prevention:incidents:investigate") && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div><p className="font-medium">Siguiente etapa: {INCIDENT_STATUS_LABELS[next]}</p><p className="text-sm text-[var(--color-text-subtle)]">El servidor volverá a validar investigación, CAPA y evidencia.</p></div>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => transitionPreventionIncidentAction({ incidentId: incident.id, expectedVersion: incident.version, toStatus: next, reason: `Avance controlado a ${INCIDENT_STATUS_LABELS[next]}` }))}>Avanzar</Button>
        </div>
      )}

      {["immediate_measures", "under_investigation", "pending_capa"].includes(incident.status) && can("prevention:incidents:investigate") && (
        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer font-semibold">Investigación guiada</summary>
          {/* Precarga lo guardado: el servicio guarda lo que recibe, y un
              formulario en blanco borraba causas, resumen y marcas al volver a
              guardar. */}
          <form key={`investigation-${incident.version}`} className="mt-4 grid gap-4" onSubmit={onSubmitWith((formData) => run(() => savePreventionIncidentInvestigationAction({
            incidentId: incident.id,
            expectedIncidentVersion: incident.version,
            methodology: String(formData.get("methodology") ?? ""),
            team: investigation?.team.length ? investigation.team : [{ userId: currentUser.id, role: "Investigador responsable" }],
            evidenceSummary: String(formData.get("evidenceSummary") ?? "") || null,
            immediateCauses: splitLines(formData.get("immediateCauses")),
            basicCauses: splitLines(formData.get("basicCauses")),
            organizationalCauses: splitLines(formData.get("organizationalCauses")),
            failedControls: splitLines(formData.get("failedControls")),
            conclusions: String(formData.get("conclusions") ?? "") || null,
            miperUpdateRequired: formData.get("miperUpdateRequired") === "on",
            miperUpdated: formData.get("miperUpdated") === "on",
            procedureUpdateRequired: formData.get("procedureUpdateRequired") === "on",
            procedureUpdated: formData.get("procedureUpdated") === "on",
            trainingRequired: formData.get("trainingRequired") === "on",
            trainingCompleted: formData.get("trainingCompleted") === "on",
            complete: formData.get("complete") === "on",
            reason: String(formData.get("reason") ?? ""),
          })))}>
            <div className="space-y-2"><Label htmlFor="methodology">Metodología</Label><Input id="methodology" name="methodology" required defaultValue={investigation?.methodology ?? "Árbol de causas"} /></div>
            <p className="text-xs text-[var(--color-text-subtle)]">{investigation?.team.length ? `Se conserva el equipo registrado (${investigation.team.length} ${investigation.team.length === 1 ? "persona" : "personas"}).` : `Equipo inicial: ${currentUser.name}.`} Las entrevistas identificables se guardan sólo en el payload cifrado.</p>
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Causas inmediatas, una por línea</Label><Textarea name="immediateCauses" defaultValue={investigation?.immediateCauses.join("\n") ?? ""} rows={3} /></div><div className="space-y-2"><Label>Causas básicas, una por línea</Label><Textarea name="basicCauses" defaultValue={investigation?.basicCauses.join("\n") ?? ""} rows={3} /></div><div className="space-y-2"><Label>Causas organizacionales</Label><Textarea name="organizationalCauses" defaultValue={investigation?.organizationalCauses.join("\n") ?? ""} rows={3} /></div><div className="space-y-2"><Label>Controles fallidos</Label><Textarea name="failedControls" defaultValue={investigation?.failedControls.join("\n") ?? ""} rows={3} /></div></div>
            <div className="space-y-2"><Label>Resumen de evidencia</Label><Textarea name="evidenceSummary" defaultValue={investigation?.evidenceSummary ?? ""} rows={2} /></div>
            <div className="space-y-2"><Label>Conclusiones</Label><Textarea name="conclusions" defaultValue={investigation?.conclusions ?? ""} rows={4} /></div>
            <div className="grid gap-2 text-sm md:grid-cols-3"><Checkbox name="miperUpdateRequired" defaultChecked={investigation?.miperUpdateRequired ?? false} label="Requiere actualizar MIPER" /><Checkbox name="miperUpdated" defaultChecked={Boolean(investigation?.miperUpdatedAt)} label="MIPER actualizado" /><span /><Checkbox name="procedureUpdateRequired" defaultChecked={investigation?.procedureUpdateRequired ?? false} label="Requiere procedimiento" /><Checkbox name="procedureUpdated" defaultChecked={Boolean(investigation?.procedureUpdatedAt)} label="Procedimiento actualizado" /><span /><Checkbox name="trainingRequired" defaultChecked={investigation?.trainingRequired ?? false} label="Requiere capacitación" /><Checkbox name="trainingCompleted" defaultChecked={Boolean(investigation?.trainingCompletedAt)} label="Capacitación completada" /></div>
            <div className="space-y-2"><Label>Motivo de actualización</Label><Input name="reason" required minLength={5} /></div>
            <Checkbox name="complete" defaultChecked={investigation?.status === "completed"} label={<span className="font-medium">Declarar investigación completa</span>} />
            <div><Button type="submit" disabled={pending}>Guardar investigación</Button></div>
          </form>
        </details>
      )}

      {can("prevention:incidents:investigate") && (
        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer font-semibold">Agregar evidencia o CAPA</summary>
          {/* La clave por versión vuelve a montar cada formulario después de
              un guardado exitoso, con sus valores por defecto (ver
              `onSubmitWith`). */}
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <form key={`evidence-${incident.version}`} className="space-y-3" onSubmit={onSubmitWith((formData) => run(() => addPreventionIncidentEvidenceAction({ incidentId: incident.id, expectedVersion: incident.version, kind: formData.get("kind"), reference: formData.get("reference"), description: formData.get("description") || null, isSensitive: formData.get("isSensitive") === "on" })))}>
              <p className="font-medium">Evidencia</p><Select name="kind" defaultValue="document"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="document">Documento</SelectItem><SelectItem value="photo">Fotografía</SelectItem><SelectItem value="video">Video</SelectItem><SelectItem value="diagram">Diagrama</SelectItem><SelectItem value="external_reference">Referencia externa</SelectItem><SelectItem value="note">Nota</SelectItem></SelectContent></Select><Input name="reference" required placeholder="ID documental, URL o referencia controlada" /><Input name="description" placeholder="Descripción" /><Checkbox name="isSensitive" label="Evidencia sensible" /><Button type="submit" variant="secondary" disabled={pending}>Agregar evidencia</Button>
            </form>
            {can("prevention:capa:manage") && <form key={`capa-${incident.version}`} className="space-y-3" onSubmit={onSubmitWith((formData) => run(() => createPreventionIncidentCapaAction({ incidentId: incident.id, expectedVersion: incident.version, finding: formData.get("finding"), actionDescription: formData.get("actionDescription"), priority: formData.get("priority"), targetDate, evidenceRequired: true }), () => setTargetDate(defaultTargetDate)))}>
              <p className="font-medium">Acción CAPA común</p><Input name="finding" required minLength={3} placeholder="Hallazgo / causa a controlar" /><Textarea name="actionDescription" required minLength={3} rows={2} placeholder="Acción correctiva o preventiva" /><Select name="priority" defaultValue="high"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baja</SelectItem><SelectItem value="medium">Media</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select><DatePicker value={targetDate} onChange={setTargetDate} min={defaultTargetDate} /><Button type="submit" variant="secondary" disabled={pending}>Crear CAPA</Button>
            </form>}
          </div>
          {capa.length > 0 && <div className="mt-4 text-sm">{capa.map((action) => <Link key={action.id} href={`/prevencion/capa/${action.id}`} className="mr-3 text-[var(--color-primary-ink)] hover:underline">{action.code} · {action.status}</Link>)}</div>}
        </details>
      )}

      {people.length > 0 && can("prevention:incidents:investigate") && (
        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer font-semibold">Clasificación para indicadores DS 44</summary>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">La inclusión es una decisión explícita y trazable. Se incluye por ausencia con tiempo perdido o por días de cargo (una fatalidad tiene 6.000 días de cargo y cero de ausencia). Registrar las fechas de reposo permite atribuir los días al período en que realmente hubo incapacidad, que es lo que exige el DS 44 para la gravedad semestral. Un período cerrado exige permiso de Jefatura y se reabre con historial.</p>
          {/* Misma clave por versión que evidencia y CAPA: tras guardar, la
              fila vuelve a montar con la decisión que quedó guardada. */}
          <div className="mt-4 space-y-4">{people.map((person) => (
            <form key={`${person.id}:${person.version}`} className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmitWith((formData) => run(() => classifyIncidentPersonForIndicatorsAction({
              incidentId: incident.id,
              personId: person.id,
              expectedIncidentVersion: incident.version,
              expectedPersonVersion: person.version,
              absenceAtLeastNormalShift: formData.get("absenceAtLeastNormalShift") === "on",
              absenceDays: Number(formData.get("absenceDays") ?? 0),
              chargeDays: Number(formData.get("chargeDays") ?? 0),
              administratorQualification: formData.get("administratorQualification") || null,
              inclusionStatus: formData.get("inclusionStatus"),
              reason: formData.get("reason"),
              // NORM-07: con fechas reales los días se reparten por el mes en
              // que hubo reposo (la gravedad es semestral). Sin ellas, el
              // registro conserva la imputación al mes del accidente.
              absencePeriods: formData.get("absenceStartDate")
                ? [{
                    startDate: formData.get("absenceStartDate"),
                    endDate: formData.get("returnToWorkDate") || null,
                  }]
                : undefined,
            })))}>
              <div className="md:col-span-2 lg:col-span-4"><p className="font-medium">{person.displayLabel}</p><p className="text-xs text-[var(--color-text-subtle)]">Estado actual: {person.indicatorInclusionStatus === "included" ? "Incluida" : person.indicatorInclusionStatus === "excluded" ? "Excluida" : "Pendiente"}</p></div>
              <div className="space-y-2"><Label>Decisión</Label><Select name="inclusionStatus" defaultValue={person.indicatorInclusionStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendiente / provisional</SelectItem><SelectItem value="included">Incluida</SelectItem><SelectItem value="excluded">Excluida</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Calificación administrador</Label><Input name="administratorQualification" defaultValue={person.administratorQualification ?? ""} placeholder="Resolución o calificación" /></div>
              <div className="space-y-2"><Label>Inicio del reposo</Label><Input name="absenceStartDate" type="date" defaultValue={person.absenceStartDate ?? ""} /></div>
              <div className="space-y-2"><Label>Reintegro (vacío = reposo vigente)</Label><Input name="returnToWorkDate" type="date" defaultValue={person.returnToWorkDate ?? ""} /></div>
              <div className="space-y-2"><Label>Días de ausencia</Label><Input name="absenceDays" type="number" min={0} defaultValue={person.absenceDays} disabled={Boolean(person.absenceStartDate)} /><p className="text-xs text-[var(--color-text-subtle)]">{person.absenceStartDate ? "Se calcula desde las fechas de reposo." : "Sin fechas de reposo: se imputa al mes del accidente."}</p></div>
              <div className="space-y-2"><Label>Días de cargo</Label><Input name="chargeDays" type="number" min={0} defaultValue={person.chargeDays} /></div>
              <div className="md:col-span-2"><Checkbox name="absenceAtLeastNormalShift" defaultChecked={person.absenceAtLeastNormalShift} label="Ausencia igual o superior a una jornada normal" /></div>
              <div className="space-y-2 md:col-span-2"><Label>Fundamento de inclusión/exclusión</Label><Input name="reason" required minLength={10} placeholder="Resolución revisada y criterio aplicado" /></div>
              <div className="lg:col-span-4"><Button type="submit" variant="secondary" disabled={pending}>Guardar clasificación</Button></div>
            </form>
          ))}</div>
        </details>
      )}

      {notifications.length > 0 && can("prevention:incidents:notify") && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="font-semibold">Denuncias y notificaciones</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">{notifications.filter((lane) => lane.notificationType !== "restart_authorization").map((lane) => (
            <form key={lane.id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3" onSubmit={onSubmitWith((formData) => run(() => recordPreventionIncidentNotificationAction({ incidentId: incident.id, expectedVersion: incident.version, notificationType: lane.notificationType, sentAt: new Date().toISOString(), evidenceReference: formData.get("evidenceReference"), observations: formData.get("observations") || null })))}>
              <div className="flex justify-between gap-2"><strong>{lane.notificationType.toUpperCase()}</strong><span className={lane.status === "overdue" ? "text-[var(--color-danger)]" : "text-[var(--color-text-subtle)]"}>{notificationStatusLabel(lane.status)}</span></div><p className="text-xs text-[var(--color-text-subtle)]">Plazo: {lane.deadlineAt ? formatDateTime(lane.deadlineAt) : "Inmediato"}</p>{!["sent", "acknowledged"].includes(lane.status) && <><Input name="evidenceReference" required placeholder="Folio, documento o evidencia de envío" /><Input name="observations" placeholder="Observaciones" /><Button type="submit" size="sm" disabled={pending}>Registrar envío ahora</Button></>}{lane.sentAt && <p className="text-xs">Enviada: {formatDateTime(lane.sentAt)}</p>}{lane.escalatedAt && <p className="text-xs text-[var(--color-danger)]">Atraso/escalamiento conservado: {formatDateTime(lane.escalatedAt)}</p>}
            </form>
          ))}</div>
        </section>
      )}

      {incident.isFatalOrSerious && incident.operationsSuspended && can("prevention:incidents:authorize_restart") && (
        <form
          className="space-y-3 rounded-xl border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-4"
          onSubmit={onSubmitWith((formData) => run(() => authorizePreventionIncidentRestartAction({
            incidentId: incident.id,
            expectedVersion: incident.version,
            reason: formData.get("reason"),
            authorityName: formData.get("authorityName"),
            authorizationReference: formData.get("authorizationReference"),
            authorizationDate: formData.get("authorizationDate"),
            evidenceReference: formData.get("evidenceReference"),
            segregationExceptionReason: formData.get("segregationExceptionReason") || undefined,
          })))}
        >
          <div>
            <p className="text-sm font-medium">Levantamiento de la suspensión</p>
            {/* Ley 16.744 art. 76: la faena reanuda cuando lo autoriza el
                organismo fiscalizador. La autorización interna no lo reemplaza,
                por eso estos datos son obligatorios para reanudar. */}
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              La faena sólo puede reanudar operaciones con la autorización del organismo fiscalizador.
              Registra la resolución que levanta la suspensión.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="restart-authority">Organismo que autoriza</Label><Input id="restart-authority" name="authorityName" required minLength={3} placeholder="DT, SEREMI de Salud, SERNAGEOMIN…" /></div>
            <div className="space-y-2"><Label htmlFor="restart-reference">Folio o resolución</Label><Input id="restart-reference" name="authorizationReference" required minLength={3} /></div>
            <div className="space-y-2"><Label htmlFor="restart-date">Fecha de la autorización</Label><Input id="restart-date" name="authorizationDate" type="date" required /></div>
          </div>
          {/* Sin "Checksum SHA-256 (opcional)": le pedía a quien registra la
              resolución del fiscalizador que corriera `sha256sum` sobre un PDF
              que la plataforma no almacena y transcribiera 64 caracteres. La
              huella la calcula el sistema sobre un archivo propio —como en TAE
              e inspecciones—, no la tipea una persona. */}
          <div className="space-y-2"><Label htmlFor="restart-evidence">Documento de respaldo</Label><Input id="restart-evidence" name="evidenceReference" required minLength={3} placeholder="Referencia verificable del documento" /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="restart-reason">Fundamento de autorización de reinicio</Label><Input id="restart-reason" name="reason" required minLength={10} /></div>
            <div className="space-y-2"><Label htmlFor="restart-segregation-reason">Excepción de segregación (si participaste en la investigación o las medidas)</Label><Input id="restart-segregation-reason" name="segregationExceptionReason" minLength={10} placeholder="Sólo si tienes autorización de excepción" /></div>
          </div>
          <Button type="submit" variant="destructive" disabled={pending}>Autorizar reinicio</Button>
        </form>
      )}

      {incident.status === "pending_verification" && can("prevention:incidents:close") && (
        <form className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:flex-row md:items-end" onSubmit={onSubmitWith((formData) => run(() => transitionPreventionIncidentAction({ incidentId: incident.id, expectedVersion: incident.version, toStatus: "closed", reason: String(formData.get("reason") ?? "") })))}>
          <div className="flex-1 space-y-2"><Label htmlFor="closure-reason">Conclusión de cierre</Label><Input id="closure-reason" name="reason" required minLength={5} /></div><Button type="submit" disabled={pending}>Cerrar incidente</Button>
        </form>
      )}
    </div>
  )
}
