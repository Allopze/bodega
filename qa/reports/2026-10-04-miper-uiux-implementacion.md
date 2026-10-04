# Implementación UI/UX desktop de MIPER — 4 de octubre de 2026

Implementa las fases F1 a F6 de [PLAN_MEJORA_UIUX_MIPER_2026-10-03.md](../../PLAN_MEJORA_UIUX_MIPER_2026-10-03.md), sólo desktop. Rama `codex/miper-uiux-desktop`, base `d994d035`. Este informe es **evidencia de verificación técnica**; no mide comprensión con usuarios.

## Resultado

Las puertas deterministas pasan y la suite E2E de MIPER está en verde. **No se validó comprensión con usuarios (F0/F7)**: el objetivo «alguien que no conoce MIPER comienza sin ayuda» sigue sin comprobarse.

## Verificaciones ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Pasa |
| `npm run lint` | Pasa |
| `npm run test:fast` | 884 archivos / 11 186 pruebas pasan (31 archivos y 274 pruebas omitidos por configuración) |
| PGlite: `miper-portfolio`, `miper-queries`, `miper-import`, `prevention-risk-legal`, `prevention-risk-control-ineffective-capa` | 43 pruebas pasan. Las demás suites PGlite no se corrieron |
| E2E `prevencion-miper-*.spec.ts` (13 archivos, incluidas `uiux-desktop` y `uiux-evidence`) | 54 de 54 pasan (7,4 min), Chromium, base E2E dedicada |
| `npm run doctor` | 67/100, igual que la base `d994d035`. Variación neta frente a la base: +2 mantenibilidad, +1 bugs, −1 rendimiento. Sin diferencia en seguridad ni accesibilidad. No se revisó cada aviso nuevo individualmente |
| `check:secrets`, `check:security-audit`, `db:verify-migrations` | No ejecutados. No hay cambios de esquema ni de dependencias |

## Evidencia de navegador

Carpeta `qa/reports/evidence/2026-10-04-miper-uiux-implementation/` (ignorada por git; 24 capturas y `browser-evidence.json`).

- Rutas: portada, Inicio, Riesgos, editor, Plan de medidas, Revisión y ficha de control a **1280×800, 1440×900 y 1920×1080**; además importador, detalle de actividad y editor con zoom CSS al 200 % a 1440×900.
- Sin errores de consola, errores de página ni respuestas HTTP ≥ 400 en las 24 entradas.
- Sin desborde horizontal de documento ni del pozo del shell.
- axe (`wcag2a/aa`, `wcag21aa`, `wcag22aa`) en las 7 rutas a 1440×900: **0 hallazgos**.
- Teclado: «Crear matriz» abre con Enter y lleva a «Importar desde Excel».
- Roles recorridos por los E2E: prevencionista de faena, Jefa de prevención, Legal y RRHH, responsable de la actividad, administrador.

## Defectos encontrados y corregidos durante la verificación

1. **PRODUCT BUG — toast «Antecedentes guardados» perdido.** Abrir la matriz recién creada en `?tab=resumen&ficha=1` provocaba una recarga completa del documento tras guardar la ficha, y con ella se perdía el aviso. Comprobado contra la base (33/33 en verde) y contra el cambio (fallaba ≈ 50 %); con la URL original `?ficha=1` pasa 6/6. Se revirtió esa URL. **La causa de fondo de la recarga no se identificó**: queda como riesgo si en el futuro se vuelve a abrir en Inicio.
2. **PRODUCT BUG — estado del documento oculto en el encabezado.** Con las acciones del flujo en todas las áreas, el título largo dejaba la descripción (donde se lee «Vigente v1 · cambios pendientes…») con ancho cero a 1280 px. Corregido en la capa compartida (`components/layout/top-bar.tsx`): la descripción pasa a una segunda línea. El cambio afecta el encabezado de todas las páginas; sólo se verificó en MIPER.
3. **INCONSISTENCY** — botones «Continuar» idénticos cuando una faena tiene varios borradores. Ahora indican el período.
4. Textos de las specs desactualizados respecto del producto (avance «0/3 · 0% realizado», «1 pendiente · 0 incumplidas», «Actividades del plan de medidas», «Elaboró» dentro de «Datos del documento»): se actualizaron las specs, no el producto.

## Decisiones de producto aplicadas

- El editor de un riesgo conserva «Volver al documento» y «Ficha del documento»; sin pestañas.
- Las acciones del flujo (enviar, devolver, aprobar, «Más») se muestran en todas las áreas.
- «Preparación para enviar» en Revisión, con los bloqueos del validador del servidor agrupados.
- `kind` (`review`/`respond`/`continue`) en las acciones de la portada: «Con observaciones» lleva a Revisión con la acción «Responder».
- La barra «Recorrer riesgos» **no** es fija, a propósito: el plan exige que no tape campos enfocados.

## UX FINDING / IMPROVEMENT OPPORTUNITY (no corregidos)

- En Revisión, «Enviaste esta ronda…» aparece dos veces (aviso superior y panel de estado).
- La descripción del encabezado del editor se trunca con «…» a 1280 px; el estado completo sólo se lee en el `title`.
- El menú lateral conserva «Matriz IPER» y la miga «MIPER», mientras el título dice «Matriz de riesgos». Se dejó porque cambiar el rótulo de navegación exige paridad con el manifiesto y un E2E lo usa.
- Las siglas MR y P×C tienen `title` sólo en la insignia de clasificación (`RiskClassificationBadge`); no en el paso Evaluación.

## COVERAGE GAP

- **F0 y F7 sin hacer**: no hubo prueba de 5 segundos ni recorrido con usuarios. Métricas del §7 del plan sin medir.
- Sin lector de pantalla, sin otros navegadores (sólo Chromium), sin móvil (fuera de alcance acordado).
- Zoom al 200 % simulado con `body.style.zoom`, no con el zoom real del navegador.
- axe sólo a 1440×900. Los estados poblados (programa con historial mensual, control con conflicto de verificador, importación con archivo real y filas rechazadas) se probaron con los datos sembrados por los E2E, que son pocos; no con un archivo Excel real.
- Los E2E de otras áreas no se corrieron tras el cambio del TopBar compartido.
- La importación no se probó con el archivo real de la planta.

## Recomendaciones priorizadas

1. Antes de integrar: correr los E2E de las áreas que usan `PageHeader` con descripción, por el cambio del TopBar.
2. Hacer F0/F7: prueba de 5 segundos con prevencionista, revisora y responsable de ejecución.
3. Investigar la recarga completa al abrir en `?tab=resumen` antes de cambiar la entrada por defecto.
4. Resolver los hallazgos UX listados arriba.
