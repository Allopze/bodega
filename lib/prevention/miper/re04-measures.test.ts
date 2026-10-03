/**
 * Fase C (spec §8): las medidas del RE-04 real. Las frases salen del RE-04 de
 * Biodiversa (`docs/Prevención Biodiversa/…/RE- 04 … (MIPER).xlsx`, ignorado por
 * git). Los responsables son cargos: ningún dato personal entra a una prueba.
 */
import { describe, expect, it } from "vitest"
import {
  analyzeRe04Measures, deadlineSuggestion, distinctPhrases, inferHierarchy, mappingProblems, responsibleSuggestion, splitMeasures, suggestedMappings,
} from "./re04-measures"

const TODAY = "2026-10-03"
const texts = (cell: unknown) => splitMeasures(cell).map((piece) => piece.text)
const row = (rowNumber: number, original: Record<string, unknown>, status = "ready") => ({ rowNumber, status, original })

describe("splitMeasures: las medidas de una celda del RE-04 real", () => {
  it("separa por comas de primer nivel, sin cortar dentro de paréntesis, y quita el punto final", () => {
    expect(texts("USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS, CAPACITACIÓN EN TRABAJO SEGURO."))
      .toEqual(["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ORDEN Y LIMPIEZA", "SEÑALIZACIÓN DE ÁREAS", "CAPACITACIÓN EN TRABAJO SEGURO"])
  })
  it("con «;» en la línea, separa por «;» y las comas enumeran dentro de una medida", () => {
    expect(texts("APLICAR TRES PUNTOS DE APOYO; PROHIBIDO SALTAR DESDE CABINA O CONTENEDOR; MANTENER PELDAÑOS, PASAMANOS Y CALZADO LIMPIOS; VERIFICAR ILUMINACIÓN Y ESTADO DE ACCESOS; PROHIBIDO SUBIR AL BORDE DEL CONTENEDOR SIN PROTECCIÓN."))
      .toEqual([
        "APLICAR TRES PUNTOS DE APOYO", "PROHIBIDO SALTAR DESDE CABINA O CONTENEDOR", "MANTENER PELDAÑOS, PASAMANOS Y CALZADO LIMPIOS",
        "VERIFICAR ILUMINACIÓN Y ESTADO DE ACCESOS", "PROHIBIDO SUBIR AL BORDE DEL CONTENEDOR SIN PROTECCIÓN",
      ])
  })
  it("corta dos medidas pegadas por un punto sin espacio, pero no una sigla", () => {
    expect(texts("USO DE GUANTES Y MASCARILLA, LAVADO FRECUENTE DE MANOS, EVITAR CONTACTO DIRECTO CON AGENTES BIOLÓGICOS.PARTICIPAR DE FORMA OBLIGATORIA EN PROGRAMA DE INOCULACION DE LA FAENA."))
      .toEqual(["USO DE GUANTES Y MASCARILLA", "LAVADO FRECUENTE DE MANOS", "EVITAR CONTACTO DIRECTO CON AGENTES BIOLÓGICOS", "PARTICIPAR DE FORMA OBLIGATORIA EN PROGRAMA DE INOCULACION DE LA FAENA"])
    expect(texts("USO DE E.P.P. OBLIGATORIO")).toEqual(["USO DE E.P.P. OBLIGATORIO"])
  })
  it("cada salto de línea separa; la coma final y los espacios sobrantes no dejan medidas vacías", () => {
    expect(texts("INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD")).toEqual(["INSTALAR RESGUARDOS EN MAQUINAS", "GUANTES", "CASCO", "CALZADO DE SEGURIDAD"])
    expect(texts("SEÑALIZACIÓN Y DEMARCACION DE VIAS\nCONTROL DE VELOCIDAD Y CAPACITACIÓN\nCHALECO REFLECTANTE, CASCO, CAPACITACIÓN DE MANEJO A LA DEFENSIVA,"))
      .toEqual(["SEÑALIZACIÓN Y DEMARCACION DE VIAS", "CONTROL DE VELOCIDAD Y CAPACITACIÓN", "CHALECO REFLECTANTE", "CASCO", "CAPACITACIÓN DE MANEJO A LA DEFENSIVA"])
    expect(texts("SISTEMAS DE VENTILACION\nCAPACITACIÓN EN MANEJO DE SUSTANCIAS CONOCER SUS RIESGOS IDENTIFICADOS EN HDS \n MANTENER VENTILACION ADECUADA, ALMACENAR PRODUCTOS EN LUGARES AUTORIZADOS Y EVITAR FUENTES DE IGNICION"))
      .toEqual(["SISTEMAS DE VENTILACION", "CAPACITACIÓN EN MANEJO DE SUSTANCIAS CONOCER SUS RIESGOS IDENTIFICADOS EN HDS", "MANTENER VENTILACION ADECUADA", "ALMACENAR PRODUCTOS EN LUGARES AUTORIZADOS Y EVITAR FUENTES DE IGNICION"])
  })
  it("el «I.–V.» del libro exportado da el tipo y la línea es una sola medida, con comas o sin rótulo", () => {
    expect(splitMeasures("III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de 5 minutos, registro firmado\nII. Cambiar solvente por uno base agua")
      .map((piece) => [piece.text, piece.prefix]))
      .toEqual([["Topes de descarga", "engineering"], ["Charla de 5 minutos, registro firmado", "administrative"], ["Cambiar solvente por uno base agua", "substitution"]])
  })
  it("cada pieza recuerda su línea, contada sobre las líneas no vacías antes de descartar repetidas y restos", () => {
    expect(splitMeasures("GUANTES, CASCO\n\nOK\nguantes\nORDEN Y LIMPIEZA").map((piece) => [piece.text, piece.line]))
      .toEqual([["GUANTES", 0], ["CASCO", 0], ["ORDEN Y LIMPIEZA", 3]])
  })
  it("la misma medida dos veces en una celda cuenta una; sin texto no hay medidas", () => {
    expect(texts("ORDEN Y LIMPIEZA, orden y limpieza.")).toEqual(["ORDEN Y LIMPIEZA"])
    expect(texts("Y, DE.")).toEqual([])
    expect(splitMeasures(null)).toEqual([])
    expect(splitMeasures(42)).toEqual([])
  })
})

