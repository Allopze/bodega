/**
 * Normaliza SKUs de productos EPP y servicios a formato secuencial:
 *   EPP-001, EPP-002, ... (EPP)
 *   SRV-001, SRV-002, ... (servicios)
 *
 * Conserva el código de todo producto que ya tiene un SKU canónico de su
 * prefijo: el SKU es lo que quedó impreso en guías y actas, así que sólo se
 * asigna a productos nuevos, a SKUs heredados y a reclasificados de prefijo.
 * Eso deja la secuencia fuera del orden alfabético a medida que se agregan
 * productos, y es a propósito.
 *
 * Sólo toca productos activos. Los inactivos conservan su SKU para preservar la
 * trazabilidad histórica; sus códigos quedan reservados y producen saltos en la
 * secuencia activa.
 *
 * También ajusta unit_of_measure de productos que requieren presentación
 * distinta de "unidad".
 *
 * Ejecutar con:
 *   npx tsx scripts/normalize-epp-skus.ts            -- dry-run (preview)
 *   npx tsx scripts/normalize-epp-skus.ts --apply     -- aplicar cambios
 *   npx tsx scripts/normalize-epp-skus.ts --rollback  -- revertir desde backup
 */
import postgres from "postgres"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { buildSequentialSkuMap } from "./normalize-epp-skus-logic"

const DRY_RUN = !process.argv.includes("--apply")
const ROLLBACK = process.argv.includes("--rollback")

type AllProductRow = {
  id: string
  sku: string
  name: string
  is_active: boolean
}

function getBackupDir(): string {
  const custom = process.env.BACKUP_DIR
  const candidates = [
    ...(custom ? [custom] : []),
    path.join(process.cwd(), "backups"),
    path.join("/tmp", "backups"),
    path.join(os.tmpdir(), "backups"),
    os.tmpdir(),
  ]

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.accessSync(dir, fs.constants.W_OK)
      return dir
    } catch {
      continue
    }
  }

  return os.tmpdir()
}

function findBackupFile(): string | null {
  const candidateDirs: string[] = [
    ...(process.env.BACKUP_DIR ? [process.env.BACKUP_DIR] : []),
    path.join(process.cwd(), "backups"),
    path.join("/tmp", "backups"),
    path.join(os.tmpdir(), "backups"),
    os.tmpdir(),
  ]

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith("sku-normalize-") && f.endsWith(".json"))
      if (files.length > 0) {
        files.sort().reverse()
        return path.join(dir, files[0]!)
      }
    } catch {
      continue
    }
  }
  return null
}

