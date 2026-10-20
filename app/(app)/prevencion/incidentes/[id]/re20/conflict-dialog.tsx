"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { Re20Conflict } from "./types"
import { re20SectionLabel } from "./workspace-data"

/* Diferencias entre lo que hay en esta pantalla y lo que otra persona guardó.
 * Se comparan campo por campo con etiquetas humanas; nunca se muestra JSON. */

/** Etiquetas de los campos que aparecen en una diferencia. Lo que no está aquí se nombra por su sección. */
const FIELD_LABELS: Record<string, string> = {
  managerName: "Jefatura a cargo", reportDate: "Fecha del informe", subManagement: "Subgerencia", area: "Área o taller",
  eventDescription: "Descripción de lo ocurrido", activity: "Actividad", injuryDescription: "Descripción de la lesión",
  bodyZone: "Parte del cuerpo", injuryElement: "Elemento que provocó la lesión", causalAgent: "Agente causante", source: "Fuente",
  conditions: "Condiciones", deviation: "Desviaciones", immediateResponse: "Respuesta inmediata", initialMeasures: "Medidas iniciales",
  shiftEntryTime: "Hora de ingreso", shiftExitTime: "Hora de salida", hazardSource: "Peligro o fuente", hazardSourceOther: "Otro peligro o fuente",
  temperature: "Temperatura", weather: "Clima", shiftSystem: "Sistema de turnos", proposedMeasures: "Medidas propuestas",
  immediateActions: "Acciones inmediatas", immediateActionsDetail: "Detalle de las acciones", marked: "Realizada", responsible: "Responsable",
  firstAid: "Primeros auxilios", isolation: "Aislamiento del área", suspension: "Suspensión de la tarea", evidencePreservation: "Preservación de evidencias",
  supervisorNotice: "Aviso a jefatura", committeeNotice: "Aviso al Comité Paritario", administratorNotice: "Aviso al organismo administrador", authorityNotice: "Aviso a la autoridad",
  potential: "Potencial", description: "Descripción", status: "Estado", completedAt: "Terminada el", dueAt: "Plazo", note: "Nota",
  responsibleUserId: "Responsable", verifierUserId: "Verificador", userId: "Persona", role: "Rol", position: "Cargo",
  controlType: "Tipo de control", evidence: "Evidencia", verified: "Verificado", type: "Tipo", origin: "Origen", date: "Fecha", custody: "Custodia",
  conclusion: "Conclusión", reconstruction: "Reconstrucción", chronology: "Cronología", occurredAt: "Fecha y hora",
  events: "Hechos", relations: "Relaciones", statement: "Relato", name: "Nombre", tasks: "Avance de etapas",
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

function describeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Vacío"
  if (typeof value === "boolean") return value ? "Sí" : "No"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") {
    if (ISO_DATETIME.test(value)) return formatDateTime(value)
    if (PLAIN_DATE.test(value)) return formatDate(value)
    return value.length > 140 ? `${value.slice(0, 140)}…` : value
  }
  if (Array.isArray(value)) return value.length === 0 ? "Ninguno" : `${value.length} ${value.length === 1 ? "elemento" : "elementos"}`
  return "Con datos"
}

function flatten(value: unknown, prefix: string[] = [], out = new Map<string, { path: string[]; value: unknown }>()) {
  if (value && typeof value === "object" && !(Array.isArray(value) && value.every((item) => typeof item !== "object"))) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) flatten(entry, [...prefix, key], out)
    if (Object.keys(value as object).length === 0) out.set(prefix.join("."), { path: prefix, value: undefined })
  } else {
    out.set(prefix.join("."), { path: prefix, value: Array.isArray(value) ? value.join(" · ") : value })
  }
  return out
}

function labelForPath(section: string, path: string[]) {
  const parts = path
    .map((part) => /^\d+$/.test(part) ? `n.º ${Number(part) + 1}` : FIELD_LABELS[part])
    .filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : re20SectionLabel(section)
}

export interface Re20Difference {
  label: string
  local: string
  remote: string
}

/** Las diferencias de una sección, en palabras: «Clima: Lluvia → Nublado». */
export function describeConflict(section: string, local: unknown, remote: unknown, options: { personName?: (userId: string) => string | undefined; limit?: number } = {}): { rows: Re20Difference[]; more: number } {
  const limit = options.limit ?? 8
  // Las personas se nombran, nunca se muestra su ID.
  const show = (entry: { path: string[]; value: unknown } | undefined) => {
    const key = entry?.path.at(-1) ?? ""
    if (entry && typeof entry.value === "string" && entry.value && /(^userId$|UserId$)/.test(key)) return options.personName?.(entry.value) ?? "Otra persona"
    return describeValue(entry?.value)
  }
  const left = flatten(local)
  const right = flatten(remote)
  const rows: Re20Difference[] = []
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key)
    const b = right.get(key)
    const localText = show(a)
    const remoteText = show(b)
    if (localText === remoteText) continue
    rows.push({ label: labelForPath(section, (a ?? b)!.path), local: localText, remote: remoteText })
  }
  return { rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) }
}

