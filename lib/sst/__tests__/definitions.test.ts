import { describe, it, expect } from 'vitest'
import { getDefinition, CHECKLIST_DEFINITIONS, TRABAJADOR_NUEVO, TRABAJADOR_ANTIGUO, isPersonEvaluationDefinition, isNonInspectionDefinition } from '../definitions'
import { checklistDefinitionSchema } from '../definition-schema'

// ── CHECKLIST_DEFINITIONS ───────────────────────────────────────────────────

describe('CHECKLIST_DEFINITIONS', () => {
  it('has trabajador_nuevo definition', () => {
    const definition = CHECKLIST_DEFINITIONS['trabajador_nuevo']
    expect(definition).toBeDefined()
    expect(definition?.code).toBe('trabajador_nuevo')
  })

  it('has trabajador_antiguo definition', () => {
    const definition = CHECKLIST_DEFINITIONS['trabajador_antiguo']
    expect(definition).toBeDefined()
    expect(definition?.code).toBe('trabajador_antiguo')
  })

  it('keeps the person-only subset explicit even when the catalog also contains inspections', () => {
    expect(isPersonEvaluationDefinition('trabajador_nuevo')).toBe(true)
    expect(isPersonEvaluationDefinition('trabajador_antiguo')).toBe(true)
    expect(isPersonEvaluationDefinition('inspeccion_taller')).toBe(false)
  })

  it('digitaliza el Anexo 7 y el Anexo 08 dentro del motor sin puntaje oficial', () => {
    expect(isNonInspectionDefinition('observacion_planeada')).toBe(false)
    expect(CHECKLIST_DEFINITIONS['observacion_planeada']).toBeDefined()
    expect(CHECKLIST_DEFINITIONS['observacion_planeada']?.version).toBe('03')
    expect(CHECKLIST_DEFINITIONS['observacion_planeada']?.recordsPreventiveActions).toBe(true)
    expect(CHECKLIST_DEFINITIONS['inspeccion_no_planeada']?.recordsDeviations).toBe(true)
    expect(isNonInspectionDefinition('observacion_ampliroll')).toBe(false)
    expect(isNonInspectionDefinition('observacion_maquinaria')).toBe(false)
    expect(isNonInspectionDefinition('inspeccion_taller')).toBe(false)
    expect(Object.keys(CHECKLIST_DEFINITIONS).length).toBeGreaterThanOrEqual(2)
  })

  it.each([
    ['inspeccion_equipos_moviles', '02', 52],
    ['inspeccion_extintores', '02', 5],
    ['inspeccion_epp', '03', 20],
    ['observacion_ampliroll', '02', 22],
    ['observacion_maquinaria', '02', 22],
    ['inspeccion_taller', '02', 16],
    ['inspeccion_carros', '03', 22],
    ['inspeccion_contenedores', '03', 14],
    ['inspeccion_condiciones_ambientales', '01', 12],
  ])('mantiene la paridad de %s v%s con %i respuestas puntuables', (code, version, expected) => {
    const definition = CHECKLIST_DEFINITIONS[code]
    expect(definition?.version).toBe(version)
    const scorable = definition?.sections.flatMap((section) => section.countsForCompliance === false ? [] : section.items)
      .filter((item) => !['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'signature', 'readonly'].includes(item.kind))
    expect(scorable).toHaveLength(expected)
  })

  it('presenta EPP como matriz de respuestas independientes', () => {
    const items = CHECKLIST_DEFINITIONS.inspeccion_epp!.sections
      .filter((section) => section.countsForCompliance !== false)
      .flatMap((section) => section.items)
    expect(items.every((item) => item.matrix)).toBe(true)
    expect(items.filter((item) => item.matrix?.rowId === 'bloqueador_solar').map((item) => item.matrix?.columnLabel)).toEqual([
      'Usa (Sí/No/N/A)',
      'Registro (Sí/No)',
    ])
  })
})

// ── getDefinition ───────────────────────────────────────────────────────────

/*
 * El único control automático sobre la forma del catálogo. Vivía en las pruebas
 * del motor de checklist del PDTP, que se retiró; se mudó acá porque el
 * catálogo pertenece hoy al motor de inspecciones. Se itera entero y no tres
 * definiciones elegidas a mano: la versión anterior dejaba pasar a las demás.
 */
describe('forma del catálogo', () => {
  it('todas las definiciones pasan el validador de forma', () => {
    for (const [code, definition] of Object.entries(CHECKLIST_DEFINITIONS)) {
      const parsed = checklistDefinitionSchema.safeParse(definition)
      expect(parsed.success, `${code}: ${parsed.error?.issues[0]?.path.join('.')} ${parsed.error?.issues[0]?.message}`).toBe(true)
    }
  })

  it('ninguna sección viene vacía: el motor desreferencia items sin guarda', () => {
    for (const [code, definition] of Object.entries(CHECKLIST_DEFINITIONS)) {
      for (const section of definition.sections) {
        expect(Array.isArray(section.items), `${code}/${section.id}`).toBe(true)
      }
    }
  })

  it('los pares (sección, ítem) son únicos y no llevan "::"', () => {
    // `sectionId::itemId` es la clave compuesta de las respuestas, y el cliente
    // la parte por posición: un id con "::" corrompe el payload, y uno repetido
    // colapsa dos respuestas en una fila sin avisar.
    for (const [code, definition] of Object.entries(CHECKLIST_DEFINITIONS)) {
      const seen = new Set<string>()
      for (const section of definition.sections) {
        for (const item of section.items) {
          const key = `${section.id}::${item.id}`
          expect(section.id.includes('::'), `${code}/${section.id}`).toBe(false)
          expect(item.id.includes('::'), `${code}/${item.id}`).toBe(false)
          expect(seen.has(key), `${code}: ${key} duplicado`).toBe(false)
          seen.add(key)
        }
      }
    }
  })

  it('EPP, Carros y Contenedores usan la escala del anexo, no la binaria', () => {
    const escalas: Record<string, string> = {
      // EPP combina B/R/M con la columna "Usa" (Sí/No/N/A) del Anexo 3.
      inspeccion_epp: 'bueno_regular_malo_obs',
      inspeccion_carros: 'bueno_regular_malo_obs',
      inspeccion_contenedores: 'bueno_regular_malo_na_nt_obs',
    }
    for (const [code, kind] of Object.entries(escalas)) {
      const items = CHECKLIST_DEFINITIONS[code]!.sections.flatMap((section) => section.items)
      expect(items.some((item) => item.kind === kind), `${code} debería usar ${kind}`).toBe(true)
      expect(items.every((item) => item.kind !== 'cumple_nocumple_obs'), `${code} conserva escala binaria`).toBe(true)
    }
  })
})

describe('getDefinition', () => {
  it('returns trabajador_nuevo definition by code', () => {
    const def = getDefinition('trabajador_nuevo')
    expect(def).toBe(TRABAJADOR_NUEVO)
    expect(def.code).toBe('trabajador_nuevo')
  })

  it('returns trabajador_antiguo definition by code', () => {
    const def = getDefinition('trabajador_antiguo')
    expect(def).toBe(TRABAJADOR_ANTIGUO)
    expect(def.code).toBe('trabajador_antiguo')
  })

  it('throws for unknown code', () => {
    expect(() => getDefinition('unknown_code')).toThrow('Unknown checklist definition')
  })

  it('throws for empty string', () => {
    expect(() => getDefinition('')).toThrow('Unknown checklist definition')
  })
})

// ── TRABAJADOR_NUEVO structure ──────────────────────────────────────────────

describe('TRABAJADOR_NUEVO', () => {
  it('has required fields', () => {
    expect(TRABAJADOR_NUEVO.code).toBe('trabajador_nuevo')
    expect(TRABAJADOR_NUEVO.title).toBeTruthy()
    expect(TRABAJADOR_NUEVO.version).toBeTruthy()
    expect(TRABAJADOR_NUEVO.revisionDate).toBeTruthy()
    expect(TRABAJADOR_NUEVO.tipo).toBe('nuevo')
  })

  it('has at least 3 sections', () => {
    expect(TRABAJADOR_NUEVO.sections.length).toBeGreaterThanOrEqual(3)
  })

  it('every section has id, title, and items', () => {
    for (const sec of TRABAJADOR_NUEVO.sections) {
      expect(sec.id).toBeTruthy()
      expect(sec.title).toBeTruthy()
      expect(Array.isArray(sec.items)).toBe(true)
      expect(sec.items.length).toBeGreaterThan(0)
    }
  })

  it('every item has id, label, and kind', () => {
    for (const sec of TRABAJADOR_NUEVO.sections) {
      for (const item of sec.items) {
        expect(item.id).toBeTruthy()
        expect(item.label).toBeTruthy()
        expect(item.kind).toBeTruthy()
      }
    }
  })

  it('has closingAct definition', () => {
    expect(TRABAJADOR_NUEVO.closingAct).toBeDefined()
    expect(TRABAJADOR_NUEVO.closingAct!.title).toBeTruthy()
    expect(Array.isArray(TRABAJADOR_NUEVO.closingAct!.signatureRoles)).toBe(true)
  })

  it('includes blocker sections: documentacion_requisitos, induccion_capacitacion, competencias_operacionales', () => {
    const sectionIds = TRABAJADOR_NUEVO.sections.map((s) => s.id)
    expect(sectionIds).toContain('documentacion_requisitos')
    expect(sectionIds).toContain('induccion_capacitacion')
    expect(sectionIds).toContain('competencias_operacionales')
  })
})

// ── TRABAJADOR_ANTIGUO structure ────────────────────────────────────────────

describe('TRABAJADOR_ANTIGUO', () => {
  it('has required fields', () => {
    expect(TRABAJADOR_ANTIGUO.code).toBe('trabajador_antiguo')
    expect(TRABAJADOR_ANTIGUO.title).toBeTruthy()
    expect(TRABAJADOR_ANTIGUO.tipo).toBe('seguimiento')
  })

  it('has at least 5 sections', () => {
    expect(TRABAJADOR_ANTIGUO.sections.length).toBeGreaterThanOrEqual(5)
  })

  it('every section has id, title, and items', () => {
    for (const sec of TRABAJADOR_ANTIGUO.sections) {
      expect(sec.id).toBeTruthy()
      expect(sec.title).toBeTruthy()
      expect(Array.isArray(sec.items)).toBe(true)
      expect(sec.items.length).toBeGreaterThan(0)
    }
  })

  it('includes blocker sections: procedimientos_criticos, control_ampliroll, control_batea, control_maquinaria', () => {
    const sectionIds = TRABAJADOR_ANTIGUO.sections.map((s) => s.id)
    expect(sectionIds).toContain('procedimientos_criticos')
    expect(sectionIds).toContain('control_ampliroll')
    expect(sectionIds).toContain('control_batea')
    expect(sectionIds).toContain('control_maquinaria')
  })

  it('has cargo-conditional sections with appliesWhen', () => {
    const conditionalSections = TRABAJADOR_ANTIGUO.sections.filter(
      (s) => s.appliesWhen && s.appliesWhen.length > 0
    )
    expect(conditionalSections.length).toBeGreaterThan(0)
  })
})
