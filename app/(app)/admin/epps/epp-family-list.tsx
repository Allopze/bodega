"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { DesktopOnlyTableNotice } from "@/components/ui/desktop-only-table"

import type { ColumnDef } from "@/components/admin/data-table"

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

  return (
    <>
  <DesktopOnlyTableNotice />
      <DataTable
        caption="Catálogo de EPP"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["canonicalName", "brand", "model", "certification"]}
        renderRow={(row) => (
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
        )}
      />
    </>
  )
}
