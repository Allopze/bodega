"use client"

import { useState } from "react"
import { Plus, DownloadSimple, UploadSimple, HardHat, Package } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ProductForm } from "./product-form"
import { ProductImportPanel } from "./product-import-panel"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { importProductsFromXlsx } from "./actions"
import type { AttributeTemplateOption, SizeFamilyOption, ProductUnitOption } from "./product-form.types"

interface CategoryItem {
  id: string; name: string; slug: string
  isEpp: boolean; requiresPrevencion: boolean; sortOrder: number
}
interface SupplierItem { id: string; name: string }

interface ProductActionsProps {
  categories: CategoryItem[]
  allSuppliers: SupplierItem[]
  units: ProductUnitOption[]
  templates: AttributeTemplateOption[]
  sizeFamilies: SizeFamilyOption[]
}

export function ProductActions({ categories, allSuppliers, units, templates, sizeFamilies }: ProductActionsProps) {
  const [productFormOpen, setProductFormOpen] = useState(false)
  const [importChoiceOpen, setImportChoiceOpen] = useState(false)
  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const [catalogImportOpen, setCatalogImportOpen] = useState(false)

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/admin/catalogos/export?tipo=productos"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <DownloadSimple size={14} />Exportar Excel
      </a>
      <Button size="sm" variant="secondary" onClick={() => setImportChoiceOpen(true)}>
        <UploadSimple size={14} />Importar
      </Button>
      <Button size="sm" onClick={() => setProductFormOpen(true)}>
        <Plus size={14} />Nuevo producto
      </Button>

      {/* Nuevo producto sheet */}
      <ProductForm
        key="nuevo"
        open={productFormOpen}
        onClose={() => setProductFormOpen(false)}
        categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion }))}
        allSuppliers={allSuppliers}
        units={units}
        templates={templates}
        sizeFamilies={sizeFamilies}
        editProduct={null}
      />

      {/* Import choice dialog */}
      <Dialog open={importChoiceOpen} onOpenChange={setImportChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué quieres importar?</DialogTitle>
            <DialogDescription>Elige el tipo de archivo Excel que vas a subir.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => { setImportChoiceOpen(false); setImportSheetOpen(true) }}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-left hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-tint)] transition-colors"
            >
              <HardHat size={20} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
              <div>
                <p className="font-medium text-[var(--color-text)]">Equipos de protección (EPP)</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Cada fila se revisa y valida antes de agregarse al catálogo.</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setImportChoiceOpen(false); setCatalogImportOpen(true) }}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-left hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-tint)] transition-colors"
            >
              <Package size={20} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
              <div>
                <p className="font-medium text-[var(--color-text)]">Catálogo de productos</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Crea o actualiza productos directamente según el SKU, sin revisión previa.</p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ProductImportPanel
        open={importSheetOpen}
        onClose={() => setImportSheetOpen(false)}
      />

      <CatalogImportPanel
        open={catalogImportOpen}
        onClose={() => setCatalogImportOpen(false)}
        title="Importar catálogo de productos"
        description="Crea productos nuevos o actualiza los existentes según el SKU. Se aplica de inmediato, sin pantalla de revisión."
        action={importProductsFromXlsx}
        helperText="Usa el botón Exportar Excel para obtener la plantilla con los datos actuales."
      />
    </>
  )
}
