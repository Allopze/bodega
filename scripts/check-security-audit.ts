import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Allowlist de hallazgos altos de `npm audit` con evidencia de no-alcanzabilidad.
 * Ver AUDITORIA_BUGS_2026-07-28.md, P1-22, pasada 46, para el detalle completo.
 * `reviewBy`: si esta fecha ya pasó, el gate falla para forzar una re-evaluación
 * (los supuestos de alcanzabilidad pueden dejar de ser válidos con el tiempo).
 */
export const AUDIT_ALLOWLIST = [
  {
    ghsaId: "GHSA-mh99-v99m-4gvg", // brace-expansion: DoS por expansión sin límite
    reason:
      "Solo alcanzable vía Archiver.prototype.directory()/.glob() (usa readdir-glob). " +
      "ExcelJS solo requiere 'archiver' desde su WorkbookWriter de streaming " +
      "(lib/stream/xlsx/workbook-writer.js) y ahí únicamente llama .append()/.file(). " +
      "Ningún archivo de esta app importa esa API de streaming: todos usan " +
      ".xlsx.writeBuffer()/.load(), que usa jszip. El resto de la cadena (minimatch, " +
      "glob, archiver-utils, rimraf, zip-stream, readdir-glob, archiver, exceljs, y la " +
      "rama de ESLint que nunca procesa input externo) son entradas de propagación " +
      "de la misma vulnerabilidad, no hallazgos independientes.",
    reviewBy: "2026-10-28",
  },
  {
    ghsaId: "GHSA-f88m-g3jw-g9cj", // sharp: CVEs heredados de libvips
    reason:
      "El sharp vulnerable solo vive anidado en next, usado por su optimizador " +
      "/_next/image. La app nunca pasa contenido de usuario por next/image sin " +
      "`unoptimized` (evidence-thumbnail.tsx, tae-form.tsx) y next.config.ts no define " +
      "remotePatterns/domains externos. El sharp que procesa fotos reales de usuario " +
      "(OCR de TAE y facturas) usa la copia raíz 0.35.3, que no es vulnerable.",
    reviewBy: "2026-10-28",
  },
  {
    ghsaId: "GHSA-rgw5-rvv9-x895", // brace-expansion: bypass de la mitigación de CVE-2026-14257
    reason:
      "Mismo paquete y misma ruta que GHSA-mh99-v99m-4gvg: npm audit reporta ambos " +
      "advisories sobre la misma entrada 'brace-expansion', alcanzada desde los mismos " +
      "tres subpaths (raíz, minimatch/, readdir-glob/). Solo alcanzable vía " +
      "Archiver.prototype.directory()/.glob(), que esta app no usa (ver la justificación " +
      "de GHSA-mh99-v99m-4gvg arriba, incluido el guardrail de WorkbookWriter que cubre " +
      "ambos advisories). No es una alcanzabilidad independiente, es la misma cadena bajo " +
      "un segundo advisory del mismo CVE base (CVE-2026-14257).",
    reviewBy: "2026-10-28",
  },
] as const

type AuditVulnerability = {
  severity: string
  range?: string
  via?: Array<string | { url?: string }>
}

type AuditReport = {
  vulnerabilities?: Record<string, AuditVulnerability>
}

export function resolveGhsaIds(
  vulnerabilities: Record<string, AuditVulnerability>,
  name: string,
  seen: Set<string> = new Set(),
): Set<string> {
  const ghsaIds = new Set<string>()
  if (seen.has(name)) return ghsaIds
  seen.add(name)
  const entry = vulnerabilities[name]
  if (!entry) return ghsaIds
  for (const via of entry.via ?? []) {
    if (typeof via === "string") {
      for (const id of resolveGhsaIds(vulnerabilities, via, seen)) ghsaIds.add(id)
    } else if (via?.url) {
      const match = /advisories\/(GHSA-[a-z0-9-]+)/i.exec(via.url)
      if (match?.[1]) ghsaIds.add(match[1])
    }
  }
  return ghsaIds
}

export function findExpiredAllowlistEntries(today: string) {
  return AUDIT_ALLOWLIST.filter((entry) => entry.reviewBy < today)
}

