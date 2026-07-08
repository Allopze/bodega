"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import Link from "next/link"
import {
  PencilSimple,
  Plus,
  ToggleLeft,
  ToggleRight,
  Plant,
  ArrowsClockwise,
} from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import {
  seedDefaultDocumentCategoriesAction,
  setDocumentCategoryStatusAction,
  setDocumentTypeStatusAction,
} from "./actions"
import { CategoryForm } from "./category-form"
import { TypeForm } from "./type-form"

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
  isActive: boolean
}

const CATEGORY_COLUMNS = [
  { key: "name", label: "Categoría", sortable: true },
  { key: "description", label: "Descripción", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

const TYPE_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-36" },
  { key: "name", label: "Tipo", sortable: true },
  { key: "defaultConfidentiality", label: "Confidencialidad", sortable: true, width: "w-40" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

interface TaxonomyViewProps {
  categories: CategoryRow[]
  activeSlug: string
  types: TypeRow[]
}

export function TaxonomyView({ categories, activeSlug, types }: TaxonomyViewProps) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [editCategory, setEditCategory] = React.useState<CategoryRow | null>(null)
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false)
  const [editType, setEditType] = React.useState<TypeRow | null>(null)

  const [catToggleState, catToggleAction] = useActionState(setDocumentCategoryStatusAction, INITIAL_STATE)
  const [typeToggleState, typeToggleAction] = useActionState(setDocumentTypeStatusAction, INITIAL_STATE)
  const [seedState, seedAction] = useActionState(seedDefaultDocumentCategoriesAction, INITIAL_STATE)

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
  useEffect(() => {
    if (seedState.message) {
      (seedState.ok ? toast.success : toast.error).call(null, seedState.message)
    }
  }, [seedState])

  const catRows = categories as (CategoryRow & Record<string, unknown>)[]
  const typeRows = types as (TypeRow & Record<string, unknown>)[]
  const activeCategory = categories.find((c) => c.slug === activeSlug)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
            Categorías
          </h2>
          <div className="flex items-center gap-2">
            <form action={seedAction}>
              <Button type="submit" variant="secondary" size="sm">
                <ArrowsClockwise size={14} />Sembrar predeterminadas
              </Button>
            </form>
            <Button size="sm" onClick={() => { setEditCategory(null); setCatSheetOpen(true) }}>
              <Plus size={14} />Nueva categoría
            </Button>
          </div>
        </div>
        {activeCategory && (
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">
            Categoría activa: <span className="font-medium">{activeCategory.name}</span> (
            <Link href="/admin/taxonomia-sst" className="underline">cambiar</Link>)
          </p>
        )}
        <DataTable
          columns={CATEGORY_COLUMNS}
          rows={catRows}
          searchKeys={["name", "description"]}
          pageSize={20}
          emptyTitle="Sin categorías"
          emptyDescription="Crea o siembra las categorías maestras del SST."
          emptyAction={
            <Button size="sm" onClick={() => { setEditCategory(null); setCatSheetOpen(true) }}>
              <Plus size={14} />Nueva categoría
            </Button>
          }
          actions={
            <Button size="sm" onClick={() => { setEditCategory(null); setCatSheetOpen(true) }}>
              <Plus size={14} />Nueva categoría
            </Button>
          }
          renderRow={(row) => {
            const c = row as CategoryRow
            const isActive = c.slug === activeSlug
            return (
              <React.Fragment key={c.slug}>
                <TableRow>
                  <TableCell>
                    <Link
                      href={{ pathname: "/admin/taxonomia-sst", query: { category: c.slug } }}
                      className={`flex items-center gap-1 font-medium ${isActive ? "text-[var(--color-primary)]" : ""}`}
                    >
                      <Plant size={14} />
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[var(--color-text-muted)]">{c.description || "—"}</TableCell>
                  <TableCell>
                    {c.isActive
                      ? <Badge variant="success">Activa</Badge>
                      : <Badge variant="default">Inactiva</Badge>}
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
          key={editCategory?.slug ?? "nueva"}
          open={catSheetOpen}
          onClose={() => setCatSheetOpen(false)}
          editCategory={editCategory}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
            Tipos {activeCategory ? `· ${activeCategory.name}` : ""}
          </h2>
          <Button
            size="sm"
            disabled={!activeSlug}
            onClick={() => { setEditType(null); setTypeSheetOpen(true) }}
          >
            <Plus size={14} />Nuevo tipo
          </Button>
        </div>
        {!activeSlug ? (
          <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            Selecciona una categoría a la izquierda para ver y editar sus tipos.
          </p>
        ) : (
          <DataTable
            columns={TYPE_COLUMNS}
            rows={typeRows}
            searchKeys={["code", "name", "description"]}
            pageSize={20}
            emptyTitle="Sin tipos"
            emptyDescription={`Crea el primer tipo para la categoría ${activeCategory?.name ?? ""}.`}
            emptyAction={
              <Button
                size="sm"
                onClick={() => { setEditType(null); setTypeSheetOpen(true) }}
              >
                <Plus size={14} />Nuevo tipo
              </Button>
            }
            actions={
              <Button
                size="sm"
                onClick={() => { setEditType(null); setTypeSheetOpen(true) }}
              >
                <Plus size={14} />Nuevo tipo
              </Button>
            }
            renderRow={(row) => {
              const t = row as TypeRow
              return (
                <React.Fragment key={t.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell>{t.name}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {t.defaultConfidentiality}
                    </TableCell>
                    <TableCell>
                      {t.isActive
                        ? <Badge variant="success">Activo</Badge>
                        : <Badge variant="default">Inactivo</Badge>}
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
            key={editType?.id ?? activeSlug}
            open={typeSheetOpen}
            onClose={() => setTypeSheetOpen(false)}
            editType={editType}
            categorySlug={activeSlug}
          />
        )}
      </section>
    </div>
  )
}
