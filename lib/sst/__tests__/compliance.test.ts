import { describe, it, expect } from 'vitest'
import { calculateCompliance, classifyEfficacy, getAutomaticResultadoFinal } from '../compliance'
import type { StatusValue } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function respuestas(map: Record<string, string>): { estado: StatusValue }[] {
  return Object.values(map).map((estado) => ({ estado: estado as StatusValue }))
}

// ---------------------------------------------------------------------------
// calculateCompliance
// ---------------------------------------------------------------------------
describe('calculateCompliance', () => {
  it('retorna 100% cuando todos los ítems cumplen', () => {
    const r = respuestas({ a: 'cumple', b: 'cumple', c: 'cumple' })
    const result = calculateCompliance(r)
    expect(result.cumplidos).toBe(3)
    expect(result.noCumplidos).toBe(0)
    expect(result.percentage).toBe(100)
  })

  it('retorna 0% cuando todos los ítems no cumplen', () => {
    const r = respuestas({ a: 'no_cumple', b: 'no_cumple' })
    const result = calculateCompliance(r)
    expect(result.cumplidos).toBe(0)
    expect(result.noCumplidos).toBe(2)
    expect(result.percentage).toBe(0)
  })

  it('calcula fórmula cumplidos/(cumplidos+noCumplidos)', () => {
    const r = respuestas({ a: 'cumple', b: 'cumple', c: 'no_cumple' })
    const result = calculateCompliance(r)
    expect(result.percentage).toBeCloseTo(66.667, 2)
  })

  it('excluye N/A del denominador', () => {
    // 3 cumple, 1 no_cumple, 2 na → % = 3/(3+1) = 75%, no 3/6 = 50%
    const r = respuestas({ a: 'cumple', b: 'cumple', c: 'cumple', d: 'no_cumple', e: 'na', f: 'na' })
    const result = calculateCompliance(r)
    expect(result.na).toBe(2)
    expect(result.total).toBe(4)    // solo cumple + no_cumple
    expect(result.percentage).toBeCloseTo(75, 2)
  })

  it('N/A no penaliza (formulario solo con N/A retorna 0%, no rompe)', () => {
    const r = respuestas({ a: 'na', b: 'na' })
    const result = calculateCompliance(r)
    expect(result.total).toBe(0)
    expect(result.percentage).toBe(0)
  })

  it('formulario vacío (sin respuestas) retorna 0%', () => {
    const result = calculateCompliance([])
    expect(result.percentage).toBe(0)
    expect(result.total).toBe(0)
  })

  it('acepta variantes: entregado / no_entregado', () => {
    const r = respuestas({ a: 'entregado', b: 'no_entregado', c: 'entregado' })
    const result = calculateCompliance(r)
    expect(result.cumplidos).toBe(2)
    expect(result.noCumplidos).toBe(1)
    expect(result.percentage).toBeCloseTo(66.667, 2)
  })

  it('acepta variantes: apto / no_apto', () => {
    const r = respuestas({ a: 'apto', b: 'no_apto' })
    const result = calculateCompliance(r)
    expect(result.cumplidos).toBe(1)
    expect(result.noCumplidos).toBe(1)
    expect(result.percentage).toBe(50)
  })

  it('acepta variantes: si / no', () => {
    const r = respuestas({ a: 'si', b: 'si', c: 'no' })
    const result = calculateCompliance(r)
    expect(result.cumplidos).toBe(2)
    expect(result.noCumplidos).toBe(1)
    expect(result.percentage).toBeCloseTo(66.667, 2)
  })

  it('no redondea el porcentaje (valor exacto persistido)', () => {
    // 2/3 → 66.6666... (no 67)
    const r = respuestas({ a: 'cumple', b: 'cumple', c: 'no_cumple' })
    const result = calculateCompliance(r)
    expect(result.percentage).not.toBe(67)
    expect(result.percentage).toBeGreaterThan(66)
    expect(result.percentage).toBeLessThan(67)
  })
})

