"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Plus, PencilSimple, ToggleLeft, ToggleRight, Tag } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { CategoryPanel, type CategoryForEdit } from "./category-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { formatCLP } from "@/lib/utils"
import { toggleProductActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface ProductRow {
  id: string; sku: string; name: string
  categoryId: string; categoryName: string
  isEpp: boolean; requiresPrevencion: boolean
  referencePrice: number | null
  isActive: boolean; createdAt: string
}
interface CategoryItem {
  id: string; name: string; slug: string
  isEpp: boolean; requiresPrevencion: boolean; sortOrder: number
}

const COLUMNS = [
  { key: "sku",          label: "SKU",       sortable: true, width: "w-36" },
  { key: "name",         label: "Nombre",    sortable: true  },
  { key: "categoryName", label: "Categoría", sortable: true  },
  { key: "referencePrice", label: "Precio ref.", sortable: true, numeric: true, width: "w-28" },
  { key: "isActive",     label: "Estado",    sortable: true, width: "w-24"  },
  { key: "",             label: "",          sortable: false, width: "w-20"  },
]

export function ProductList({ products, categories }: { products: ProductRow[]; categories: CategoryItem[] }) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryForEdit | null>(null)
  const [toggleState,  toggleAction]    = useActionState(toggleProductActive, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openNewCat()              { setEditCategory(null);    setCatSheetOpen(true) }
  function openEditCat(c: CategoryItem) {
    setEditCategory({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder })
    setCatSheetOpen(true)
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        {/* Secondary: manage categories */}
        <button
          onClick={openNewCat}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-2)]"
        >
          <Tag size={13} />
          <span>Gestionar categorías ({categories.length})</span>
        </button>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={products as unknown as Record<string, unknown>[]}
        searchKeys={["sku", "name", "categoryName"]}
        pageSize={25}
        searchPlaceholder="Buscar SKU, nombre o categoría..."
        emptyTitle="Sin productos"
        emptyDescription="Registra el primer producto del catálogo."
        emptyAction={
          <Button size="sm" asChild>
            <Link href="/admin/productos/nuevo"><Plus size={14} />Nuevo producto</Link>
          </Button>
        }
        actions={
          <Button size="sm" asChild>
            <Link href="/admin/productos/nuevo"><Plus size={14} />Nuevo producto</Link>
          </Button>
        }
        renderRow={(row) => {
          const p = row as unknown as ProductRow
          return (
            <TableRow key={p.id}>
              <TableCell>
                <span className="font-mono text-xs">{p.sku}</span>
              </TableCell>
              <TableCell>
                <p className="text-sm font-medium text-[var(--color-text)]">{p.name}</p>
                <div className="flex gap-1 mt-0.5">
                  {p.isEpp           && <Badge variant="info"    size="sm">EPP</Badge>}
                  {p.requiresPrevencion && <Badge variant="warning" size="sm">Prevención</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">{p.categoryName}</TableCell>
              <TableCellNum>
                {p.referencePrice != null ? formatCLP(p.referencePrice) : "—"}
              </TableCellNum>
              <TableCell>
                <Badge variant={p.isActive ? "success" : "default"} dot>
                  {p.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 justify-end">
                  <Link
                    href={`/admin/productos/${p.id}`}
                    className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]"
                    title="Editar"
                  >
                    <PencilSimple size={14} />
                  </Link>
                  <form action={toggleAction}>
                    <input type="hidden" name="id"       value={p.id} />
                    <input type="hidden" name="activate" value={String(!p.isActive)} />
                    <button type="submit" className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title={p.isActive ? "Desactivar" : "Activar"}>
                      {p.isActive ? <ToggleRight size={14} className="text-[var(--color-primary)]" /> : <ToggleLeft size={14} />}
                    </button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      {/* Category management inline list */}
      {categories.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
              Categorías ({categories.length})
            </p>
            <button onClick={openNewCat} className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1 active:scale-[0.97] transition-transform">
              <Plus size={12} />Nueva categoría
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openEditCat(c)}
                className="group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-100)] hover:bg-[var(--color-primary-50)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]"
              >
                <span className="text-[var(--color-text)]">{c.name}</span>
                {c.isEpp && <Badge variant="info" size="sm">EPP</Badge>}
                <PencilSimple size={11} className="text-[var(--color-text-subtle)] group-hover:text-[var(--color-primary)] transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      <CategoryPanel
        open={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        editCategory={editCategory}
      />
    </>
  )
}