// ── Unit of measure corrections ──────────────────────────────────────────────
const UOM_CHANGES: Array<{ nameLike: string; newUom: string }> = [
  { nameLike: "Guante Ansell Hyflex 11-801", newUom: "par" },
  { nameLike: "Guante nitrilo texturizado", newUom: "caja" },
  { nameLike: "Protector Solar FPS 50 Leblon", newUom: "kg" },
]

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL es requerida")
    process.exit(1)
  }

  const sql = postgres(databaseUrl, { max: 1 })

  if (ROLLBACK) {
    await rollback(sql)
    return
  }

  // ── 1. Backup actual ─────────────────────────────────────────────────────
  console.log("📦 Generando backup de SKUs actuales...")
  const backup = await sql`
    SELECT p.id, p.sku, p.name, p.unit_of_measure, p.category_id
    FROM products p
    WHERE p.is_active = true
  `

  const backupDir = getBackupDir()
  const backupFile = path.join(backupDir, `sku-normalize-${new Date().toISOString().slice(0, 10)}.json`)

  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2))
    console.log(`   → ${backup.length} productos respaldados en ${backupFile}`)
  } catch (err) {
    console.warn(`   ⚠️  No se pudo escribir archivo de backup en ${backupFile}: ${(err as Error).message}`)
    console.log(`   (Se continúa porque el despliegue cuenta con pg_dump previo)`)
  }

  // ── 2. Query EPP y SRV ──────────────────────────────────────────────────
  // El desempate por `id` no es cosmético. Hay productos que comparten nombre
  // exacto (varias tallas del mismo botín), y `ORDER BY p.name` a secas deja su
  // posición en manos del plan de ejecución. Como este script reescribe cada
  // fila dos veces por corrida (SKU temporal y definitivo), su lugar en el heap
  // cambia y el orden se daba vuelta en el siguiente deploy: en producción los
  // SKU EPP-023..026 se permutaban entre sí una y otra vez.
  //
  // El anclaje de `buildSequentialSkuMap` ya impide esa rotación, porque un
  // producto con código canónico no se mueve. Este orden sigue decidiendo qué
  // correlativo recibe cada producto nuevo, y ahí un empate sin desempate
  // volvería a repartir códigos distintos en cada corrida.
  const eppRows = await sql`
    SELECT p.id, p.name
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
    WHERE c.is_epp = true AND p.is_active = true
    ORDER BY p.name, p.id
  `

  const srvRows = await sql`
    SELECT p.id, p.name
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
    WHERE c.is_epp = false AND p.is_active = true
    ORDER BY p.name, p.id
  `

  const allProducts = await sql<AllProductRow[]>`
    SELECT p.id, p.sku, p.name, p.is_active
    FROM products p
    WHERE p.sku IS NOT NULL
  `

  // ── 3. Construir mapeo ──────────────────────────────────────────────────
  const backupMap = new Map(backup.map((r) => [r.id, r]))
  const skuMap = buildSequentialSkuMap({
    rows: [
      ...eppRows.map((row) => ({
        id: row.id,
        oldSku: backupMap.get(row.id)?.sku ?? "?",
        name: row.name,
        prefix: "EPP" as const,
      })),
      ...srvRows.map((row) => ({
        id: row.id,
        oldSku: backupMap.get(row.id)?.sku ?? "?",
        name: row.name,
        prefix: "SRV" as const,
      })),
    ],
    existingProducts: allProducts.map((row) => ({ id: row.id, sku: row.sku })),
  })

  const normalizableIds = new Set(skuMap.map((row) => row.id))
  const reservedProducts = allProducts.filter(
    (row) => !normalizableIds.has(row.id) && /^(EPP|SRV)-\d+$/.test(row.sku),
  )
  if (reservedProducts.length > 0) {
    console.log(`\n🔒 SKUs conservados fuera de la renumeración (${reservedProducts.length}):`)
    for (const row of reservedProducts) {
      console.log(`   ${row.sku.padEnd(12)} | ${row.name.slice(0, 60)}${row.is_active ? "" : " (inactivo)"}`)
    }
  }

  // ── 4. Mostrar preview ──────────────────────────────────────────────────
  console.log(`\n📋 Mapeo de SKUs (${skuMap.length} productos):`)
  console.log("─".repeat(80))
  console.log(`${"SKU actual".padEnd(48)} → ${"Nuevo SKU".padEnd(12)} Nombre`)
  console.log("─".repeat(80))

  for (const row of skuMap) {
    const changed = row.oldSku !== row.newSku
    const marker = changed ? "✏️ " : "   "
    console.log(`${marker}${row.oldSku.padEnd(46)} → ${row.newSku.padEnd(12)} ${row.name.slice(0, 40)}`)
  }

  // ── 5. Mostrar cambios de UoM ──────────────────────────────────────────
  console.log(`\n📏 Cambios de unit_of_measure:`)
  for (const change of UOM_CHANGES) {
    const match = backup.filter((p) => p.name.toLowerCase().includes(change.nameLike.toLowerCase()))
    for (const m of match) {
      console.log(`   ${m.sku.padEnd(12)} | ${m.name.slice(0, 40).padEnd(40)} | ${m.unit_of_measure} → ${change.newUom}`)
    }
  }

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN — sin cambios aplicados. Ejecuta con --apply para confirmar.")
    await sql.end()
    return
  }

  // ── 6. Aplicar cambios ──────────────────────────────────────────────────
  console.log("\n🔧 Aplicando cambios...")

  await sql.begin(async (tx) => {
    let updated = 0
    const toUpdate = skuMap.filter((row) => row.oldSku !== row.newSku)
    if (toUpdate.length > 0) {
      // Fase 1: prefijo temporal para evitar colisiones con el constraint unique
      for (const row of toUpdate) {
        await tx`UPDATE products SET sku = ${"__sku_normalize_tmp__" + row.id} WHERE id = ${row.id}`
      }
      // Fase 2: asignar el nuevo SKU definitivo
      for (const row of toUpdate) {
        await tx`UPDATE products SET sku = ${row.newSku} WHERE id = ${row.id}`
        updated++
      }
    }
    console.log(`   ✓ ${updated} SKUs actualizados`)

    for (const change of UOM_CHANGES) {
      const res = await tx`
        UPDATE products SET unit_of_measure = ${change.newUom}
        WHERE LOWER(name) LIKE ${"%" + change.nameLike.toLowerCase() + "%"}
          AND is_active = true
          AND unit_of_measure != ${change.newUom}
      `
      if (res.count > 0) {
        console.log(`   ✓ ${res.count} productos → unit_of_measure = '${change.newUom}' (${change.nameLike})`)
      }
    }
  })

  console.log("\n✅ Todos los cambios aplicados correctamente.")
  await sql.end()
}

async function rollback(sql: postgres.Sql) {
  const backupFile = findBackupFile()
  if (!backupFile) {
    console.error(`❌ No se encontró ningún archivo de backup sku-normalize-*.json`)
    process.exit(1)
  }

  const backup: Array<{ id: string; sku: string; name: string; unit_of_measure: string }> = JSON.parse(
    fs.readFileSync(backupFile, "utf-8"),
  )

  console.log(`🔄 Revirtiendo ${backup.length} productos desde ${backupFile}...`)

  await sql.begin(async (tx) => {
    const toRestore = backup

    // Stage all changed rows first so rollback also handles SKU cycles (A ↔ B)
    // without violating products.sku_unique midway through the transaction.
    for (const row of toRestore) {
      await tx`UPDATE products SET sku = ${"__sku_rollback_tmp__" + row.id} WHERE id = ${row.id} AND sku != ${row.sku}`
    }

    for (const row of toRestore) {
      await tx`
        UPDATE products
        SET sku = ${row.sku}, unit_of_measure = ${row.unit_of_measure}
        WHERE id = ${row.id} AND (sku != ${row.sku} OR unit_of_measure != ${row.unit_of_measure})
      `
    }
  })

  console.log(`✅ Rollback completado — ${backup.length} productos restaurados.`)
  await sql.end()
}

main()
