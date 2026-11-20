/**
 * Trae de VisionLink (Asset Operations) los tramos por hora de un rango pasado y
 * los guarda en `fuel_telemetry_hourly`, para que «Turnos y ralentí» tenga
 * historia desde antes de que corriera el cron.
 *
 *   tsx scripts/backfill-visionlink-hourly.ts --from=2026-10-01 [--to=2026-11-19]
 *
 * `--from` es obligatorio (`YYYY-MM-DD`); `--to` es hoy por defecto. El rango se
 * parte solo en ventanas de 28 días (la API acepta hasta un mes por consulta) y
 * es idempotente: repetirlo deja las mismas filas. Usa las credenciales
 * guardadas en la plataforma (o el `.env`) y NO las imprime: sólo el resumen y,
 * por equipo que falló, el código de error del cliente.
 *
 * Cada día del rango son unas 10–20 llamadas por equipo: un backfill largo
 * gasta cupo del proveedor (50.000 llamadas al día), así que conviene hacerlo
 * por tramos de unas semanas.
 */
import { loadVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { syncVisionLinkHourly } from "@/lib/integrations/visionlink/visionlink-hourly-sync"
import { todayInChile } from "@/lib/utils"

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function main() {
  const from = argValue("from")
  const to = argValue("to") ?? todayInChile()
  if (!validDate(from)) throw new Error("Falta --from=YYYY-MM-DD (fecha válida). Ejemplo: --from=2026-10-01")
  if (!validDate(to)) throw new Error("--to debe ser una fecha válida YYYY-MM-DD")
  if (from > to) throw new Error("--from no puede ser posterior a --to")

  const config = await loadVisionLinkConfig()
  if (!config.hasCredentials) throw new Error("VisionLink no tiene credenciales: configúralas en Combustibles › Ajustes › Integraciones.")

  console.log(`Tramos por hora de VisionLink: ${from} a ${to}…`)
  const result = await syncVisionLinkHourly(config, { from, to })
  console.log(JSON.stringify(result, null, 2))
  if (result.failedVehicles.length > 0) process.exitCode = 1
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