export function findUncoveredFindings(report: AuditReport) {
  const vulnerabilities = report.vulnerabilities ?? {}
  const allowedIds = new Set<string>(AUDIT_ALLOWLIST.map((entry) => entry.ghsaId))
  const problems: string[] = []

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (entry.severity !== "high" && entry.severity !== "critical") continue
    if (entry.severity === "critical") {
      problems.push(`${name}: severidad crítica, nunca se permite en el allowlist`)
      continue
    }
    const ghsaIds = resolveGhsaIds(vulnerabilities, name)
    const uncovered = [...ghsaIds].filter((id) => !allowedIds.has(id))
    if (ghsaIds.size === 0 || uncovered.length > 0) {
      const detail = uncovered.length > 0 ? uncovered.join(", ") : "sin advisory resoluble"
      problems.push(`${name} (${entry.range ?? "rango desconocido"}) -> ${detail}`)
    }
  }
  return problems
}

/** GHSA-mh99-v99m-4gvg solo está cubierto mientras nadie use el WorkbookWriter de streaming de ExcelJS. */
export function findStreamingWorkbookWriterUsage(): string[] {
  try {
    const matches = execFileSync(
      "git",
      [
        "grep",
        "-lIE",
        "WorkbookWriter|exceljs/lib/stream",
        "--",
        "*.ts",
        "*.tsx",
        ":!scripts/check-security-audit.ts",
        ":!scripts/check-security-audit.test.ts",
      ],
      { encoding: "utf8" },
    )
    return matches.split("\n").filter(Boolean)
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [] // sin coincidencias
    throw error
  }
}

/** GHSA-f88m-g3jw-g9cj solo está cubierto mientras next/image no procese hosts externos no confiables. */
export function hasRemoteImagePatterns(nextConfigSource: string): boolean {
  return /remotePatterns|images\s*:\s*{[^}]*\bdomains\s*:/.test(nextConfigSource)
}

function runNpmAudit(): AuditReport {
  try {
    const out = execFileSync("npm", ["audit", "--audit-level=high", "--json"], { encoding: "utf8" })
    return JSON.parse(out)
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout
    if (stdout) return JSON.parse(stdout)
    throw error
  }
}

function main() {
  const today = new Date().toISOString().slice(0, 10)

  const expired = findExpiredAllowlistEntries(today)
  if (expired.length > 0) {
    console.error("Estos hallazgos de npm audit vencieron su fecha de re-revisión:")
    for (const entry of expired) console.error(`- ${entry.ghsaId} (reviewBy ${entry.reviewBy})`)
    console.error("Reevalúa la alcanzabilidad y actualiza scripts/check-security-audit.ts.")
    process.exit(1)
  }

  const streamingUsage = findStreamingWorkbookWriterUsage()
  if (streamingUsage.length > 0) {
    console.error("Se encontró uso de la API de streaming de ExcelJS (carga archiver de verdad):")
    for (const file of streamingUsage) console.error(`- ${file}`)
    console.error("Esto invalida el allowlist de GHSA-mh99-v99m-4gvg/GHSA-rgw5-rvv9-x895; revisa scripts/check-security-audit.ts.")
    process.exit(1)
  }

  const nextConfig = fs.readFileSync("next.config.ts", "utf8")
  if (hasRemoteImagePatterns(nextConfig)) {
    console.error("next.config.ts ahora define remotePatterns/domains de imágenes externas.")
    console.error("Esto puede invalidar el allowlist de GHSA-f88m-g3jw-g9cj; revisa scripts/check-security-audit.ts.")
    process.exit(1)
  }

  const report = runNpmAudit()
  const problems = findUncoveredFindings(report)
  if (problems.length > 0) {
    console.error("npm audit encontró hallazgos altos/críticos fuera del allowlist documentado:")
    for (const problem of problems) console.error(`- ${problem}`)
    console.error("Revisa scripts/check-security-audit.ts y agrega justificación o corrige la dependencia.")
    process.exit(1)
  }

  const nextReview = [...AUDIT_ALLOWLIST].sort((a, b) => (a.reviewBy < b.reviewBy ? -1 : 1))[0]?.reviewBy
  console.log(
    `npm audit: hallazgos altos cubiertos por el allowlist documentado (próxima revisión: ${nextReview}).`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
