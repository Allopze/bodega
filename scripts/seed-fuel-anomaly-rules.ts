/**
 * Deja el catálogo de reglas de anomalía al día en la base apuntada.
 *
 * El cron de detección hace lo mismo en cada corrida (`syncAnomalyRuleCatalog`),
 * así que este script es para el despliegue: deja las reglas nuevas disponibles
 * en la pantalla de configuración sin esperar a la próxima ventana del cron, y
 * sirve de verificación manual. Comparte el catálogo y el escritor con el cron
 * —dos listas de reglas que hay que mantener en sincronía es exactamente cómo se
 * pierde una— y no pisa severidad, config ni activación de las existentes.
 */
import { syncAnomalyRuleCatalog } from "@/lib/combustibles/anomaly-cases"
import { ANOMALY_RULE_CATALOG } from "@/lib/combustibles/anomaly-rule-catalog"
import { KNOWN_RULE_CODES } from "@/lib/combustibles/validation"

async function main() {
  const sembradas = new Set(ANOMALY_RULE_CATALOG.map((rule) => rule.code))
  const sinCatalogo = KNOWN_RULE_CODES.filter((code) => !sembradas.has(code))
  if (sinCatalogo.length > 0) {
    throw new Error(`Hay códigos en KNOWN_RULE_CODES sin entrada en el catálogo: ${sinCatalogo.join(", ")}`)
  }

  const { created } = await syncAnomalyRuleCatalog()
  console.log(JSON.stringify({ reglasEnCatalogo: ANOMALY_RULE_CATALOG.length, creadas: created }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
