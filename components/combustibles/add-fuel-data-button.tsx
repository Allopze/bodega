"use client"

import { UploadSimple } from "@phosphor-icons/react"
import { CreateChoiceButton } from "@/components/ui/create-choice-button"
import type { FuelAddDataOption } from "@/lib/combustibles/section-nav"

/**
 * «Agregar datos»: pregunta qué tiene la persona en la mano y la lleva al
 * importador correspondiente. Las opciones salen de `fuelAddDataOptions(session)`.
 * Versión de la Fase 0; la línea L8 agrega las opciones sin permiso
 * deshabilitadas con su candado y el diálogo de facturas en Excel.
 */
export function AddFuelDataButton({ options }: { options: FuelAddDataOption[] }) {
  const allowed = options.filter((option) => option.allowed)
  if (allowed.length === 0) return null
  return (
    <CreateChoiceButton
      label="Agregar datos"
      title="¿Qué tienes en la mano?"
      description="Cada archivo se revisa antes de guardar y se puede revertir."
      icon={<UploadSimple size={14} aria-hidden />}
      variant="secondary"
      choices={allowed.map((option) => ({
        key: option.kind,
        label: option.label,
        description: option.description,
        soloLabel: "Agregar datos",
        href: option.href,
      }))}
    />
  )
}
