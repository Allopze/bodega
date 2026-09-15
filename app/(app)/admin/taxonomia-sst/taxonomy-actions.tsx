"use client"

import * as React from "react"
import { useActionState, useEffect, useRef } from "react"
import { Plus, ArrowsClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { INITIAL_STATE } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { CategoryForm } from "./category-form"
import { TypeForm } from "./type-form"
import { seedDefaultDocumentCategoriesAction } from "./actions"
import type { CategoryOption } from "./labels"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

export function TaxonomyActions({ categorySlug, categoryOptions, catalogActivities }: { categorySlug: string, categoryOptions: CategoryOption[], catalogActivities: PdtpActivityPickerOption[] }) {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false)
  const [seedConfirmOpen, setSeedConfirmOpen] = React.useState(false)

  // Sembrar re-escribe nombre/descripción/orden de las 10 categorías base y
  // re-activa las que el admin hubiera desactivado: se confirma antes de
  // ejecutarla. El submit va por formulario oculto para reutilizar la action
  // sin duplicar el parseo del resultado.
  const [seedState, seedAction] = useActionState(seedDefaultDocumentCategoriesAction, INITIAL_STATE)
  const seedFormRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (seedState.message) {
      (seedState.ok ? toast.success : toast.error).call(null, seedState.message)
    }
  }, [seedState])

  return (
    <>
      <form ref={seedFormRef} action={seedAction} className="hidden" />
      <Button size="sm" variant="secondary" onClick={() => setCatSheetOpen(true)}>
        <Plus size={14} />Nueva categoría
      </Button>
      {categorySlug && (
        <Button size="sm" variant="secondary" onClick={() => setTypeSheetOpen(true)}>
          <Plus size={14} />Nuevo tipo
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => setSeedConfirmOpen(true)}>
        <ArrowsClockwise size={14} />Sembrar predeterminadas
      </Button>
      <ConfirmDialog
        open={seedConfirmOpen}
        onOpenChange={setSeedConfirmOpen}
        title="Sembrar categorías predeterminadas"
        description="Inserta las 10 categorías base y sus tipos, y re-escribe nombre, descripción y orden de las que ya existan. Los tipos y categorías que creaste aparte no se tocan."
        confirmLabel="Sembrar"
        variant="warning"
        onConfirm={() => {
          seedFormRef.current?.requestSubmit()
          setSeedConfirmOpen(false)
        }}
      />

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
          categoryOptions={categoryOptions}
          catalogActivities={catalogActivities}
        />
      )}
    </>
  )
}
