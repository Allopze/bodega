"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { PencilSimple, Warning, ArrowsMerge, Sparkle } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { setEppFamilyTypeAction } from "./actions"
import { EppFamilyForm, type EppFamilyEditRow } from "./epp-family-form"
import { getEppFamilyWarnings, formatLifespan, suggestEppTypeId } from "./epp-family-list.helpers"
import { MergeFamilyDialog } from "./merge-family-dialog"
import { ApplySuggestionsDialog, type EppTypeSuggestion } from "./apply-suggestions-dialog"

import type { ColumnDef } from "@/components/ui/data-table"

export interface EppFamilyRow {
  id: string
  canonicalName: string
  brand: string | null
  model: string | null
  certification: string | null
  lifespanMonths: number | null
  lifespanNotApplicable: boolean
  pictogramUrl: string | null
  eppTypeId: string | null
  eppTypeLabel: string | null
  categoryName: string
  categoryId: string
  totalVariants: number
  activeVariants: number
  variants: { id: string; sku: string; name: string }[]
}

const COLUMNS: ColumnDef[] = [
  { key: "canonicalName", label: "Familia" },
  { key: "eppTypeLabel", label: "Tipo" },
  { key: "brand", label: "Marca" },
  { key: "model", label: "Modelo" },
  { key: "certification", label: "Certificación" },
  { key: "lifespanLabel", label: "Vida útil" },
  { key: "totalVariants", label: "Variantes", numeric: true },
  { key: "", label: "", sortable: false, width: "w-20" },
]

interface Props {
  families: EppFamilyRow[]
  eppTypes: { id: string; code: string; label: string }[]
  categories: { id: string; name: string }[]
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
  lifespanLabel: formatLifespan(f.lifespanMonths, f.lifespanNotApplicable),
  lifespanMonths: f.lifespanMonths,
  lifespanNotApplicable: f.lifespanNotApplicable,
  pictogramUrl: f.pictogramUrl,
  // Los SKU son el elemento visual dominante de la primera columna y no se
  // podían buscar: se ven y no se encuentran.
  skuSearch: f.variants.map((v) => v.sku).join(" "),
  warnings: getEppFamilyWarnings({
    eppTypeId: f.eppTypeId,
    lifespanMonths: f.lifespanMonths,
    lifespanNotApplicable: f.lifespanNotApplicable,
    certification: f.certification,
    brand: f.brand,
    model: f.model,
  }),
  brandRaw: f.brand,
  modelRaw: f.model,
  certificationRaw: f.certification,
  totalVariants: String(f.totalVariants),
  categoryName: f.categoryName,
  categoryId: f.categoryId,
  activeVariants: f.activeVariants,
  variants: f.variants,
})

type Row = ReturnType<typeof toRow>

// La fila lleva valores de presentación ("—", "No vence"); el formulario
// necesita los crudos o guardaría el guión como marca.
const toEditRow = (row: Row): EppFamilyEditRow => ({
  id: row.id,
  canonicalName: row.canonicalName,
  categoryId: row.categoryId,
  brand: row.brandRaw,
  model: row.modelRaw,
  certification: row.certificationRaw,
  lifespanMonths: row.lifespanMonths,
  lifespanNotApplicable: row.lifespanNotApplicable,
  pictogramUrl: row.pictogramUrl,
})

