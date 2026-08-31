import { describe, it, expect } from 'vitest'
import { statusOptionsForKind, kindAllowsNotApplicable } from '../status-options'
import { CHECKLIST_DEFINITIONS } from '../definitions'
import { isStatusKind } from '../checklist'

/**
 * Caracterización de la extracción desde `renderStatusButtons()`
 * (app/(app)/prevencion/[id]/checklist-section-item.tsx). Fija el mapa tal como
 * estaba para que mover la lógica no cambie lo que ve el motor SST.
 */
describe('opciones por escala', () => {
  it('cumple/no cumple sin escape no ofrece N/A', () => {
    expect(statusOptionsForKind('cumple_nocumple_obs').map((o) => o.value))
      .toEqual(['cumple', 'no_cumple'])
  })

  it('cumple/no cumple con N/A lo ofrece al final', () => {
    expect(statusOptionsForKind('cumple_nocumple_na_obs').map((o) => o.value))
      .toEqual(['cumple', 'no_cumple', 'na'])
  })

  it('la escala B/R/M usa el vocabulario del papel: Bueno, Regular, Malo', () => {
    expect(statusOptionsForKind('bueno_regular_malo_obs').map((o) => o.label))
      .toEqual(['Bueno', 'Regular', 'Malo'])
  })

  it('B/R/M del Anexo 13 no tiene escape: ni N/A ni NT', () => {
    expect(kindAllowsNotApplicable('bueno_regular_malo_obs')).toBe(false)
    expect(statusOptionsForKind('bueno_regular_malo_obs')).toHaveLength(3)
  })

  it('B/R/M del Anexo 14 agrega N/A y "No tiene", en ese orden', () => {
    expect(statusOptionsForKind('bueno_regular_malo_na_nt_obs').map((o) => o.value))
      .toEqual(['cumple', 'regular', 'no_cumple', 'na', 'no_tiene'])
  })

  it('entrega y aptitud tienen su propio vocabulario, no cumple/no cumple', () => {
    expect(statusOptionsForKind('entregado_obs').map((o) => o.label))
      .toEqual(['Entregado', 'No entregado'])
    expect(statusOptionsForKind('apto_obs').map((o) => o.label))
      .toEqual(['Apto', 'No apto'])
    expect(statusOptionsForKind('si_no_obs').map((o) => o.label)).toEqual(['Sí', 'No'])
  })

  it('un kind que no expresa conformidad no ofrece ninguna opción', () => {
    for (const kind of ['text', 'textarea', 'number', 'date', 'select', 'signature'] as const) {
      expect(statusOptionsForKind(kind)).toEqual([])
    }
    expect(statusOptionsForKind(null)).toEqual([])
  })

  /**
   * El discriminador de `lib/sst/checklist.ts` y este mapa tienen que decir lo
   * mismo: un ítem que puntúa necesita opciones que ofrecer, y uno que no
   * puntúa no puede tenerlas.
   */
  it('coincide con isStatusKind para todo el catálogo real', () => {
    for (const definition of Object.values(CHECKLIST_DEFINITIONS)) {
      for (const section of definition.sections) {
        for (const item of section.items) {
          expect(
            statusOptionsForKind(item.kind).length > 0,
            `${definition.code} · ${item.id} (${item.kind})`,
          ).toBe(isStatusKind(item.kind))
        }
      }
    }
  })
})
