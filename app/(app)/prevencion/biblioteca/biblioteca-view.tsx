"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Books,
  CheckCircle,
  ClockCounterClockwise,
  FilePlus,
  MagnifyingGlass,
  WarningOctagon,
  Warning,
} from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DashboardCounters, ExpiringDocument, SstDocumentStatus } from "@/lib/services/prevention-documents-library"

interface CategoryRow {
  slug: string
  name: string
  description: string | null
  sortOrder: number
}

interface TypeRow {
  id: string
  categorySlug: string
  code: string
  name: string
}

interface DocumentRow {
  id: string
  title: string
  internalCode: string | null
  categorySlug: string
  status: string
  confidentiality: string
  worksiteId: string | null
  worksiteName: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  uploaderName: string | null
  expiresAt: string | null
  daysUntilExpiry: number | null
  currentVersionId: string | null
  requiresAcknowledgment: boolean
  updatedAt: string
}

interface Props {
  counters: DashboardCounters
  expiring: Array<ExpiringDocument & { worksiteName: string | null; responsibleName: string | null }>
  documents: DocumentRow[]
  categories: CategoryRow[]
  types: TypeRow[]
  searchParams: { q?: string; category?: string; status?: string; worksiteId?: string }
  total: number
  canManage: boolean
  canApprove: boolean
  canAck: boolean
  canArchive: boolean
}

const STATUS_LABELS: Record<SstDocumentStatus, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "primary" | "signal" | "outline"> = {
  borrador: "default",
  en_revision: "info",
  observado: "warning",
  aprobado: "info",
  vigente: "success",
  vencido: "danger",
  reemplazado: "outline",
  archivado: "outline",
}

export function BibliotecaView(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { counters, expiring, documents, categories, types, searchParams: incoming, total, canManage, canApprove, canAck, canArchive } = props

  const [q, setQ] = React.useState(incoming.q ?? "")
  const [category, setCategory] = React.useState(incoming.category ?? "")
  const [status, setStatus] = React.useState(incoming.status ?? "")

  const applyFilters = React.useCallback((next: { q?: string; category?: string; status?: string }) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (next.q !== undefined) {
      if (next.q) sp.set("q", next.q)
      else sp.delete("q")
    }
    if (next.category !== undefined) {
      if (next.category) sp.set("category", next.category)
      else sp.delete("category")
    }
    if (next.status !== undefined) {
      if (next.status) sp.set("status", next.status)
      else sp.delete("status")
    }
    router.push(`/prevencion/biblioteca?${sp.toString()}`)
  }, [router, searchParams])

  return (
    <div className="space-y-6">
      {/* Dashboard counters */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <CounterCard label="Total"        value={counters.total} icon={<Books />} tone="info" />
        <CounterCard label="Vigentes"     value={counters.byStatus.vigente} icon={<CheckCircle />} tone="success" />
        <CounterCard label="En revisión"  value={counters.byStatus.en_revision} icon={<ClockCounterClockwise />} tone="info" />
        <CounterCard label="Observados"   value={counters.byStatus.observado} icon={<Warning />} tone="warning" />
        <CounterCard label="Vencidos"     value={counters.byStatus.vencido} icon={<WarningOctagon />} tone="danger" />
        <CounterCard label="≤ 7 días"     value={counters.expiringSoon.within7} icon={<WarningOctagon />} tone="danger" />
        <CounterCard label="≤ 15 días"    value={counters.expiringSoon.within15} icon={<Warning />} tone="warning" />
        <CounterCard label="≤ 30 días"    value={counters.expiringSoon.within30} icon={<ClockCounterClockwise />} tone="info" />
      </div>

      {/* Filtros y tabla */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Documentos</CardTitle>
            <p className="text-sm text-[var(--color-text-subtle)]">
              {total} documento{total === 1 ? "" : "s"} encontrado{total === 1 ? "" : "s"}.
            </p>
          </div>
          {canManage ? (
            <Button asChild>
              <Link href="/prevencion/biblioteca/nuevo">
                <FilePlus size={16} className="mr-1" />
                Nuevo documento
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-3 md:grid-cols-4"
            onSubmit={(e) => { e.preventDefault(); applyFilters({ q, category, status }) }}
          >
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Búsqueda</label>
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" size={16} />
                <Input
                  className="pl-9"
                  placeholder="Título, código, descripción..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Categoría</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Estado</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setQ(""); setCategory(""); setStatus(""); applyFilters({ q: "", category: "", status: "" }) }}>
                Limpiar
              </Button>
              <Button type="submit">Aplicar filtros</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <EmptyState
              title="No hay documentos para mostrar"
              description="Ajusta los filtros o sube un nuevo documento para empezar."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Confidencialidad</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => {
                  const cat = categories.find((c) => c.slug === d.categorySlug)
                  const tone = STATUS_TONES[d.status] ?? "default"
                  const days = d.daysUntilExpiry
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <Link href={`/prevencion/biblioteca/${d.id}`} className="font-medium text-[var(--color-text)] hover:underline">
                            {d.title}
                          </Link>
                          <span className="text-xs text-[var(--color-text-subtle)]">
                            {d.internalCode || "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--color-text-subtle)]">{cat?.name ?? d.categorySlug}</TableCell>
                      <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
                      <TableCell><Badge variant={tone}>{STATUS_LABELS[d.status as SstDocumentStatus] ?? d.status}</Badge></TableCell>
                      <TableCell className="text-xs">{d.confidentiality}</TableCell>
                      <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {d.expiresAt ? (
                          <Tooltip content={`${d.expiresAt}${days !== null ? ` · ${days} día(s)` : ""}`}>
                            <span className={cn(
                              days !== null && days < 0 && "font-semibold text-[var(--color-danger)]",
                              days !== null && days >= 0 && days <= 30 && "text-[var(--color-warning)]",
                            )}>
                              {d.expiresAt}
                            </span>
                          </Tooltip>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/prevencion/biblioteca/${d.id}`}>Ver</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {expiring.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Próximos a vencer y vencidos</CardTitle>
            <p className="text-sm text-[var(--color-text-subtle)]">
              {expiring.length} documento{expiring.length === 1 ? "" : "s"} requieren atención.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Días</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Responsable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link href={`/prevencion/biblioteca/${e.id}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONES[e.status] ?? "default"}>{STATUS_LABELS[e.status as SstDocumentStatus] ?? e.status}</Badge></TableCell>
                    <TableCell className="text-xs">{e.expiresAt ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className={cn(
                        e.daysRemaining !== null && e.daysRemaining < 0 && "font-semibold text-[var(--color-danger)]",
                        e.daysRemaining !== null && e.daysRemaining >= 0 && e.daysRemaining <= 7 && "text-[var(--color-warning)]",
                      )}>
                        {e.daysRemaining ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{e.worksiteName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{e.responsibleName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function CounterCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "info" | "success" | "warning" | "danger" }) {
  return (
    <Card>
      <CardContent className="flex flex-row items-center gap-3 p-4">
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md",
          tone === "success" && "bg-[var(--color-success-soft)] text-[var(--color-success)]",
          tone === "info" && "bg-[var(--color-info-soft)] text-[var(--color-info)]",
          tone === "warning" && "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
          tone === "danger" && "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
        )}>
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}
