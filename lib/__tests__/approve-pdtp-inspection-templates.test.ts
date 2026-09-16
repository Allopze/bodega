import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PDTP_2026_TEMPLATE_REMEDIATION,
  decideOutcome,
  type RemediationEntry,
} from "@/scripts/approve-pdtp-2026-inspection-templates"
import { PDTP_2026_INSPECTION_SPECS, completionNumbers } from "@/lib/prevention/inspection-wiring"

const approval: RemediationEntry = {
  code: "CAMINATA-SEG",
  versionLabel: "01",
  action: "approve",
  expectStatus: "draft",
  reason: "motivo suficientemente largo para el servicio",
}

const retirement: RemediationEntry = {
  code: "inspeccion_epp",
  versionLabel: "02",
  action: "retire",
  expectStatus: "approved",
  reason: "motivo suficientemente largo para el servicio",
}

describe("plan de habilitación de plantillas PDTP 2026", () => {
  it("aplica cuando la plantilla está en el estado esperado", () => {
    expect(decideOutcome(approval, { status: "draft" })).toEqual({ kind: "apply" })
    expect(decideOutcome(retirement, { status: "approved" })).toEqual({ kind: "apply" })
  })

  it("es idempotente: no reaplica lo que ya está hecho", () => {
    // Correr el script dos veces no puede aprobar dos veces ni fallar: la
    // segunda corrida es la que se hace cuando la primera se cortó a la mitad.
    expect(decideOutcome(approval, { status: "approved" })).toEqual({ kind: "already_done" })
    expect(decideOutcome(retirement, { status: "superseded" })).toEqual({ kind: "already_done" })
  })

  it("trata la plantilla ausente como retiro ya hecho y como aprobación imposible", () => {
    // `retireInspectionTemplate` BORRA la fila cuando no tiene corridas ni
    // programas, así que 'no está' es el resultado buscado de un retiro; para
    // una aprobación es que el sembrador del catálogo nunca corrió.
    expect(decideOutcome(retirement, undefined)).toEqual({ kind: "already_done" })
    expect(decideOutcome(approval, undefined)).toEqual({ kind: "missing" })
  })

  it("no toca nada ante un estado inesperado", () => {
    // Una plantilla que alguien dejó `superseded` a mano no se re-aprueba en
    // silencio: el script reporta y se detiene.
    expect(decideOutcome(approval, { status: "superseded" })).toEqual({ kind: "unexpected_status", found: "superseded" })
    expect(decideOutcome(retirement, { status: "draft" })).toEqual({ kind: "unexpected_status", found: "draft" })
  })

  it("el stage del Dockerfile le da a este bundle los globals de CJS", () => {
    /* Cualquier dependencia CJS que caiga dentro de este bundle ESM usa
     * `__dirname`/`require`, indefinidos ahí. Sin el banner el script revienta
     * al cargar, en producción, antes de ejecutar una línea propia — que es
     * exactamente lo que pasó la primera vez, cuando la cadena
     * `logger -> lib/sentry.ts -> @sentry/nextjs` metía Next entero. Esa cadena
     * ya no existe, pero el banner se conserva: cuesta una línea y el día que
     * alguien importe un servicio pesado acá el fallo vuelve a ser en runtime. */
    const dockerfile = readFileSync("Dockerfile", "utf8")
    const stage = /RUN \.\/node_modules\/\.bin\/esbuild scripts\/approve-pdtp-2026-inspection-templates\.ts[\s\S]*?--outfile=\S+/.exec(dockerfile)
    expect(stage, "falta el stage de esbuild para el script de habilitación").not.toBeNull()
    expect(stage![0]).toContain("--banner:js=")
    for (const global of ["__dirname", "__filename", "createRequire"]) {
      expect(stage![0], `el banner no define ${global}`).toContain(global)
    }
  })

  it("cada entrada trae un motivo que el servicio acepta", () => {
    // `approveInspectionTemplate` y `retireInspectionTemplate` exigen 10
    // caracteres: un motivo corto sólo falla al llegar a producción.
    for (const entry of PDTP_2026_TEMPLATE_REMEDIATION) {
      expect(entry.reason.trim().length, `${entry.code}@${entry.versionLabel}`).toBeGreaterThanOrEqual(10)
    }
  })

  it("no repite una plantilla en el plan", () => {
    const keys = PDTP_2026_TEMPLATE_REMEDIATION.map((entry) => `${entry.code}@${entry.versionLabel}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("sólo aprueba plantillas que el catálogo 2026 declara con actividad PDTP", () => {
    // Una aprobación que no corresponda a una fila del catálogo sería habilitar
    // un instrumento que el programa no pidió.
    const wiredCodes = new Set(
      PDTP_2026_INSPECTION_SPECS
        .filter((spec) => (completionNumbers(spec) ?? []).length > 0)
        .map((spec) => spec.definitionCode),
    )
    const aliases: Record<string, string> = { "INSP-AREA": "inspeccion_area", "CAMINATA-SEG": "caminata_seguridad" }
    for (const entry of PDTP_2026_TEMPLATE_REMEDIATION.filter((candidate) => candidate.action === "approve")) {
      expect(wiredCodes, entry.code).toContain(aliases[entry.code] ?? entry.code)
    }
  })
})
