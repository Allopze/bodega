"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "@/lib/toast"
import { Plus, PencilSimple, Tag, UploadSimple, Warning, DownloadSimple } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { CategoryPanel, type CategoryForEdit } from "./category-panel"
import { ProductForm } from "./product-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { formatCLP } from "@/lib/utils"
import { toggleProductActive, getProductForEdit } from "./actions"
import { ProductImportPanel } from "./product-import-panel"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { importProductsFromXlsx } from "./actions"
import { getProductWarnings, getFamilyWarnings, type ProductAttributeSummary } from "./product-list.helpers"
import type { AttributeTemplateOption, ProductUnitOption } from "./product-form.types"
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

const STATUS_LABELS: Record<string, { label: string; variant: "info" | "warning" | "success" | "danger" | "default" }> = {
  review: { label: "En revisión", variant: "warning" },
  confirmed: { label: "Confirmado", variant: "success" },
  cancelled: { label: "Cancelado", variant: "default" },
}
interface ProductFamilyRow {
  id: string
  name: string
  variants: ProductRow[]
  sku: string
  categoryName: string
  variantSearchText: string
}

export function ProductList({ products, categories, allSuppliers, units, templates, recentBatches }: {
  products:      ProductRow[]
  categories:    CategoryItem[]
  allSuppliers:  SupplierItem[]
  units:         ProductUnitOption[]
  templates:     AttributeTemplateOption[]
  recentBatches?: RecentBatch[]
}) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [importSheetOpen, setImportSheetOpen] = React.useState(false)
  const [catalogImportOpen, setCatalogImportOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryForEdit | null>(null)
  const { toggleAction } = useCatalogSheet<ProductRow>(toggleProductActive)

  // Product sheet state
  const [productSheetOpen, setProductSheetOpen] = React.useState(false)
  const [editProductFull,  setEditProductFull]  = React.useState<Awaited<ReturnType<typeof getProductForEdit>>>(null)
  const [loadingEditId,    setLoadingEditId]    = React.useState<string | null>(null)
  const [productFormKey,   setProductFormKey]   = React.useState(0)
  const [selectedVariantByFamily, setSelectedVariantByFamily] = React.useState<Record<string, string>>({})
  const [,                 startTransition]     = React.useTransition()
  const productFamilies = React.useMemo<ProductFamilyRow[]>(() => groupProductVariants(products).map((family) => ({
    ...family,
    sku: family.variants.map((variant) => variant.sku).join(" "),
    categoryName: family.variants.map((variant) => variant.categoryName).join(" "),
    variantSearchText: family.variants.map((variant) => formatProductVariant(variant.attributes, variant.sku)).join(" "),
  })), [products])

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

  function openNewProduct() {
    setEditProductFull(null)
    setProductFormKey((key) => key + 1)
    setProductSheetOpen(true)
  }

  function openEditProduct(id: string) {
    setLoadingEditId(id)
    startTransition(async () => {
      const product = await getProductForEdit(id)
      setLoadingEditId(null)
      if (product) {
        setEditProductFull(product)
        setProductFormKey((key) => key + 1)
        setProductSheetOpen(true)
      } else {
        toast.error("No se pudo cargar el producto")
      }
    })
  }

  function openNewCat()              { setEditCategory(null);    setCatSheetOpen(true) }
  function openEditCat(c: CategoryItem) {
    setEditCategory({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder })
    setCatSheetOpen(true)
  }

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

      <DataTable
        columns={COLUMNS}
        rows={productFamilies as unknown as Record<string, unknown>[]}
        searchKeys={CONTRACT.searchKeys}
        tableClassName="table-fixed min-w-0"
        pageSize={25}

        emptyTitle="Sin productos"
        emptyDescription="Registra el primer producto del catálogo."
        emptyAction={
          <Button size="sm" onClick={openNewProduct}>
            <Plus size={14} />Nuevo producto
          </Button>
        }
        actions={(
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/admin/catalogos/export?tipo=productos"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <DownloadSimple size={14} />Exportar XLSX
            </a>
            <Button size="sm" variant="secondary" onClick={() => setImportSheetOpen(true)}>
              <UploadSimple size={14} />Importar EPP
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCatalogImportOpen(true)}>
              <UploadSimple size={14} />Importar catálogo
            </Button>
            <Button size="sm" onClick={openNewProduct}>
              <Plus size={14} />Nuevo producto
            </Button>
          </div>
        )}
        renderRow={(row) => {
          const family = row as unknown as ProductFamilyRow
          const p = selectedVariant(family)
          return (
            <TableRow key={family.id}>
              <TableCell>
                <span className="block font-mono text-xs leading-4 line-clamp-2 break-words" title={p.sku}>{p.sku}</span>
              </TableCell>
              <TableCell>
                <p className="line-clamp-2 text-sm font-medium text-[var(--color-text)]" title={p.name}>{p.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {p.isEpp           && <Badge variant="info"    size="sm">EPP</Badge>}
                  {p.requiresPrevencion && <Badge variant="warning" size="sm">Prevención</Badge>}
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
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {family.variants.length === 1 ? formatProductVariant(p.attributes, p.sku) : (
                  <select
                    aria-label={`Características de ${family.name}`}
                    value={p.id}
                    onChange={(event) => setSelectedVariantByFamily((current) => ({ ...current, [family.id]: event.target.value }))}
                    className="h-8 max-w-52 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
                  >
                    {family.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>{formatProductVariant(variant.attributes, variant.sku)}</option>
                    ))}
                  </select>
                )}
              </TableCell>
              <TableCellNum>
                {p.referencePrice != null ? formatCLP(p.referencePrice) : "—"}
              </TableCellNum>
              <TableCell>
                <Badge variant={p.isActive ? "success" : "default"} dot className="w-20 justify-center">
                  {p.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <CatalogRowActions
                    id={p.id}
                    isActive={p.isActive}
                    label={`producto ${p.name}`}
                    onEdit={() => openEditProduct(p.id)}
                    toggleAction={toggleAction}
                    editDisabled={loadingEditId === p.id}
                    editPending={loadingEditId === p.id}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
        renderMobileCard={(row) => {
          const family = row as unknown as ProductFamilyRow
          const p = selectedVariant(family)
          return (
            <article key={family.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">{p.sku}</p>
                  <h2 className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{p.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {p.isEpp && <Badge variant="info" size="sm">EPP</Badge>}
                    {p.requiresPrevencion && <Badge variant="warning" size="sm">Prevención</Badge>}
                    {warningsFor(p).length > 0 && (
                      <Warning size={14} weight="fill" className="text-warning" alt={warningsFor(p).join(" · ")} />
                    )}
                    {familyWarningsFor(family).length > 0 && (
                      <Warning size={14} weight="fill" className="text-warning" alt={`Familia: ${familyWarningsFor(family).join(" · ")}`} />
                    )}
                  </div>
                </div>
                <Badge variant={p.isActive ? "success" : "default"} dot>
                  {p.isActive ? "Activo" : "Inactivo"}
                </Badge>
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
                    {family.variants.length === 1 ? formatProductVariant(p.attributes, p.sku) : (
                      <select
                        aria-label={`Características de ${family.name}`}
                        value={p.id}
                        onChange={(event) => setSelectedVariantByFamily((current) => ({ ...current, [family.id]: event.target.value }))}
                        className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
                      >
                        {family.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>{formatProductVariant(variant.attributes, variant.sku)}</option>
                        ))}
                      </select>
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
                  editDisabled={loadingEditId === p.id}
                  editPending={loadingEditId === p.id}
                />
              </div>
            </article>
          )
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
              const statusInfo = STATUS_LABELS[batch.status] ?? { label: batch.status, variant: "default" as const }
              return (
                <div key={batch.id} className="group flex items-center justify-between w-full gap-2 px-4 py-3 text-sm rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hover:bg-[var(--color-primary-tint)] transition-colors duration-[var(--duration-fast)]">
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--color-text)] truncate font-medium">{batch.fileName}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <Badge variant={statusInfo.variant} size="sm">{statusInfo.label}</Badge>
                      {batch.rowCount != null && <span>{batch.rowCount} filas</span>}
                      <span>{new Date(batch.createdAt).toLocaleDateString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
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
                <span className="text-[var(--color-text)] truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.isEpp && <Badge variant="info" size="sm">EPP</Badge>}
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

      <ProductImportPanel
        open={importSheetOpen}
        onClose={() => setImportSheetOpen(false)}
      />

      <CatalogImportPanel
        open={catalogImportOpen}
        onClose={() => setCatalogImportOpen(false)}
        title="Importar productos desde XLSX"
        description="Importa productos exportados desde el catálogo. La columna ID determina si se crea (sin ID) o actualiza (con ID)."
        action={importProductsFromXlsx}
        helperText="Usa el botón Exportar XLSX para obtener la plantilla con los datos actuales."
      />

        <ProductForm
        key={`${editProductFull?.id ?? "nuevo"}-${productFormKey}`}
        open={productSheetOpen}
        onClose={() => {
          setProductSheetOpen(false)
          setEditProductFull(null)
        }}
        categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion }))}
        allSuppliers={allSuppliers}
        units={units}
        templates={templates}
        editProduct={editProductFull}
      />
    </>
  )
}
