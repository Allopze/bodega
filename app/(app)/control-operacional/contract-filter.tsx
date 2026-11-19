"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { OptionSelect } from "@/components/ui/option-select"

/**
 * Filtro «Contrato» de la tabla de vehículos del Panel operacional (`?contrato=`).
 * Es estado de la vista, no navegación: `router.replace` + `scroll: false`, y se
 * conservan `desde`/`hasta` (y cualquier otro parámetro). «Todos los contratos»
 * quita `contrato`.
 */
export function ContractFilter({
  options,
  value,
}: {
  options: { id: string; label: string }[]
  value: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set("contrato", next)
    else params.delete("contrato")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <OptionSelect
      aria-label="Contrato"
      className="w-full sm:w-72"
      emptyLabel="Todos los contratos"
      placeholder="Todos los contratos"
      value={value ?? ""}
      onValueChange={change}
      options={options.map((option) => ({ value: option.id, label: option.label }))}
    />
  )
}