describe("inferHierarchy: el tipo sugerido", () => {
  it.each([
    ["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ppe"],
    ["GUANTES", "ppe"],
    ["USO DE PROTECTORES AUDITIVOS", "ppe"],
    ["BLOQUEO Y ETIQUETADO (LOTO)", "engineering"],
    ["INSTALACION DE BARANDAS Y ESCALAS SEGURAS", "engineering"],
    ["MANTENER RESGUARDOS INSTALADOS", "engineering"],
    ["DEMARCACIÓN DE ÁREAS DE TRÁNSITO", "engineering"],
    ["USO DE BARANDAS", "engineering"],
    ["CAPACITACIÓN EN TRABAJO SEGURO", "administrative"],
    ["PROCEDIMIENTOS DE BLOQUEO Y ETIQUETADO", "administrative"],
    ["REVISIÓN DE INSTALACIONES ELÉCTRICAS", "administrative"],
    ["NO INTRODUCIR MANOS EN PARTES MOVILES", "administrative"],
    ["SUSTITUIR SOLVENTE POR PRODUCTO BASE AGUA", "substitution"],
    ["ELIMINAR LA TAREA MANUAL", "elimination"],
  ])("«%s» → %s por palabra clave (manda la que aparece primero)", (text, hierarchy) => {
    expect(inferHierarchy({ text })).toEqual({ hierarchy, source: "keyword" })
  })
  it("«uso de …» sin otra pista es EPP; sin ninguna pista es IV y queda marcada", () => {
    expect(inferHierarchy({ text: "USO DE CINTA ANTIDESLIZANTE" })).toEqual({ hierarchy: "ppe", source: "keyword" })
    expect(inferHierarchy({ text: "ORGANIZAR LAS TAREAS" })).toEqual({ hierarchy: "administrative", source: "default" })
  })
  it("el «I.–V.» del Excel manda sobre las palabras clave", () => {
    expect(inferHierarchy({ text: "Uso de casco", prefix: "administrative" })).toEqual({ hierarchy: "administrative", source: "prefix" })
  })
})

