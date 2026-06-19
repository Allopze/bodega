import { describe, expect, it } from 'vitest'
import { getApplicableResponseStatuses } from '../checklist'
import { LC_SST_002 } from '../definitions'
import type { StatusValue } from '../types'

describe('getApplicableResponseStatuses', () => {
  it('excluye la sección 2 de trabajador antiguo del porcentaje de cumplimiento', () => {
    const responses = [
      { seccionId: 'clasificacion_evento', itemId: 'dano_personas', estado: 'no' as StatusValue },
      { seccionId: 'clasificacion_evento', itemId: 'dano_material', estado: 'no' as StatusValue },
      { seccionId: 'verificacion_documental', itemId: 'licencia_autorizacion', estado: 'cumple' as StatusValue },
      { seccionId: 'verificacion_documental', itemId: 'registro_induccion', estado: 'cumple' as StatusValue },
    ]

    const complianceInput = getApplicableResponseStatuses(
      LC_SST_002,
      'conductor_ampliroll',
      responses,
    )

    expect(complianceInput).toEqual([
      { estado: 'cumple' },
      { estado: 'cumple' },
    ])
  })
})