interface SensitiveConflictInput {
  local: unknown
  remote: unknown
}

export function Re20ConflictDialog({ open, onOpenChange, conflicts, sensitiveConflict, remoteAuthor, remoteAt, onChoose, onChooseSensitive, onApply, personName }: {
  personName?: (userId: string) => string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  conflicts: Re20Conflict[]
  sensitiveConflict: SensitiveConflictInput | null
  remoteAuthor: string | null
  remoteAt: string | null
  onChoose: (section: string, choice: "local" | "remote") => void
  onChooseSensitive: (choice: "local" | "remote") => void
  onApply: () => void
}) {
  const [sensitiveChoice, setSensitiveChoice] = React.useState<"local" | "remote" | null>(null)
  const remoteLabel = `Versión guardada${remoteAuthor ? ` por ${remoteAuthor}` : ""}${remoteAt ? `, ${formatDateTime(remoteAt)}` : ""}`
  const pending = conflicts.filter((item) => !item.choice).length + (sensitiveConflict && !sensitiveChoice ? 1 : 0)

  function apply() {
    if (sensitiveConflict && sensitiveChoice) onChooseSensitive(sensitiveChoice)
    onApply()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Otra persona guardó cambios en las mismas partes</DialogTitle>
          <DialogDescription>
            Elige en cada parte qué versión conservar. Lo que no aparece aquí ya se combinó solo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {conflicts.map((conflict) => (
            <ConflictSection
              key={conflict.section}
              title={re20SectionLabel(conflict.section)}
              section={conflict.section}
              local={conflict.local}
              remote={conflict.remote}
              remoteLabel={remoteLabel}
              personName={personName}
              choice={conflict.choice ?? null}
              onChoose={(choice) => onChoose(conflict.section, choice)}
            />
          ))}
          {sensitiveConflict && (
            <ConflictSection
              title="Datos reservados"
              section="sensitive"
              local={sensitiveConflict.local}
              remote={sensitiveConflict.remote}
              remoteLabel={remoteLabel}
              personName={personName}
              choice={sensitiveChoice}
              onChoose={setSensitiveChoice}
            />
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
            {pending > 0 ? `Falta elegir en ${pending} ${pending === 1 ? "parte" : "partes"}.` : "Listo: al aplicar, guarda para dejarlo en el servidor."}
          </p>
          <Button type="button" onClick={apply} disabled={pending > 0}>Aplicar mi elección</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConflictSection({ title, section, local, remote, remoteLabel, choice, onChoose, personName }: {
  personName?: (userId: string) => string | undefined
  title: string
  section: string
  local: unknown
  remote: unknown
  remoteLabel: string
  choice: "local" | "remote" | null
  onChoose: (choice: "local" | "remote") => void
}) {
  const { rows, more } = describeConflict(section, local, remote, { personName })
  const groupId = React.useId()
  return (
    <section aria-labelledby={`${groupId}-title`} className="space-y-2 border-t border-[var(--color-border)] pt-4 first:border-t-0 first:pt-0">
      <h3 id={`${groupId}-title`} className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-text-subtle)]">
              <th scope="col" className="py-1 pr-3 font-medium">Dato</th>
              <th scope="col" className="py-1 pr-3 font-medium">Tu versión</th>
              <th scope="col" className="py-1 font-medium">{remoteLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="align-top">
                <th scope="row" className="py-1.5 pr-3 font-medium text-[var(--color-text)]">{row.label}</th>
                <td className="py-1.5 pr-3 text-[var(--color-text)]">{row.local}</td>
                <td className="py-1.5 text-[var(--color-text)]">{row.remote}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Y {more} {more === 1 ? "diferencia" : "diferencias"} más en esta parte.</p>}
      </div>
      <div role="radiogroup" aria-labelledby={`${groupId}-title`} className="flex flex-wrap gap-2">
        <ChoiceButton active={choice === "local"} onClick={() => onChoose("local")}>Conservar la mía</ChoiceButton>
        <ChoiceButton active={choice === "remote"} onClick={() => onChoose("remote")}>Usar la guardada</ChoiceButton>
      </div>
    </section>
  )
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={active
        ? "inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-tint)] px-3 text-sm font-medium text-[var(--color-primary-ink)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:min-h-9"
        : "inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] transition-colors duration-150 hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:min-h-9"}
    >
      {children}
    </button>
  )
}
