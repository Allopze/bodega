import { DEFAULT_MAX_GAP_DAYS, type StaySnapshotInput } from "./stay-reconstruction-run"

/** Argumentos y planilla del script de reconstrucción (puro, para poder probarlo sin base). */

export const STAY_RECONSTRUCTION_USAGE =
  "tsx --env-file=.env.local scripts/reconstruct-worksite-stays.ts --out=<informe.xlsx> " +
  "[--apply] [--max-gap-days=7] [--snapshots=<archivo.json>] [--actor-email=<correo>]"

export interface StayCliArgs {
  apply: boolean
  maxGapDays: number
  snapshotsFile: string | null
  out: string
  actorEmail: string | null
}

/** Acepta `--flag=valor` y `--flag valor`. */
function valueOf(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
    if (arg === flag) {
      const next = argv[i + 1]
      return next !== undefined && !next.startsWith("--") ? next : null
    }
  }
  return null
}

export function parseStayCliArgs(argv: string[]): StayCliArgs {
  const rawGap = valueOf(argv, "--max-gap-days")
  const maxGapDays = rawGap === null ? DEFAULT_MAX_GAP_DAYS : Number(rawGap)
  if (!Number.isInteger(maxGapDays) || maxGapDays < 0) {
    throw new Error("--max-gap-days debe ser un entero mayor o igual a 0.")
  }
  const out = valueOf(argv, "--out")
  if (!out) throw new Error(`Falta --out=<informe.xlsx>. Uso: ${STAY_RECONSTRUCTION_USAGE}`)
  if (!out.toLowerCase().endsWith(".xlsx")) throw new Error("--out debe terminar en .xlsx (el informe es Excel).")
  return {
    apply: argv.includes("--apply"),
    maxGapDays,
    snapshotsFile: valueOf(argv, "--snapshots"),
    out,
    actorEmail: valueOf(argv, "--actor-email"),
  }
}

/** Valida el JSON de planilla: `[{ date, code?, plate?, worksiteName }]`. Una fila rota detiene la corrida. */
export function parseSnapshots(json: string): StaySnapshotInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("--snapshots no es un JSON válido.")
  }
  if (!Array.isArray(parsed)) throw new Error("--snapshots debe ser una lista de filas.")
  return parsed.map((row, index): StaySnapshotInput => {
    const where = `Fila ${index + 1} de --snapshots`
    if (!row || typeof row !== "object") throw new Error(`${where}: no es un objeto.`)
    const { date, code, plate, worksiteName } = row as Record<string, unknown>
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${where}: «date» debe ser AAAA-MM-DD.`)
    if (typeof worksiteName !== "string" || !worksiteName.trim()) throw new Error(`${where}: falta «worksiteName».`)
    const asText = (value: unknown, label: string): string | null => {
      if (value === undefined || value === null) return null
      if (typeof value !== "string") throw new Error(`${where}: «${label}» debe ser texto.`)
      return value.trim() || null
    }
    const normalizedCode = asText(code, "code")
    const normalizedPlate = asText(plate, "plate")
    if (!normalizedCode && !normalizedPlate) throw new Error(`${where}: falta «plate» o «code».`)
    return { date, code: normalizedCode, plate: normalizedPlate, worksiteName: worksiteName.trim() }
  })
}
