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
export interface OcReceptionStageInput {
  status: string
  deliveryMode: string
  pendingOfficeQuantity: number
  pendingFaenaQuantity: number
}

export interface ActiveDispatchGuide {
  id: string
  code: string
  status: string
}

/**
 * Etapa de recepción pendiente, o null si no queda ninguna.
 *
 * Exportada porque el rail necesita saber si la recepción sigue siendo el paso
 * dominante para decidir la jerarquía del CTA de factura. Derivarlo aparte
 * —"queda saldo de oficina o de faena"— daba `true` en una OC `directo_faena`
 * ya recibida, donde `quantityOfficeReceived` es 0 por diseño y nada pasa por
 * oficina.
 */
export function pendingReceptionStage(input: OcReceptionStageInput): "office" | "faena" | null {
  const directFaena = input.deliveryMode === "directo_faena"
  const faenaStatuses = directFaena ? DIRECT_FAENA_RECEIVABLE_STATUSES : FAENA_RECEIVABLE_STATUSES

  if (!directFaena && OFFICE_RECEIVABLE_STATUSES.has(input.status) && input.pendingOfficeQuantity > 0) return "office"
  if (faenaStatuses.has(input.status) && input.pendingFaenaQuantity > 0) return "faena"
  return null
}

export function OcReceptionCta({
  orderId,
  status,
  deliveryMode,
  pendingOfficeQuantity,
  pendingFaenaQuantity,
  worksiteName,
  canRegisterOffice,
  canRegisterFaena,
  activeDispatchGuide,
}: {
  orderId: string
  status: string
  deliveryMode: string
  pendingOfficeQuantity: number
  pendingFaenaQuantity: number
  worksiteName: string
  canRegisterOffice: boolean
  canRegisterFaena: boolean
  activeDispatchGuide?: ActiveDispatchGuide
}) {
  // La oficina va primero: mientras quede saldo por llegar ahí, ése es el paso.
  const stage = pendingReceptionStage({ status, deliveryMode, pendingOfficeQuantity, pendingFaenaQuantity })
  if (!stage) return null

  const quantity = stage === "office" ? pendingOfficeQuantity : pendingFaenaQuantity
  const allowed = stage === "office" ? canRegisterOffice : canRegisterFaena

  const description = stage === "office"
    ? `${QUANTITY_FORMAT.format(quantity)} unidades por llegar a oficina`
    : `${QUANTITY_FORMAT.format(quantity)} unidades pendientes para ${worksiteName}`
  const actionLabel = stage === "office" ? "Registrar llegada a oficina" : "Recepcionar en faena"

  if (stage === "faena" && deliveryMode !== "directo_faena") {
    if (activeDispatchGuide) {
      return (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <p className="text-xs font-medium text-[var(--color-text)]">
            El despacho a faena continúa en la guía {activeDispatchGuide.code}.
          </p>
          <Button asChild variant="primary" size="sm" className="mt-3 w-full">
            <Link href={`/bodega/guias/${activeDispatchGuide.id}`}>
              {activeDispatchGuide.status === "draft" ? "Completar despacho" : "Cotejar entrega en faena"}
              <ArrowRight size={14} aria-hidden />
            </Link>
          </Button>
        </div>
      )
    }

    return (
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <p className="text-xs font-medium text-[var(--color-text)]">
          La OC ya llegó a oficina y queda pendiente preparar el despacho a faena.
        </p>
        {canRegisterFaena ? (
          <Button asChild variant="secondary" size="sm" className="mt-3 w-full">
            <Link href="/recepcion">
              Continuar en Recepciones
              <ArrowRight size={14} aria-hidden />
            </Link>
          </Button>
        ) : (
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Siguiente paso: preparar el despacho desde Recepciones.
          </p>
        )}
      </div>
    )
  }

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
