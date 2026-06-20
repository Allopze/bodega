import { describe, it, expect } from 'vitest'
import { getApplicableItems, getUnansweredApplicableItems, isStatusKind, getApplicableResponses, getApplicableResponseStatuses } from '../checklist'
import type { ChecklistDefinition, StatusValue } from '../types'

type ChecklistResponseStatus = {
  seccionId: string
  itemId: string
  estado: StatusValue
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const mockDefinition: ChecklistDefinition = {
  code: 'TEST-001',
  version: '01',
  revisionDate: '2026-01-01',
  title: 'Test',
  tipo: 'nuevo',
  legalFramework: [],
  applicableTo: 'Test',
  sections: [
    {
      id: 'sec_clasif',
      title: 'Clasificación',
      countsForCompliance: false,
      items: [
        { id: 'item_a', label: 'A', kind: 'si_no_obs' }
      ]
    },
    {
      id: 'sec_general',
      title: 'General',
      countsForCompliance: true,
      items: [
        { id: 'item_b', label: 'B', kind: 'cumple_nocumple_obs' },
        { id: 'item_c', label: 'C', kind: 'cumple_nocumple_obs' },
        { id: 'item_texto', label: 'Texto libre', kind: 'text' }
      ]
    },
    {
      id: 'sec_ampliroll',
      title: '5.1 Ampliroll',
      countsForCompliance: true,
      appliesWhen: ['conductor_ampliroll'],
      items: [
        { id: 'item_d', label: 'D', kind: 'cumple_nocumple_obs' },
        { id: 'item_e', label: 'E', kind: 'cumple_nocumple_obs' }
      ]
    },
    {
      id: 'sec_batea',
      title: '5.2 Batea',
      countsForCompliance: true,
      appliesWhen: ['conductor_batea'],
      items: [
        { id: 'item_f', label: 'F', kind: 'cumple_nocumple_obs' }
      ]
    }
  ],
  closingAct: {
    title: 'Acta',
    resultOptions: [],
    signatureRoles: []
  }
}

// ---------------------------------------------------------------------------
// getApplicableItems
// ---------------------------------------------------------------------------
describe('getApplicableItems', () => {
  it('excluye secciones con countsForCompliance=false', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const ids = items.map((x) => x.item.id)
    expect(ids).not.toContain('item_a')   // sec_clasif: countsForCompliance=false
  })

  it('excluye ítems con kind no-status (text, date, etc.)', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const ids = items.map((x) => x.item.id)
    expect(ids).not.toContain('item_texto')
  })

  it('incluye secciones sin appliesWhen (universales)', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const ids = items.map((x) => x.item.id)
    expect(ids).toContain('item_b')
    expect(ids).toContain('item_c')
  })

  it('incluye secciones appliesWhen que coinciden con el cargo', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const ids = items.map((x) => x.item.id)
    expect(ids).toContain('item_d')
    expect(ids).toContain('item_e')
  })

  it('excluye secciones appliesWhen que NO coinciden con el cargo', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const ids = items.map((x) => x.item.id)
    expect(ids).not.toContain('item_f')  // sec_batea no aplica a ampliroll
  })

  it('soporta múltiples cargos (array): ampliroll + batea muestra ambas secciones', () => {
    const items = getApplicableItems(mockDefinition, ['conductor_ampliroll', 'conductor_batea'])
    const ids = items.map((x) => x.item.id)
    expect(ids).toContain('item_d')  // ampliroll
    expect(ids).toContain('item_e')  // ampliroll
    expect(ids).toContain('item_f')  // batea
  })

  it('incluye seccionId correcto para cada ítem', () => {
    const items = getApplicableItems(mockDefinition, 'conductor_ampliroll')
    const itemD = items.find((x) => x.item.id === 'item_d')
    expect(itemD?.seccionId).toBe('sec_ampliroll')
    const itemB = items.find((x) => x.item.id === 'item_b')
    expect(itemB?.seccionId).toBe('sec_general')
  })
})

