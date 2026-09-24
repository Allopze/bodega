"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import Link from "next/link"
import {
  PencilSimple,
  Plus,
  ToggleLeft,
  ToggleRight,
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
  /** Días para entregar cada versión vigente a toda la dotación (RIOHS: N°18). */
  distributionDueDays?: number | null
  /** Actividades del PDTP que acredita publicar una versión de este tipo. */
  pdtpActivityNumbers: number[] | null
  /** Actividades que acredita cada acuse de recibo. */
  pdtpAcknowledgmentActivityNumbers: number[] | null
  pdtpCatalogActivityIds?: string[]
  pdtpAcknowledgmentCatalogActivityIds?: string[]
  isActive: boolean
}

// El estado no es una columna: en una taxonomía sana *todas* las filas están
// activas, así que la columna gastaba un badge verde por fila para no decir
// nada. La excepción —una categoría desactivada— se marca en la propia celda
// del nombre, que es donde el ojo ya está.
const CATEGORY_COLUMNS = [
  { key: "name", label: "Categoría", sortable: true },
  { key: "description", label: "Descripción", sortable: true },
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
  catalogActivities?: PdtpActivityPickerOption[]
}

function formatPdtpNumbers(numbers: number[] | null): string {
  if (!numbers || numbers.length === 0) return "—"
  return numbers.map((n) => `N°${n}`).join(", ")
}

/*
 * Desde que el tipo se cablea por identidad corporativa, el número es un
 * snapshot histórico: al guardar desde el formulario nuevo deja de reflejar la
 * configuración vigente. Se muestra el código de la identidad cuando existe, y
 * el número sólo mientras el tipo no esté migrado.
 */
function formatPdtpAccreditation(
  catalogActivityIds: string[] | undefined,
  numbers: number[] | null,
  codeById: Map<string, string>,
): string {
  if (catalogActivityIds && catalogActivityIds.length > 0) {
    return catalogActivityIds.map((id) => codeById.get(id) ?? id).join(", ")
  }
  return formatPdtpNumbers(numbers)
}

function hasPdtpAccreditation(type: TypeRow): boolean {
  return Boolean(
    type.pdtpCatalogActivityIds?.length || type.pdtpAcknowledgmentCatalogActivityIds?.length ||
    type.pdtpActivityNumbers?.length || type.pdtpAcknowledgmentActivityNumbers?.length,
  )
}

export function TaxonomyView({ categories, activeSlug, confidentialityLabel = DEFAULT_CONFIDENTIALITY_LABEL, categoryOptions, types, catalogActivities = [] }: TaxonomyViewProps) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryRow | null>(null)
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false)
  const [editType, setEditType] = React.useState<TypeRow | null>(null)

  const [catToggleState, catToggleAction] = useActionState(setDocumentCategoryStatusAction, INITIAL_STATE)
  const [typeToggleState, typeToggleAction] = useActionState(setDocumentTypeStatusAction, INITIAL_STATE)
  const catalogCodeById = React.useMemo(
    () => new Map(catalogActivities.map((activity) => [activity.id, activity.code])),
    [catalogActivities],
  )
  // Un buscador rotulado por tabla. La ruta está en `ROUTES_WITH_OWN_SEARCH`,
  // así que el input de la shell no aparece y no hay una tercera caja de
  // búsqueda compitiendo con estas dos (ver search-architecture).
  const [catSearch, setCatSearch] = React.useState("")
  const [typeSearch, setTypeSearch] = React.useState("")

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
        <DataTable
          caption="Categorías Documentales SST"
          viewKey="tax"
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
                status={c.isActive ? undefined : <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
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
                <TableRow className={c.isActive ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={{ pathname: "/admin/taxonomia-sst", query: { category: c.slug } }}
                        scroll={false}
                        aria-current={isActive ? "true" : undefined}
                        aria-label={`Ver tipos de ${c.name}`}
                        className={`font-medium ${isActive ? "text-[var(--color-primary)]" : ""}`}
                      >
                        {c.name}
                      </Link>
                      {!c.isActive && <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
                    </div>
                  </TableCell>
                  <TableCell className="text-[var(--color-text-muted)]">{c.description || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setEditCategory(c); setCatSheetOpen(true) }}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        aria-label={`Editar ${c.name}`}
                        title="Editar"
                      >
                        <PencilSimple size={15} />
                      </button>
                      <form action={catToggleAction}>
                        <input type="hidden" name="slug" value={c.slug} />
                        <input type="hidden" name="activate" value={String(!c.isActive)} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={c.isActive ? `Desactivar ${c.name}` : `Reactivar ${c.name}`}
                          title={c.isActive ? "Activa — clic para desactivar" : "Inactiva — clic para reactivar"}
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
          key={editCategory?.slug ?? "nueva"}
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
            // La densidad es una preferencia global: un solo control en la
            // pantalla (el de categorías) la fija para ambas tablas. Repetirlo
            // aquí era la misma decisión ofrecida dos veces.
            hideDensityToggle
            columns={TYPE_COLUMNS}
            rows={typeRows}
            search={typeSearch}
            onSearchChange={setTypeSearch}
            searchPlaceholder="Buscar tipos..."
            searchKeys={["code", "name", "description"]}
            pageSize={20}
            // "Nuevo tipo" es contextual —tipo *de esta categoría*— así que
            // vive junto a la tabla que lo recibe, no en el header de la página.
            actions={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => { setEditType(null); setTypeSheetOpen(true) }}
              >
                <Plus size={14} />Nuevo tipo
              </Button>
            }
            emptyTitle="Sin tipos"
            emptyDescription={`Crea el primer tipo para la categoría ${activeCategory?.name ?? ""}.`}
            renderMobileCard={(row) => {
              const t = row as TypeRow
              return (
                <ResponsiveDataListCard
                  title={t.name}
                  description={t.description || undefined}
                  status={t.isActive ? undefined : <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
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
                  {hasPdtpAccreditation(t) ? (
                    <ResponsiveDataListField label="PDTP" className="col-span-2">
                      {[
                        t.pdtpCatalogActivityIds?.length || t.pdtpActivityNumbers?.length
                          ? `Al publicar: ${formatPdtpAccreditation(t.pdtpCatalogActivityIds, t.pdtpActivityNumbers, catalogCodeById)}`
                          : null,
                        t.pdtpAcknowledgmentCatalogActivityIds?.length || t.pdtpAcknowledgmentActivityNumbers?.length
                          ? `Por acuse: ${formatPdtpAccreditation(t.pdtpAcknowledgmentCatalogActivityIds, t.pdtpAcknowledgmentActivityNumbers, catalogCodeById)}`
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
                  <TableRow className={t.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {t.name}
                        {!t.isActive && <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
                      </div>
                    </TableCell>
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
                      {formatPdtpAccreditation(t.pdtpCatalogActivityIds, t.pdtpActivityNumbers, catalogCodeById)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {formatPdtpAccreditation(t.pdtpAcknowledgmentCatalogActivityIds, t.pdtpAcknowledgmentActivityNumbers, catalogCodeById)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditType(t); setTypeSheetOpen(true) }}
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={`Editar ${t.name}`}
                          title="Editar"
                        >
                          <PencilSimple size={15} />
                        </button>
                        <form action={typeToggleAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="activate" value={String(!t.isActive)} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                            aria-label={t.isActive ? `Desactivar ${t.name}` : `Reactivar ${t.name}`}
                            title={t.isActive ? "Activo — clic para desactivar" : "Inactivo — clic para reactivar"}
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
            key={editType?.id ?? "nuevo"}
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
