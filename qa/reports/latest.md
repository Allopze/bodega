# Índice de auditorías QA

`AGENTS.md` reserva este archivo para el resultado humano más reciente del pipeline de QA.
Hasta el 2026-09-12 contenía el informe de **trazabilidad** del 2026-09-04 bajo este
nombre: un informe de alcance acotado a un módulo, presentado como si fuera el resultado
global y anclado al commit `da582cfc`. Leerlo como estado del producto llevaba a creer
cubierto lo que nunca se recorrió.

Este archivo es ahora un índice. Cada informe se lee bajo su propio alcance.

| Fecha | Informe | Alcance |
|---|---|---|
| 2026-09-17 | [2026-09-17-pdtp-changes-audit.md](2026-09-17-pdtp-changes-audit.md) | Auditoría y remediación PDTP v+1: planilla con modo histórico/exigible y export explícito; PGlite completa 171/1.939, `test:fast` 711/7.344, gates estáticos verdes; UAT autenticada creó, revisó, aprobó y activó v2 y luego verificó el selector post-fix en escritorio/móvil; sin certificación global |
| 2026-09-17 | [2026-09-17-pdtp-audit-fixes.md](2026-09-17-pdtp-audit-fixes.md) | Remediación PDTP-F01–F05: deltas por identidad estable, estados aplicados/segregados, compatibilidad segura de huellas y optimizaciones; 147 PGlite focalizadas, 16 UI y `test:fast` 711/7.343 verdes; UAT local autenticada con capturas desktop/móvil; PGlite completa no certificada por fallos SST ajenos |
| 2026-09-16 | [2026-09-16-pdtp-final-audit.md](2026-09-16-pdtp-final-audit.md) | Auditoría final de los cambios PDTP v+1; 261 pruebas PGlite focalizadas, 95 UI/acciones y `test:fast` verdes; deltas del diff, estado segregado, compatibilidad histórica y deuda React Doctor pendientes; UAT autenticada y PGlite completa sin certificar |
| 2026-09-16 | [2026-09-16-pdtp-audit-fixes.md](2026-09-16-pdtp-audit-fixes.md) | Cierre de fixes PDTP-A01–A13; gates estáticos, `test:fast` y suites PDTP focalizadas verdes; la corrida PGlite completa quedó interrumpida por fallos SST ajenos y la UAT autenticada sigue bloqueada por redirección de sesión |
| 2026-09-16 | [2026-09-16-pdtp-changes-audit.md](2026-09-16-pdtp-changes-audit.md) | Auditoría estática de los cambios PDTP v+1 frente a `HEAD`; sin nuevas pruebas ni UAT autenticada del módulo |
| 2026-09-16 | [2026-09-16-pdtp-uiux.md](2026-09-16-pdtp-uiux.md) | UI/UX y flujo visible del PDTP local autenticado: capturas de tablero, matriz, detalle y movil; sin suites ni acciones mutantes, no es certificacion de release |
| 2026-09-15 | [2026-09-15-pdtp-catalogo-actividades.md](2026-09-15-pdtp-catalogo-actividades.md) | Catálogo corporativo PDTP, migración 1:1, revisiones, bindings, importación y seis pantallas. E2E no inició por salida 143 del build; no es certificación de release |
| 2026-09-14 | [auditoria-fixes-capacitacion-2026-09-14.md](auditoria-fixes-capacitacion-2026-09-14.md) | Fixes de simplificación de capacitación: catálogo, ocurrencias por faena, evidencias, historial, exportación, PDTP y permisos. E2E no inició; no es certificación de release |
| 2026-09-12 | [AUDITORIA_INTEGRAL_CHOME_2026-09-12.md](../../AUDITORIA_INTEGRAL_CHOME_2026-09-12.md) | Integral: repositorio y entorno local/efímero. E2E detenida a los 45 min con 126 pruebas sin ejecutar — no es certificación de release |
| 2026-09-04 | [trazabilidad-2026-09-04.md](trazabilidad-2026-09-04.md) | Módulo de trazabilidad de bodega, commit `da582cfc` |
| 2026-09-03 | [auditoria-ti-2026-09-03.md](auditoria-ti-2026-09-03.md) | Módulo de TI |

## Cómo se actualiza

Al cerrar una auditoría, versionar el informe en `qa/reports/` con la fecha en el nombre y
agregar su fila acá, diciendo explícitamente qué quedó **sin** recorrer. Una auditoría
interrumpida se registra como interrumpida: el contrato pide distinguir rutas descubiertas,
flujos autenticados y estados condicionales, y una corrida parcial no cubre los tres.

No renombrar un informe de módulo a `latest.md`: fue exactamente esa confusión la que hizo
pasar un recorrido de un módulo por un resultado de producto.
