import { describe, it, expect } from 'vitest'
import {
  MOTIVO_LABELS,
  RESULTADO_LABELS,
  estadoLabel,
  ESTADO_OPTIONS,
  ESTADO_LABELS,
  resultadoBadgeVariant,
  estadoBadgeVariant,
  tipoBadgeVariant,
  estadoPlanBadgeVariant,
} from '../badges'

// ── MOTIVO_LABELS ───────────────────────────────────────────────────────────

describe('MOTIVO_LABELS', () => {
  it('has labels for all known motivo values', () => {
    expect(MOTIVO_LABELS['ingreso_nuevo']).toBe('Ingreso nuevo')
    expect(MOTIVO_LABELS['reincorporacion']).toBe('Reincorporación')
    expect(MOTIVO_LABELS['cambio_cargo']).toBe('Cambio de cargo')
    expect(MOTIVO_LABELS['post_incidente_persona']).toBe('Post incidente — persona')
    expect(MOTIVO_LABELS['post_incidente_ambiente']).toBe('Post incidente — ambiente')
    expect(MOTIVO_LABELS['evaluacion_periodica']).toBe('Evaluación periódica')
    expect(MOTIVO_LABELS['solicitud_trabajador']).toBe('Solicitud del trabajador')
  })

  it('returns undefined for unknown motivo', () => {
    expect(MOTIVO_LABELS['desconocido']).toBeUndefined()
  })
})

// ── RESULTADO_LABELS ────────────────────────────────────────────────────────

describe('RESULTADO_LABELS', () => {
  it('has labels for all resultado values', () => {
    expect(RESULTADO_LABELS['habilitado_autonomo']).toBe('Habilitado Autónomo')
    expect(RESULTADO_LABELS['habilitado_restricciones']).toBe('Habilitado c/Restricciones')
    expect(RESULTADO_LABELS['no_habilitado']).toBe('No Habilitado')
    expect(RESULTADO_LABELS['requiere_reforzamiento']).toBe('Requiere Reforzamiento')
  })

  it('returns undefined for unknown resultado', () => {
    expect(RESULTADO_LABELS['otro']).toBeUndefined()
  })
})

// ── estadoLabel ─────────────────────────────────────────────────────────────

describe('estadoLabel', () => {
  it('returns "Cerrado" for "cerrado"', () => {
    expect(estadoLabel('cerrado')).toBe('Cerrado')
  })

  it('returns "Borrador" for "borrador"', () => {
    expect(estadoLabel('borrador')).toBe('Borrador')
  })

  it('returns "Borrador" for any unknown value (default)', () => {
    expect(estadoLabel('')).toBe('Borrador')
    expect(estadoLabel('otro')).toBe('Borrador')
    expect(estadoLabel('cerrado')).toBe('Cerrado')
  })
})

// ── ESTADO_OPTIONS / ESTADO_LABELS ──────────────────────────────────────────

describe('ESTADO_OPTIONS', () => {
  it('has 3 options', () => {
    expect(ESTADO_OPTIONS).toHaveLength(3)
  })

  it('each option has value and label', () => {
    for (const opt of ESTADO_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
    }
  })
})

describe('ESTADO_LABELS', () => {
  it('mirrors ESTADO_OPTIONS as a record', () => {
    expect(ESTADO_LABELS['pendiente']).toBe('Pendiente')
    expect(ESTADO_LABELS['en_proceso']).toBe('En proceso')
    expect(ESTADO_LABELS['cerrado']).toBe('Cerrado')
  })
})

// ── resultadoBadgeVariant ───────────────────────────────────────────────────

describe('resultadoBadgeVariant', () => {
  it('returns "success" for habilitado_autonomo', () => {
    expect(resultadoBadgeVariant('habilitado_autonomo')).toBe('success')
  })

  it('returns "warning" for habilitado_restricciones', () => {
    expect(resultadoBadgeVariant('habilitado_restricciones')).toBe('warning')
  })

  it('returns "danger" for no_habilitado', () => {
    expect(resultadoBadgeVariant('no_habilitado')).toBe('danger')
  })

  it('returns "info" for requiere_reforzamiento', () => {
    expect(resultadoBadgeVariant('requiere_reforzamiento')).toBe('info')
  })

  it('returns "default" for unknown resultado', () => {
    expect(resultadoBadgeVariant('otro')).toBe('default')
    expect(resultadoBadgeVariant('')).toBe('default')
  })
})

// ── estadoBadgeVariant ──────────────────────────────────────────────────────

describe('estadoBadgeVariant', () => {
  it('returns "default" for "cerrado"', () => {
    expect(estadoBadgeVariant('cerrado')).toBe('default')
  })

  it('returns "signal" for "borrador"', () => {
    expect(estadoBadgeVariant('borrador')).toBe('signal')
  })

  it('returns "signal" for any non-cerrado value', () => {
    expect(estadoBadgeVariant('')).toBe('signal')
    expect(estadoBadgeVariant('otro')).toBe('signal')
  })
})

// ── tipoBadgeVariant ────────────────────────────────────────────────────────

describe('tipoBadgeVariant', () => {
  it('returns "info" for "seguimiento"', () => {
    expect(tipoBadgeVariant('seguimiento')).toBe('info')
  })

  it('returns "default" for "nuevo"', () => {
    expect(tipoBadgeVariant('nuevo')).toBe('default')
  })

  it('returns "default" for unknown tipo', () => {
    expect(tipoBadgeVariant('')).toBe('default')
    expect(tipoBadgeVariant('otro')).toBe('default')
  })
})

// ── estadoPlanBadgeVariant ──────────────────────────────────────────────────

describe('estadoPlanBadgeVariant', () => {
  it('returns "success" for "cerrado"', () => {
    expect(estadoPlanBadgeVariant('cerrado')).toBe('success')
  })

  it('returns "warning" for "en_proceso"', () => {
    expect(estadoPlanBadgeVariant('en_proceso')).toBe('warning')
  })

  it('returns "default" for "pendiente"', () => {
    expect(estadoPlanBadgeVariant('pendiente')).toBe('default')
  })

  it('returns "default" for unknown estado', () => {
    expect(estadoPlanBadgeVariant('')).toBe('default')
    expect(estadoPlanBadgeVariant('otro')).toBe('default')
  })
})
