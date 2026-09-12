import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PDTP_2026_COURSE_VERSIONS,
  contentHashFor,
  decideOutcome,
  outlineMinutes,
  type CourseVersionSeed,
} from "@/scripts/seed-pdtp-2026-course-versions"
import { TRAINING_MODALITIES } from "@/lib/validation/prevention-module/training"

const seed = PDTP_2026_COURSE_VERSIONS[0]!
const course = { id: "trc-1" }

describe("carga de versiones de curso PDTP 2026", () => {
  it("crea cuando el curso existe y no tiene versiones", () => {
    expect(decideOutcome(seed, course, [])).toEqual({ kind: "create" })
  })

  it("es idempotente: no duplica la versión ya cargada", () => {
    expect(decideOutcome(seed, course, [seed.versionLabel])).toEqual({ kind: "already_done" })
  })

  it("no agrega una versión si el curso ya tiene otras", () => {
    /* `(course_id, version_label)` no es único por sí solo, así que insertar a
     * ciegas puede dejar dos versiones compitiendo. Si alguien ya cargó una a
     * mano, el script reporta y se detiene en vez de decidir por él. */
    expect(decideOutcome(seed, course, ["02"])).toEqual({ kind: "has_other_versions", labels: ["02"] })
  })

  it("trata el curso ausente como problema", () => {
    expect(decideOutcome(seed, undefined, [])).toEqual({ kind: "missing_course" })
  })

  it("el temario nunca excede la duración declarada", () => {
    // `createTrainingCourseVersion` rechaza un temario que declare más minutos
    // que el curso: sin esta comprobación el error aparece recién al escribir.
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(outlineMinutes(item), `${item.code} declara más minutos de los que dura`)
        .toBeLessThanOrEqual(item.durationMinutes)
    }
  })

  it("el temario suma exactamente la duración declarada", () => {
    // No es obligación del servicio, pero un temario que no cuadra con la
    // duración es una ficha que no se sostiene: sobran o faltan minutos sin
    // explicar en qué se ocupan.
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(outlineMinutes(item), `${item.code}: el temario no cuadra con la duración`)
        .toBe(item.durationMinutes)
    }
  })

  it("cada módulo cumple lo que el esquema exige", () => {
    // title entre 3 y 300, minutes entero positivo, detail hasta 3000.
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(item.contentOutline.length, `${item.code} sin módulos`).toBeGreaterThan(0)
      for (const modulo of item.contentOutline) {
        expect(modulo.title.trim().length, `${item.code}: "${modulo.title}"`).toBeGreaterThanOrEqual(3)
        expect(modulo.title.trim().length).toBeLessThanOrEqual(300)
        expect(Number.isInteger(modulo.minutes), `${item.code}: minutos no enteros`).toBe(true)
        expect(modulo.minutes).toBeGreaterThan(0)
        if (modulo.detail) expect(modulo.detail.length).toBeLessThanOrEqual(3000)
      }
    }
  })

  it("las modalidades existen en el enum y en el CHECK de la base", () => {
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(TRAINING_MODALITIES, `modalidad de ${item.code}`).toContain(item.modality)
    }
  })

  it("la nota de aprobación está en el rango que acepta el esquema", () => {
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(item.passingScore).toBeGreaterThanOrEqual(0)
      expect(item.passingScore).toBeLessThanOrEqual(100)
    }
  })

  it("sólo las charlas cortas van sin evaluación", () => {
    /* `closeTrainingSession` marca `not_required` a todo asistente cuando el
     * tipo es "none": nadie rinde nada. Correcto para una charla de 15 o 30
     * minutos, no para un curso formal. */
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      if (item.assessmentType === "none") {
        expect(item.durationMinutes, `${item.code} no evalúa pese a durar ${item.durationMinutes} min`)
          .toBeLessThanOrEqual(30)
      }
    }
  })

  it("cada temario declara su procedencia", () => {
    // Es lo que se responde si preguntan de dónde salió el contenido.
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(item.source.trim().length, `${item.code} sin fuente`).toBeGreaterThan(30)
    }
  })

  it("no repite un curso y deja fuera sólo el que tiene un conflicto abierto", () => {
    const codes = PDTP_2026_COURSE_VERSIONS.map((item) => item.code)
    expect(new Set(codes).size).toBe(codes.length)
    /* La N°60 es la única que falta de los trece: su ficha OTEC declara 16 horas
     * y el programa comprometió 8. Duplicar la duración de una actividad
     * comprometida es decisión de Prevención, así que queda pendiente en vez de
     * elegirse acá. Se afirma para que la ausencia se lea como decisión. */
    expect(codes, "N°60 tiene un conflicto de duración sin resolver").not.toContain("PDTP-60")
    expect(codes.length).toBe(12)
  })

  it("PDTP-54 usa la modalidad del certificado y no la del catálogo streaming", () => {
    /* La ficha publicada por Mutual describe el curso como streaming, pero el
     * certificado del 24/04/2026 dice taller, relator y dos horas presenciales,
     * con fotos de la práctica. Manda lo que efectivamente se dictó. */
    const extintores = PDTP_2026_COURSE_VERSIONS.find((item) => item.code === "PDTP-54")!
    expect(extintores.modality).toBe("presencial")
    expect(extintores.durationMinutes).toBe(120)
  })

  it("la huella de contenido cumple el CHECK de la base", () => {
    /* El esquema exige `length(content_hash) = 64`. La huella se replica del
     * servicio porque su función es privada; si alguna vez dejan de coincidir,
     * el contenido "cambiado" no se detectaría. */
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      expect(contentHashFor(item), `huella de ${item.code}`).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it("dos temarios distintos no comparten huella", () => {
    const hashes = PDTP_2026_COURSE_VERSIONS.map(contentHashFor)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it("el stage del Dockerfile le da a este bundle los globals de CJS", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8")
    const stage = /RUN \.\/node_modules\/\.bin\/esbuild scripts\/seed-pdtp-2026-course-versions\.ts[\s\S]*?--outfile=\S+/.exec(dockerfile)
    expect(stage, "falta el stage de esbuild para el cargador de temarios").not.toBeNull()
    expect(stage![0]).toContain("--banner:js=")
    for (const global of ["__dirname", "__filename", "createRequire"]) {
      expect(stage![0], `el banner no define ${global}`).toContain(global)
    }
  })

  it("las duraciones coinciden con lo que el catálogo fuente declara", () => {
    /* Si el temario dura más que el mínimo declarado del curso la ficha se
     * contradice a sí misma. Se lee como texto para no disparar el `main()` del
     * script de datos. */
    const source = readFileSync("scripts/apply-pdtp-2026-program-data.ts", "utf8")
    for (const item of PDTP_2026_COURSE_VERSIONS) {
      const line = source.split("\n").find((l) => l.includes(`code: "${item.code}"`))
      const declared = line?.match(/minutes: (\d+)/)?.[1]
      expect(declared, `${item.code} no está en el catálogo fuente`).toBeTruthy()
      expect(item.durationMinutes, `${item.code}: temario de ${item.durationMinutes} min contra ficha de ${declared}`)
        .toBe(Number(declared))
    }
  })
})

// Referencia de tipo para que el seed de ejemplo no se desalinee del tipo real.
const _typecheck: CourseVersionSeed = seed
void _typecheck
