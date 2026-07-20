"use client"

import * as React from "react"
import Link from "next/link"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"
import { createInspectionRunAction } from "./actions"
import { Field, selectClass, useOperation } from "./inspection-form-kit"

interface TemplateOption {
  id: string
  name: string
  versionLabel: string
}

interface RunItem {
  id: string
  code: string
  status: string
  templateName: string
  templateKind: string
  subjectLabel: string | null
  worksiteId: string
  worksiteName: string
  executedAt: string | null
  compliancePercent: number | null
  nonConformingCount: number
  openFindings: number
  criticalFindings: number
}

type QuickFilter = "all" | "pending_review" | "open_findings" | "critical"

interface Props {
  runs: RunItem[]
  overdueProgramCount: number
  canExecute: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
}

export function InspectionRunList({ runs, overdueProgramCount, canExecute, templates, worksites, assignees }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")
  const [worksite, setWorksite] = React.useState("all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")

  // Faenas presentes en las inspecciones listadas: el filtro sólo debe
  // ofrecer valores que puedan devolver alguna fila, no todo el alcance.
  const runWorksites = React.useMemo(() => {
    const map = new Map(runs.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [runs])

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = runs.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    if (quickFilter === "pending_review" && item.status !== "completed") return false
    if (quickFilter === "open_findings" && item.openFindings === 0) return false
    if (quickFilter === "critical" && item.criticalFindings === 0) return false
    if (!query) return true
    return `${item.code} ${item.templateName} ${item.subjectLabel ?? ""} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const metrics = [
    { id: "pending-review", key: "pending_review" as const, label: "Esperando revisión", value: runs.filter((item) => item.status === "completed").length, detail: "Ejecutadas sin cerrar" },
    { id: "open-findings", key: "open_findings" as const, label: "Con hallazgos abiertos", value: runs.filter((item) => item.openFindings > 0).length, detail: "Requieren acción" },
    { id: "critical", key: "critical" as const, label: "Con hallazgo grave", value: runs.filter((item) => item.criticalFindings > 0).length, detail: "Alto o crítico" },
    { id: "overdue", key: "all" as const, label: "Programaciones vencidas", value: overdueProgramCount, detail: "Inspección no ejecutada a tiempo" },
  ]

  function clearFilters() {
    setStatus("all"); setWorksite("all"); setQuickFilter("all")
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setQuickFilter((current) => current === metric.key ? "all" : metric.key)}
            aria-pressed={quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select value={status} onValueChange={(value) => { setStatus(value); setQuickFilter("all") }}>
          <SelectTrigger className="w-56" aria-label="Estado de la inspección"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(INSPECTION_RUN_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={setWorksite}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {runWorksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || worksite !== "all" || quickFilter !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
        {canExecute && templates.length > 0 && worksites.length > 0 && (
          <div className="ml-auto">
            <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlass size={20} />}
          title={runs.length === 0 ? "Aún no hay inspecciones ejecutadas" : "No hay inspecciones con estos filtros"}
          description={runs.length === 0
            ? "Incorpora una plantilla del catálogo, apruébala y prográmala por faena. Cada incumplimiento genera un hallazgo, y los graves exigen una acción CAPA antes de cerrar."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={runs.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>
            : canExecute && templates.length > 0 && worksites.length > 0
              ? <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} />
              : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / plantilla</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Faena / sujeto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ejecutada</TableHead>
                <TableHead className="text-right" title="Porcentaje sobre ítems evaluables; excluye los no aplica">Cumplimiento</TableHead>
                <TableHead className="text-right" title="Hallazgos abiertos y, entre paréntesis, los graves">Hallazgos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/prevencion/inspecciones/${item.id}`} className="hover:underline">
                      <span className="font-mono text-xs">{item.code}</span>
                      <span className="block text-sm font-medium">{item.templateName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.templateKind] ?? item.templateKind}</TableCell>
                  <TableCell className="text-sm">
                    {item.worksiteName}
                    {item.subjectLabel && <span className="block text-xs text-[var(--color-text-subtle)]">{item.subjectLabel}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusBadgeVariant(item.status)}>
                      {INSPECTION_RUN_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{item.executedAt ? formatDateTime(item.executedAt) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.compliancePercent === null ? "No calculable" : `${item.compliancePercent}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.openFindings}{item.criticalFindings > 0 && ` (${item.criticalFindings})`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Alta de inspección ───────────────────────────────────────────────────── */

function NewRunDialog({ templates, worksites, assignees }: {
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const subjectLabel = String(form.get("subjectLabel") ?? "").trim()
    const scheduledFor = String(form.get("scheduledFor") ?? "").trim()
    const assignedToUserId = String(form.get("assignedToUserId") ?? "").trim()
    operation.run(() => createInspectionRunAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      subjectType: subjectType || null,
      subjectLabel: subjectLabel || null,
      scheduledFor: scheduledFor || null,
      assignedToUserId: assignedToUserId || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nueva inspección</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva inspección</DialogTitle>
            <DialogDescription>Sólo puede ejecutarse una plantilla aprobada. Las respuestas se registran después, desde el detalle.</DialogDescription>
          </DialogHeader>
          <Field label="Plantilla">
            <select name="templateId" className={selectClass} required>
              {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.versionLabel}</option>)}
            </select>
          </Field>
          <Field label="Faena">
            <select name="worksiteId" className={selectClass} required>
              {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor."><Input name="subjectType" maxLength={120} /></Field>
            <Field label="Identificación del sujeto" hint="Opcional. Ej: TAG o patente."><Input name="subjectLabel" maxLength={300} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Programada para" hint="Opcional."><Input name="scheduledFor" type="date" /></Field>
            <Field label="Asignada a" hint="Vacío = quien la crea.">
              <select name="assignedToUserId" className={selectClass} defaultValue="">
                <option value="">Quien la crea</option>
                {assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
