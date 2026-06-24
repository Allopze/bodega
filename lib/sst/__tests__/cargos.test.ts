import { describe, it, expect } from 'vitest'
import { CARGO_KEYS, CARGO_OPTIONS, SIGNATURE_ROLE_LABELS } from '../cargos'
import type { CargoKey } from '../cargos'

// ── CARGO_KEYS ──────────────────────────────────────────────────────────────

describe('CARGO_KEYS', () => {
  it('has 3 cargo keys', () => {
    const keys = Object.keys(CARGO_KEYS)
    expect(keys).toHaveLength(3)
  })

  it('has conductor_ampliroll', () => {
    expect(CARGO_KEYS.conductor_ampliroll).toBe('Conductor Ampliroll')
  })

  it('has conductor_batea', () => {
    expect(CARGO_KEYS.conductor_batea).toBe('Conductor Batea')
  })

  it('has operador_maquinaria_pesada', () => {
    expect(CARGO_KEYS.operador_maquinaria_pesada).toBe('Operador Maquinaria Pesada')
  })

  it('all values are non-empty strings', () => {
    for (const key of Object.keys(CARGO_KEYS) as CargoKey[]) {
      expect(typeof CARGO_KEYS[key]).toBe('string')
      expect(CARGO_KEYS[key].length).toBeGreaterThan(0)
    }
  })
})

// ── CARGO_OPTIONS ───────────────────────────────────────────────────────────

describe('CARGO_OPTIONS', () => {
  it('has 3 options (one per cargo)', () => {
    expect(CARGO_OPTIONS).toHaveLength(3)
  })

  it('each option has value and label', () => {
    for (const opt of CARGO_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
    }
  })

  it('values match CARGO_KEYS keys', () => {
    const optionValues = CARGO_OPTIONS.map((o) => o.value).sort()
    const keyValues = Object.keys(CARGO_KEYS).sort()
    expect(optionValues).toEqual(keyValues)
  })

  it('labels match CARGO_KEYS values', () => {
    for (const opt of CARGO_OPTIONS) {
      expect(opt.label).toBe(CARGO_KEYS[opt.value as CargoKey])
    }
  })
})

// ── SIGNATURE_ROLE_LABELS ───────────────────────────────────────────────────

describe('SIGNATURE_ROLE_LABELS', () => {
  it('has labels for all signature roles', () => {
    expect(SIGNATURE_ROLE_LABELS['trabajador']).toBe('Trabajador')
    expect(SIGNATURE_ROLE_LABELS['supervisor']).toBe('Administrador de contrato')
    expect(SIGNATURE_ROLE_LABELS['prevencionista']).toBe('Prevencionista')
    expect(SIGNATURE_ROLE_LABELS['jefe_area']).toBe('Supervisor de faena/Jefe de terreno')
  })

  it('returns undefined for unknown role', () => {
    expect(SIGNATURE_ROLE_LABELS['desconocido']).toBeUndefined()
  })

  it('has at least 4 roles defined', () => {
    expect(Object.keys(SIGNATURE_ROLE_LABELS).length).toBeGreaterThanOrEqual(4)
  })
})
