import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PDTP_2026_COURSE_RECLASSIFICATION,
  decideOutcome,
  type ReclassifyEntry,
} from "@/scripts/reclassify-pdtp-2026-specific-courses"
import { TRAINING_COURSE_KINDS, DS44_ART16_MIN_DURATION_MINUTES } from "@/lib/validation/prevention-module/training"

const entry: ReclassifyEntry = {
  code: "PDTP-54",
  expectKind: "legal_mandatory",
  toKind: "practical_training",
  legalBasis: "DS 594 art. 48",
  minimumDurationMinutes: 120,
  validityMonths: 36,
  evidence: "Certificado Mutual 24/04/2026",
  reason: "motivo suficientemente largo para la constancia",
}

describe("plan de reclasificación de cursos específicos PDTP 2026", () => {
  it("aplica cuando el curso está en la clasificación esperada", () => {
    expect(decideOutcome(entry, { kind: "legal_mandatory" })).toEqual({ kind: "apply" })
  })

  it("es idempotente: no reaplica lo ya hecho", () => {
    // Correr el script dos veces no puede duplicar la entrada de historial; la
    // segunda corrida es la que se hace cuando la primera se cortó a la mitad.
    expect(decideOutcome(entry, { kind: "practical_training" })).toEqual({ kind: "already_done" })
  })

  it("no toca nada ante una clasificación inesperada", () => {
    // Un curso que alguien ya movió a mano a otra categoría no se pisa en
    // silencio: el script reporta y se detiene.
    expect(decideOutcome(entry, { kind: "certification" })).toEqual({ kind: "unexpected_kind", found: "certification" })
  })

  it("trata el curso ausente como problema, no como éxito", () => {
    expect(decideOutcome(entry, undefined)).toEqual({ kind: "missing" })
  })

  it("las clasificaciones del plan existen en el enum", () => {
    // `kind` tiene CHECK en la base: un valor inventado revienta al escribir,
    // en producción y a mitad del lote.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      expect(TRAINING_COURSE_KINDS, `origen de ${item.code}`).toContain(item.expectKind)
      expect(TRAINING_COURSE_KINDS, `destino de ${item.code}`).toContain(item.toKind)
    }
  })

  it("saca todos los cursos de `legal_mandatory`", () => {
    // Ése es el punto: mientras sigan ahí, `assessLegalFloor` exige 8 horas y
    // no se puede crear su versión.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      expect(item.toKind, `${item.code} seguiría bloqueado`).not.toBe("legal_mandatory")
    }
  })

  it("cubre los tres cursos que el piso del art. 16 bloquea o bloqueará", () => {
    /* PDTP-54 (240 min) y PDTP-63 (120 min) están bloqueados hoy: declaran menos
     * que los 480 minutos que `assessLegalFloor` exige a un `legal_mandatory`.
     * PDTP-58 pasa hoy sólo porque declara 480; entra igual porque su
     * clasificación es igual de incorrecta y porque corregir su duración a la
     * de la ficha real del organismo administrador lo bloquearía. */
    expect(DS44_ART16_MIN_DURATION_MINUTES).toBe(480)
    const codes = PDTP_2026_COURSE_RECLASSIFICATION.map((item) => item.code).sort()
    expect(codes).toEqual(["PDTP-54", "PDTP-58", "PDTP-63"])
  })

  it("no repite un curso en el plan", () => {
    const codes = PDTP_2026_COURSE_RECLASSIFICATION.map((item) => item.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("cada entrada deja constancia utilizable", () => {
    // El motivo y la base legal quedan en el historial y en la ficha: son lo
    // que se muestra si alguien pregunta por qué el curso dejó de ser de 8 horas.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      expect(item.reason.trim().length, `motivo de ${item.code}`).toBeGreaterThanOrEqual(10)
      expect(item.legalBasis, `base legal de ${item.code}`).toBeTruthy()
      expect(item.legalBasis, `${item.code} debe aclarar que el art. 16 sigue vigente`)
        .toContain("no elimina el cumplimiento del curso general")
    }
  })

  it("toda corrección de duración o vigencia trae su respaldo documental", () => {
    /* Bajar la duración declarada de un curso de prevención sin decir de dónde
     * sale el número es exactamente lo que no se puede sostener frente a una
     * fiscalización. Si la entrada corrige, tiene que citar el certificado. */
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      const corrige = item.minimumDurationMinutes !== null || item.validityMonths !== null
      if (corrige) {
        expect(item.evidence, `${item.code} corrige la ficha sin citar respaldo`).toBeTruthy()
        expect(item.evidence!.length).toBeGreaterThan(40)
      }
    }
  })

  it("las vigencias corregidas exceden el máximo del art. 16, que es parte del punto", () => {
    // 36 meses > 24: mientras fueran `legal_mandatory`, la vigencia real los
    // bloqueaba igual que la duración. Reclasificar destraba ambas.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      if (item.validityMonths !== null) expect(item.validityMonths).toBeGreaterThan(24)
    }
  })

  it("PDTP-63 no inventa duración ni vigencia", () => {
    // No hay certificado que contradiga lo declarado, así que no se toca.
    const epp = PDTP_2026_COURSE_RECLASSIFICATION.find((item) => item.code === "PDTP-63")!
    expect(epp.minimumDurationMinutes).toBeNull()
    expect(epp.validityMonths).toBeNull()
  })

  it("el catálogo fuente ya nace con la clasificación corregida", () => {
    /* `apply-pdtp-2026-program-data.ts` es de donde salieron mal. Si el plan de
     * reclasificación corrige algo que ese catálogo sigue declarando al revés,
     * la próxima corrida del script de datos vuelve a crear el curso torcido en
     * cualquier base nueva. Se lee como texto y no por import para no disparar
     * el `main()` del script. */
    const source = readFileSync("scripts/apply-pdtp-2026-program-data.ts", "utf8")
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      const line = source.split("\n").find((l) => l.includes(`code: "${item.code}"`))
      expect(line, `${item.code} no está en el catálogo fuente`).toBeTruthy()
      expect(line, `${item.code} sigue declarado como '${item.expectKind}' en el catálogo fuente`)
        .toContain(`kind: "${item.toKind}"`)
      if (item.minimumDurationMinutes !== null) {
        expect(line, `${item.code}: el catálogo fuente no declara ${item.minimumDurationMinutes} min`)
          .toContain(`minutes: ${item.minimumDurationMinutes}`)
      }
      if (item.validityMonths !== null) {
        expect(line, `${item.code}: el catálogo fuente no declara ${item.validityMonths} meses`)
          .toContain(`validityMonths: ${item.validityMonths}`)
      }
    }
  })

  it("el stage del Dockerfile le da a este bundle los globals de CJS", () => {
    // Precaución, no necesidad: hoy este script importa `db/schema` directo y no
    // arrastra Next. El banner evita que reviente al cargar el día que alguien
    // necesite importar un servicio acá, como le pasó al de plantillas.
    const dockerfile = readFileSync("Dockerfile", "utf8")
    const stage = /RUN \.\/node_modules\/\.bin\/esbuild scripts\/reclassify-pdtp-2026-specific-courses\.ts[\s\S]*?--outfile=\S+/.exec(dockerfile)
    expect(stage, "falta el stage de esbuild para el script de reclasificación").not.toBeNull()
    expect(stage![0]).toContain("--banner:js=")
    for (const global of ["__dirname", "__filename", "createRequire"]) {
      expect(stage![0], `el banner no define ${global}`).toContain(global)
    }
  })
})
