"use client"

import * as React from "react"
import Link from "next/link"
import { Certificate } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  TRAINING_KIND_LABELS,
  TRAINING_MODALITY_LABELS,
  TRAINING_SESSION_STATUS_LABELS,
} from "@/lib/prevention/training"
import { formatDateTime } from "@/lib/utils"
import { acknowledgeTrainingAction } from "./actions"

interface SessionItem {
  id: string
  code: string
  status: string
  modality: string
  scheduledAt: string
  endedAt: string | null
  durationMinutes: number | null
  worksiteId: string
  worksiteName: string
  courseName: string
  courseKind: string
  versionLabel: string
  convenedCount: number
  attendedCount: number
  acknowledgedCount: number
}

interface PendingAck {
  attendanceId: string
  sessionCode: string
  courseName: string
  endedAt: string | null
}

interface Props {
  sessions: SessionItem[]
  courseCount: number
  blockingGapCount: number
  pendingAcks: PendingAck[]
  canAck: boolean
}

type QuickFilter = "all" | "planned" | "pending_ack" | "blocking_gaps"

function statusBadgeVariant(status: string): "default" | "info" | "success" | "outline" {
  if (status === "completed") return "success"
  if (status === "in_progress") return "info"
  if (status === "cancelled") return "outline"
  return "default"
}

function showDateTime(value: string | null) {
  return value ? formatDateTime(value) : "—"
}

export function TrainingSessionList({ sessions, courseCount, blockingGapCount, pendingAcks, canAck }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")
  const [worksite, setWorksite] = React.useState("all")
  const [kind, setKind] = React.useState("all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")
  const [ackPending, startAck] = React.useTransition()
  const [ackMessage, setAckMessage] = React.useState<string | null>(null)

  const worksites = React.useMemo(() => {
    const map = new Map(sessions.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [sessions])

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = sessions.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    if (kind !== "all" && item.courseKind !== kind) return false
    if (quickFilter === "planned" && item.status !== "planned") return false
    if (quickFilter === "pending_ack" && item.acknowledgedCount >= item.attendedCount) return false
    if (!query) return true
    return `${item.code} ${item.courseName} ${item.worksiteName} ${item.versionLabel}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const pendingAckTotal = sessions.reduce((total, item) => total + Math.max(0, item.attendedCount - item.acknowledgedCount), 0)

  const metrics = [
    { key: "planned" as const, label: "Sesiones planificadas", value: sessions.filter((item) => item.status === "planned").length, detail: "Convocadas sin dictar", href: null },
    { key: "pending_ack" as const, label: "Acuses pendientes", value: pendingAckTotal, detail: "Asistieron y no han firmado", href: null },
    { key: "blocking_gaps" as const, label: "Brechas bloqueantes", value: blockingGapCount, detail: "Personas sin habilitación exigida", href: "/prevencion/capacitacion/brechas" },
    { key: "all" as const, label: "Cursos en catálogo", value: courseCount, detail: "Contenidos versionados", href: "/prevencion/capacitacion/competencias" },
  ]

  function clearFilters() {
    setStatus("all"); setWorksite("all"); setKind("all"); setQuickFilter("all")
  }

  function submitAck(attendanceId: string) {
    setAckMessage(null)
    startAck(async () => {
      const result = await acknowledgeTrainingAction({ attendanceId, method: "platform_click" })
      setAckMessage(result.ok ? "Acuse registrado." : result.message ?? "No se pudo acusar recibo.")
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => metric.href ? (
          <Link
            key={metric.label}
            href={metric.href}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </Link>
        ) : (
          <button
            key={metric.label}
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

      {canAck && pendingAcks.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="text-sm font-semibold">Tus capacitaciones pendientes de acuse</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            El acuse firma la versión exacta del contenido que recibiste. Nadie puede acusarlo por ti.
          </p>
          <ul className="mt-3 space-y-2">
            {pendingAcks.map((item) => (
              <li key={item.attendanceId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <strong>{item.courseName}</strong>{" "}
                  <span className="text-[var(--color-text-subtle)]">({item.sessionCode} · {showDateTime(item.endedAt)})</span>
                </span>
                <Button type="button" size="sm" disabled={ackPending} onClick={() => submitAck(item.attendanceId)}>
                  Acusar recibo
                </Button>
              </li>
            ))}
          </ul>
          {ackMessage && <p role="status" className="mt-2 text-sm">{ackMessage}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Select value={status} onValueChange={(value) => { setStatus(value); setQuickFilter("all") }}>
          <SelectTrigger className="w-48" aria-label="Estado de la sesión"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(TRAINING_SESSION_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56" aria-label="Tipo de capacitación"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(TRAINING_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={setWorksite}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || worksite !== "all" || kind !== "all" || quickFilter !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Certificate size={20} />}
          title={sessions.length === 0 ? "Aún no hay sesiones de capacitación" : "No hay sesiones con estos filtros"}
          description={sessions.length === 0
            ? "Publica una versión de curso y programa una sesión para empezar a registrar asistencia, evaluación y acuses."
            : "Ajusta los filtros o el texto del buscador superior para volver a ver sesiones."}
          action={sessions.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>
            : <Button asChild><Link href="/prevencion/capacitacion/competencias">Ver catálogo y competencias</Link></Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / curso</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Programada</TableHead>
                <TableHead className="text-right" title="Convocados / asistentes / acuses">Conv. / Asist. / Acuses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.courseName}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">Versión {item.versionLabel} · {TRAINING_MODALITY_LABELS[item.modality] ?? item.modality}</span>
                  </TableCell>
                  <TableCell className="text-sm">{TRAINING_KIND_LABELS[item.courseKind] ?? item.courseKind}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.status)}>
                      {TRAINING_SESSION_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{showDateTime(item.scheduledAt)}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.convenedCount} / {item.attendedCount} / {item.acknowledgedCount}
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
