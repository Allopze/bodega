# QA — EPP desde bodega, Plan de emergencia en GRD, retiro de Gestión del cambio (2026-09-28)

Recorrido asistido con Chromium de `@playwright/test` contra `next dev` (:3001, `bodega_dev`),
sesión `playwright/.auth/monkeytest.json` regenerada con `scripts/qa-login.mjs`.

## PASS (verificado)

- `/prevencion/inspecciones/QA_epp_run_1` (Inspección de Uso y Estado de EPP (JT), faena
  Santa Fe - Grúas): la matriz lista los 13 EPP con historial en la bodega de la faena,
  entre ellos "Buzo Tyvek Dupont", "Lente Activex sellado" y "JARDINERA TERMICA". La
  lista fija anterior ("Zapatos de seguridad", "Casco / cubre cuello") ya no aparece.
  Contador: "0 de 26 obligatorios" (13 × Uso/Estado).
- En esa misma ficha: responder "Sí" a "Buzo Tyvek Dupont: usa" y guardar da "1 de 26" y
  se mantiene tras recargar. La fila `epp_prd_…_uso` quedó persistida en
  `prevention_inspection_answers`.
- `/prevencion/emergencias`: el menú muestra "Gestión de riesgos de desastres" → "Mapa de
  riesgos" / "Plan de emergencia", ya sin la entrada suelta "Emergencias". Las migas dicen
  Inicio / Prevención / Gestión de riesgos de desastres / Plan de emergencia.
- El menú ya no ofrece "Gestión del cambio". `/prevencion/gestion-cambio` ya no existe como
  ruta y la app redirige a `/prevencion`.
- Sin errores de consola ni respuestas 5xx en los recorridos.

## COVERAGE GAP

- No se probó en el navegador una sesión real de `jefe_mantencion` (tiene `emergency:view`
  y no `cgrd:view`). Ese caso lo cubre la prueba unitaria de `getVisibleAreas`
  (`lib/__tests__/navigation.test.ts`).
- No se abrieron el acta impresa ni la exportación Excel de una inspección de EPP con filas
  de bodega. Ambas usan la definición resuelta o la escala derivada del sufijo, y eso lo
  cubren pruebas unitarias y de PGlite.

## Datos QA creados

- `prevention_inspection_runs.id = 'QA_epp_run_1'` (código `QA_INS-EPP-001`) en `bodega_dev`,
  con una respuesta.
