/**
 * Carga inicial del módulo de mantención de equipos (§13).
 *
 *   npm run db:seed:mantencion
 *   npm run db:seed:mantencion -- --correos /ruta/fuera/del/repo/correos.json
 *
 * Lee `db/seed/mantencion-seed.json` (copia de la referencia validada con la
 * jefatura) y deja al día: faenas con código de folio, tipos de equipo, marcas,
 * talleres, conductores, tipos de trabajo, aceites, las dos pautas con matriz y
 * reglas por marca, los 120 equipos y los mecánicos.
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda vez. Si la flota
 * ya tiene equipos, los concilia por código (y luego por patente) y REPORTA las
 * diferencias sin pisar datos de flota. No crea contraseñas ni envía correos.
 *
 * `--correos` es un archivo JSON `{ "Nombre Apellido": "correo" }` que debe
 * quedar FUERA del repositorio: sólo sirve para reconocer cuentas ya creadas y
 * para decir en el reporte a quién falta invitar desde /admin/usuarios.
 *
 * Apunta a la base de DATABASE_URL (`.env.local`): correrlo contra producción
 * es una decisión de despliegue, no de desarrollo.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { db } from "@/db"
import { parseMantSeedData, seedMantencion } from "@/lib/services/mantencion/seed"

const SEED_FILE = path.resolve(__dirname, "../db/seed/mantencion-seed.json")

function readEmails(): Record<string, string> {
  const at = process.argv.indexOf("--correos")
  if (at < 0) return {}
  const file = process.argv[at + 1]
  if (!file) throw new Error("--correos necesita la ruta de un archivo JSON.")
  const parsed = z.record(z.string(), z.string().email()).safeParse(JSON.parse(readFileSync(file, "utf8")))
  // Sin mostrar el contenido: son correos personales.
  if (!parsed.success) throw new Error("El archivo de correos debe ser un objeto { \"Nombre Apellido\": \"correo\" } con correos válidos.")
  return parsed.data
}

async function main() {
  const data = parseMantSeedData(JSON.parse(readFileSync(SEED_FILE, "utf8")))
  const report = await seedMantencion(db, data, { invitationEmails: readEmails() })
  console.log(report.changed ? "La carga escribió cambios." : "Nada que cambiar: la base ya estaba al día.")
  console.log(JSON.stringify(report, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
