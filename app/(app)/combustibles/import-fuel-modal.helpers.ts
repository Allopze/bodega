import type { ParsedFuelLoad, ImportError } from "@/lib/combustibles/import"

export type Step = "upload" | "preview" | "done"

export type Worksite = { id: string; name: string }

// Sentinels for worksite mapping dropdown (Radix Select doesn't support value="")
export const CREATE_FAENA = "__create__"
export const SKIP_FAENA = "__skip__"

/** Normalize a worksite name for auto-matching: lowercase, remove accents,
 *  remove the word "faena", alphanumeric only. */
export function normFaena(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bfaena\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Returns the best-matching worksiteId for an Excel worksite name, or ""
 *  if none matches. Uses normalized exact match or token containment. */
export function autoMatchWorksite(fileFaena: string, worksites: Worksite[]): string {
  const target = normFaena(fileFaena)
  if (!target) return ""
  let best = ""
  let bestLen = 0
  for (const w of worksites) {
    const wn = normFaena(w.name)
    if (!wn) continue
    const hit = target === wn || target.includes(wn) || wn.includes(target)
    if (hit && wn.length > bestLen) {
      best = w.id
      bestLen = wn.length
    }
  }
  return best
}

export interface ImportResult {
  imported: number
  errors: ImportError[]
  created: Array<{ type: string; name: string }>
}

export function resetImportState() {
  return {
    step: "upload" as Step,
    fileName: "",
    loads: [] as ParsedFuelLoad[],
    errors: [] as ImportError[],
    duplicates: [] as number[],
    importing: false,
    result: null as ImportResult | null,
    createMissing: false,
  }
}

export const STEP_LABELS = ["Subir archivo", "Revisar datos", "Completado"]
