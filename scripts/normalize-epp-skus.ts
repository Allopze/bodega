/**
 * Normaliza SKUs de productos EPP y servicios a formato secuencial:
 *   EPP-001, EPP-002, ... (EPP)
 *   SRV-001, SRV-002, ... (servicios)
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

const DRY_RUN = !process.argv.includes("--apply")
const ROLLBACK = process.argv.includes("--rollback")

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
  const eppRows = await sql`
    SELECT p.id, p.name
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
    WHERE c.is_epp = true AND p.is_active = true
    ORDER BY p.name
  `

  const srvRows = await sql`
    SELECT p.id, p.name
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
    WHERE c.is_epp = false AND p.is_active = true
    ORDER BY p.name
  `

  // ── 3. Construir mapeo ──────────────────────────────────────────────────
  const backupMap = new Map(backup.map((r) => [r.id, r]))
  const skuMap: Array<{ id: string; oldSku: string; newSku: string; name: string }> = []

  for (let i = 0; i < eppRows.length; i++) {
    const row = eppRows[i]
    if (!row) continue
    const oldSku = backupMap.get(row.id)?.sku ?? "?"
    skuMap.push({
      id: row.id,
      oldSku,
      newSku: `EPP-${String(i + 1).padStart(3, "0")}`,
      name: row.name,
    })
  }

  for (let i = 0; i < srvRows.length; i++) {
    const row = srvRows[i]
    if (!row) continue
    const oldSku = backupMap.get(row.id)?.sku ?? "?"
    skuMap.push({
      id: row.id,
      oldSku,
      newSku: `SRV-${String(i + 1).padStart(3, "0")}`,
      name: row.name,
    })
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
        await tx`UPDATE products SET sku = ${"__tmp__" + row.id} WHERE id = ${row.id}`
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
    for (const row of backup) {
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