describe("deadlineSuggestion: los PLAZOS del RE-04 real", () => {
  it.each([
    ["TRIMESTRAL", { kind: "existing", frequency: "TRIMESTRAL" }, "frequency"],
    ["ANTES DE CADA OPERACIÓN", { kind: "existing", frequency: "ANTES DE CADA OPERACIÓN" }, "frequency"],
    ["INMEDIATO / ANTES DE CONTINUAR LA TAREA", { kind: "pending", dueDate: TODAY }, "immediate"],
    // «al ocurrir» es una medida de contingencia que ya existe (kit de derrames): se aplica cuando pasa el evento.
    ["INMEDIATO AL OCURRIR", { kind: "existing", frequency: "Al ocurrir" }, "frequency"],
    ["AL OCURRIR", { kind: "existing", frequency: "Al ocurrir" }, "frequency"],
    // «en N días» manda sobre «diario»: es una medida nueva con su plazo.
    ["IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO", { kind: "pending", dueDate: "2026-11-02" }, "relative"],
    // «cada N días» no es un plazo: es la frecuencia con que se verifica una medida existente.
    ["CADA 30 DÍAS", { kind: "existing", frequency: "CADA 30 DÍAS" }, "frequency"],
    ["30-06-2026", { kind: "pending", dueDate: "2026-06-30" }, "date"],
    ["2026-06-30", { kind: "pending", dueDate: "2026-06-30" }, "date"],
    ["31/12/2026", { kind: "pending", dueDate: "2026-12-31" }, "date"],
  ] as const)("«%s»", (text, decision, source) => {
    expect(deadlineSuggestion(text, TODAY)).toEqual({ decision, source })
  })
  it("una fecha imposible, un texto sin pista o una celda vacía quedan por implementar y sin fecha", () => {
    for (const text of ["31-02-2026", "SEGÚN PROGRAMA", "", null]) {
      expect(deadlineSuggestion(text, TODAY)).toEqual({ decision: { kind: "pending", dueDate: null }, source: "default" })
    }
  })
})

describe("responsibleSuggestion", () => {
  it("por defecto, el texto del Excel; si es exactamente el nombre de una persona de la faena, esa persona; vacío, sin responsable", () => {
    const users = [{ id: "u-1", name: "Jefe de Faena" }]
    expect(responsibleSuggestion("SUPERVISOR/PREVENCION", users)).toEqual({ kind: "text", name: "SUPERVISOR/PREVENCION" })
    expect(responsibleSuggestion("  jefe de   faena ", users)).toEqual({ kind: "user", userId: "u-1" })
    expect(responsibleSuggestion(null, users)).toEqual({ kind: "none" })
  })
})