// ---------------------------------------------------------------------------
// classifyEfficacy
// ---------------------------------------------------------------------------
describe('classifyEfficacy', () => {
  // --- Límites exactos ---
  it('exactamente 90% → eficaz', () => {
    const r = classifyEfficacy(90)
    expect(r.classification).toBe('eficaz')
  })

  it('91% → eficaz', () => {
    expect(classifyEfficacy(91).classification).toBe('eficaz')
  })

  it('100% → eficaz', () => {
    expect(classifyEfficacy(100).classification).toBe('eficaz')
  })

  it('exactamente 70% → parcialmente_eficaz (inclusivo)', () => {
    expect(classifyEfficacy(70).classification).toBe('parcialmente_eficaz')
  })

  it('89.96% → parcialmente_eficaz (no redondea a 90)', () => {
    // El clasificador usa el float real, no el redondeado de pantalla
    expect(classifyEfficacy(89.96).classification).toBe('parcialmente_eficaz')
  })

  it('89.5% → parcialmente_eficaz', () => {
    expect(classifyEfficacy(89.5).classification).toBe('parcialmente_eficaz')
  })

  it('71% → parcialmente_eficaz', () => {
    expect(classifyEfficacy(71).classification).toBe('parcialmente_eficaz')
  })

  it('exactamente 69.99% → no_eficaz', () => {
    expect(classifyEfficacy(69.99).classification).toBe('no_eficaz')
  })

  it('0% → no_eficaz', () => {
    expect(classifyEfficacy(0).classification).toBe('no_eficaz')
  })

  // --- Override por desviación crítica / reincidencia ---
  it('desviación crítica fuerza no_eficaz aunque % >= 90', () => {
    const r = classifyEfficacy(95, true, false)
    expect(r.classification).toBe('no_eficaz')
    expect(r.hasCriticalDeviation).toBe(true)
  })

  it('reincidencia fuerza no_eficaz aunque % = 100', () => {
    const r = classifyEfficacy(100, false, true)
    expect(r.classification).toBe('no_eficaz')
    expect(r.hasReincidence).toBe(true)
  })

  it('ambos flags activos → no_eficaz', () => {
    expect(classifyEfficacy(90, true, true).classification).toBe('no_eficaz')
  })

  it('sin flags y % = 90 → eficaz (flags falsos no interfieren)', () => {
    expect(classifyEfficacy(90, false, false).classification).toBe('eficaz')
  })

  it('retorna los flags en el resultado', () => {
    const r = classifyEfficacy(85, true, false)
    expect(r.hasCriticalDeviation).toBe(true)
    expect(r.hasReincidence).toBe(false)
    expect(r.percentage).toBe(85)
  })

  it('bloqueador activo fuerza no_eficaz aunque % = 100', () => {
    const r = classifyEfficacy(100, false, false, true)
    expect(r.classification).toBe('no_eficaz')
  })
})

// ---------------------------------------------------------------------------
// getAutomaticResultadoFinal
// ---------------------------------------------------------------------------
describe('getAutomaticResultadoFinal', () => {
  describe('Trabajador Nuevo (trabajador_nuevo)', () => {
    it('retorna habilitado_autonomo (CUMPLE) si tiene >= 90% y no hay bloqueos', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        92,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'induccion_irl', estado: 'cumple' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })

    it('retorna no_habilitado (NO CUMPLE) si es < 90% aunque no haya bloqueos', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        88,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'induccion_irl', estado: 'cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en 1.1 (documentacion_requisitos) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        95,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'no_cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'induccion_irl', estado: 'cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en 1.2 (induccion_capacitacion) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        95,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'riohs', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('no bloquea si el ítem es protocolos_minsal en 1.2 y el porcentaje es >= 90%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        91,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'protocolos_minsal', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })

    it('retorna no_habilitado si el ítem es protocolos_minsal pero el porcentaje total es < 90%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        85,
        [
          { seccionId: 'documentacion_requisitos', itemId: 'contrato_trabajo', estado: 'cumple' },
          { seccionId: 'induccion_capacitacion', itemId: 'protocolos_minsal', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en sección 2 (competencias_operacionales) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        95,
        [
          { seccionId: 'competencias_operacionales', itemId: 'reconoce_peligros', estado: 'no_apto' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('no bloquea si el ítem es protocolos_minsal en sección 2 y el porcentaje es >= 90%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        91,
        [
          { seccionId: 'competencias_operacionales', itemId: 'protocolos_minsal', estado: 'no_apto' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })

    it('no bloquea secciones no críticas si el porcentaje es suficiente', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_nuevo',
        95,
        [
          { seccionId: 'epp', itemId: 'casco_seguridad', estado: 'no_entregado' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })
  })

  describe('Trabajador Antiguo (trabajador_antiguo)', () => {
    it('no bloquea si no cumple en sección 3 (verificacion_documental) y el porcentaje es >= 90%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'verificacion_documental', itemId: 'contrato_vigente', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })

    it('no bloquea si el ítem es protocolos_minsal en sección 3 y porcentaje es >= 90%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'verificacion_documental', itemId: 'protocolos_minsal', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })

    it('no bloquea si el ítem es protocolos_minsal en sección 3 y porcentaje es 70-89%', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        85,
        [
          { seccionId: 'verificacion_documental', itemId: 'protocolos_minsal', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('habilitado_restricciones')
    })

    it('retorna no_habilitado si no cumple en sección 4 (procedimientos_criticos) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'procedimientos_criticos', itemId: 'bloqueo_energia', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en sección 5.1 (control_ampliroll) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'control_ampliroll', itemId: 'autorizacion_ampliroll', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en sección 5.2 (control_batea) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'control_batea', itemId: 'autorizacion_batea', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en sección 5.3 (control_maquinaria) independientemente del porcentaje', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'control_maquinaria', itemId: 'autorizacion_maquinaria', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('retorna no_habilitado si no cumple en múltiples secciones críticas simultáneamente', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        100,
        [
          { seccionId: 'procedimientos_criticos', itemId: 'bloqueo_energia', estado: 'no_cumple' },
          { seccionId: 'control_batea', itemId: 'autorizacion_batea', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('no_habilitado')
    })

    it('no bloquea secciones no críticas si el porcentaje es suficiente', () => {
      const result = getAutomaticResultadoFinal(
        'trabajador_antiguo',
        95,
        [
          { seccionId: 'capacitaciones_continuas', itemId: 'curso_altura', estado: 'no_cumple' }
        ]
      )
      expect(result).toBe('habilitado_autonomo')
    })
  })
})
