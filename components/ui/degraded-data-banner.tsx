import { Callout } from "@/components/ui/callout"

/**
 * Aviso de degradación parcial (CO-037): cuando una o más fuentes de una
 * página cayeron a su fallback, la página sigue rindiendo (no se cae entera),
 * pero mostrar ceros/listas vacías como si fueran el dato real es peor que
 * avisar. El logger ya registra cada falla server-side con su label; este
 * banner es la señal visible para quien mira la pantalla.
 *
 * Es un `Callout` en tono `danger` con `role="alert"`: la degradación exige
 * atención, a diferencia de un aviso informativo (`role="status"`).
 */
export function DegradedDataBanner({ degraded, total }: { degraded: string[]; total: number }) {
  if (degraded.length === 0) return null
  return (
    <Callout tone="danger" role="alert">
      {`Algunos datos no pudieron cargarse (${degraded.length} de ${total} fuentes). Reintenta o contacta soporte.`}
    </Callout>
  )
}