// ---------------------------------------------------------------------------
// getUnansweredApplicableItems
// ---------------------------------------------------------------------------
describe('getUnansweredApplicableItems', () => {
  const respuestasCompletas = [
    { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' },
    { seccionId: 'sec_general', itemId: 'item_c', estado: 'no_cumple' },
    { seccionId: 'sec_ampliroll', itemId: 'item_d', estado: 'cumple' },
    { seccionId: 'sec_ampliroll', itemId: 'item_e', estado: 'cumple' }
  ]

  it('retorna array vacío si todos los ítems aplicables están respondidos', () => {
    const unanswered = getUnansweredApplicableItems(
      mockDefinition,
      'conductor_ampliroll',
      respuestasCompletas
    )
    expect(unanswered).toHaveLength(0)
  })

  it('detecta ítems sin responder', () => {
    const respuestasParciales = [
      { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' }
      // item_c, item_d, item_e sin responder
    ]
    const unanswered = getUnansweredApplicableItems(
      mockDefinition,
      'conductor_ampliroll',
      respuestasParciales
    )
    const ids = unanswered.map((x) => x.item.id)
    expect(ids).toContain('item_c')
    expect(ids).toContain('item_d')
    expect(ids).toContain('item_e')
  })

  it('trata estado=null como sin responder', () => {
    const respuestasConNull = [
      { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' },
      { seccionId: 'sec_general', itemId: 'item_c', estado: null },
      { seccionId: 'sec_ampliroll', itemId: 'item_d', estado: 'cumple' },
      { seccionId: 'sec_ampliroll', itemId: 'item_e', estado: 'cumple' }
    ]
    const unanswered = getUnansweredApplicableItems(
      mockDefinition,
      'conductor_ampliroll',
      respuestasConNull
    )
    expect(unanswered.map((x) => x.item.id)).toContain('item_c')
    expect(unanswered).toHaveLength(1)
  })

  it('no reporta como pendiente ítems de secciones no aplicables', () => {
    // Un ampliroll no debe ver sec_batea como pendiente
    const unanswered = getUnansweredApplicableItems(
      mockDefinition,
      'conductor_ampliroll',
      respuestasCompletas
    )
    expect(unanswered.map((x) => x.item.id)).not.toContain('item_f')
  })

  it('returns all applicable items as unanswered when respuestas is empty', () => {
    const unanswered = getUnansweredApplicableItems(
      mockDefinition,
      'conductor_ampliroll',
      []
    )
    // Should include all items from sec_general + sec_ampliroll (excluding sec_clasif and item_texto)
    const ids = unanswered.map((x) => x.item.id)
    expect(ids).toContain('item_b')
    expect(ids).toContain('item_c')
    expect(ids).toContain('item_d')
    expect(ids).toContain('item_e')
    expect(ids).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// isStatusKind
// ---------------------------------------------------------------------------
describe('isStatusKind', () => {
  it('returns true for cumple_nocumple_obs', () => {
    expect(isStatusKind('cumple_nocumple_obs')).toBe(true)
  })

  it('returns true for cumple_nocumple_na_obs', () => {
    expect(isStatusKind('cumple_nocumple_na_obs')).toBe(true)
  })

  it('returns true for entregado_obs', () => {
    expect(isStatusKind('entregado_obs')).toBe(true)
  })

  it('returns true for apto_obs', () => {
    expect(isStatusKind('apto_obs')).toBe(true)
  })

  it('returns true for si_no_obs', () => {
    expect(isStatusKind('si_no_obs')).toBe(true)
  })

  it('returns false for text', () => {
    expect(isStatusKind('text')).toBe(false)
  })

  it('returns false for date', () => {
    expect(isStatusKind('date')).toBe(false)
  })

  it('returns false for select', () => {
    expect(isStatusKind('select')).toBe(false)
  })

  it('returns false for multiselect', () => {
    expect(isStatusKind('multiselect')).toBe(false)
  })

  it('returns false for signature', () => {
    expect(isStatusKind('signature')).toBe(false)
  })

  it('returns false for readonly', () => {
    expect(isStatusKind('readonly')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getApplicableResponses
// ---------------------------------------------------------------------------
describe('getApplicableResponses', () => {
  it('filters responses to only applicable items', () => {
    const responses: ChecklistResponseStatus[] = [
      { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' },
      { seccionId: 'sec_general', itemId: 'item_c', estado: 'no_cumple' },
      { seccionId: 'sec_ampliroll', itemId: 'item_d', estado: 'cumple' },
      { seccionId: 'sec_batea', itemId: 'item_f', estado: 'cumple' }, // not applicable to ampliroll
    ]
    const filtered = getApplicableResponses(mockDefinition, 'conductor_ampliroll', responses)
    const keys = filtered.map((r) => `${r.seccionId}::${r.itemId}`)
    expect(keys).toContain('sec_general::item_b')
    expect(keys).toContain('sec_general::item_c')
    expect(keys).toContain('sec_ampliroll::item_d')
    expect(keys).not.toContain('sec_batea::item_f')
  })

  it('returns empty array when no responses match', () => {
    const responses: ChecklistResponseStatus[] = [
      { seccionId: 'sec_batea', itemId: 'item_f', estado: 'cumple' },
    ]
    const filtered = getApplicableResponses(mockDefinition, 'conductor_ampliroll', responses)
    expect(filtered).toHaveLength(0)
  })

  it('returns all responses when all are applicable', () => {
    const responses: ChecklistResponseStatus[] = [
      { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' },
      { seccionId: 'sec_general', itemId: 'item_c', estado: 'no_cumple' },
      { seccionId: 'sec_ampliroll', itemId: 'item_d', estado: 'cumple' },
      { seccionId: 'sec_ampliroll', itemId: 'item_e', estado: 'cumple' },
    ]
    const filtered = getApplicableResponses(mockDefinition, 'conductor_ampliroll', responses)
    expect(filtered).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// getApplicableResponseStatuses (wrapper over getApplicableResponses)
// ---------------------------------------------------------------------------
describe('getApplicableResponseStatuses', () => {
  it('returns only {estado} tuples for applicable items', () => {
    const responses: ChecklistResponseStatus[] = [
      { seccionId: 'sec_general', itemId: 'item_b', estado: 'cumple' },
      { seccionId: 'sec_ampliroll', itemId: 'item_d', estado: 'no_cumple' },
      { seccionId: 'sec_batea', itemId: 'item_f', estado: 'cumple' }, // not applicable
    ]
    const statuses = getApplicableResponseStatuses(mockDefinition, 'conductor_ampliroll', responses)
    expect(statuses).toEqual([
      { estado: 'cumple' },
      { estado: 'no_cumple' },
    ])
  })
})
