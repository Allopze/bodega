"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ProductUnitForm } from "./product-unit-form"
import { AttributeTemplateForm } from "./attribute-template-form"

export function CatalogActions({ categories }: { categories: { id: string; name: string }[] }) {
  const [unitSheetOpen, setUnitSheetOpen] = React.useState(false)
  const [attrSheetOpen, setAttrSheetOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setUnitSheetOpen(true)}>
        <Plus size={14} />Nueva unidad
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setAttrSheetOpen(true)}>
        <Plus size={14} />Nueva plantilla
      </Button>

      <ProductUnitForm
        key="nueva-unidad"
        open={unitSheetOpen}
        onClose={() => setUnitSheetOpen(false)}
        editUnit={null}
      />

      <AttributeTemplateForm
        key="nueva-plantilla"
        open={attrSheetOpen}
        onClose={() => setAttrSheetOpen(false)}
        editTemplate={null}
        categories={categories}
      />
    </>
  )
}
