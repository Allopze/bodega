"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "@/lib/toast"
import { Plus, PencilSimple, Tag, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { CategoryPanel, type CategoryForEdit } from "./category-panel"
import { ProductForm } from "./product-form"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { formatCLP, formatDateTime } from "@/lib/utils"
import { toggleProductActive, getProductForEdit, getProductFamilyForAddVariant, bulkToggleProductActiveAction } from "./actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getProductWarnings, getFamilyWarnings, type ProductAttributeSummary } from "./product-list.helpers"
import type { AttributeTemplateOption, SizeFamilyOption, ProductUnitOption } from "./product-form.types"
import { formatProductVariant, groupProductVariants } from "@/lib/products/variant-grouping"
import { COLUMNS, CONTRACT } from "./catalog-contract"

interface ProductRow {
  id: string; sku: string; name: string
  familyId: string | null
  categoryId: string; categoryName: string
  isEpp: boolean; requiresPrevencion: boolean
  referencePrice: number | null
  hasPreferredSupplier: boolean
  isActive: boolean; createdAt: string
  attributes: ProductAttributeSummary[]
}
interface CategoryItem {
  id: string; name: string; slug: string
  isEpp: boolean; requiresPrevencion: boolean; sortOrder: number
}
interface SupplierItem { id: string; name: string }
interface RecentBatch {
  id: string
  fileName: string
  status: string
  createdAt: string
  rowCount: number | null
}

/** Label + variante en un solo mapa (MetaBadge). */
const STATUS_META: Record<string, StateMetaInput> = {
  review:    { label: "En revisión", variant: "warning" },
  confirmed: { label: "Confirmado",  variant: "success" },
  cancelled: { label: "Cancelado",   variant: "default" },
}
type ProductFamilyRow = {
  id: string
  name: string
  variants: ProductRow[]
  sku: string
  categoryName: string
  variantSearchText: string
}

export function ProductList({ products, categories, allSuppliers, units, templates, sizeFamilies, recentBatches }: {
  products:      ProductRow[]
  categories:    CategoryItem[]
  allSuppliers:  SupplierItem[]
  units:         ProductUnitOption[]
  templates:     AttributeTemplateOption[]
  sizeFamilies:  SizeFamilyOption[]
  recentBatches?: RecentBatch[]
}) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryForEdit | null>(null)
  const { toggleAction } = useCatalogSheet<ProductRow>(toggleProductActive)

  // Product sheet state
  const [productSheetOpen, setProductSheetOpen] = React.useState(false)
  const [editProductFull,  setEditProductFull]  = React.useState<Awaited<ReturnType<typeof getProductForEdit>>>(null)
  const [addVariantFamily, setAddVariantFamily] = React.useState<Awaited<ReturnType<typeof getProductFamilyForAddVariant>>>(null)
  const [loadingEditId,    setLoadingEditId]    = React.useState<string | null>(null)
  const [loadingFamilyId,  setLoadingFamilyId]  = React.useState<string | null>(null)
  const [productFormKey,   setProductFormKey]   = React.useState(0)
  const [selectedVariantByFamily, setSelectedVariantByFamily] = React.useState<Record<string, string>>({})
  const [,                 startTransition]     = React.useTransition()
  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkActionType, setBulkActionType] = React.useState<"activate" | "deactivate" | null>(null)
  const [bulkPending, setBulkPending] = React.useState(false)

  const activeProducts = React.useMemo(() => products.filter((p) => p.isActive), [products])
  const inactiveProducts = React.useMemo(() => products.filter((p) => !p.isActive), [products])

  const toFamilyRow = React.useCallback((family: { id: string; name: string; variants: ProductRow[] }): ProductFamilyRow => ({
    ...family,
    sku: family.variants.map((variant) => variant.sku).join(" "),
    categoryName: family.variants.map((variant) => variant.categoryName).join(" "),
    variantSearchText: family.variants.map((variant) => formatProductVariant(variant.attributes, variant.sku)).join(" "),
  }), [])

  const activeFamilies = React.useMemo<ProductFamilyRow[]>(
    () => groupProductVariants(activeProducts).map(toFamilyRow),
    [activeProducts, toFamilyRow],
  )
  const inactiveFamilies = React.useMemo<ProductFamilyRow[]>(
    () => groupProductVariants(inactiveProducts).map(toFamilyRow),
    [inactiveProducts, toFamilyRow],
  )

  const currentFamilies = tab === "active" ? activeFamilies : inactiveFamilies

  // Reset selection when switching tabs
  React.useEffect(() => { setSelectedIds(new Set()) }, [tab])

  // ── Bulk selection helpers ────────────────────────────────────────────────
  const allIds = React.useMemo(
    () => new Set(currentFamilies.flatMap((f) => f.variants.map((v) => v.id))),
    [currentFamilies],
  )
  const allSelected = allIds.size > 0 && allIds.size === selectedIds.size

  const selectAllRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedIds.size > 0 && !allSelected
    }
  }, [selectedIds, allSelected])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  function selectedVariant(family: ProductFamilyRow): ProductRow {
    const variant = family.variants.find((item) => item.id === selectedVariantByFamily[family.id]) ?? family.variants[0]
    if (!variant) throw new Error(`La familia ${family.name} no tiene variantes`)
    return variant
  }

  const categoriesById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  function warningsFor(p: ProductRow) {
    return getProductWarnings(p, categoriesById.get(p.categoryId))
  }
  function familyWarningsFor(family: ProductFamilyRow) {
    const cat = categoriesById.get(family.variants[0]?.categoryId ?? "")
    return getFamilyWarnings(family.variants, cat)
  }

  function openEditProduct(id: string) {
    setLoadingEditId(id)
    startTransition(async () => {
      const product = await getProductForEdit(id)
      setLoadingEditId(null)
      if (product) {
        setEditProductFull(product)
        setAddVariantFamily(null)
        setProductFormKey((key) => key + 1)
        setProductSheetOpen(true)
      } else {
        toast.error("No se pudo cargar el producto")
      }
    })
  }

  /** Abre el asistente en modo "añadir variante" para la familia de un
   *  producto: pre-carga la identidad de la familia para que las variantes
   *  nuevas nazcan dentro de ella (y no en una familia duplicada). */
  function openAddVariant(familyId: string, fallbackLabel: string) {
    setLoadingFamilyId(familyId)
    startTransition(async () => {
      const snapshot = await getProductFamilyForAddVariant(familyId)
      setLoadingFamilyId(null)
      if (snapshot) {
        setEditProductFull(null)
        setAddVariantFamily(snapshot)
        setProductFormKey((key) => key + 1)
        setProductSheetOpen(true)
      } else {
        toast.error(`No se pudo cargar la familia ${fallbackLabel}`)
      }
    })
  }

  function openNewCat()              { setEditCategory(null);    setCatSheetOpen(true) }
  function openEditCat(c: CategoryItem) {
    setEditCategory({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder })
    setCatSheetOpen(true)
  }

  // Columns with checkbox
  const CHECKBOX_WIDTH = "w-10"
  const COLUMNS_WITH_CHECKBOX = [
    { key: "_sel", label: "Sel.", sortable: false, width: CHECKBOX_WIDTH },
    ...COLUMNS,
  ]

  const renderRow = React.useCallback((family: ProductFamilyRow) => {
    const p = selectedVariant(family)
    return (
      <TableRow key={family.id}>
        <TableCell>
          <Checkbox
            labelHidden
            label={`Seleccionar ${p.name}`}
            checked={selectedIds.has(p.id)}
            onChange={() => toggleSelect(p.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </TableCell>
        <TableCell>
          <span className="block font-mono text-xs leading-4 line-clamp-2 break-words" title={p.sku}>{p.sku}</span>
        </TableCell>
        <TableCell>
          <p className="line-clamp-2 text-sm font-medium text-[var(--color-text)]" title={p.name}>{p.name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            {p.isEpp           && <MetaBadge meta={{ label: "EPP", variant: "info" }} />}
            {p.requiresPrevencion && <MetaBadge meta={{ label: "Prevención", variant: "warning" }} />}
            {warningsFor(p).length > 0 && (
              <Warning size={14} weight="fill" className="text-warning" alt={warningsFor(p).join(" · ")} />
            )}
            {familyWarningsFor(family).length > 0 && (
              <Warning size={14} weight="fill" className="text-warning" alt={`Familia: ${familyWarningsFor(family).join(" · ")}`} />
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">
          <span className="block truncate" title={p.categoryName}>{p.categoryName}</span>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">            {family.variants.length === 1 ? (p.attributes.length > 0 ? formatProductVariant(p.attributes, p.sku) : "—") : (
            <Select value={p.id} onValueChange={(v) => setSelectedVariantByFamily((current) => ({ ...current, [family.id]: v }))}>
              <SelectTrigger aria-label={`Características de ${family.name}`} className="h-8 max-w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {family.variants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>{formatProductVariant(variant.attributes, variant.sku)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
        <TableCellNum>
          {p.referencePrice != null ? formatCLP(p.referencePrice) : "—"}
        </TableCellNum>
        <TableCell>
          <MetaBadge meta={p.isActive ? { label: "Activo", variant: "success" } : { label: "Inactivo", variant: "default" }} dot className="w-20 justify-center" />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 justify-end">
            <CatalogRowActions
              id={p.id}
              isActive={p.isActive}
              label={`producto ${p.name}`}
              onEdit={() => openEditProduct(p.id)}
              toggleAction={toggleAction}
              editDisabled={loadingEditId === p.id || loadingFamilyId === p.familyId}
              editPending={loadingEditId === p.id}
            />
            {p.familyId && (
              <button
                type="button"
                onClick={() => openAddVariant(p.familyId!, family.name)}
                disabled={loadingFamilyId === p.familyId}
                className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-tint)] transition-colors disabled:opacity-50"
                title="Añadir variante (talla/color con stock propio)"
                aria-label={`Añadir variante a ${family.name}`}
              >
                <Plus size={16} className={loadingFamilyId === p.familyId ? "animate-spin" : undefined} />
              </button>
            )}
          </div>
        </TableCell>
      </TableRow>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantByFamily, loadingEditId, loadingFamilyId, selectedIds])

  const renderMobileCard = React.useCallback((family: ProductFamilyRow) => {
    const p = selectedVariant(family)
    return (
      <article key={family.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Checkbox
                labelHidden
                label={`Seleccionar ${p.name}`}
                checked={selectedIds.has(p.id)}
                onChange={() => toggleSelect(p.id)}
              />
              <div>
                <p className="font-mono text-xs text-[var(--color-text-subtle)]">{p.sku}</p>
                <h2 className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{p.name}</h2>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 ml-6">
              {p.isEpp && <MetaBadge meta={{ label: "EPP", variant: "info" }} />}
              {p.requiresPrevencion && <MetaBadge meta={{ label: "Prevención", variant: "warning" }} />}
              {warningsFor(p).length > 0 && (
                <Warning size={14} weight="fill" className="text-warning" alt={warningsFor(p).join(" · ")} />
              )}
              {familyWarningsFor(family).length > 0 && (
                <Warning size={14} weight="fill" className="text-warning" alt={`Familia: ${familyWarningsFor(family).join(" · ")}`} />
              )}
            </div>
          </div>
          <MetaBadge meta={p.isActive ? { label: "Activo", variant: "success" } : { label: "Inactivo", variant: "default" }} dot className="shrink-0" />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-[var(--color-text-subtle)]">Categoría</dt>
            <dd className="text-[var(--color-text-muted)]">{p.categoryName}</dd>
          </div>
          <div className="text-right">
            <dt className="text-[var(--color-text-subtle)]">Precio ref.</dt>
            <dd className="font-mono tabular-nums text-[var(--color-text)]">
              {p.referencePrice != null ? formatCLP(p.referencePrice) : "—"}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[var(--color-text-subtle)]">Características</dt>
            <dd className="text-[var(--color-text-muted)]">
              {family.variants.length === 1 ? (p.attributes.length > 0 ? formatProductVariant(p.attributes, p.sku) : "—") : (
                <Select value={p.id} onValueChange={(v) => setSelectedVariantByFamily((current) => ({ ...current, [family.id]: v }))}>
                  <SelectTrigger aria-label={`Características de ${family.name}`} className="mt-1 h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {family.variants.map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>{formatProductVariant(variant.attributes, variant.sku)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
          <CatalogRowActions
            id={p.id}
            isActive={p.isActive}
            label={`producto ${p.name}`}
            onEdit={() => openEditProduct(p.id)}
            toggleAction={toggleAction}
            editDisabled={loadingEditId === p.id || loadingFamilyId === p.familyId}
            editPending={loadingEditId === p.id}
          />
          {p.familyId && (
            <button
              type="button"
              onClick={() => openAddVariant(p.familyId!, family.name)}
              disabled={loadingFamilyId === p.familyId}
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-tint)] transition-colors disabled:opacity-50"
              title="Añadir variante (talla/color con stock propio)"
              aria-label={`Añadir variante a ${family.name}`}
            >
              <Plus size={14} className={loadingFamilyId === p.familyId ? "animate-spin" : undefined} />
              Variante
            </button>
          )}
        </div>
      </article>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantByFamily, loadingEditId, loadingFamilyId, selectedIds])

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={openNewCat}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-2)]"
        >
          <Tag size={13} />
          <span>Gestionar categorías ({categories.length})</span>
        </button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "active" | "inactive")}
      >
        <div className="flex items-center justify-between mb-3">
          <TabsList>
            <TabsTrigger value="active">
              Activos
              <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{activeFamilies.length}</span>
            </TabsTrigger>
            <TabsTrigger value="inactive">
              Inactivos
              <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{inactiveFamilies.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <Checkbox
            ref={selectAllRef}
            checked={allSelected}
            onChange={toggleSelectAll}
            label={<span className="text-xs text-[var(--color-text-subtle)]">
              {selectedIds.size > 0 ? `${selectedIds.size} seleccionados` : "Seleccionar todo"}
            </span>}
          />
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] px-4 py-2 mb-3">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {selectedIds.size} producto{selectedIds.size === 1 ? "" : "s"} seleccionado{selectedIds.size === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              {tab === "inactive" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkActionType("activate")}
                >
                  Reactivar seleccionados
                </Button>
              )}
              {tab === "active" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkActionType("deactivate")}
                >
                  Desactivar seleccionados
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Limpiar selección
              </Button>
            </div>
          </div>
        )}

        <TabsContent value="active">
          <DataTable
            caption="Productos Activos"
            columns={COLUMNS_WITH_CHECKBOX}
            rows={activeFamilies}
            searchKeys={CONTRACT.searchKeys as (keyof ProductFamilyRow)[]}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin productos activos"
            emptyDescription="No hay productos activos en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
          />
        </TabsContent>

        <TabsContent value="inactive">
          <DataTable
            caption="Productos Inactivos"
            columns={COLUMNS_WITH_CHECKBOX}
            rows={inactiveFamilies}
            searchKeys={CONTRACT.searchKeys as (keyof ProductFamilyRow)[]}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin productos inactivos"
            emptyDescription="No hay productos dados de baja en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
          />
        </TabsContent>
      </Tabs>

      {/* Bulk action confirm dialog */}
      <ConfirmDialog
        open={bulkActionType !== null}
        onOpenChange={(open) => { if (!open) setBulkActionType(null) }}
        title={bulkActionType === "activate" ? "¿Reactivar productos seleccionados?" : "¿Desactivar productos seleccionados?"}
        description={`Se ${bulkActionType === "activate" ? "reactivarán" : "desactivarán"} ${selectedIds.size} producto${selectedIds.size === 1 ? "" : "s"}. Los productos ${bulkActionType === "activate" ? "reactivados" : "desactivados"} ${bulkActionType === "activate" ? "volverán a estar disponibles" : "quedarán ocultos en el catálogo activo"}. Esta acción no afecta registros históricos y puede revertirse individualmente.`}
        confirmLabel={bulkActionType === "activate" ? "Reactivar" : "Desactivar"}
        variant={bulkActionType === "activate" ? "default" : "warning"}
        loading={bulkPending}
        onConfirm={async () => {
          setBulkPending(true)
          const fd = new FormData()
          fd.set("ids", Array.from(selectedIds).join(","))
          fd.set("activate", String(bulkActionType === "activate"))
          let res
          try {
            res = await bulkToggleProductActiveAction({ ok: true, message: "" }, fd)
            setBulkActionType(null)
            setSelectedIds(new Set())
          } finally {
            setBulkPending(false)
          }
          if (res.ok) toast.success(res.message ?? "Operación exitosa")
          else toast.error(res.message ?? "Error al realizar la operación")
        }}
      />

      {/* Recent import batches */}
      {recentBatches && recentBatches.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-eyebrow">
              Importaciones recientes ({recentBatches.length})
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentBatches.map((batch) => {
              const statusInfo = metaFor(STATUS_META, batch.status)
              return (
                <div key={batch.id} className="group flex items-center justify-between w-full gap-2 px-4 py-3 text-sm rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hover:bg-[var(--color-primary-tint)] transition-colors duration-[var(--duration-fast)]">
                  <div className="min-w-0 flex-1">
                    <p title={batch.fileName} className="text-[var(--color-text)] truncate font-medium">{batch.fileName}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <MetaBadge meta={statusInfo} />
                      {batch.rowCount != null && <span>{batch.rowCount} filas</span>}
                      <span>{formatDateTime(batch.createdAt)}</span>
                    </div>
                  </div>
                  {batch.status === "review" && (
                    <Link
                      href={`/admin/productos/importar/${batch.id}`}
                      className="shrink-0 text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1"
                    >
                      Revisar
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Category management inline list */}
      {categories.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-eyebrow">
              Categorías ({categories.length})
            </p>
            <button type="button" onClick={openNewCat} className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1 transition-transform">
              <Plus size={12} />Nueva categoría
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openEditCat(c)}
                className="group flex items-center justify-between w-full text-left gap-2 px-4 py-3 text-sm rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary-ink)] transition-colors duration-[var(--duration-fast)]"
              >
                <span title={c.name} className="text-[var(--color-text)] truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.isEpp && <MetaBadge meta={{ label: "EPP", variant: "info" }} />}
                  <PencilSimple size={14} className="text-[var(--color-text-subtle)] group-hover:text-[var(--color-primary)] transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <CategoryPanel
        key={editCategory?.id ?? "nueva"}
        open={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        editCategory={editCategory}
      />

      <ProductForm
        key={`${editProductFull?.id ?? addVariantFamily?.id ?? "nuevo"}-${productFormKey}`}
        open={productSheetOpen}
        onClose={() => {
          setProductSheetOpen(false)
          setEditProductFull(null)
          setAddVariantFamily(null)
        }}
        categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion }))}
        allSuppliers={allSuppliers}
        units={units}
        templates={templates}
        sizeFamilies={sizeFamilies}
        editProduct={editProductFull}
        addVariantToFamily={addVariantFamily}
      />
    </>
  )
}
