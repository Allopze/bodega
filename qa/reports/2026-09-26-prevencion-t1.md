# Tanda T1: cálculo del porcentaje del PDTP (2026-09-26)

Segunda tanda del plan de pendientes de la auditoría de Prevención (`/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`). Rama `prevencion/t1-calculo`, sobre el commit local de T0 (`319598c7`). Sin migración.

**Decisión aplicada (D1):** el tope del porcentaje es **por actividad y mes**. Reemplaza la "respuesta 2.4" (tope al total del mes), que dejaba que una actividad sobreejecutada compensara a otra en cero. Queda documentado en `PDTP_DECISIONES_TOMADAS_2026-09-02.md` §4.

## Qué cambió

| ID | Cambio | Archivos |
|---|---|---|
| C02, dedup | La carga manual y las acreditaciones de la misma celda semanal valen `max(manual, Σ acreditaciones)`. Antes solo se deduplicaba `inspeccion`; las demás fuentes se sumaban a la carga manual | `compliance.ts` (`effectiveApprovedExecutionsByCell`) |
| C02, tope (D1) | `pdtpCountedExecuted(p, e)`: cada actividad aporta al mes como máximo su plan, y nada si no tenía plan. Aplicado en el bucle mensual, el cumplimiento a la fecha, el avance por eje (por faena, actividad y mes), el reporte de gestión y los objetivos del cierre de período | `compliance.ts`, `helpers.ts`, `management-report.ts`, `period-closures.ts` |
| C02, planilla | La planilla (vista por faena y agregada) deduplica la misma semana. La sobreejecución se sigue mostrando. El Excel agrega las columnas "Ejecutado computable histórico" y "Ejecutado computable exigible", y el % sale de ellas | `sheets.ts` |
| C02, techo | `executedQuantity` no puede superar 100.000 (servidor y `max` del input) | `lib/validation/prevention-module/pdtp.ts`, `pdtp-execution-form.tsx` |
| D3 | El formulario "Registrar" de una actividad de enganche o compuesta avisa que la misma semana acreditada en su módulo cuenta una sola vez. Sin enlace | `pdtp-execution-form.tsx` |
| I08-a | Una ejecución enlazada a una ocurrencia programada ya completada no suma encima de la ocurrencia. Predicado único `pdtpScheduledInstanceCountsAsExecuted` | `scheduled-compliance.ts`, `compliance.ts` |
| M07 | Una obligación que vence en el año siguiente ya no suma al mes del programa (`loadClosedOnTimeByActivityMonth` recibe el año y lo filtra, también en `completedByActivity`) | `compliance.ts` |
| Textos | El panel ya no dice que el % "puede llegar a 100 % por compensación". Se corrigieron los comentarios que describían la regla anterior | `pdtp-indicators-panel.tsx`, `pdtp/page.tsx`, `prevention-campaigns.ts`, conector de vinculación externa |

**No se hizo, con motivo:**
- **Techo en el importador XLSX.** El parser nunca importa las columnas E (`importedExecutions: []` por diseño: la Base 2026 es una definición, no evidencia del año). Un techo ahí rechazaría libros válidos por datos que se descartan.
- **D6, cierres ya emitidos que quedarán desviados.** Contarlos exige consultar la base de desarrollo o producción, y no está autorizado en esta sesión. Queda como consulta de solo lectura previa al despliegue.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `npm run test:fast` | 771 archivos / **9.990 pruebas PASS**, 29 archivos omitidos (suites `*-postgres`) |
| `npm run test:pglite` | 195 archivos / **2.347 pruebas PASS** |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (puerto 3100, base desechable) | **146 PASS, 2 omitidas.** Una es la omisión condicional de siempre (`pdtp-habilitacion:98`). La otra (`pdtp-contexto-ida-vuelta:78`, "sin actividades que resumir") depende del estado que dejan las pruebas anteriores: al correr ese archivo solo contra el mismo servidor, pasa |

Cada cambio de comportamiento tuvo primero su prueba en rojo:
- R2 de la auditoría: carga manual más acreditación de capacitación en la misma semana;
- lo ejecutado sin plan no cubre a otra actividad;
- eje topado por faena, actividad y mes;
- M07;
- reporte de gestión;
- planilla y Excel;
- I08-a;
- techo de 100.000;
- aviso del formulario.

Suites nuevas: `lib/services/pdtp/compliance-cells.test.ts` y `lib/services/pdtp/period-closures-objectives.test.ts`. La prueba de la "respuesta 2.4" en `pdtp-compliance-zero.test.ts` se reescribió con la regla nueva. Las pruebas de `prevention-pdtp.test.ts` que dependían de la compensación ahora eligen actividades con plan en el mes que registran.

## Pendiente y riesgos

- **Las cifras bajan de forma visible** donde había compensación entre actividades o doble conteo de manual más acreditación. Conviene que la jefatura lo comunique antes del despliegue, junto con los cambios de T0.
- **D6:** antes de desplegar, contar con una consulta de solo lectura cuántos cierres ya emitidos quedarían desviados al recalcular. Su foto no cambia, pero la comparación con el cálculo en vivo sí.
- `monthlyTotals[].percent` de la planilla sigue siendo el total del mes sin tope por actividad. Hoy ninguna pantalla ni exportación lo lee (ver comentario en `sheets.ts`).
- El avance por eje todavía no incluye las ocurrencias programadas del creador nuevo. Es un vacío previo a T1 y no se tocó.
- **Sin recorrido de navegador manual.** Los cambios visibles son el texto del panel, el aviso del formulario y las columnas nuevas del Excel. Los cubren pruebas de componente y la prueba del export, pero no se capturaron pantallas.
- Tampoco se corrieron `npm run test:e2e` completo ni las suites `*-postgres`.
