"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { DesktopOnlyTableNotice } from "@/components/ui/desktop-only-table"
import { DataTable } from "@/components/admin/data-table"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { ProductUnitForm, type ProductUnitRow } from "./product-unit-form"
import { AttributeTemplateForm, type AttributeTemplateRow } from "./attribute-template-form"
import {
  setAttributeTemplateStatusAction,
  setProductUnitStatusAction,
} from "./actions"

const UNIT_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-28" },
  { key: "label", label: "Etiqueta", sortable: true },
  { key: "description", label: "Descripción", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-28" },
]

const ATTR_COLUMNS = [
  { key: "name", label: "Nombre", sortable: true },
  { key: "type", label: "Tipo", sortable: true, width: "w-24" },
  { key: "categoryId", label: "Categoría", sortable: true, width: "w-32" },
  { key: "isRequired", label: "Requerido", sortable: true, width: "w-28" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-28" },
]

const TABS = [
  { key: "units", label: "Unidades" },
  { key: "templates", label: "Atributos reutilizables" },
] as const

interface CatalogListProps {
  units: ProductUnitRow[]
  templates: AttributeTemplateRow[]
  categories: { id: string; name: string }[]
  legacyUnits: string[]
}

export function CatalogList({ units, templates, categories, legacyUnits }: CatalogListProps) {
  const [tab, setTab] = React.useState<(typeof TABS)[number]["key"]>("units")
  const [unitSheetOpen, setUnitSheetOpen] = React.useState(false)
  const [editUnit, setEditUnit] = React.useState<ProductUnitRow | null>(null)
  const [attrSheetOpen, setAttrSheetOpen] = React.useState(false)
  const [editAttr, setEditAttr] = React.useState<AttributeTemplateRow | null>(null)

  const [unitToggleState, unitToggleAction] = useActionState(setProductUnitStatusAction, INITIAL_STATE)
  const [attrToggleState, attrToggleAction] = useActionState(setAttributeTemplateStatusAction, INITIAL_STATE)

  useEffect(() => {
    if (unitToggleState.message) {
      (unitToggleState.ok ? toast.success : toast.error).call(null, unitToggleState.message)
    }
  }, [unitToggleState])
  useEffect(() => {
    if (attrToggleState.message) {
      (attrToggleState.ok ? toast.success : toast.error).call(null, attrToggleState.message)
    }
  }, [attrToggleState])

  const unitRows = units as (ProductUnitRow & Record<string, unknown>)[]
  const attrRows = templates as (AttributeTemplateRow & Record<string, unknown>)[]

  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative -mb-px rounded-t-[var(--radius)] border border-b-0 px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-[var(--color-border)] bg-[var(--color-surface)] font-semibold text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "units" && (
        <section>
          {legacyUnits.length > 0 && (
            <div className="mb-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
              <p className="text-[var(--color-text-muted)]">
                Unidades legacy en uso (de productos):{" "}
                <span className="font-mono">{legacyUnits.join(", ")}</span>
              </p>
              <p className="mt-1 text-[var(--color-text-muted)]">
                Crea acá entradas para normalizarlas y luego reemplaza manualmente el campo <code>unitOfMeasure</code> en la ficha del producto.
              </p>
            </div>
          )}
          <DesktopOnlyTableNotice />
          <DataTable
        caption="Unidades de Producto"
        enableColumnToggle
        viewKey="cat"
        stickyFirstColumn
            columns={UNIT_COLUMNS}
            rows={unitRows}
            searchKeys={["code", "label", "description"]}
            pageSize={20}
            emptyTitle="Sin unidades"
            emptyDescription="Crea unidades para empezar a normalizar el catálogo."
            renderRow={(row) => {
              const u = row as ProductUnitRow
              return (
                <React.Fragment key={u.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{u.code}</TableCell>
                    <TableCell>{u.label}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{u.description || "—"}</TableCell>
                    <TableCell>
                      {u.isActive ? <Badge variant="success">Activa</Badge> : <Badge variant="default">Inactiva</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { setEditUnit(u); setUnitSheetOpen(true) }} className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" aria-label={`Editar unidad ${u.label}`}>
                          <PencilSimple size={16} />
                        </button>
                        <form action={unitToggleAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="activate" value={String(!u.isActive)} />
                          <button type="submit" className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" aria-label={u.isActive ? "Desactivar" : "Reactivar"}>
                            {u.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <ProductUnitForm
            key={editUnit?.id ?? "editar"}
            open={unitSheetOpen}
            onClose={() => setUnitSheetOpen(false)}
            editUnit={editUnit}
          />
        </section>
      )}

      {tab === "templates" && (
        <section>
          <DataTable
            caption="Atributos Reutilizables"
            columns={ATTR_COLUMNS}
            rows={attrRows}
            searchKeys={["name", "type", "categoryId"]}
            pageSize={20}
            emptyTitle="Sin plantillas"
            emptyDescription={'Crea plantillas (ej. "Talla", "Color", "Capacidad") reutilizables por categoría.'}
            renderRow={(row) => {
              const t = row as AttributeTemplateRow
              return (
                <React.Fragment key={t.id}>
                  <TableRow>
                    <TableCell>{t.name}</TableCell>
                    <TableCell className="font-mono text-xs"><Badge variant="default">{t.type}</Badge></TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{t.categoryName || "Todas"}</TableCell>
                    <TableCell>{t.isRequired ? <Badge variant="warning">Sí</Badge> : <Badge variant="default">No</Badge>}</TableCell>
                    <TableCell>
                      {t.isActive ? <Badge variant="success">Activa</Badge> : <Badge variant="default">Inactiva</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { setEditAttr(t); setAttrSheetOpen(true) }} className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" aria-label={`Editar plantilla ${t.name}`}>
                          <PencilSimple size={16} />
                        </button>
                        <form action={attrToggleAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="activate" value={String(!t.isActive)} />
                          <button type="submit" className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" aria-label={t.isActive ? "Desactivar" : "Reactivar"}>
                            {t.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <AttributeTemplateForm
            key={editAttr?.id ?? "editar"}
            open={attrSheetOpen}
            onClose={() => setAttrSheetOpen(false)}
            editTemplate={editAttr}
            categories={categories}
          />
        </section>
      )}
    </>
  )
}
