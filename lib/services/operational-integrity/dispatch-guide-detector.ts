/**
 * La merma de un traslado interno que nadie regulariza.
 *
 * `GDI-001` (auditoría 2026-09-14). El traslado mueve stock **al despachar**:
 * sale de la oficina y entra en la faena por la cantidad despachada. El cotejo
 * en faena acepta recibir menos, exige un motivo y lo guarda… pero el saldo del
 * destino conserva la cantidad completa. Los bienes que nunca llegaron siguen
 * contados en la faena, y el propio documento que reconoce la merma es la
 * evidencia de que el sistema sabe que ese saldo está mal.
 *
 * **Qué corrige esto y qué no.** No descuenta el stock por su cuenta, y no es
 * un olvido: el cotejo admite completarse después —una guía queda en
 * `partially_received` y una segunda visita puede recibir lo que faltaba—, así
 * que una diferencia recién cotejada todavía no es una pérdida. Decidir cuándo
 * una diferencia pasa a ser definitiva es una regla de negocio que la
 * plataforma no declara en ninguna parte.
 *
 * Lo que sí se puede afirmar sin esa regla es lo que la ficha reprocha: que
 * nada lo recuerda. Ningún detector miraba las guías. Ahora la diferencia
 * abierta aparece en la cola de integridad operacional con su cantidad, su
 * motivo y el enlace a la guía, y se cierra sola cuando alguien la completa o
 * la regulariza.
 */

import { integrityFinding, type OperationalIntegrityFinding } from "./types"

export interface GuideShortfallLine {
  guideId: string
  guideCode: string
  destinationWorksiteId: string
  guideStatus: string
  itemId: string
  productId: string
  productName: string
  quantity: number
  quantityReceived: number
  differenceReason: string | null
  /** Cuándo se cotejó: una diferencia de ayer no es la misma señal que una de hace un mes. */
  receivedAt: string | null
}

/** Tolerancia de coma flotante, la misma que usa el cotejo. */
const EPSILON = 1e-9

export function detectDispatchGuideShrinkage(
  input: { lines: GuideShortfallLine[] },
): OperationalIntegrityFinding[] {
  const findings: OperationalIntegrityFinding[] = []
  const byGuide = new Map<string, GuideShortfallLine[]>()

  for (const line of [...input.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    // Sólo las guías cotejadas con saldo abierto. Una `dispatched` todavía no se
    // ha cotejado: no hay diferencia que regularizar, hay una visita pendiente.
    if (line.guideStatus !== "partially_received") continue
    const shortfall = line.quantity - line.quantityReceived
    if (shortfall <= EPSILON) continue
    const rows = byGuide.get(line.guideId) ?? []
    rows.push(line)
    byGuide.set(line.guideId, rows)
  }

  for (const [guideId, lines] of [...byGuide.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = lines[0]!
    const total = lines.reduce((sum, line) => sum + (line.quantity - line.quantityReceived), 0)
    findings.push(integrityFinding({
      domain: "receiving",
      code: "DISPATCH_GUIDE_SHRINKAGE_UNRESOLVED",
      worksiteId: first.destinationWorksiteId,
      entityType: "dispatch_guide",
      entityId: guideId,
      href: `/bodega/guias/${encodeURIComponent(guideId)}`,
      snapshot: {
        guideCode: first.guideCode,
        shortfall: total,
        receivedAt: first.receivedAt,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          productId: line.productId,
          productName: line.productName,
          dispatched: line.quantity,
          received: line.quantityReceived,
          shortfall: line.quantity - line.quantityReceived,
          reason: line.differenceReason,
        })),
      },
    }))
  }

  return findings
}
