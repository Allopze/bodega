import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")

const apply = process.argv.includes("--apply")
const sql = postgres(databaseUrl, { max: 1 })

function normalize(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-CL")
}

function familyKey(row: { categoryName: string; canonicalName: string; brand: string | null; model: string | null }) {
  return [normalize(row.categoryName), normalize(row.canonicalName), normalize(row.brand), normalize(row.model)].join("|")
}

async function main() {
type FamilyRow = {
  id: string
  category_id: string
  category_name: string
  canonical_name: string
  identity_key: string
  epp_type: string | null
  brand: string | null
  model: string | null
}
type ProductRow = {
  id: string
  family_id: string | null
  category_id: string
  category_name: string
  name: string
}

const families = await sql<FamilyRow[]>`
  select f.id, f.category_id, c.name as category_name, f.canonical_name, f.identity_key,
         f.epp_type, f.brand, f.model
  from epp_product_families f
  join product_categories c on c.id = f.category_id
  order by f.id
`

const products = await sql<ProductRow[]>`
  select p.id, p.family_id, p.category_id, c.name as category_name, p.name
  from products p
  join product_categories c on c.id = p.category_id
  where p.is_epp = true
  order by p.id
`

const groups = new Map<string, FamilyRow[]>()
for (const family of families) {
  const key = familyKey({ categoryName: family.category_name, canonicalName: family.canonical_name, brand: family.brand, model: family.model })
  const group = groups.get(key) ?? []
  group.push(family)
  groups.set(key, group)
}

const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1)
const unassignedProducts = products.filter((product) => product.family_id == null)

console.log(`[normalize-epp-families] modo: ${apply ? "APPLY" : "DRY-RUN"}`)
console.log(`[normalize-epp-families] familias actuales: ${families.length}`)
console.log(`[normalize-epp-families] grupos que colapsarían: ${duplicateGroups.length}`)
console.log(`[normalize-epp-families] productos EPP sin familia: ${unassignedProducts.length}`)

for (const [key, group] of duplicateGroups) {
  console.log(`- ${key}: ${group.map((family) => family.id).join(", ")} -> ${group[0]?.id}`)
}

if (!apply) {
  await sql.end({ timeout: 5 })
  process.exit(0)
}

await sql.begin(async (tx) => {
  const familyByKey = new Map<string, { id: string; categoryId: string; canonicalName: string; eppType: string | null; brand: string | null; model: string | null }>()

  for (const [key, group] of groups) {
    const winner = group[0]
    if (!winner) continue
    for (const duplicate of group.slice(1)) {
      await tx`update products set family_id = ${winner.id} where family_id = ${duplicate.id}`
      await tx`delete from epp_product_families where id = ${duplicate.id}`
    }
    await tx`
      update epp_product_families
      set identity_key = ${key}, updated_at = now()
      where id = ${winner.id}
    `
    familyByKey.set(key, {
      id: winner.id,
      categoryId: winner.category_id,
      canonicalName: winner.canonical_name,
      eppType: winner.epp_type,
      brand: winner.brand,
      model: winner.model,
    })
  }

  for (const product of unassignedProducts) {
    const key = familyKey({ categoryName: product.category_name, canonicalName: product.name, brand: null, model: null })
    let family = familyByKey.get(key)
    if (!family) {
      const id = `family-${product.id}`
      await tx`
        insert into epp_product_families (id, category_id, canonical_name, identity_key)
        values (${id}, ${product.category_id}, ${product.name}, ${key})
      `
      family = { id, categoryId: product.category_id, canonicalName: product.name, eppType: null, brand: null, model: null }
      familyByKey.set(key, family)
    }
    await tx`update products set family_id = ${family.id}, updated_at = now() where id = ${product.id}`
  }
})

console.log("[normalize-epp-families] normalización aplicada")
await sql.end({ timeout: 5 })
}

main().catch(async (error) => {
  console.error("[normalize-epp-families] falló:", error)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exitCode = 1
})
