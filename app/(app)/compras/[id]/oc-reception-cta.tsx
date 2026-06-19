import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"

export function OcReceptionCta({
  orderId,
  pendingFaenaQuantity,
  worksiteName,
  canRegisterFaena,
}: {
  orderId: string
  pendingFaenaQuantity: number
  worksiteName: string
  canRegisterFaena: boolean
}) {
  if (!canRegisterFaena || pendingFaenaQuantity <= 0) return null

  const pendingLabel = new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 2,
  }).format(pendingFaenaQuantity)

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className="text-xs font-medium text-[var(--color-text)]">
        {pendingLabel} unidades pendientes para {worksiteName}
      </p>
      <Button asChild variant="primary" size="sm" className="mt-3 w-full">
        <Link href={`/recepcion/nueva?oc=${orderId}`}>
          Recepcionar en faena
          <ArrowRight size={14} aria-hidden />
        </Link>
      </Button>
    </div>
  )
}
