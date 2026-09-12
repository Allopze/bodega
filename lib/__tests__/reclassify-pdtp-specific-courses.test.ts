import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PDTP_2026_COURSE_RECLASSIFICATION,
  decideOutcome,
  type CourseRow,
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

/** Fila tal como quedaría después de aplicar `entry`. */
const corregida: CourseRow = {
  kind: "practical_training",
  minimumDurationMinutes: 120,
  validityMonths: 36,
  legalBasis: "DS 594 art. 48",
}

/** Entrada que sólo declara vigencia, sin tocar la clasificación. */
const soloVigencia: ReclassifyEntry = {
  code: "PDTP-57",
  expectKind: null,
  toKind: null,
  legalBasis: null,
  minimumDurationMinutes: null,
  validityMonths: 24,
  evidence: "Informe de cierre, regla interna de refresco de competencias.",
  reason: "motivo suficientemente largo para la constancia",
}

describe("plan de corrección de fichas de curso PDTP 2026", () => {
  it("aplica cuando el curso está en la clasificación esperada", () => {
    expect(decideOutcome(entry, { ...corregida, kind: "legal_mandatory", minimumDurationMinutes: 240, validityMonths: 12, legalBasis: "DS 594 art. 44 y 45" }))
      .toEqual({ kind: "apply" })
  })

  it("es idempotente: no reaplica lo ya hecho", () => {
    // Correr el script dos veces no puede duplicar la entrada de historial; la
    // segunda corrida es la que se hace cuando la primera se cortó a la mitad.
    expect(decideOutcome(entry, corregida)).toEqual({ kind: "already_done" })
  })

  it("sigue aplicando si la clasificación ya cambió pero falta otro campo", () => {
    /* Mirar sólo el `kind` daba por hecha una entrada a medio aplicar. Si el
     * script se cortó entre el UPDATE y el commit de otra fila, la segunda
     * corrida tiene que terminar el trabajo, no declararlo hecho. */
    expect(decideOutcome(entry, { ...corregida, validityMonths: 12 })).toEqual({ kind: "apply" })
    expect(decideOutcome(entry, { ...corregida, minimumDurationMinutes: 240 })).toEqual({ kind: "apply" })
    expect(decideOutcome(entry, { ...corregida, legalBasis: "otra cosa" })).toEqual({ kind: "apply" })
  })

  it("una entrada que sólo declara vigencia no depende de la clasificación", () => {
    // PDTP-57 y PDTP-60 no cambian de categoría: sólo se les declara la vigencia
    // que estaba en blanco. Con `toKind` nulo, el `kind` actual es irrelevante.
    const sinVigencia: CourseRow = { kind: "practical_training", minimumDurationMinutes: 240, validityMonths: null, legalBasis: null }
    expect(decideOutcome(soloVigencia, sinVigencia)).toEqual({ kind: "apply" })
    expect(decideOutcome(soloVigencia, { ...sinVigencia, validityMonths: 24 })).toEqual({ kind: "already_done" })
    // Y no se queja de una categoría que no vino a corregir.
    expect(decideOutcome(soloVigencia, { ...sinVigencia, kind: "certification" })).toEqual({ kind: "apply" })
  })

  it("no toca nada ante una clasificación inesperada", () => {
    // Un curso que alguien ya movió a mano a otra categoría no se pisa en
    // silencio: el script reporta y se detiene.
    expect(decideOutcome(entry, { ...corregida, kind: "certification" }))
      .toEqual({ kind: "unexpected_kind", found: "certification" })
  })

  it("trata el curso ausente como problema, no como éxito", () => {
    expect(decideOutcome(entry, undefined)).toEqual({ kind: "missing" })
  })

  it("las clasificaciones declaradas existen en el enum", () => {
    // `kind` tiene CHECK en la base: un valor inventado revienta al escribir,
    // en producción y a mitad del lote.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      if (item.expectKind !== null) expect(TRAINING_COURSE_KINDS, `origen de ${item.code}`).toContain(item.expectKind)
      if (item.toKind !== null) expect(TRAINING_COURSE_KINDS, `destino de ${item.code}`).toContain(item.toKind)
    }
  })

  it("ninguna entrada deja un curso en `legal_mandatory`", () => {
    // Mientras sigan ahí, `assessLegalFloor` exige 8 horas y vigencia de a lo
    // más 24 meses, y no se puede crear su versión.
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      expect(item.toKind, `${item.code} seguiría bloqueado`).not.toBe("legal_mandatory")
    }
  })

  it("reclasifica los cuatro cursos que no son del art. 16", () => {
    /* Extintores, EPP, Coordinador GRD y primeros auxilios: ninguno satisface el
     * temario transversal del art. 16, aunque alguno coincida en duración. */
    expect(DS44_ART16_MIN_DURATION_MINUTES).toBe(480)
    const reclasifican = PDTP_2026_COURSE_RECLASSIFICATION
      .filter((item) => item.toKind !== null).map((item) => item.code).sort()
    expect(reclasifican).toEqual(["PDTP-54", "PDTP-55", "PDTP-58", "PDTP-63"])
  })

  it("no repite un curso en el plan", () => {
    const codes = PDTP_2026_COURSE_RECLASSIFICATION.map((item) => item.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("cada entrada explica su motivo", () => {
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      expect(item.reason.trim().length, `motivo de ${item.code}`).toBeGreaterThanOrEqual(10)
    }
  })

  it("toda reclasificación aclara que el art. 16 sigue vigente", () => {
    /* La baja aparente de 8 horas a 4 o 2 no es una rebaja del estándar: el
     * curso general del art. 16 es otra obligación y mantiene su duración. Sin
     * esa aclaración en la ficha, la corrección se lee como un recorte. */
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION.filter((i) => i.toKind !== null)) {
      expect(item.legalBasis, `base legal de ${item.code}`).toBeTruthy()
      expect(item.legalBasis, `${item.code} debe aclarar que el art. 16 sigue vigente`)
        .toContain("no elimina el cumplimiento del curso general")
    }
  })

  it("toda corrección de duración o vigencia trae su respaldo documental", () => {
    /* Cambiar la duración o la vigencia declarada de un curso de prevención sin
     * decir de dónde sale el número es lo que no se sostiene frente a una
     * fiscalización. Si la entrada corrige, tiene que citar su fuente. */
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      const corrige = item.minimumDurationMinutes !== null || item.validityMonths !== null
      if (corrige) {
        expect(item.evidence, `${item.code} corrige la ficha sin citar respaldo`).toBeTruthy()
        expect(item.evidence!.length).toBeGreaterThan(40)
      }
    }
  })

  it("distingue la vigencia documentada de la regla interna", () => {
    /* Las de 36 meses salen de un certificado y además exceden el máximo de 24
     * del art. 16 —otra razón por la que esos cursos no podían estar ahí—. Las
     * de 24 son criterio interno de refresco y su respaldo tiene que decirlo,
     * para que nadie las lea como plazo legal. */
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      if (item.validityMonths === 36) {
        expect(item.evidence, `${item.code}`).toMatch(/[Cc]ertificado|[Dd]iploma/)
      }
      if (item.validityMonths === 24) {
        expect(item.evidence, `${item.code} debe declarar que no es exigencia legal`)
          .toContain("No se presenta como exigencia legal")
      }
    }
  })

  it("PDTP-63 no inventa duración ni vigencia", () => {
    // No hay certificado que contradiga lo declarado, así que no se toca.
    const epp = PDTP_2026_COURSE_RECLASSIFICATION.find((item) => item.code === "PDTP-63")!
    expect(epp.minimumDurationMinutes).toBeNull()
    expect(epp.validityMonths).toBeNull()
  })

  it("el catálogo fuente ya nace con la ficha corregida", () => {
    /* `apply-pdtp-2026-program-data.ts` es de donde salieron mal. Si el plan
     * corrige algo que ese catálogo sigue declarando al revés, la próxima
     * corrida del script de datos vuelve a crear el curso torcido en cualquier
     * base nueva. Se lee como texto y no por import para no disparar su
     * `main()`. */
    const source = readFileSync("scripts/apply-pdtp-2026-program-data.ts", "utf8")
    for (const item of PDTP_2026_COURSE_RECLASSIFICATION) {
      const line = source.split("\n").find((l) => l.includes(`code: "${item.code}"`))
      expect(line, `${item.code} no está en el catálogo fuente`).toBeTruthy()
      if (item.toKind !== null) {
        expect(line, `${item.code} sigue declarado como '${item.expectKind}' en el catálogo fuente`)
          .toContain(`kind: "${item.toKind}"`)
      }
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
