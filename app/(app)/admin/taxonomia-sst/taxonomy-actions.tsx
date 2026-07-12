"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { CategoryForm } from "./category-form"
import { TypeForm } from "./type-form"

export function TaxonomyActions({ categorySlug }: { categorySlug: string }) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setCatSheetOpen(true)}>
        <Plus size={14} />Nueva categoría
      </Button>
      {categorySlug && (
        <Button size="sm" variant="secondary" onClick={() => setTypeSheetOpen(true)}>
          <Plus size={14} />Nuevo tipo
        </Button>
      )}

      <CategoryForm
        key="nueva-categoria"
        open={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        editCategory={null}
      />

      {categorySlug && (
        <TypeForm
          key="nuevo-tipo"
          open={typeSheetOpen}
          onClose={() => setTypeSheetOpen(false)}
          editType={null}
          categorySlug={categorySlug}
        />
      )}
    </>
  )
}
