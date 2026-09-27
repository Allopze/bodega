"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import {
  registerDeviationAction,
  registerInspectionPreventiveActionAction,
  removeDeviationAction,
  saveInspectionParticipantsAction,
} from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import type { FindingInfo } from "./types"
import { FindingEvidence } from "./inspection-evidence"

/* ── Desviaciones encontradas ─────────────────────────────────────────────
 * El panel de los instrumentos que no puntúan ítems: observación de conductas,
 * inspección de área y caminata de seguridad.
 *
 * Cada desviación se elige del catálogo del instrumento y de ahí sale su
 * gravedad — por eso el formulario NO ofrece elegirla en ese camino: si la
 * eligiera quien registra, el plazo de la acción correctiva dependería de su
 * criterio. La excepción es "Otra desviación", que existe porque forzar la
 * desviación más parecida ensucia el dato peor que no clasificarla; ésas quedan
 * en la cola que Prevención resuelve desde el creador.
 */

export function PreventiveActionsPanel({ runId, actions, assignees, editable }: {
  runId: string
  actions: FindingInfo[]
  assignees: { id: string; name: string }[]
  editable: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const [targetDate, setTargetDate] = React.useState("")
  const operation = useOperation()
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Acciones preventivas ({actions.length}/6)</h2>
      {editable && actions.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Agregar acción</Button>}
    </div>
    {actions.length === 0 ? <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin acciones preventivas acordadas.</p> : <ol className="space-y-2">{actions.map((action, index) => <li key={action.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm"><span className="font-semibold">{index + 1}.</span> {action.description} {action.capaActionId && <MetaBadge meta={{ label: "CAPA creada", variant: "success" }} className="ml-2" />}</li>)}</ol>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const actionDescription = String(new FormData(event.currentTarget).get("actionDescription") ?? "")
      // El panel sigue montado tras guardar: la acción siguiente parte de cero.
      operation.run(() => registerInspectionPreventiveActionAction({ runId, actionDescription, responsibleUserId, targetDate }), () => {
        setOpen(false)
        setResponsibleUserId("")
        setTargetDate("")
      })
    }}>
      <DialogHeader><DialogTitle>Acción preventiva</DialogTitle><DialogDescription>La acción quedará creada directamente en CAPA/PDTP con responsable y fecha de control.</DialogDescription></DialogHeader>
      <Field label="Acción acordada" required><Textarea name="actionDescription" required minLength={10} maxLength={3000} /></Field>
      <Field label="Responsable" required><Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger aria-label="Responsable de la acción"><SelectValue placeholder="Selecciona responsable" /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Fecha de control" required><DatePicker value={targetDate} onChange={setTargetDate} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !responsibleUserId || !targetDate}>Crear acción CAPA</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>
}

export function ParticipantsPanel({ runId, participants, editable }: {
  runId: string
  participants: { id: string; name: string; position: string; userId: string | null }[]
  editable: boolean
}) {
  const [rows, setRows] = React.useState(() => participants.map(({ id, name, position, userId }) => ({ id, name, position, userId })))
  const operation = useOperation()

  function updateRow(index: number, patch: Partial<{ name: string; position: string }>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Participantes ({rows.length})</h2>
        {editable && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setRows((current) => [...current, { id: `participant-${Date.now()}-${current.length}`, name: "", position: "", userId: null }])}>
            Agregar participante
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
          Registra al menos una persona participante, con su nombre y cargo.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-[1fr_1fr_auto]">
              {editable ? (
                <>
                  <Field label={`Nombre ${index + 1}`} required><Input value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></Field>
                  <Field label="Cargo" required><Input value={row.position} onChange={(event) => updateRow(index, { position: event.target.value })} /></Field>
                  <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Quitar</Button>
                </>
              ) : (
                <p className="md:col-span-3"><span className="font-medium">{row.name}</span> · {row.position}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <Button
          type="button"
          size="sm"
          disabled={operation.pending || rows.length === 0 || rows.some((row) => row.name.trim().length < 2 || row.position.trim().length < 2)}
          onClick={() => operation.run(() => saveInspectionParticipantsAction({ runId, participants: rows }))}
        >
          {operation.pending ? "Guardando…" : "Guardar participantes"}
        </Button>
      )}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
    </section>
  )
}

const DEVIATION_PLAZO: Record<string, string> = {
  critical: "3 días y detención",
  high: "7 días",
  medium: "15 días",
  low: "30 días",
}

export function DeviationsPanel({ runId, editable, canExecute, catalog, registered, narrative }: {
  runId: string
  editable: boolean
  canExecute: boolean
  catalog: { id: string; label: string; danoPotencial: string; criticality: string }[]
  registered: FindingInfo[]
  narrative: boolean
}) {
  const [entryId, setEntryId] = React.useState("")
  const [otherOpen, setOtherOpen] = React.useState(false)
  const operation = useOperation()
  const puedeRegistrar = editable && canExecute

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Desviaciones encontradas ({registered.length})</h2>
        {puedeRegistrar && (
          <div className="flex flex-wrap items-center gap-2">
            {!narrative && catalog.length > 0 && (
              <>
                <Select value={entryId} onValueChange={setEntryId}>
                  <SelectTrigger className="w-72" aria-label="Desviación del catálogo">
                    <SelectValue placeholder="Elegir del catálogo…" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label} · {DEVIATION_PLAZO[entry.criticality] ?? entry.criticality}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={operation.pending || !entryId}
                  onClick={() => operation.run(
                    () => registerDeviationAction({ runId, catalogEntryId: entryId }),
                    () => setEntryId(""),
                  )}
                >
                  Registrar
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={() => setOtherOpen(true)}>
              {narrative ? "Registrar hallazgo" : "Otra desviación"}
            </Button>
          </div>
        )}
      </div>

      {!narrative && catalog.length === 0 && puedeRegistrar && (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
          Este instrumento aún no tiene catálogo de desviaciones. Prevención lo arma desde Inspecciones → Plantillas;
          mientras tanto se pueden registrar con «Otra desviación».
        </p>
      )}

      {registered.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
          Sin desviaciones registradas. Si la actividad se hizo y no encontró nada, declárala ejecutada así.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desviación</TableHead>
                <TableHead>Criticidad</TableHead>
                <TableHead>Plazo de la acción</TableHead>
                <TableHead>Estado</TableHead>
                {puedeRegistrar && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {registered.map((finding) => (
                <React.Fragment key={finding.id}>
                <TableRow>
                  <TableCell className="text-sm">{finding.description}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: `${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}`, variant: criticalityBadgeVariant(finding.criticality) }} />
                  </TableCell>
                  <TableCell className="text-sm">{DEVIATION_PLAZO[finding.criticality] ?? "—"}</TableCell>
                  <TableCell className="text-sm">{FINDING_STATUS_LABELS[finding.status] ?? finding.status}</TableCell>
                  {puedeRegistrar && (
                    <TableCell className="text-right">
                      {/* Quitar sólo mientras no tenga CAPA: con acción correctiva
                          enlazada ya hay trabajo colgando de ella. */}
                      {finding.capaActionId ? (
                        <span className="text-xs text-[var(--color-text-subtle)]">Con CAPA</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={operation.pending}
                          onClick={() => operation.run(() => removeDeviationAction({ findingId: finding.id }))}
                        >
                          Quitar
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                {narrative && (finding.potentialDamageDescription || finding.immediateMeasure || finding.applicableLaw) && (
                  <TableRow>
                    <TableCell colSpan={puedeRegistrar ? 5 : 4} className="bg-[var(--color-surface-2)] text-xs">
                      <dl className="grid gap-2 md:grid-cols-3">
                        <div><dt className="font-semibold">Daño potencial</dt><dd>{finding.potentialDamageDescription ?? "—"}</dd></div>
                        <div><dt className="font-semibold">Medida preventiva</dt><dd>{finding.immediateMeasure ?? "—"}</dd></div>
                        <div><dt className="font-semibold">Normativa</dt><dd>{finding.applicableLaw ?? "—"}</dd></div>
                      </dl>
                      <div className="mt-3"><FindingEvidence findingId={finding.id} evidence={finding.evidence} editable={puedeRegistrar} /></div>
                    </TableCell>
                  </TableRow>
                )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}

      <OtherDeviationDialog runId={runId} open={otherOpen} onOpenChange={setOtherOpen} narrative={narrative} />
    </section>
  )
}

/**
 * "Otra desviación": el único camino donde la gravedad la elige quien registra.
 * Queda sin entrada de catálogo, y por eso aparece en la cola de clasificación
 * del creador para que Prevención la incorpore con la gravedad oficial.
 */
function OtherDeviationDialog({ runId, open, onOpenChange, narrative }: {
  runId: string
  open: boolean
  onOpenChange: (next: boolean) => void
  narrative: boolean
}) {
  const [dano, setDano] = React.useState("moderado")
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const description = String(form.get("description") ?? "").trim()
            operation.run(
              () => registerDeviationAction({
                runId,
                description,
                danoPotencial: dano,
                potentialDamageDescription: narrative ? String(form.get("potentialDamageDescription") ?? "").trim() : undefined,
                immediateMeasure: narrative ? String(form.get("immediateMeasure") ?? "").trim() : undefined,
                applicableLaw: narrative ? String(form.get("applicableLaw") ?? "").trim() : undefined,
              }),
              () => {
                // El diálogo sigue montado: la desviación siguiente parte de la gravedad por defecto.
                setDano("moderado")
                onOpenChange(false)
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{narrative ? "Registrar hallazgo del Anexo 08" : "Otra desviación"}</DialogTitle>
            <DialogDescription>
              {narrative
                ? "Completa los antecedentes documentales del hallazgo. La clasificación interna determina la prioridad y el plazo CAPA."
                : "Para lo que no está en el catálogo. Prevención la revisará y, si corresponde, la incorporará con su gravedad oficial — hasta entonces rige la que elijas acá."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Qué se encontró" required>
            <Textarea name="description" required minLength={3} maxLength={3000} rows={3} aria-label="Descripción de la desviación" />
          </Field>
          {narrative && (
            <>
              <Field label="Descripción narrativa del daño potencial" required>
                <Textarea name="potentialDamageDescription" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Medida preventiva" required>
                <Textarea name="immediateMeasure" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Normativa legal aplicable" required>
                <Input name="applicableLaw" required minLength={2} maxLength={1000} />
              </Field>
            </>
          )}
          <Field label="Gravedad" required>
            <Select value={dano} onValueChange={setDano}>
              <SelectTrigger aria-label="Gravedad de la desviación"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="leve">Leve → bajo · 30 días</SelectItem>
                <SelectItem value="moderado">Moderado → medio · 15 días</SelectItem>
                <SelectItem value="grave">Grave → alto · 7 días</SelectItem>
                <SelectItem value="fatal">Fatal → crítico · 3 días y detención</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
