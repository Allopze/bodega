"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { PencilSimple } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { setEppFamilyTypeAction } from "./actions"
import { EppFamilyForm, type EppFamilyEditRow } from "./epp-family-form"

import type { ColumnDef } from "@/components/ui/data-table"

export interface EppFamilyRow {
  id: string
  canonicalName: string
  brand: string | null
  model: string | null
  certification: string | null
  lifespanMonths: number | null
  eppTypeId: string | null
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
  { key: "lifespanLabel", label: "Vida útil" },
  { key: "totalVariants", label: "Variantes", numeric: true },
  { key: "", label: "", sortable: false, width: "w-12" },
]

interface Props {
  families: EppFamilyRow[]
  eppTypes: { id: string; code: string; label: string }[]
}

const toRow = (f: EppFamilyRow) => ({
  id: f.id,
  canonicalName: f.canonicalName,
  eppTypeId: f.eppTypeId,
  eppTypeLabel: f.eppTypeLabel ?? "—",
  brand: f.brand ?? "—",
  model: f.model ?? "—",
  certification: f.certification ?? "—",
  // `lifespanMonths` se cargaba desde la página pero no se mostraba en
  // ninguna parte, y es justo el campo que enciende el vencimiento de EPP.
  lifespanLabel: f.lifespanMonths != null ? `${f.lifespanMonths} meses` : "No vence",
  lifespanMonths: f.lifespanMonths,
  brandRaw: f.brand,
  modelRaw: f.model,
  certificationRaw: f.certification,
  totalVariants: String(f.totalVariants),
  categoryName: f.categoryName,
  activeVariants: f.activeVariants,
  variants: f.variants,
})

type Row = ReturnType<typeof toRow>

// La fila lleva valores de presentación ("—", "No vence"); el formulario
// necesita los crudos o guardaría el guión como marca.
const toEditRow = (row: Row): EppFamilyEditRow => ({
  id: row.id,
  canonicalName: row.canonicalName,
  brand: row.brandRaw,
  model: row.modelRaw,
  certification: row.certificationRaw,
  lifespanMonths: row.lifespanMonths,
})

export function EppFamilyList({ families, eppTypes }: Props) {
  const rows = families.map(toRow)

  // Una familia sin ninguna variante activa está dada de baja: se muestra
  // aparte para no mezclarla con el catálogo vigente.
  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const activeRows   = rows.filter((row) => row.activeVariants > 0)
  const inactiveRows = rows.filter((row) => row.activeVariants === 0)

  // Ninguna otra pantalla escribe `eppTypeId`: una familia creada antes de que
  // el import/formulario supieran inferirlo (o que no tienen cómo inferirlo)
  // se queda sin clasificar para siempre si no hay dónde corregirla. La
  // cobertura EPP de Prevención hace INNER JOIN sobre este campo, así que sin
  // esto ninguna entrega de una familia sin tipo cuenta como cobertura.
  const [editFamily, setEditFamily] = React.useState<EppFamilyEditRow | null>(null)
  const [savingId, setSavingId] = React.useState<string | null>(null)
  function handleTypeChange(familyId: string, eppTypeId: string) {
    setSavingId(familyId)
    setEppFamilyTypeAction(familyId, eppTypeId)
      .then((result) => {
        if (result.ok) toast.success(result.message ?? "Tipo actualizado")
        else toast.error(result.message ?? "No se pudo actualizar el tipo")
      })
      .finally(() => setSavingId(null))
  }

  const typeSelect = (row: Row) => (
    <Select value={row.eppTypeId ?? ""} onValueChange={(value) => handleTypeChange(row.id, value)} disabled={savingId === row.id}>
      <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Tipo de EPP para ${row.canonicalName}`}>
        <SelectValue placeholder="Sin clasificar" />
      </SelectTrigger>
      <SelectContent>
        {eppTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  const renderMobileCard = (row: Row) => (
    <ResponsiveDataListCard
      title={row.canonicalName}
      status={row.eppTypeId ? <MetaBadge meta={{ label: row.eppTypeLabel, variant: "info" }} /> : <MetaBadge meta={{ label: "Sin clasificar", variant: "warning" }} />}
    >
      <ResponsiveDataListField label="Tipo de EPP" className="col-span-2">{typeSelect(row)}</ResponsiveDataListField>
      <ResponsiveDataListField label="Marca / modelo">{row.brand} · {row.model}</ResponsiveDataListField>
      <ResponsiveDataListField label="Categoría">{row.categoryName}</ResponsiveDataListField>
      <ResponsiveDataListField label="Certificación">{row.certification}</ResponsiveDataListField>
      <ResponsiveDataListField label="Vida útil">{row.lifespanLabel}</ResponsiveDataListField>
      <ResponsiveDataListField label="Variantes" className="col-span-2">
        <span className="font-mono tabular-nums text-[var(--color-text)]">{row.activeVariants} activas de {row.totalVariants}</span>
      </ResponsiveDataListField>
      <ResponsiveDataListField label="" className="col-span-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditFamily(toEditRow(row))}>
          <PencilSimple size={15} />Editar ficha
        </Button>
      </ResponsiveDataListField>
    </ResponsiveDataListCard>
  )

  const renderRow = (row: Row) => (
    <tr key={row.id} className="border-b border-(--color-border) hover:bg-(--color-surface-2) transition-colors">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-(--color-text)">{row.canonicalName}</span>
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {row.variants.slice(0, 4).map((v) => (
            <MetaBadge key={v.id} meta={{ label: `${v.sku}`, variant: "default" }} />
          ))}
          {row.variants.length > 4 && (
            <MetaBadge meta={{ label: `+${row.variants.length - 4}`, variant: "default" }} />
          )}
        </span>
      </td>
      <td className="px-4 py-3">{typeSelect(row)}</td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.brand}</td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.model}</td>
      <td className="px-4 py-3 text-sm text-(--color-text-muted)">{row.certification}</td>
      <td className="px-4 py-3 text-sm text-(--color-text-muted)">{row.lifespanLabel}</td>
      <td className="px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">{row.totalVariants}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => setEditFamily(toEditRow(row))}
          className="rounded p-1.5 text-(--color-text-subtle) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-text)"
          aria-label={`Editar familia ${row.canonicalName}`}
        >
          <PencilSimple size={16} />
        </button>
      </td>
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

      <EppFamilyForm
        key={editFamily?.id ?? "none"}
        open={!!editFamily}
        onClose={() => setEditFamily(null)}
        family={editFamily}
      />
    </Tabs>
  )
}
