import postgres from "postgres"

type FuelSupplierRow = {
  id: string
  name: string
  rut: string | null
  supplier_id: string | null
}

type GeneralSupplierRow = {
  id: string
  name: string
  rut: string | null
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")

const apply = process.argv.includes("--apply")
const sql = postgres(databaseUrl, { max: 1 })

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-CL")
}

function normalizeRut(value: string | null | undefined) {
  return normalize(value).replace(/[.\-\s]/g, "").toUpperCase()
}

async function main() {
  const [fuelSuppliers, generalSuppliers] = await Promise.all([
    sql<FuelSupplierRow[]>`
      select id, name, rut, supplier_id
      from fuel_suppliers
      order by id
    `,
    sql<GeneralSupplierRow[]>`
      select id, name, rut
      from suppliers
      order by id
    `,
  ])

  const generalByRut = new Map<string, GeneralSupplierRow[]>()
  const generalByName = new Map<string, GeneralSupplierRow[]>()
  for (const supplier of generalSuppliers) {
    const rut = normalizeRut(supplier.rut)
    const name = normalize(supplier.name)
    if (rut) generalByRut.set(rut, [...(generalByRut.get(rut) ?? []), supplier])
    if (name) generalByName.set(name, [...(generalByName.get(name) ?? []), supplier])
  }

  const rutMatches: Array<{ fuel: FuelSupplierRow; general: GeneralSupplierRow }> = []
  const nameOnlyMatches: Array<{ fuel: FuelSupplierRow; general: GeneralSupplierRow }> = []
  const ambiguous: FuelSupplierRow[] = []
  const unmatched: FuelSupplierRow[] = []

  for (const fuel of fuelSuppliers.filter((row) => !row.supplier_id)) {
    const rut = normalizeRut(fuel.rut)
    const byRut = rut ? generalByRut.get(rut) ?? [] : []
    if (byRut.length === 1) {
      rutMatches.push({ fuel, general: byRut[0]! })
      continue
    }
    if (byRut.length > 1) {
      ambiguous.push(fuel)
      continue
    }

    const byName = generalByName.get(normalize(fuel.name)) ?? []
    if (byName.length === 1) {
      nameOnlyMatches.push({ fuel, general: byName[0]! })
    } else if (byName.length > 1) {
      ambiguous.push(fuel)
    } else {
      unmatched.push(fuel)
    }
  }

  console.log(`[normalize-fuel-suppliers] modo: ${apply ? "APPLY" : "DRY-RUN"}`)
  console.log(`[normalize-fuel-suppliers] proveedores combustible: ${fuelSuppliers.length}`)
  console.log(`[normalize-fuel-suppliers] ya vinculados: ${fuelSuppliers.filter((row) => row.supplier_id).length}`)
  console.log(`[normalize-fuel-suppliers] vínculos seguros por RUT: ${rutMatches.length}`)
  console.log(`[normalize-fuel-suppliers] coincidencias solo por nombre (no se aplican): ${nameOnlyMatches.length}`)
  console.log(`[normalize-fuel-suppliers] ambiguos: ${ambiguous.length}`)
  console.log(`[normalize-fuel-suppliers] sin coincidencia: ${unmatched.length}`)

  for (const match of rutMatches) {
    console.log(`- RUT ${match.fuel.rut}: ${match.fuel.id} -> ${match.general.id}`)
  }
  for (const match of nameOnlyMatches) {
    console.log(`- revisar nombre ${match.fuel.name}: ${match.fuel.id} ~ ${match.general.id}`)
  }
  for (const fuel of [...ambiguous, ...unmatched]) {
    console.log(`- revisar manualmente ${fuel.id}: ${fuel.name}${fuel.rut ? ` · ${fuel.rut}` : ""}`)
  }

  if (!apply || rutMatches.length === 0) {
    await sql.end({ timeout: 5 })
    return
  }

  await sql.begin(async (tx) => {
    for (const match of rutMatches) {
      await tx`
        update fuel_suppliers
        set supplier_id = ${match.general.id}, updated_at = now()
        where id = ${match.fuel.id} and supplier_id is null
      `
    }
  })

  console.log(`[normalize-fuel-suppliers] vínculos por RUT aplicados: ${rutMatches.length}`)
  await sql.end({ timeout: 5 })
}

main().catch(async (error) => {
  console.error("[normalize-fuel-suppliers] falló:", error)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exitCode = 1
})
