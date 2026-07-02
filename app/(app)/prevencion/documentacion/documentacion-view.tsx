"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  FilePlus,
  FolderOpen,
  MagnifyingGlass,
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

export function DocumentacionView(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { counters, documents, categories, searchParams: incoming, total, canManage } = props

  const [q, setQ] = React.useState(incoming.q ?? "")
  const [status, setStatus] = React.useState(incoming.status ?? "")

  const activeCategory = incoming.category && incoming.category !== "all" ? incoming.category : null
  const activeCategoryRow = activeCategory ? categories.find((c) => c.slug === activeCategory) : null

  const applyFilters = React.useCallback((next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (next.q !== undefined) { if (next.q) sp.set("q", next.q); else sp.delete("q") }
    if (next.status !== undefined) { if (next.status) sp.set("status", next.status); else sp.delete("status") }
    router.push(`/prevencion/documentacion?${sp.toString()}`)
  }, [router, searchParams])

  // ── Folder grid (no category selected) ───────────────────────────────────
  if (!activeCategory) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-(--color-border) bg-(--color-chrome) px-4 py-3 text-sm">
          <StatChip label="Total" value={counters.total} />
          <StatChip label="Vigentes" value={counters.byStatus.vigente} tone="success" />
          <StatChip label="En revisión" value={counters.byStatus.en_revision} tone="info" />
          <StatChip label="Observados" value={counters.byStatus.observado} tone="warning" />
          <StatChip label="Vencidos" value={counters.byStatus.vencido} tone="danger" />
          <StatChip label="Próximos ≤30 d" value={counters.expiringSoon.within30} tone="warning" />
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/prevencion/documentacion?category=${cat.slug}`}
              data-pressable
              className="group rounded-xl border border-(--color-border) bg-(--color-surface) p-4 transition-[border-color,background-color] duration-(--duration-fast) hover:border-(--color-primary-muted) hover:bg-(--color-primary-tint)"
            >
              <FolderOpen
                size={32}
                weight="duotone"
                className="mb-3 text-(--color-primary) transition-transform duration-(--duration-fast) group-hover:scale-110"
              />
              <p className="mb-1 text-sm font-semibold text-(--color-text) leading-tight">{cat.name}</p>
              {cat.description && (
                <p className="text-xs text-(--color-text-subtle) line-clamp-2 leading-relaxed">{cat.description}</p>
              )}
            </Link>
          ))}
        </div>

        {canManage && (
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/prevencion/documentacion/nuevo">
                <FilePlus size={16} className="mr-1" />
                Nuevo documento
              </Link>
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ── Document list (category selected) ────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/prevencion/documentacion"
          data-pressable
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--color-text-subtle) transition-[background-color] duration-(--duration-fast) hover:bg-(--color-chrome-hover) hover:text-(--color-text)"
        >
          <ArrowLeft size={18} />
        </Link>
        <FolderOpen size={20} weight="duotone" className="text-(--color-primary)" />
        <h2 className="text-lg font-semibold text-(--color-text)">{activeCategoryRow?.name ?? activeCategory}</h2>
        {canManage && (
          <div className="ml-auto">
            <Button asChild size="sm">
              <Link href="/prevencion/documentacion/nuevo">
                <FilePlus size={14} className="mr-1" />
                Nuevo documento
              </Link>
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); applyFilters({ q, status }) }}
      >
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" size={16} />
          <Input
            className="pl-9"
            placeholder="Título, código..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {(q || (status && status !== "all")) && (
          <Button type="button" variant="ghost" onClick={() => { setQ(""); setStatus(""); applyFilters({ q: "", status: "" }) }}>
            Limpiar
          </Button>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-(--color-text-subtle)">
            {total} documento{total === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <EmptyState
              title="No hay documentos"
              description="Esta carpeta está vacía o no coincide con los filtros."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => {
                  const tone = STATUS_TONES[d.status] ?? "default"
                  const days = d.daysUntilExpiry
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <Link href={`/prevencion/documentacion/${d.id}`} className="font-medium text-(--color-text) hover:underline">
                            {d.title}
                          </Link>
                          {d.internalCode && (
                            <span className="text-xs text-(--color-text-subtle)">{d.internalCode}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={tone}>{STATUS_LABELS[d.status as SstDocumentStatus] ?? d.status}</Badge></TableCell>
                      <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {d.expiresAt ? (
                          <Tooltip content={`${d.expiresAt}${days !== null ? ` · ${days} día(s)` : ""}`}>
                            <span className={cn(
                              days !== null && days < 0 && "font-semibold text-(--color-danger)",
                              days !== null && days >= 0 && days <= 30 && "text-(--color-warning)",
                            )}>
                              {d.expiresAt}
                            </span>
                          </Tooltip>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/prevencion/documentacion/${d.id}`}>Ver</Link>
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
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "success" | "info" | "warning" | "danger" }) {
  return (
    <span className="flex items-center gap-1.5 text-(--color-text-subtle)">
      <span className="text-xs">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        tone === "success" && "text-(--color-success)",
        tone === "info" && "text-(--color-info)",
        tone === "warning" && "text-(--color-warning)",
        tone === "danger" && "text-(--color-danger)",
        !tone && "text-(--color-text)",
      )}>
        {value}
      </span>
    </span>
  )
}
