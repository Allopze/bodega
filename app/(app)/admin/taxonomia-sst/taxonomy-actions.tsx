"use client"

import * as React from "react"
import { useActionState, useEffect, useRef } from "react"
import { Plus, DotsThree, ArrowsClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { INITIAL_STATE } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { CategoryForm } from "./category-form"
import { seedDefaultDocumentCategoriesAction } from "./actions"

/**
 * Acciones de nivel página. "Nuevo tipo" ya no vive aquí: es contextual a la
 * categoría abierta, así que lo emite el propio panel de tipos
 * (`taxonomy-list.tsx`), junto a la tabla que lo recibe.
 */
export function TaxonomyActions() {
  const [catSheetOpen, setCatSheetOpen] = React.useState(false)
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

      {/* Cargar la taxonomía sugerida se hace una vez en la vida de la
          instalación: ocupaba un botón permanente en la barra para una acción
          que además reescribe datos. Al menú de overflow, y con un nombre que
          no sea jerga de seeding. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="Más acciones">
            <DotsThree size={18} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setSeedConfirmOpen(true)}>
            <ArrowsClockwise size={14} className="mr-2" />
            Cargar taxonomía sugerida
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={seedConfirmOpen}
        onOpenChange={setSeedConfirmOpen}
        title="Cargar taxonomía sugerida"
        description="Inserta las 10 categorías base y sus tipos, y re-escribe nombre, descripción y orden de las que ya existan. Los tipos y categorías que creaste aparte no se tocan."
        confirmLabel="Cargar"
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
    </>
  )
}
