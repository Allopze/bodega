import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"

/**
 * Siguiente paso de facturación de la OC, en el mismo rail donde se decide.
 *
 * El adjuntar factura vivía sólo al final de la pestaña "Facturación", que nunca
 * viene seleccionada: había que saber que existía. Ni el stepper ni el rail la
 * nombraban, y la advertencia de factura faltante aparecía recién dentro del
 * formulario de cierre. Este bloque reusa las advertencias de conciliación que
 * la página ya calcula para el cierre y las adelanta al punto donde todavía se
 * pueden resolver. Sin el permiso se muestra el texto sin enlace: quien recibe
 * necesita saber qué falta aunque lo ejecute quien compra.
 */
export function OcInvoiceCta({
  orderId,
  invoiceCount,
  invoiceDue,
  warnings,
  canManage,
  receptionPending,
}: {
  orderId: string
  invoiceCount: number
  /** Ya llegó mercadería: recién ahí exigir la factura es legítimo. */
  invoiceDue: boolean
  /** Advertencias de conciliación OC↔factura (las mismas del cierre). */
  warnings: string[]
  canManage: boolean
  /** Con recepción pendiente ése es el paso dominante: la factura va secundaria. */
  receptionPending: boolean
}) {
  if (warnings.length === 0) return null

  const missing = invoiceCount === 0
  // Antes de que llegue nada, reclamar la factura sería ruido permanente en cada
  // OC enviada. Una factura ya adjunta que no cuadra, en cambio, está mal ahora.
  if (missing && !invoiceDue) return null

  const description = missing
    ? "Falta la factura de esta orden"
    : "La facturación de esta orden está incompleta"

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className="text-xs font-medium text-[var(--color-text)]">{description}</p>
      {!missing && (
        <ul className="mt-1.5 list-disc pl-4 text-xs text-(--color-text-muted)">
          {warnings.slice(0, 2).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      {canManage ? (
        <Button
          asChild
          variant={receptionPending ? "secondary" : "primary"}
          size="sm"
          className="mt-3 w-full"
        >
          <Link href={`/compras/${orderId}?tab=facturacion`}>
            {missing ? "Adjuntar factura" : "Revisar conciliación"}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </Button>
      ) : (
        <p className="mt-1.5 text-xs text-(--color-text-muted)">
          Siguiente paso: {missing ? "adjuntar la factura" : "revisar la conciliación"}. Lo registra quien compra.
        </p>
      )}
    </div>
  )
}
