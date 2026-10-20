"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
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
import { toast } from "@/lib/toast"
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

/**
 * Lo que el padre necesita de un registro: registrar una desviación o una acción
 * puede pasar la ejecución de `planned` a `in_progress` y subir su versión, y si
 * el cliente no se entera su siguiente guardado choca con su propio bloqueo
 * optimista. La versión viaja en `result.data.version`.
 */
type VersionResult = { data?: Record<string, unknown> }

/** Un error del servidor, en el sitio donde ocurrió y dicho como alerta. */
function OperationError({ operation }: { operation: { message: string; messageTone: string } }) {
  if (operation.messageTone !== "error" || !operation.message) return null
  return <Callout tone="danger" role="alert">{operation.message}</Callout>
}

export function PreventiveActionsPanel({ runId, actions, assignees, editable, onVersion }: {
  runId: string
  actions: FindingInfo[]
  assignees: { id: string; name: string }[]
  editable: boolean
  /** Recibe el resultado de registrar: trae la versión nueva de la ejecución. */
  onVersion?: (result: VersionResult) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const [targetDate, setTargetDate] = React.useState("")
  const operation = useOperation()

  function changeOpen(next: boolean) {
    operation.setMessage("")
    setOpen(next)
  }

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Acciones preventivas ({actions.length}/6)</h2>
      {editable && actions.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Agregar acción</Button>}
    </div>
    {actions.length === 0 ? <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin acciones preventivas acordadas.</p> : <ol className="space-y-2">{actions.map((action, index) => <li key={action.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm"><span className="font-semibold">{index + 1}.</span> {action.description} {action.capaActionId && <MetaBadge meta={{ label: "CAPA creada", variant: "success" }} className="ml-2" />}</li>)}</ol>}
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const actionDescription = String(new FormData(event.currentTarget).get("actionDescription") ?? "")
      // El panel sigue montado tras guardar: la acción siguiente parte de cero.
      operation.run(() => registerInspectionPreventiveActionAction({ runId, actionDescription, responsibleUserId, targetDate }), (result) => {
        onVersion?.(result)
        toast.success("Acción preventiva creada en CAPA.")
        changeOpen(false)
        setResponsibleUserId("")
        setTargetDate("")
      })
    }}>
      <DialogHeader><DialogTitle>Acción preventiva</DialogTitle><DialogDescription>La acción quedará creada directamente en CAPA/PDTP con responsable y fecha de control.</DialogDescription></DialogHeader>
      <Field label="Acción acordada" required error={operation.fieldError("actionDescription")}><Textarea name="actionDescription" required minLength={10} maxLength={3000} /></Field>
      <Field label="Responsable" required error={operation.fieldError("responsibleUserId")}><Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger aria-label="Responsable de la acción"><SelectValue placeholder="Selecciona responsable" /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Fecha de control" required error={operation.fieldError("targetDate")}><DatePicker value={targetDate} onChange={setTargetDate} /></Field>
      <OperationError operation={operation} />
      <DialogFooter><Button type="submit" loading={operation.pending} disabled={!responsibleUserId || !targetDate}>Crear acción CAPA</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>
}

type ParticipantRow = { id: string; name: string; position: string; userId: string | null }

/**
 * Clave de comparación entre lo que hay en pantalla y lo último guardado. Ignora
 * el `id`: las filas nuevas lo generan en el cliente y el servidor las reasigna
 * al guardar, así que compararlo daría «sin guardar» para siempre.
 */
function participantsKey(rows: readonly ParticipantRow[]) {
  return JSON.stringify(rows.map((row) => [row.name.trim(), row.position.trim(), row.userId]))
}

export function ParticipantsPanel({ runId, participants, editable, initialRows, onRowsChange }: {
  runId: string
  participants: { id: string; name: string; position: string; userId: string | null }[]
  editable: boolean
  /**
   * Filas que reemplazan a las del servidor, p. ej. las que sobrevivieron en el
   * dispositivo. Se adoptan cada vez que su contenido cambia; es el padre quien
   * decide cuándo (la restauración ocurre tras el montaje, no durante él).
   */
  initialRows?: ParticipantRow[]
  /**
   * Avisa cada vez que la persona cambia las filas o las guarda, con si difieren
   * de lo guardado. El detalle lo usa para el espejo del dispositivo y para no
   * dejar declarar ejecutada con participantes sin guardar.
   */
  onRowsChange?: (rows: ParticipantRow[], dirty: boolean) => void
}) {
  const [rows, setRows] = React.useState<ParticipantRow[]>(() => initialRows ?? participants.map(({ id, name, position, userId }) => ({ id, name, position, userId })))
  const [savedKey, setSavedKey] = React.useState(() => participantsKey(participants))
  // Lo último que el padre mandó adoptar, por contenido y no por referencia: un
  // arreglo armado en cada render no debe pisar lo que la persona está escribiendo.
  const [seed, setSeed] = React.useState(() => (initialRows ? JSON.stringify(initialRows) : null))
  // Las filas más recientes, para el callback de éxito, que corre tras un `await`
  // con las filas que había al pulsar «Guardar».
  const rowsRef = React.useRef(rows)
  React.useEffect(() => { rowsRef.current = rows }, [rows])
  const operation = useOperation()
  const dirty = participantsKey(rows) !== savedKey

  // Un `initialRows` distinto es una orden del padre de adoptarlas. Se ajusta
  // durante el render, con lo anterior guardado en estado, y no en un efecto: así
  // no hay un cuadro intermedio con las filas viejas.
  const incomingSeed = initialRows ? JSON.stringify(initialRows) : null
  if (incomingSeed !== seed) {
    setSeed(incomingSeed)
    if (initialRows) setRows(initialRows)
  }

  function commit(next: ParticipantRow[]) {
    setRows(next)
    onRowsChange?.(next, participantsKey(next) !== savedKey)
  }

  function updateRow(index: number, patch: Partial<{ name: string; position: string }>) {
    commit(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Participantes ({rows.length})</h2>
        {editable && (
          <Button type="button" size="sm" variant="secondary" onClick={() => commit([...rows, { id: `participant-${Date.now()}-${rows.length}`, name: "", position: "", userId: null }])}>
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
                  <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => commit(rows.filter((_, rowIndex) => rowIndex !== index))}>Quitar</Button>
                </>
              ) : (
                <p className="md:col-span-3"><span className="font-medium">{row.name}</span> · {row.position}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            loading={operation.pending}
            disabled={rows.length === 0 || rows.some((row) => row.name.trim().length < 2 || row.position.trim().length < 2)}
            onClick={() => {
              const sent = rows
              operation.run(() => saveInspectionParticipantsAction({ runId, participants: sent }), () => {
                // Lo enviado es ahora lo guardado; si la persona siguió escribiendo
                // mientras tanto, esas filas quedan «sin guardar» otra vez.
                const sentKey = participantsKey(sent)
                setSavedKey(sentKey)
                onRowsChange?.(rowsRef.current, participantsKey(rowsRef.current) !== sentKey)
                toast.success("Participantes guardados.")
              })
            }}
          >
            {operation.pending ? "Guardando…" : "Guardar participantes"}
          </Button>
          {dirty && <span role="status" className="text-xs font-medium text-[var(--color-warning-ink)]">Participantes sin guardar</span>}
        </div>
      )}
      <OperationError operation={operation} />
    </section>
  )
}

const DEVIATION_PLAZO: Record<string, string> = {
  critical: "3 días y detención",
  high: "7 días",
  medium: "15 días",
  low: "30 días",
}

export function DeviationsPanel({ runId, editable, canExecute, catalog, registered, narrative, onVersion }: {
  runId: string
  editable: boolean
  canExecute: boolean
  catalog: { id: string; label: string; danoPotencial: string; criticality: string }[]
  registered: FindingInfo[]
  narrative: boolean
  /** Recibe el resultado de registrar: trae la versión nueva de la ejecución. */
  onVersion?: (result: VersionResult) => void
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
                    (result) => {
                      onVersion?.(result)
                      toast.success("Desviación registrada.")
                      setEntryId("")
                    },
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
                          onClick={() => operation.run(
                            () => removeDeviationAction({ findingId: finding.id }),
                            () => toast.success("Desviación quitada."),
                          )}
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
      <OperationError operation={operation} />

      <OtherDeviationDialog runId={runId} open={otherOpen} onOpenChange={setOtherOpen} narrative={narrative} onVersion={onVersion} />
    </section>
  )
}

/**
 * "Otra desviación": el único camino donde la gravedad la elige quien registra.
 * Queda sin entrada de catálogo, y por eso aparece en la cola de clasificación
 * del creador para que Prevención la incorpore con la gravedad oficial.
 */
function OtherDeviationDialog({ runId, open, onOpenChange, narrative, onVersion }: {
  runId: string
  open: boolean
  onOpenChange: (next: boolean) => void
  narrative: boolean
  onVersion?: (result: VersionResult) => void
}) {
  const [dano, setDano] = React.useState("moderado")
  const operation = useOperation()

  function changeOpen(next: boolean) {
    // Un error de un intento anterior no debe esperar a quien vuelve a abrir.
    operation.setMessage("")
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
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
              (result) => {
                onVersion?.(result)
                toast.success("Desviación registrada.")
                // El diálogo sigue montado: la desviación siguiente parte de la gravedad por defecto.
                setDano("moderado")
                changeOpen(false)
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
          <Field label="Qué se encontró" required error={operation.fieldError("description")}>
            <Textarea name="description" required minLength={3} maxLength={3000} rows={3} aria-label="Descripción de la desviación" />
          </Field>
          {narrative && (
            <>
              <Field label="Descripción narrativa del daño potencial" required error={operation.fieldError("potentialDamageDescription")}>
                <Textarea name="potentialDamageDescription" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Medida preventiva" required error={operation.fieldError("immediateMeasure")}>
                <Textarea name="immediateMeasure" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Normativa legal aplicable" required error={operation.fieldError("applicableLaw")}>
                <Input name="applicableLaw" required minLength={2} maxLength={1000} />
              </Field>
            </>
          )}
          <Field label="Gravedad" required error={operation.fieldError("danoPotencial")}>
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
          <OperationError operation={operation} />
          <DialogFooter><Button type="submit" loading={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
