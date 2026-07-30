import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import {
  OFFICE_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES,
  DIRECT_FAENA_RECEIVABLE_STATUSES,
} from "@/lib/work-queue-labels"

const QUANTITY_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 })

/**
 * Siguiente paso de recepción de la OC, en la misma tarjeta donde se decide.
 *
 * Cubre las dos etapas porque el flujo tiene dos: una OC `via_oficina` pasa por
 * oficina antes de faena y una `directo_faena` no pasa por oficina en absoluto.
 * Mostrando sólo la etapa de faena, una OC recién enviada no ofrecía nada y la
 * página quedaba sin siguiente paso visible. Sin el permiso de la etapa se
 * muestra el texto sin enlace: quien compra necesita saber qué falta aunque lo
 * ejecute la faena.
 */
export function OcReceptionCta({
  orderId,
  status,
  deliveryMode,
  pendingOfficeQuantity,
  pendingFaenaQuantity,
  worksiteName,
  canRegisterOffice,
  canRegisterFaena,
}: {
  orderId: string
  status: string
  deliveryMode: string
  pendingOfficeQuantity: number
  pendingFaenaQuantity: number
  worksiteName: string
  canRegisterOffice: boolean
  canRegisterFaena: boolean
}) {
  const directFaena = deliveryMode === "directo_faena"
  const faenaStatuses = directFaena ? DIRECT_FAENA_RECEIVABLE_STATUSES : FAENA_RECEIVABLE_STATUSES

  const officeStage = !directFaena && OFFICE_RECEIVABLE_STATUSES.has(status) && pendingOfficeQuantity > 0
  const faenaStage = faenaStatuses.has(status) && pendingFaenaQuantity > 0
  if (!officeStage && !faenaStage) return null

  // La oficina va primero: mientras quede saldo por llegar ahí, ése es el paso.
  const stage = officeStage ? "office" : "faena"
  const quantity = stage === "office" ? pendingOfficeQuantity : pendingFaenaQuantity
  const allowed = stage === "office" ? canRegisterOffice : canRegisterFaena

  const description = stage === "office"
    ? `${QUANTITY_FORMAT.format(quantity)} unidades por llegar a oficina`
    : `${QUANTITY_FORMAT.format(quantity)} unidades pendientes para ${worksiteName}`
  const actionLabel = stage === "office" ? "Registrar llegada a oficina" : "Recepcionar en faena"

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className="text-xs font-medium text-[var(--color-text)]">{description}</p>
      {allowed ? (
        <Button asChild variant="primary" size="sm" className="mt-3 w-full">
          <Link href={`/recepcion/nueva?oc=${orderId}`}>
            {actionLabel}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </Button>
      ) : (
        <p className="mt-1.5 text-xs text-(--color-text-muted)">
          Siguiente paso: {actionLabel.toLowerCase()}. Lo registra quien recibe en{" "}
          {stage === "office" ? "oficina" : "faena"}.
        </p>
      )}
    </div>
  )
}