describe("analyzeRe04Measures", () => {
  const analysis = analyzeRe04Measures([
    row(14, { "MEDIDA DE CONTROL": "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA", "RESPONSABLE": "SUPERVISOR/PREVENCION", "PLAZOS": "INMEDIATO / ANTES DE CONTINUAR LA TAREA" }),
    row(15, { "MEDIDA DE CONTROL": "ORDEN Y LIMPIEZA; INSPECCIÓN DE HERRAMIENTAS", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL " }),
    // P o C fuera de la escala: nunca se carga, así que no pide decisiones.
    row(16, { "MEDIDA DE CONTROL": "PROTECTORES AUDITIVOS", "RESPONSABLE": "PREVENCION", "PLAZOS": "MENSUAL" }, "rejected"),
    row(17, { "MEDIDA DE CONTROL": null, "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL" }),
    // Espera su factor: si existe al confirmar se carga, así que sus medidas sí piden decisión.
    row(18, { "MEDIDA DE CONTROL": "CHARLA DE SEGURIDAD", "RESPONSABLE": null, "PLAZOS": null }, "needs_review"),
  ], { today: TODAY })

  it("una medida por frase y fila; las filas que nunca se cargan no piden decisiones", () => {
    expect(analysis.measures.map((measure) => [measure.rowNumber, measure.text])).toEqual([
      [14, "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)"], [14, "ORDEN Y LIMPIEZA"],
      [15, "ORDEN Y LIMPIEZA"], [15, "INSPECCIÓN DE HERRAMIENTAS"], [18, "CHARLA DE SEGURIDAD"],
    ])
  })
  it("cada frase, responsable y plazo distinto aparece una vez, por frecuencia, con su sugerencia", () => {
    expect(analysis.phrases.map((phrase) => [phrase.text, phrase.count, phrase.suggestion.hierarchy])).toEqual([
      ["ORDEN Y LIMPIEZA", 2, "administrative"],
      ["CHARLA DE SEGURIDAD", 1, "administrative"],
      ["INSPECCIÓN DE HERRAMIENTAS", 1, "administrative"],
      ["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", 1, "ppe"],
    ])
    expect(analysis.responsibles.map((group) => [group.key, group.text, group.count, group.suggestion])).toEqual([
      ["prevencion", "PREVENCION", 2, { kind: "text", name: "PREVENCION" }],
      ["supervisor/prevencion", "SUPERVISOR/PREVENCION", 2, { kind: "text", name: "SUPERVISOR/PREVENCION" }],
      ["", null, 1, { kind: "none" }],
    ])
    expect(analysis.deadlines.map((group) => [group.key, group.text, group.count, group.suggestion])).toEqual([
      ["inmediato / antes de continuar la tarea", "INMEDIATO / ANTES DE CONTINUAR LA TAREA", 2, { kind: "pending", dueDate: TODAY }],
      ["trimestral", "TRIMESTRAL", 2, { kind: "existing", frequency: "TRIMESTRAL" }],
      ["", null, 1, { kind: "pending", dueDate: null }],
    ])
  })
  it("libro exportado: con «I.–V.» en todas las medidas y una línea por medida, cada medida toma su responsable y su plazo", () => {
    const exported = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno",
      "RESPONSABLE": "Supervisor de turno\n—", "PLAZOS": "30-06-2026\nTrimestral",
    })], { today: TODAY })
    expect(exported.measures.map((measure) => [measure.text, measure.prefix, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "engineering", "supervisor de turno", "30-06-2026"],
      ["Charla de inicio de turno", "administrative", "", "trimestral"],
    ])
    // Sin «I.–V.», la celda entera vale para todas las medidas de la fila.
    const plain = analyzeRe04Measures([row(14, { "MEDIDA DE CONTROL": "BARANDAS\nCHARLA DE INICIO", "RESPONSABLE": "SUPERVISOR\nPREVENCION", "PLAZOS": "TRIMESTRAL" })], { today: TODAY })
    expect(plain.measures.map((measure) => measure.responsibleKey)).toEqual(["supervisor prevencion", "supervisor prevencion"])
    // Con «I.–V.» pero sin una línea por medida (alguien editó el libro a mano), también.
    const collapsed = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno",
      "RESPONSABLE": "Supervisor de turno", "PLAZOS": "Trimestral",
    })], { today: TODAY })
    expect(collapsed.measures.map((measure) => [measure.responsibleKey, measure.deadlineKey])).toEqual([["supervisor de turno", "trimestral"], ["supervisor de turno", "trimestral"]])
  })
  it("libro exportado con una frase repetida en la fila: la frase toma los valores de su PRIMERA línea y las demás siguen alineadas", () => {
    const exported = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Topes de descarga\nV. Elementos de protección personal: Casco",
      "RESPONSABLE": "Supervisor de turno\nJefe de faena\n—", "PLAZOS": "30-06-2026\nTrimestral\nMensual",
    })], { today: TODAY })
    expect(exported.measures.map((measure) => [measure.text, measure.prefix, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "engineering", "supervisor de turno", "30-06-2026"],
      ["Casco", "ppe", "", "mensual"],
    ])
  })
  it("libro exportado con un resto de menos de 3 caracteres: el resto consume su línea y las demás siguen alineadas", () => {
    const exported = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: OK\nV. Elementos de protección personal: Casco",
      "RESPONSABLE": "Supervisor de turno\nPrevención\nJefe de faena", "PLAZOS": "30-06-2026\nTrimestral\n—",
    })], { today: TODAY })
    expect(exported.measures.map((measure) => [measure.text, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "supervisor de turno", "30-06-2026"],
      ["Casco", "jefe de faena", ""],
    ])
  })
  it("libro exportado con una línea en blanco en RESPONSABLE y PLAZOS: con tantas líneas crudas como MEDIDA, la blanca es «vacío» y no corre las demás", () => {
    const exported = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno",
      "RESPONSABLE": "\nJefe de faena", "PLAZOS": "\nTrimestral",
    })], { today: TODAY })
    expect(exported.measures.map((measure) => [measure.text, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "", ""],
      ["Charla de inicio de turno", "jefe de faena", "trimestral"],
    ])
    // Sin calce de líneas crudas (las blancas del final no cuentan), se alinean las no vacías.
    const loose = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno\n",
      "RESPONSABLE": "Supervisor de turno\n\nJefe de faena\n\n", "PLAZOS": "30-06-2026\nTrimestral",
    })], { today: TODAY })
    expect(loose.measures.map((measure) => [measure.responsibleKey, measure.deadlineKey])).toEqual([["supervisor de turno", "30-06-2026"], ["jefe de faena", "trimestral"]])
  })
  it("distinctPhrases: si alguna aparición trae «I.–V.», la frase toma ese tipo", () => {
    expect(distinctPhrases([
      { text: "Charla de inicio", phraseKey: "charla inicio", prefix: null },
      { text: "Charla de inicio", phraseKey: "charla inicio", prefix: "administrative" },
    ])).toEqual([{ key: "charla inicio", text: "Charla de inicio", count: 2, suggestion: { hierarchy: "administrative", source: "prefix" } }])
  })
})

