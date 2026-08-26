"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import type { ColumnDef } from "@/components/ui/data-table"

export interface EppFamilyRow {
  id: string
  canonicalName: string
  brand: string | null
  model: string | null
  certification: string | null
  lifespanMonths: number | null
  eppTypeLabel: string | null
  categoryName: string
  totalVariants: number
  activeVariants: number
  variants: { id: string; sku: string; name: string; attributes: { name: string; options: string }[] }[]
}

const COLUMNS: ColumnDef[] = [
  { key: "canonicalName", label: "Familia" },
  { key: "eppTypeLabel", label: "Tipo" },
  { key: "brand", label: "Marca" },
  { key: "model", label: "Modelo" },
  { key: "certification", label: "Certificación" },
  { key: "totalVariants", label: "Variantes", numeric: true },
]

interface Props {
  families: EppFamilyRow[]
  eppTypes: { id: string; code: string; label: string }[]
}

export function EppFamilyList({ families, eppTypes }: Props) {
  const rows = families.map((f) => ({
    id: f.id,
    canonicalName: f.canonicalName,
    eppTypeLabel: f.eppTypeLabel ?? "—",
    brand: f.brand ?? "—",
    model: f.model ?? "—",
    certification: f.certification ?? "—",
    totalVariants: String(f.totalVariants),
    categoryName: f.categoryName,
    activeVariants: f.activeVariants,
    variants: f.variants,
    _meta: { eppTypes },
  }))
  type Row = (typeof rows)[number]

  // Una familia sin ninguna variante activa está dada de baja: se muestra
  // aparte para no mezclarla con el catálogo vigente.
  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const activeRows   = rows.filter((row) => row.activeVariants > 0)
  const inactiveRows = rows.filter((row) => row.activeVariants === 0)

  const renderMobileCard = (row: Row) => (
    <ResponsiveDataListCard
      title={row.canonicalName}
      status={<Badge variant="info">{row.eppTypeLabel}</Badge>}
    >
      <ResponsiveDataListField label="Marca / modelo">{row.brand} · {row.model}</ResponsiveDataListField>
      <ResponsiveDataListField label="Categoría">{row.categoryName}</ResponsiveDataListField>
      <ResponsiveDataListField label="Certificación" className="col-span-2">{row.certification}</ResponsiveDataListField>
      <ResponsiveDataListField label="Variantes" className="col-span-2">
        <span className="font-mono tabular-nums text-[var(--color-text)]">{row.activeVariants} activas de {row.totalVariants}</span>
      </ResponsiveDataListField>
    </ResponsiveDataListCard>
  )

  const renderRow = (row: Row) => (
    <tr key={row.id} className="border-b border-(--color-border) hover:bg-(--color-surface-2) transition-colors">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-(--color-text)">{row.canonicalName}</span>
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {row.variants.slice(0, 4).map((v) => (
            <Badge key={v.id} variant="default" size="sm">
              {v.sku}
            </Badge>
          ))}
          {row.variants.length > 4 && (
            <Badge variant="default" size="sm">+{row.variants.length - 4}</Badge>
          )}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge variant="info" size="sm">{row.eppTypeLabel}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.brand}</td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.model}</td>
      <td className="px-4 py-3 text-sm text-(--color-text-muted)">{row.certification}</td>
      <td className="px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">{row.totalVariants}</td>
    </tr>
  )

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "inactive")}>
      <TabsList className="mb-3">
        <TabsTrigger value="active">
          Vigentes
          <span className="ml-1.5 text-xs text-text-subtle">{activeRows.length}</span>
        </TabsTrigger>
        <TabsTrigger value="inactive">
          Dadas de baja
          <span className="ml-1.5 text-xs text-text-subtle">{inactiveRows.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="active">
        <DataTable
          caption="Catálogo de EPP vigente"
          columns={COLUMNS}
          rows={activeRows}
          searchKeys={["canonicalName", "brand", "model", "certification"]}
          emptyTitle="Sin familias vigentes"
          emptyDescription="Ninguna familia de EPP tiene variantes activas."
          renderMobileCard={renderMobileCard}
          renderRow={renderRow}
        />
      </TabsContent>

      <TabsContent value="inactive">
        <DataTable
          caption="Familias de EPP dadas de baja"
          columns={COLUMNS}
          rows={inactiveRows}
          searchKeys={["canonicalName", "brand", "model", "certification"]}
          emptyTitle="Sin familias dadas de baja"
          emptyDescription="Aquí aparecen las familias cuyas variantes se desactivaron. Su historial de entregas se conserva."
          renderMobileCard={renderMobileCard}
          renderRow={renderRow}
        />
      </TabsContent>
    </Tabs>
  )
}
