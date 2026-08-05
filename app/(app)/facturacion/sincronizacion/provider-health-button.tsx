"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { checkProviderHealthAction } from "../actions"
import type { BillingProviderId } from "@/db/schema"

/**
 * Comprueba la conexión con un proveedor, a pedido.
 *
 * Vive en la tarjeta de cada proveedor porque la comprobación **es** por
 * proveedor: como enlace suelto junto a los botones de sincronización quedaba
 * ambiguo a qué se aplicaba. El resultado se persiste, así que la pantalla lo
 * sigue mostrando después con su fecha.
 */
export function ProviderHealthButton({
  provider,
  label,
  disabled,
}: {
  provider: BillingProviderId
  label: string
  disabled: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={disabled || isPending}
      title={disabled ? `${label} no tiene credenciales configuradas en este servidor.` : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await checkProviderHealthAction(provider)
          if (result.ok) toast.success(result.message)
          else toast.error(result.message)
          router.refresh()
        })
      }}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? "Comprobando…" : "Probar conexión"}
    </button>
  )
}