describe("mapeos", () => {
  const analysis = analyzeRe04Measures([row(14, { "MEDIDA DE CONTROL": "GUANTES, CASCO", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL" })], { today: TODAY })

  it("las sugerencias forman un mapeo completo y sin problemas", () => {
    const mappings = suggestedMappings(analysis)
    expect(mappings).toEqual({
      measureMapping: { guantes: "ppe", casco: "ppe" },
      responsibleMapping: { prevencion: { kind: "text", name: "PREVENCION" } },
      deadlineMapping: { trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
    expect(mappingProblems(analysis, mappings)).toEqual([])
  })
  it("dice qué falta y qué sobra, en palabras de la persona", () => {
    const mappings = suggestedMappings(analysis)
    const { casco: _casco, ...withoutCasco } = mappings.measureMapping
    expect(mappingProblems(analysis, { ...mappings, measureMapping: withoutCasco, responsibleMapping: {} })).toEqual([
      "La importación no coincide con la vista previa: falta decidir el tipo de 1 medida y el responsable de 1 valor.",
      "Vuelve a revisar el archivo.",
    ])
    expect(mappingProblems(analysis, { ...mappings, deadlineMapping: { ...mappings.deadlineMapping, mensual: { kind: "existing", frequency: "MENSUAL" } } })).toEqual([
      "La importación trae decisiones para 1 valor que el archivo no tiene.",
      "Vuelve a revisar el archivo.",
    ])
  })
})
