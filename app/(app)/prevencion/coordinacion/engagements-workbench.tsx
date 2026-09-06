"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  assessArt20Reciprocity,
  COORDINATION_INFO_LABELS,
  COORDINATION_INFO_TYPES,
  COUNTERPARTY_TYPE_LABELS,
  ENGAGEMENT_DIRECTION_LABELS,
  ENGAGEMENT_KIND_LABELS,
  engagementKindBadgeVariant,
} from "@/lib/prevention/external-engagements"
import { addPrescribedMeasureAction, closeExternalEngagementAction, createExternalEngagementAction } from "./actions"

interface EngagementRow {
  id: string
  code: string
  kind: string
  direction: string
  counterpartyType: string
  counterpartyName: string
  occurredOn: string
  subject: string
  officialReference: string | null
  infoTypes: string[] | null
  closedAt: string | null
  version: number
  worksiteId: string
  worksiteName: string
  openMeasures: number
  totalMeasures: number
}

interface Props {
  engagements: EngagementRow[]
  worksites: { id: string; name: string }[]
  responsibles: { id: string; name: string }[]
  canManage: boolean
}

export function EngagementsWorkbench({ engagements, worksites, responsibles, canManage }: Props) {
  const [kind, setKind] = React.useState("all")
  const [worksiteId, setWorksiteId] = React.useState("all")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [measuring, setMeasuring] = React.useState<EngagementRow | null>(null)
  const [closing, setClosing] = React.useState<EngagementRow | null>(null)

  const rows = engagements.filter((row) =>
    (kind === "all" || row.kind === kind) && (worksiteId === "all" || row.worksiteId === worksiteId))

  // La simetría del art. 20 se evalúa por faena: recibir información del
  // mandante sin haber entregado la propia es incumplimiento, y es el caso
  // habitual porque nadie registra lo que entregó.
  const reciprocityGaps = React.useMemo(() => {
    const byWorksite = new Map<string, { name: string; missing: string[] }>()
    for (const worksite of new Set(engagements.map((row) => row.worksiteId))) {
      const scoped = engagements.filter((row) => row.worksiteId === worksite)
      const assessment = assessArt20Reciprocity(scoped)
      if (!assessment.compliant) {
        byWorksite.set(worksite, {
          name: scoped[0]?.worksiteName ?? worksite,
          missing: assessment.missingDelivery.map((type) => COORDINATION_INFO_LABELS[type]),
        })
      }
    }
    return [...byWorksite.values()]
  }, [engagements])

  return (
    <div className="space-y-4">
      {reciprocityGaps.length > 0 && (
        <div role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4 text-sm">
          <strong>Coordinación del art. 20 incompleta.</strong>
          <p className="mt-1">El deber de informar es mutuo: estas faenas recibieron información que no consta haber entregado.</p>
          <ul className="mt-2 space-y-1">
            {reciprocityGaps.map((gap) => (
              <li key={gap.name}>{gap.name} — falta entregar: {gap.missing.join(", ")}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-64" aria-label="Tipo"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(ENGAGEMENT_KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger className="w-56" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas visibles</SelectItem>
            {[...new Map(engagements.map((row) => [row.worksiteId, row.worksiteName])).entries()].map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button type="button" className="ml-auto" onClick={() => setCreateOpen(true)} disabled={worksites.length === 0}>
            Registrar interacción
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin interacciones registradas"
          description="Registra la coordinación con el mandante, una fiscalización o una visita del organismo administrador."
        />
      ) : (
        <TableRoot stickyHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="min-w-[16rem]">Contraparte</TableHead>
                <TableHead className="min-w-[18rem]">Asunto</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Medidas</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead>Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{row.occurredOn}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: `${ENGAGEMENT_KIND_LABELS[row.kind] ?? row.kind}`, variant: engagementKindBadgeVariant(row.kind) }} />
                    {row.kind === "coordinacion" && (
                      <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                        {ENGAGEMENT_DIRECTION_LABELS[row.direction] ?? row.direction}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{row.counterpartyName}</div>
                    <span className="text-xs text-[var(--color-text-muted)]">{COUNTERPARTY_TYPE_LABELS[row.counterpartyType] ?? row.counterpartyType}</span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/prevencion/coordinacion/${row.id}`} className="font-medium hover:underline">{row.subject}</Link>
                    {row.officialReference && <span className="text-xs text-[var(--color-text-muted)]">Acta {row.officialReference}</span>}
                    {row.infoTypes?.length ? (
                      <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                        {row.infoTypes.map((type) => COORDINATION_INFO_LABELS[type as keyof typeof COORDINATION_INFO_LABELS] ?? type).join(" · ")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.worksiteName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.totalMeasures === 0
                      ? <span className="text-[var(--color-text-muted)]">—</span>
                      : <MetaBadge meta={{ label: `${row.openMeasures}/${row.totalMeasures} abiertas`, variant: row.openMeasures > 0 ? "warning" : "success" }} />}
                  </TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: `${row.closedAt ? "Cerrada" : "Abierta"}`, variant: row.closedAt ? "success" : "outline" }} />
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {!row.closedAt && (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="secondary" onClick={() => setMeasuring(row)}>Agregar medida</Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setClosing(row)}>Cerrar</Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}

      <CreateEngagementDialog open={createOpen} onOpenChange={setCreateOpen} worksites={worksites} />
      <AddMeasureDialog row={measuring} onClose={() => setMeasuring(null)} responsibles={responsibles} />
      <CloseEngagementDialog row={closing} onClose={() => setClosing(null)} />
    </div>
  )
}

function CreateEngagementDialog({ open, onOpenChange, worksites }: {
  open: boolean
  onOpenChange: (value: boolean) => void
  worksites: { id: string; name: string }[]
}) {
  const router = useRouter()
  const operation = useOperation()
  const [kind, setKind] = React.useState("coordinacion")
  const [direction, setDirection] = React.useState("received")
  const [counterpartyType, setCounterpartyType] = React.useState("mandante")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [occurredOn, setOccurredOn] = React.useState("")
  const [infoTypes, setInfoTypes] = React.useState<string[]>([])

  const isCoordination = kind === "coordinacion"

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createExternalEngagementAction({
      worksiteId,
      kind,
      // Una fiscalización nunca se "entrega": el servidor lo rechaza igual, pero
      // no vale la pena mandarlo mal.
      direction: isCoordination ? direction : "received",
      counterpartyType,
      counterpartyName: form.get("counterpartyName"),
      counterpartyRut: form.get("counterpartyRut"),
      occurredOn,
      subject: form.get("subject"),
      summary: form.get("summary"),
      officialReference: form.get("officialReference"),
      infoTypes: isCoordination ? infoTypes : undefined,
    }), () => { onOpenChange(false); setInfoTypes([]); router.refresh() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar interacción externa</DialogTitle>
            <DialogDescription>
              Coordinación del art. 20, fiscalización o visita del organismo administrador.
            </DialogDescription>
          </DialogHeader>

          <Field label="Faena">
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
              <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Field label="Tipo">
            <Select value={kind} onValueChange={(value) => { setKind(value); if (value !== "coordinacion") setDirection("received") }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ENGAGEMENT_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {isCoordination && (
            <>
              <Field label="Dirección">
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Recibimos información</SelectItem>
                    <SelectItem value="delivered">Entregamos información</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Información intercambiada</legend>
                {COORDINATION_INFO_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={infoTypes.includes(type)}
                      onChange={(event) => setInfoTypes((current) =>
                        event.target.checked ? [...current, type] : current.filter((item) => item !== type))}
                    />
                    {COORDINATION_INFO_LABELS[type]}
                  </label>
                ))}
              </fieldset>
            </>
          )}

          <Field label="Tipo de contraparte">
            <Select value={counterpartyType} onValueChange={setCounterpartyType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(COUNTERPARTY_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Nombre de la contraparte"><Input name="counterpartyName" required minLength={2} /></Field>
          <Field label="RUT (opcional)"><Input name="counterpartyRut" /></Field>
          <Field label="Fecha"><DatePicker name="occurredOn" value={occurredOn} onChange={setOccurredOn} /></Field>
          <Field label="Asunto"><Input name="subject" required minLength={3} /></Field>
          <Field label={isCoordination ? "N° de acta o referencia (opcional)" : "N° de acta, resolución o comprobante"}>
            <Input name="officialReference" required={!isCoordination} minLength={isCoordination ? undefined : 3} />
          </Field>
          <Field label="Resumen (opcional)"><Textarea name="summary" /></Field>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !occurredOn || !worksiteId}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddMeasureDialog({ row, onClose, responsibles }: {
  row: EngagementRow | null
  onClose: () => void
  responsibles: { id: string; name: string }[]
}) {
  const router = useRouter()
  const operation = useOperation()
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const [targetDate, setTargetDate] = React.useState("")
  const [priority, setPriority] = React.useState("high")

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!row) return
    const form = new FormData(event.currentTarget)
    operation.run(() => addPrescribedMeasureAction({
      engagementId: row.id,
      finding: form.get("finding"),
      actionDescription: form.get("actionDescription"),
      responsibleUserId,
      targetDate,
      priority,
      normativaLegal: form.get("normativaLegal"),
    }), () => { onClose(); router.refresh() })
  }

  return (
    <Dialog open={row !== null} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Medida prescrita</DialogTitle>
            <DialogDescription>
              Se registra como acción correctiva con responsable y plazo. Las medidas del organismo
              administrador son de cumplimiento obligatorio (DS 44 art. 70).
            </DialogDescription>
          </DialogHeader>
          <Field label="Hallazgo constatado"><Textarea name="finding" required minLength={10} /></Field>
          <Field label="Medida a implementar"><Textarea name="actionDescription" required minLength={10} /></Field>
          <Field label="Responsable">
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
              <SelectTrigger><SelectValue placeholder="Selecciona responsable" /></SelectTrigger>
              <SelectContent>{responsibles.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Plazo"><DatePicker name="targetDate" value={targetDate} onChange={setTargetDate} /></Field>
          <Field label="Prioridad">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baja</SelectItem>
                <SelectItem value="medium">Media</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Norma citada (opcional)"><Input name="normativaLegal" placeholder="Ej: DS 44 art. 13" /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !targetDate || !responsibleUserId}>Registrar medida</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CloseEngagementDialog({ row, onClose }: { row: EngagementRow | null; onClose: () => void }) {
  const router = useRouter()
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!row) return
    const form = new FormData(event.currentTarget)
    operation.run(() => closeExternalEngagementAction({
      engagementId: row.id,
      expectedVersion: row.version,
      outcome: form.get("outcome"),
    }), () => { onClose(); router.refresh() })
  }

  return (
    <Dialog open={row !== null} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Cerrar interacción</DialogTitle>
            <DialogDescription>
              {row && row.openMeasures > 0
                ? `Quedan ${row.openMeasures} medida(s) sin verificar: hay que cerrarlas antes.`
                : "Deja constancia del resultado final de la visita o coordinación."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Resultado"><Textarea name="outcome" required minLength={10} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || (row?.openMeasures ?? 0) > 0}>Cerrar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
