import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

/**
 * Allowlist de hallazgos altos de `npm audit` con evidencia de no-alcanzabilidad.
 * Ver AUDITORIA_BUGS_2026-07-28.md, P1-22, pasada 46, para el criterio.
 *
 * Reglas de cada entrada:
 * - `reviewBy`: si la fecha ya pasó, el gate falla para forzar una re-evaluación
 *   (los supuestos de alcanzabilidad pueden dejar de ser válidos con el tiempo).
 * - Debe seguir apareciendo en `npm audit`: una entrada cuyo advisory ya no
 *   alcanza ningún hallazgo alto hace fallar el gate (`findStaleAllowlistEntries`).
 *   Una excepción de seguridad que ya no justifica nada queda como puerta
 *   abierta para el día en que el advisory vuelva por otra ruta de alcance.
 * - Si su justificación depende de una condición del repo (no usar una API, no
 *   tener cierto archivo), la entrada trae su propio guardrail en `main()`.
 *
 * Vacío desde el 2026-09-27: `npm audit` no reporta hallazgos. Las cuatro
 * entradas anteriores (brace-expansion GHSA-mh99-v99m-4gvg y GHSA-rgw5-rvv9-x895,
 * sharp GHSA-f88m-g3jw-g9cj, js-yaml GHSA-5p4m-2wfm-xmqj) y sus guardrails
 * (WorkbookWriter de ExcelJS, `.eslintrc.y(a)ml`, `images.remotePatterns`) siguen
 * en el historial de este archivo por si alguno reaparece.
 */
export type AuditAllowlistEntry = {
  ghsaId: string
  reason: string
  reviewBy: string
}

export const AUDIT_ALLOWLIST: readonly AuditAllowlistEntry[] = []

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

export function findExpiredAllowlistEntries(today: string, allowlist: readonly AuditAllowlistEntry[] = AUDIT_ALLOWLIST) {
  return allowlist.filter((entry) => entry.reviewBy < today)
}

/** Advisories alcanzables desde algún hallazgo alto/crítico del reporte. */
function reachableHighGhsaIds(report: AuditReport): Set<string> {
  const vulnerabilities = report.vulnerabilities ?? {}
  const reachable = new Set<string>()
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (entry.severity !== "high" && entry.severity !== "critical") continue
    for (const id of resolveGhsaIds(vulnerabilities, name)) reachable.add(id)
  }
  return reachable
}

/** Entradas del allowlist cuyo advisory ya no alcanza ningún hallazgo alto. */
export function findStaleAllowlistEntries(report: AuditReport, allowlist: readonly AuditAllowlistEntry[] = AUDIT_ALLOWLIST) {
  const reachable = reachableHighGhsaIds(report)
  return allowlist.filter((entry) => !reachable.has(entry.ghsaId))
}

export function findUncoveredFindings(report: AuditReport, allowlist: readonly AuditAllowlistEntry[] = AUDIT_ALLOWLIST) {
  const vulnerabilities = report.vulnerabilities ?? {}
  const allowedIds = new Set<string>(allowlist.map((entry) => entry.ghsaId))
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

  const report = runNpmAudit()
  const problems = findUncoveredFindings(report)
  if (problems.length > 0) {
    console.error("npm audit encontró hallazgos altos/críticos fuera del allowlist documentado:")
    for (const problem of problems) console.error(`- ${problem}`)
    console.error("Revisa scripts/check-security-audit.ts y agrega justificación o corrige la dependencia.")
    process.exit(1)
  }

  const stale = findStaleAllowlistEntries(report)
  if (stale.length > 0) {
    console.error("Estas entradas del allowlist ya no corresponden a ningún hallazgo alto de npm audit:")
    for (const entry of stale) console.error(`- ${entry.ghsaId}`)
    console.error("Quítalas de scripts/check-security-audit.ts (con sus guardrails, si los tienen).")
    process.exit(1)
  }

  if (AUDIT_ALLOWLIST.length === 0) {
    console.log("npm audit: sin hallazgos altos ni críticos; el allowlist está vacío.")
    return
  }

  const nextReview = [...AUDIT_ALLOWLIST].sort((a, b) => (a.reviewBy < b.reviewBy ? -1 : 1))[0]?.reviewBy
  console.log(
    `npm audit: hallazgos altos cubiertos por el allowlist documentado (próxima revisión: ${nextReview}).`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
