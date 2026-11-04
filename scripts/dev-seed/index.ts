/**
 * Orquestador de siembra de datos de desarrollo.
 *
 *   npm run seed:dev                 # dry-run: mide y planifica
 *   npm run seed:dev:apply           # escribe en bodega_dev
 *   npm run seed:dev:apply -- --only=combustibles,facturacion
 *
 * Nunca escribe fuera de una base local terminada en `_dev`, `_test` o `_e2e`.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { collectCounts, evaluateCoverage, printCoverage, renderCoverage } from "./coverage"
import { closeSeedContext, loadSeedContext, type SeedContext, type SeedResult } from "./shared"
import { seedCombustibles } from "./combustibles"
import { seedFacturacion } from "./facturacion"
import { seedFlota } from "./flota"
import { seedMantencion } from "./mantencion"
import { seedMiper } from "./miper"
import { seedOperaciones } from "./operaciones"
import { seedPdtp } from "./pdtp"
import { seedPrevencion } from "./prevencion"
import { seedTi } from "./ti"

type SeedModule = {
  key: string
  label: string
  run: (context: SeedContext) => Promise<SeedResult>
}

const MODULES: readonly SeedModule[] = [
  { key: "combustibles", label: "Combustibles", run: seedCombustibles },
  { key: "facturacion", label: "Facturación", run: seedFacturacion },
  { key: "operaciones", label: "Operaciones", run: seedOperaciones },
  { key: "flota", label: "Flota y GPS", run: seedFlota },
  { key: "ti", label: "TI", run: seedTi },
  { key: "mantencion", label: "Mantención", run: seedMantencion },
  { key: "miper", label: "MIPER", run: seedMiper },
  { key: "pdtp", label: "PDTP", run: seedPdtp },
  { key: "prevencion", label: "Prevención", run: seedPrevencion },
]

function parseList(value: string | undefined): Set<string> | null {
  if (!value) return null
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean))
}

function parseOptions(argv: string[]) {
  const only = parseList(argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length))
  const skip = parseList(argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length)) ?? new Set<string>()
  return {
    apply: argv.includes("--apply"),
    writeReport: argv.includes("--write-report"),
    only,
    skip,
  }
}

function targetLabel(context: SeedContext): string {
  return `${context.target.host}:${context.target.port}/${context.target.database}`
}

function reportPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return resolve("qa/reports", `seed-dev-${date}.md`)
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const context = await loadSeedContext({ apply: options.apply })

  try {
    const before = evaluateCoverage(await collectCounts(context.sql))
    console.log("\nCobertura inicial:")
    printCoverage(before)

    const selected = MODULES.filter((seedModule) => {
      if (options.only && !options.only.has(seedModule.key)) return false
      if (options.skip.has(seedModule.key)) return false
      return true
    })

    const results: SeedResult[] = []
    const failures: { key: string; message: string }[] = []
    for (const seedModule of selected) {
      console.log(`\n${seedModule.label}:`)
      try {
        const result = await seedModule.run(context)
        results.push(result)
        for (const note of result.notes) console.log(`  · ${note}`)
        console.log(`  ${options.apply ? "insertadas" : "planificadas"}: ${result.inserted} · omitidas: ${result.skipped}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ key: seedModule.key, message })
        console.error(`  ✗ ${message}`)
      }
    }

    const after = evaluateCoverage(await collectCounts(context.sql))
    console.log("\nCobertura final:")
    printCoverage(after)

    if (options.writeReport) {
      const lines: string[] = []
      lines.push(`# Siembra de datos de desarrollo — ${new Date().toISOString().slice(0, 10)}`)
      lines.push("")
      lines.push(`Destino: \`${targetLabel(context)}\` · modo: **${options.apply ? "APPLY" : "dry-run"}**`)
      lines.push("")
      lines.push("## Antes")
      lines.push("")
      lines.push(renderCoverage(before, targetLabel(context)))
      lines.push("")
      lines.push("## Después")
      lines.push("")
      lines.push(renderCoverage(after, targetLabel(context)))
      lines.push("")
      lines.push("## Resultados")
      lines.push("")
      lines.push("| Dominio | Insertadas | Omitidas | Notas |")
      lines.push("|---|---:|---:|---|")
      for (const result of results) {
        lines.push(`| ${result.domain} | ${result.inserted} | ${result.skipped} | ${result.notes.join(" ") || "—"} |`)
      }
      if (failures.length > 0) {
        lines.push("")
        lines.push("## Fallos")
        lines.push("")
        for (const failure of failures) lines.push(`- **${failure.key}**: ${failure.message}`)
      }
      lines.push("")
      const out = reportPath()
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, lines.join("\n"), "utf8")
      console.log(`\nReporte escrito en ${out}`)
    }

    if (failures.length > 0) process.exitCode = 1
  } finally {
    await closeSeedContext(context)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
