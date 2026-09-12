import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  decideOutcome,
  seedableDefinitions,
  type TemplateRow,
} from "@/scripts/resign-pdtp-2026-inspection-templates"
import { PDTP_2026_INSPECTION_SPECS } from "@/lib/prevention/inspection-wiring"

const FIRMANTE = "user-alejandro"
const OTRO = "user-lorena"

const base: TemplateRow = {
  id: "instpl-1",
  code: "inspeccion_extintores",
  versionLabel: "02",
  status: "approved",
  approvedByUserId: FIRMANTE,
  runs: 0,
  programs: 0,
}

describe("retiro de plantillas para refirma", () => {
  it("retira la que firmó la persona equivocada y no tiene uso", () => {
    expect(decideOutcome(base, FIRMANTE)).toEqual({ kind: "retire" })
  })

  it("no toca las que firmó otra persona", () => {
    // El script corrige una firma concreta, no vacía el catálogo: una plantilla
    // aprobada por quien corresponde se deja como está.
    expect(decideOutcome({ ...base, approvedByUserId: OTRO }, FIRMANTE)).toEqual({ kind: "not_targeted" })
    expect(decideOutcome({ ...base, approvedByUserId: null }, FIRMANTE)).toEqual({ kind: "not_targeted" })
  })

  it("es idempotente: la ya retirada no se vuelve a tocar", () => {
    for (const status of ["draft", "superseded"]) {
      expect(decideOutcome({ ...base, status }, FIRMANTE)).toEqual({ kind: "already_retired" })
    }
  })

  it("se detiene ante una plantilla con uso", () => {
    /* `retireInspectionTemplate` BORRA cuando no hay corridas ni programas, y
     * marca `superseded` cuando sí los hay. Un `superseded` deja ocupado el par
     * `(code, versionLabel)`, que tiene índice único, así que el sembrador no
     * podría recrear la plantilla y el instrumento quedaría fuera de
     * circulación. Por eso se comprueba antes en vez de dejar decidir al
     * servicio. */
    expect(decideOutcome({ ...base, runs: 1 }, FIRMANTE)).toEqual({ kind: "in_use", runs: 1, programs: 0 })
    expect(decideOutcome({ ...base, programs: 2 }, FIRMANTE)).toEqual({ kind: "in_use", runs: 0, programs: 2 })
  })

  it("el uso pesa más que la firma correcta sólo cuando la plantilla es del objetivo", () => {
    // Una plantilla con uso pero firmada por otra persona no es problema de este
    // script: sale como `not_targeted`, no como `in_use`.
    expect(decideOutcome({ ...base, approvedByUserId: OTRO, runs: 5 }, FIRMANTE)).toEqual({ kind: "not_targeted" })
  })

  it("las definiciones recreables salen del catálogo del sembrador", () => {
    /* Si esta lista se escribiera a mano se desincronizaría del sembrador, y el
     * síntoma sería una plantilla retirada que ya nadie recrea. */
    const definitions = seedableDefinitions()
    expect(definitions.size).toBeGreaterThan(0)
    for (const spec of PDTP_2026_INSPECTION_SPECS) {
      expect(definitions, `${spec.definitionCode} no se podría recrear`).toContain(spec.definitionCode)
    }
  })

  it("el stage del Dockerfile le da a este bundle los globals de CJS", () => {
    /* Este script sí entra por `prevention-inspections.ts`, que importa el
     * logger y con él Next: sin el banner revienta al cargar, en producción. */
    const dockerfile = readFileSync("Dockerfile", "utf8")
    const stage = /RUN \.\/node_modules\/\.bin\/esbuild scripts\/resign-pdtp-2026-inspection-templates\.ts[\s\S]*?--outfile=\S+/.exec(dockerfile)
    expect(stage, "falta el stage de esbuild para el script de refirma").not.toBeNull()
    expect(stage![0]).toContain("--banner:js=")
    for (const global of ["__dirname", "__filename", "createRequire"]) {
      expect(stage![0], `el banner no define ${global}`).toContain(global)
    }
  })
})