export function EppFamilyList({ families, eppTypes, categories }: Props) {
  const typeIdByCode = React.useMemo(
    () => new Map(eppTypes.map((type) => [type.code, type.id])),
    [eppTypes],
  )
  const typeLabelById = React.useMemo(
    () => new Map(eppTypes.map((type) => [type.id, type.label])),
    [eppTypes],
  )
  const rows = families.map(toRow)

  // Sólo se sugiere sobre lo que está sin clasificar: la decisión de una
  // persona nunca se propone reemplazar.
  const suggestions = React.useMemo<EppTypeSuggestion[]>(
    () => families.flatMap((family) => {
      if (family.eppTypeId) return []
      const eppTypeId = suggestEppTypeId(family.canonicalName, typeIdByCode)
      if (!eppTypeId) return []
      return [{
        familyId: family.id,
        familyName: family.canonicalName,
        eppTypeId,
        eppTypeLabel: typeLabelById.get(eppTypeId) ?? eppTypeId,
      }]
    }),
    [families, typeIdByCode, typeLabelById],
  )
  const suggestionByFamily = React.useMemo(
    () => new Map(suggestions.map((s) => [s.familyId, s])),
    [suggestions],
  )
  const [reviewOpen, setReviewOpen] = React.useState(false)

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
  const [mergeSource, setMergeSource] = React.useState<{ id: string; name: string } | null>(null)
  const mergeCandidates = React.useMemo(
    () => rows.map((row) => ({ id: row.id, name: row.canonicalName })),
    [rows],
  )
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

  const typeSelect = (row: Row) => {
    const suggestion = suggestionByFamily.get(row.id)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={row.eppTypeId ?? ""} onValueChange={(value) => handleTypeChange(row.id, value)} disabled={savingId === row.id}>
          <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Tipo de EPP para ${row.canonicalName}`}>
            <SelectValue placeholder="Sin clasificar" />
          </SelectTrigger>
          <SelectContent>
            {eppTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Propuesta, no valor guardado: pre-seleccionar el desplegable haría
            parecer decidido algo que nadie decidió. */}
        {suggestion && (
          <button
            type="button"
            onClick={() => handleTypeChange(row.id, suggestion.eppTypeId)}
            disabled={savingId === row.id}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-(--color-primary) px-2 py-0.5 text-xs text-(--color-primary) transition-colors hover:bg-(--color-primary-tint) disabled:opacity-50"
            title={`Clasificar «${row.canonicalName}» como ${suggestion.eppTypeLabel}`}
            aria-label={`Aplicar tipo sugerido ${suggestion.eppTypeLabel} a ${row.canonicalName}`}
          >
            <Sparkle size={12} />{suggestion.eppTypeLabel}
          </button>
        )}
      </div>
    )
  }

  const renderMobileCard = (row: Row) => (
    <ResponsiveDataListCard
      title={row.canonicalName}
      status={row.eppTypeId ? <MetaBadge meta={{ label: row.eppTypeLabel, variant: "info" }} /> : <MetaBadge meta={{ label: "Sin clasificar", variant: "warning" }} />}
    >
      {row.warnings.length > 0 && (
        <ResponsiveDataListField label="" className="col-span-2">
          <ul className="space-y-0.5">
            {row.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-xs text-(--color-warning)">
                <Warning size={13} className="mt-0.5 shrink-0" />{warning}
              </li>
            ))}
          </ul>
        </ResponsiveDataListField>
      )}
      <ResponsiveDataListField label="Tipo de EPP" className="col-span-2">{typeSelect(row)}</ResponsiveDataListField>
      <ResponsiveDataListField label="Marca / modelo">{row.brand} · {row.model}</ResponsiveDataListField>
      <ResponsiveDataListField label="Categoría">{row.categoryName}</ResponsiveDataListField>
      <ResponsiveDataListField label="Certificación">{row.certification}</ResponsiveDataListField>
      <ResponsiveDataListField label="Vida útil">{row.lifespanLabel}</ResponsiveDataListField>
      <ResponsiveDataListField label="Variantes" className="col-span-2">
        <span className="font-mono tabular-nums text-[var(--color-text)]">{row.activeVariants} activas de {row.totalVariants}</span>
      </ResponsiveDataListField>
      <ResponsiveDataListField label="" className="col-span-2">
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditFamily(toEditRow(row))}>
            <PencilSimple size={15} />Editar ficha
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMergeSource({ id: row.id, name: row.canonicalName })}>
            <ArrowsMerge size={15} />Fusionar
          </Button>
        </div>
      </ResponsiveDataListField>
    </ResponsiveDataListCard>
  )

  const renderRow = (row: Row) => (
    <tr key={row.id} className="border-b border-(--color-border) hover:bg-(--color-surface-2) transition-colors">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-(--color-text)">{row.canonicalName}</span>
        {row.warnings.length > 0 && (
          <span
            className="ml-1.5 inline-flex align-middle text-(--color-warning)"
            title={row.warnings.join(" · ")}
            aria-label={`${row.warnings.length} advertencia(s): ${row.warnings.join(". ")}`}
          >
            <Warning size={15} />
          </span>
        )}
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {row.variants.map((v) => (
            <Link key={v.id} href={`/admin/productos/${v.id}`} title={v.name} className="rounded-full">
              <MetaBadge meta={{ label: v.sku, variant: "default" }} />
            </Link>
          ))}
        </span>
      </td>
      <td className="px-4 py-3">{typeSelect(row)}</td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.brand}</td>
      <td className="px-4 py-3 text-sm text-(--color-text)">{row.model}</td>
      <td className="px-4 py-3 text-sm text-(--color-text-muted)">{row.certification}</td>
      <td className="px-4 py-3 text-sm text-(--color-text-muted)">{row.lifespanLabel}</td>
      <td className="px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">{row.totalVariants}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditFamily(toEditRow(row))}
            className="rounded p-1.5 text-(--color-text-subtle) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-text)"
            title="Editar ficha"
            aria-label={`Editar familia ${row.canonicalName}`}
          >
            <PencilSimple size={16} />
          </button>
          <button
            type="button"
            onClick={() => setMergeSource({ id: row.id, name: row.canonicalName })}
            className="rounded p-1.5 text-(--color-text-subtle) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-text)"
            title="Fusionar con otra familia"
            aria-label={`Fusionar familia ${row.canonicalName}`}
          >
            <ArrowsMerge size={16} />
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "inactive")}>
      {suggestions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
          <span className="text-sm text-(--color-text-muted)">
            {suggestions.length} familia(s) sin clasificar tienen un tipo deducible de su nombre.
          </span>
          <Button type="button" size="sm" onClick={() => setReviewOpen(true)}>
            <Sparkle size={15} />Revisar sugerencias
          </Button>
        </div>
      )}
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
          searchKeys={["canonicalName", "skuSearch", "brand", "model", "certification"]}
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
          searchKeys={["canonicalName", "skuSearch", "brand", "model", "certification"]}
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
        categories={categories}
      />

      <ApplySuggestionsDialog
        suggestions={suggestions}
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      <MergeFamilyDialog
        key={mergeSource?.id ?? "no-merge"}
        source={mergeSource}
        candidates={mergeCandidates}
        onClose={() => setMergeSource(null)}
      />
    </Tabs>
  )
}
