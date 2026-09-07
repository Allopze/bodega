/**
 * Preflight del backfill de familias EPP — SOLO LECTURA, nunca escribe.
 *
 * `products.family_id` es el primer eslabón de la cadena que `computeEppCoverageGaps`
 * recorre para contar una entrega como cobertura:
 *
 *   delivery_items → products.family_id → epp_product_families.epp_type_id → epp_types
 *
 * Ambos joins son INNER. Un producto sin familia no tiene dónde guardar el tipo,
 * así que asignar la familia es prerequisito de la clasificación. Este preflight
 * muestra qué haría `normalize-epp-families.ts --apply` y, por separado, qué tipo
 * sugeriría la inferencia del importador, marcando los casos donde esa inferencia
 * NO es confiable: escribir un `epp_type_id` equivocado es peor que dejarlo nulo,
 * porque Prevención acreditaría al trabajador con el EPP de otra zona corporal.
 */
import postgres from "postgres"
import { inferEppItemType, EPP_TYPE_TO_BODY_PART_CODE } from "../lib/services/epp-import.types"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")
const sql = postgres(databaseUrl, { max: 1 })

const clean = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()

/** Misma clave que `normalize-epp-families.ts`: categoría|nombre|marca|modelo. */
const familyKey = (categoryName: string, canonicalName: string) =>
  [clean(categoryName).toLocaleLowerCase("es-CL"), clean(canonicalName).toLocaleLowerCase("es-CL"), "", ""].join("|")

async function main() {
  const [products, families] = await Promise.all([
    sql<{ id: string; sku: string; name: string; family_id: string | null; category_name: string }[]>`
      select p.id, p.sku, p.name, p.family_id, c.name as category_name
      from products p join product_categories c on c.id = p.category_id
      where p.is_epp = true order by p.name`,
    sql<{ id: string; canonical_name: string; identity_key: string; epp_type_id: string | null }[]>`
      select id, canonical_name, identity_key, epp_type_id from epp_product_families`,
  ])

  const byIdentity = new Map(families.map((f) => [f.identity_key, f]))
  const unassigned = products.filter((p) => p.family_id == null)

  const newKeys = new Set<string>()
  const reuse: string[] = []
  const suggest = new Map<string, string[]>()
  const unclear: string[] = []

  for (const product of unassigned) {
    const key = familyKey(product.category_name, product.name)
    if (byIdentity.has(key)) reuse.push(`${product.sku} ${product.name}`)
    else newKeys.add(key)

    const item = inferEppItemType(product.name)
    const code = item ? EPP_TYPE_TO_BODY_PART_CODE[item] : undefined
    const line = `${product.sku.padEnd(14)} ${product.name}`
    if (!item || !code) unclear.push(line)
    else (suggest.get(code) ?? suggest.set(code, []).get(code)!).push(`${line}  [${item}]`)
  }

  const classified = families.filter((f) => f.epp_type_id != null).length
  console.log("── Cadena de cobertura EPP ────────────────────────────────")
  console.log(`productos EPP:                    ${products.length}`)
  console.log(`  con familia:                    ${products.length - unassigned.length}`)
  console.log(`  SIN familia (backfill):         ${unassigned.length}`)
  console.log(`familias existentes:              ${families.length}`)
  console.log(`  con epp_type_id (acreditan):    ${classified}`)
  console.log(`\n── Qué haría normalize-epp-families --apply ───────────────`)
  console.log(`familias nuevas a crear:          ${newKeys.size}`)
  console.log(`productos que reusan familia:     ${reuse.length}`)
  console.log(`productos a vincular:             ${unassigned.length}`)

  console.log(`\n── Sugerencia de tipo (NO se escribe automáticamente) ─────`)
  for (const [code, names] of [...suggest].sort()) {
    console.log(`\n${code} (${names.length})`)
    for (const n of names) console.log(`  ${n}`)
  }
  console.log(`\n? SIN TIPO INFERIBLE — clasificar a mano en /admin/epps (${unclear.length})`)
  for (const n of unclear) console.log(`  ${n}`)
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (error) => {
    console.error("[preflight-epp-family-backfill] falló:", error)
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exitCode = 1
  })
