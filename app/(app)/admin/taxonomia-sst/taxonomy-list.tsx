"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import Link from "next/link"
import {
  PencilSimple,
  ToggleLeft,
  ToggleRight,
  Plant,
} from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import {
  setDocumentCategoryStatusAction,
  setDocumentTypeStatusAction,
} from "./actions"
import { CategoryForm } from "./category-form"
import { TypeForm } from "./type-form"
import { CONFIDENTIALITY_LABEL as DEFAULT_CONFIDENTIALITY_LABEL, type CategoryOption } from "./labels"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

export interface CategoryRow {
  slug: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
}

export interface TypeRow {
  id: string
  categorySlug: string
  code: string
  name: string
  description: string
  defaultConfidentiality: string
  defaultValidityMonths: number | null
  requiresApproval: boolean
  requiresAcknowledgment: boolean
  /** Actividades del PDTP que acredita publicar una versión de este tipo. */
  pdtpActivityNumbers: number[] | null
  /** Actividades que acredita cada acuse de recibo. */
  pdtpAcknowledgmentActivityNumbers: number[] | null
  pdtpCatalogActivityIds?: string[]
  pdtpAcknowledgmentCatalogActivityIds?: string[]
  isActive: boolean
}

const CATEGORY_COLUMNS = [
  { key: "name", label: "Categoría", sortable: true },
  { key: "description", label: "Descripción", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

const TYPE_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-32" },
  { key: "name", label: "Tipo", sortable: true },
  { key: "defaultConfidentiality", label: "Confidencialidad", sortable: true, width: "w-36" },
  // Las reglas que explican el comportamiento del tipo (vigencia, aprobación,
  // acuse, actividades PDTP) van como columnas secundarias ocultables: el admin
  // las audita sin abrir el sheet de edición, y por defecto la tabla sigue
  // mostrando código, tipo, confidencialidad y estado.
  { key: "defaultValidityMonths", label: "Vigencia", sortable: true, width: "w-28", defaultVisible: false },
  { key: "requiresApproval", label: "Aprobación", sortable: true, width: "w-28", defaultVisible: false },
  { key: "requiresAcknowledgment", label: "Acuse", sortable: true, width: "w-24", defaultVisible: false },
  { key: "pdtpActivityNumbers", label: "PDTP al publicar", sortable: false, width: "w-36", defaultVisible: false },
  {
    key: "pdtpAcknowledgmentActivityNumbers",
    label: "PDTP por acuse",
    sortable: false,
    width: "w-36",
    defaultVisible: false,
  },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

interface TaxonomyViewProps {
  categories: CategoryRow[]
  activeSlug: string
  /** Etiquetas de confidencialidad; el page las pasa para no duplicar el mapa. */
  confidentialityLabel?: Record<string, string>
  /** Categorías reales de BD para el selector del formulario de tipos. */
  categoryOptions: CategoryOption[]
  types: TypeRow[]
  catalogActivities: PdtpActivityPickerOption[]
}

function formatPdtpNumbers(numbers: number[] | null): string {
  if (!numbers || numbers.length === 0) return "—"
  return numbers.map((n) => `N°${n}`).join(", ")
}

export function TaxonomyView({ categories, activeSlug, confidentialityLabel = DEFAULT_CONFIDENTIALITY_LABEL, categoryOptions, types, catalogActivities }: TaxonomyViewProps) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryRow | null>(null)
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false)
  const [editType, setEditType] = React.useState<TypeRow | null>(null)

  const [catToggleState, catToggleAction] = useActionState(setDocumentCategoryStatusAction, INITIAL_STATE)
  const [typeToggleState, typeToggleAction] = useActionState(setDocumentTypeStatusAction, INITIAL_STATE)
  // Buscador propio de categorías: el del TopBar lo usa la tabla de tipos para
  // que una búsqueda no filtre ambas a la vez (ver search-architecture).
  const [catSearch, setCatSearch] = React.useState("")

  useEffect(() => {
    if (catToggleState.message) {
      (catToggleState.ok ? toast.success : toast.error).call(null, catToggleState.message)
    }
  }, [catToggleState])
  useEffect(() => {
    if (typeToggleState.message) {
      (typeToggleState.ok ? toast.success : toast.error).call(null, typeToggleState.message)
    }
  }, [typeToggleState])

  const catRows = categories as (CategoryRow & Record<string, unknown>)[]
  const typeRows = types as (TypeRow & Record<string, unknown>)[]
  const activeCategory = categories.find((c) => c.slug === activeSlug)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section aria-labelledby="tax-categories-heading">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="tax-categories-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
            Categorías
          </h2>
          <span className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
            {categories.length === 1 ? "1 categoría" : `${categories.length} categorías`}
          </span>
        </div>
        {activeCategory && (
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">
            Categoría activa: <span className="font-medium">{activeCategory.name}</span> (
            <Link href="/admin/taxonomia-sst" scroll={false} className="underline">cambiar</Link>)
          </p>
        )}
        <DataTable
        caption="Categorías Documentales SST"
        enableColumnToggle
        viewKey="tax"
        stickyFirstColumn
          columns={CATEGORY_COLUMNS}
          rows={catRows}
          search={catSearch}
          onSearchChange={setCatSearch}
          searchPlaceholder="Buscar categorías..."
          searchKeys={["name", "description"]}
          pageSize={20}
          emptyTitle="Sin categorías"
          emptyDescription="Crea o siembra las categorías maestras del SST."
          renderMobileCard={(row) => {
            const c = row as CategoryRow
            const isActive = c.slug === activeSlug
            return (
              <ResponsiveDataListCard
                title={
                  <Link
                    href={{ pathname: "/admin/taxonomia-sst", query: { category: c.slug } }}
                    scroll={false}
                    aria-current={isActive ? "true" : undefined}
                    className={isActive ? "text-[var(--color-primary)]" : undefined}
                  >
                    {c.name}
                  </Link>
                }
                description={c.description || undefined}
                status={c.isActive ? <MetaBadge meta={{ label: "Activa", variant: "success" }} /> : <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
                actions={
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setEditCategory(c); setCatSheetOpen(true) }}>
                      <PencilSimple size={15} />Editar
                    </Button>
                    <form action={catToggleAction}>
                      <input type="hidden" name="slug" value={c.slug} />
                      <input type="hidden" name="activate" value={String(!c.isActive)} />
                      <Button type="submit" variant="ghost" size="sm">
                        {c.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                        {c.isActive ? "Desactivar" : "Reactivar"}
                      </Button>
                    </form>
                  </>
                }
              >
                <ResponsiveDataListField label="Código">
                  <span className="font-mono">{c.slug}</span>
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Orden">
                  <span className="font-mono tabular-nums text-[var(--color-text)]">{c.sortOrder}</span>
                </ResponsiveDataListField>
              </ResponsiveDataListCard>
            )
          }}
          renderRow={(row) => {
            const c = row as CategoryRow
            const isActive = c.slug === activeSlug
            return (
              <React.Fragment key={c.slug}>
                <TableRow>
                  <TableCell>
                    <Link
                      href={{ pathname: "/admin/taxonomia-sst", query: { category: c.slug } }}
                      scroll={false}
                      aria-current={isActive ? "true" : undefined}
                      aria-label={`Ver tipos de ${c.name}`}
                      className={`flex items-center gap-1 font-medium ${isActive ? "text-[var(--color-primary)]" : ""}`}
                    >
                      <Plant size={14} />
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[var(--color-text-muted)]">{c.description || "—"}</TableCell>
                  <TableCell>
                    {c.isActive
                      ? <MetaBadge meta={{ label: "Activa", variant: "success" }} />
                      : <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setEditCategory(c); setCatSheetOpen(true) }}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        aria-label={`Editar ${c.name}`}
                      >
                        <PencilSimple size={15} />
                      </button>
                      <form action={catToggleAction}>
                        <input type="hidden" name="slug" value={c.slug} />
                        <input type="hidden" name="activate" value={String(!c.isActive)} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={c.isActive ? "Desactivar" : "Reactivar"}
                        >
                          {c.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        </button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            )
          }}
        />
        <CategoryForm
          key={editCategory?.slug ?? "editar"}
          open={catSheetOpen}
          onClose={() => setCatSheetOpen(false)}
          editCategory={editCategory}
        />
      </section>

      <section aria-labelledby="tax-types-heading">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="tax-types-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
            Tipos {activeCategory ? `· ${activeCategory.name}` : ""}
          </h2>
          {activeSlug && (
            <span className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
              {types.length === 1 ? "1 tipo" : `${types.length} tipos`}
            </span>
          )}
        </div>
        {!activeSlug ? (
          <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            Selecciona una categoría a la izquierda para ver y editar sus tipos.
          </p>
        ) : (
          <DataTable
            caption={`Tipos de Documento · ${activeCategory?.name ?? ""}`}
            enableColumnToggle
            viewKey="tax-types"
            columns={TYPE_COLUMNS}
            rows={typeRows}
            // Esta tabla conserva el buscador del TopBar; la de categorías usa
            // su propio input (ver search-architecture).
            searchKeys={["code", "name", "description"]}
            pageSize={20}
            emptyTitle="Sin tipos"
            emptyDescription={`Crea el primer tipo para la categoría ${activeCategory?.name ?? ""}.`}
            renderMobileCard={(row) => {
              const t = row as TypeRow
              return (
                <ResponsiveDataListCard
                  title={t.name}
                  description={t.description || undefined}
                  status={t.isActive ? <MetaBadge meta={{ label: "Activo", variant: "success" }} /> : <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
                  actions={
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setEditType(t); setTypeSheetOpen(true) }}>
                        <PencilSimple size={15} />Editar
                      </Button>
                      <form action={typeToggleAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="activate" value={String(!t.isActive)} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                          {t.isActive ? "Desactivar" : "Reactivar"}
                        </Button>
                      </form>
                    </>
                  }
                >
                  <ResponsiveDataListField label="Código">
                    <span className="font-mono">{t.code}</span>
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Confidencialidad">
                    {confidentialityLabel[t.defaultConfidentiality] ?? t.defaultConfidentiality}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Vigencia" className="col-span-2">
                    {t.defaultValidityMonths ? `${t.defaultValidityMonths} meses` : "Sin vencimiento predeterminado"}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Aprobación">
                    {t.requiresApproval ? "Requiere" : "No requiere"}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Acuse">
                    {t.requiresAcknowledgment ? "Requiere" : "No requiere"}
                  </ResponsiveDataListField>
                  {(t.pdtpActivityNumbers?.length || t.pdtpAcknowledgmentActivityNumbers?.length) ? (
                    <ResponsiveDataListField label="PDTP" className="col-span-2">
                      {[
                        t.pdtpActivityNumbers?.length ? `Al publicar: ${formatPdtpNumbers(t.pdtpActivityNumbers)}` : null,
                        t.pdtpAcknowledgmentActivityNumbers?.length
                          ? `Por acuse: ${formatPdtpNumbers(t.pdtpAcknowledgmentActivityNumbers)}`
                          : null,
                      ].filter(Boolean).join(" · ")}
                    </ResponsiveDataListField>
                  ) : null}
                </ResponsiveDataListCard>
              )
            }}
            renderRow={(row) => {
              const t = row as TypeRow
              return (
                <React.Fragment key={t.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell>{t.name}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {confidentialityLabel[t.defaultConfidentiality] ?? t.defaultConfidentiality}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-xs text-[var(--color-text-muted)]">
                      {t.defaultValidityMonths ? `${t.defaultValidityMonths} m` : "—"}
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {t.requiresApproval ? "Sí" : "No"}
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {t.requiresAcknowledgment ? "Sí" : "No"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {formatPdtpNumbers(t.pdtpActivityNumbers)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {formatPdtpNumbers(t.pdtpAcknowledgmentActivityNumbers)}
                    </TableCell>
                    <TableCell>
                      {t.isActive
                        ? <MetaBadge meta={{ label: "Activo", variant: "success" }} />
                        : <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditType(t); setTypeSheetOpen(true) }}
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={`Editar ${t.name}`}
                        >
                          <PencilSimple size={15} />
                        </button>
                        <form action={typeToggleAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="activate" value={String(!t.isActive)} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                            aria-label={t.isActive ? "Desactivar" : "Reactivar"}
                          >
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
        )}
        {activeSlug && (
          <TypeForm
            key={editType?.id ?? "editar"}
            open={typeSheetOpen}
            onClose={() => setTypeSheetOpen(false)}
            editType={editType}
            categorySlug={activeSlug}
            categoryOptions={categoryOptions}
            catalogActivities={catalogActivities}
          />
        )}
      </section>
    </div>
  )
}
