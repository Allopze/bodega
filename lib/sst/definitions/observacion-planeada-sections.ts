import type { ChecklistSection } from '../types'

/**
 * Observación Planeada — módulo 14 (Anexo 7, Rev. 01).
 *
 * TRANSCRIPCIÓN LITERAL de `checklists/Anexo 7 Observaciones Planeadas.XLS`
 * (hoja "Observacion"). El formulario real NO es una lista de chequeo: no
 * tiene un solo ítem Cumple / No cumple. Es un relato libre más una tabla de
 * acciones preventivas. Su estructura completa es:
 *
 *   Quien Observa / Fecha de la observación / Lugar y Trabajo Observado
 *   → "Describa cualquier procedimiento, método, tarea, etc. que usted
 *      observó y que piensa debiera considerar un cambio o felicitación."
 *   → Nombre y Firma Observador | Nombre y Firma trabajador
 *   → Accion Preventiva | Responsable | Fecha Control   (6 filas)
 *   → Agregar foto de lo observado
 *   → "1° COPIA: ENVIAR A ADM. DE CONTRATO (SI NECESITA GESTIÓN)"
 *
 * Qué NO se modela aquí, porque el PDTP ya lo cubre y duplicarlo crearía dos
 * fuentes de verdad:
 *   · "Quien Observa"            → `pdtpExecutions.executedByUserId`
 *   · "Fecha de la observación"  → `pdtpExecutions.executedAt`
 *   · "Agregar foto"             → `pdtpExecutions.evidenceUrl` / `evidencePhotos`
 *   · Tabla Acción/Responsable/Fecha Control → plan de acción de la ejecución
 *     (`pdtpActionPlan`, alta manual con origen='manual'). Los tres campos del
 *     anexo son exactamente `accion`, `responsable` y `plazo`.
 *   · Las dos firmas             → `closingAct.signatureRoles`.
 *
 * Ninguna sección cuenta para cumplimiento: el formulario no puntúa. La
 * instancia persiste `porcentajeCumplimiento = null`
 * (`calculateInstanceCompliance` corta en `applicable.length === 0`), y el
 * promedio del eje de verificación descarta los nulls, así que no arrastra el
 * KPI del programa.
 *
 * Actividad PDTP 2026: n=39 ("Realizar Observación para corregir desviaciones
 * de conductas incorrectas sobre normas, procedimientos y/o estándares" —
 * Sup/JT, mensual). NO es la n=41: esa es la caminata de seguridad y ya tiene
 * OBSERVACION_MAQUINARIA.
 */
export const OBSERVACION_PLANEADA_SECTIONS: ChecklistSection[] = [
  {
    id: 'observacion',
    title: 'Observación',
    description:
      'El observador es el jefe directo del área. Registra una sola observación planeada por instancia.',
    countsForCompliance: false,
    items: [
      {
        id: 'lugar_trabajo_observado',
        label: 'Lugar y trabajo observado',
        kind: 'text',
        placeholder: 'Área / puesto y tarea que se observó…',
        required: true,
      },
      {
        id: 'descripcion',
        label:
          'Describa cualquier procedimiento, método, tarea, etc. que usted observó y que piensa debiera considerar un cambio o felicitación',
        kind: 'textarea',
        placeholder:
          'Relate lo observado: qué hacía la persona, cómo lo hacía, qué debería cambiar o qué merece felicitación…',
        required: true,
      },
    ],
  },
]
