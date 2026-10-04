# Implementación UI/UX desktop de MIPER — 4 de octubre de 2026

Implementa las fases F1 a F6 de [PLAN_MEJORA_UIUX_MIPER_2026-10-03.md](../../PLAN_MEJORA_UIUX_MIPER_2026-10-03.md), sólo desktop. Rama `codex/miper-uiux-desktop`, base `d994d035`. Este informe es **evidencia de verificación técnica**; no mide comprensión con usuarios.

## Resultado

Las puertas deterministas pasan, la suite E2E de MIPER y las de las pantallas que comparten componentes cambiados están en verde. **No se validó comprensión con usuarios (F0/F7)**: el objetivo «alguien que no conoce MIPER comienza sin ayuda» sigue sin comprobarse. El protocolo para hacerlo quedó en [docs/qa/protocolo-prueba-comprension-miper.md](../../docs/qa/protocolo-prueba-comprension-miper.md).

## Verificaciones ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Pasa |
| `npm run lint` | Pasa |
| `npm run test:fast` | 884 archivos / 11 188 pruebas pasan (31 archivos y 274 pruebas omitidos por configuración) |
| `npm run test:pglite` (suite completa) | 251 archivos / 2 985 pruebas pasan (1 omitida) |
| `npm run db:verify-migrations` | Pasa (350 entradas, checksums verificados). La rama no cambia esquema |
| `npm run check:secrets` | Pasa |
| `npm run check:security-audit` | **Falla, ajeno a esta rama**: aviso nuevo GHSA-vfj7-8cjw-p6xm sobre `braces` (dependencia de desarrollo de ESLint), sin versión corregida. Excepción propuesta con guardrail en la rama aparte `chore/audit-braces-ghsa-vfj7`, pendiente de decisión |
| E2E: 11 specs de MIPER + 18 del encabezado compartido + 22 de consumidores de `SegmentedControl` (44 archivos únicos, sin `correlativos-secciones`) | **400 de 400 pasan** (21,3 min), Chromium, base E2E dedicada |
| E2E `correlativos-secciones` | **Falla también en la base `d994d035`** (el asistente muestra «Crear 4 productos» y la spec espera «Crear producto»). Ajeno a esta rama; no se incluyó en la corrida final |
| `npm run doctor` | 67/100, igual que la base `d994d035`; bugs y rendimiento iguales o mejores que la base. Queda un aviso nuevo de complejidad en `ReviewStateSection` (condiciones según el rol; la regla tiene 198 avisos en el repo) y se resolvió uno previo en `summary-strip.tsx` |

## Evidencia de navegador

Carpeta `qa/reports/evidence/2026-10-04-miper-uiux-implementation/` (ignorada por git; 30 capturas y `browser-evidence.json`).

- Rutas: portada, Inicio, Riesgos, editor, Plan de medidas, Revisión y ficha de control a **1280×800, 1440×900 y 1920×1080**; además importador y detalle de actividad a 1440×900.
- **Zoom al 200 % real**: las 7 rutas en una vista de 640×400 px CSS con densidad 2 (lo que deja un navegador de 1280×800 al 200 %, criterio WCAG 1.4.10). Sin desborde horizontal.
- Sin errores de consola, errores de página ni respuestas HTTP ≥ 400 en las 30 entradas.
- axe (`wcag2a/aa`, `wcag21aa`, `wcag22aa`) en las 7 rutas **en los tres tamaños** (21 auditorías): **0 hallazgos**.
- Teclado: «Crear matriz» abre con Enter y lleva a «Importar desde Excel».
- Roles recorridos por los E2E: prevencionista de faena, Jefa de Prevención, Legal y RRHH, responsable de la actividad, administrador.

## Defectos encontrados y corregidos durante la verificación

1. **PRODUCT BUG — la página se recargaba entera al guardar la ficha y se perdía el aviso «Antecedentes guardados».**
   - *Causa, con evidencia:* `navigateWorkspace` cambia la URL con `history.replaceState` y el router de Next conserva el árbol con los parámetros de la URL de carga. Al guardar llegaban **dos** refrescos concurrentes: el `revalidatePath` de la acción (`guarded`) y un `router.refresh()` redundante. Ambos desajustaban con el árbol del servidor, y en el segundo desajuste seguido Next hace navegación completa (`previousNavigationDidMismatch`, `ppr-navigations.js`). Instrumentado: tres GET RSC 200 y luego un GET HTML.
   - *Medición:* con la ficha abierta por `?ficha=1` al cargar, 6 recargas de 10. Abierta con el botón, 0 de 20.
   - *Corrección:* se quitó el `router.refresh()` redundante donde la acción ya revalida la página de la matriz (ficha, observación general y observación del riesgo). Después: **0 recargas en 30 guardados**, con el aviso visible siempre. Prueba de regresión en `ficha-sheet.test.tsx`.
   - *Corrección de un diagnóstico anterior:* el commit `c34e3604` atribuía la recarga a la URL `?tab=resumen&ficha=1`. Era incorrecto: la recarga se dio también con `?ficha=1`. La matriz nueva vuelve a abrir en Inicio.
   - *Riesgo residual:* las acciones de observación que sólo reciben `observationId` no revalidan la matriz y conservan su `router.refresh()`; con un solo refresco, Next reintenta en suave y no recarga.
2. **PRODUCT BUG — estado del documento oculto en el encabezado.** Con las acciones del flujo en todas las áreas, el título largo dejaba la descripción con ancho cero a 1280 px. Corregido en `components/layout/top-bar.tsx`: la descripción pasa a una segunda línea. Verificado con las 18 specs E2E que miran el encabezado y en las capturas.
3. **PRODUCT BUG — regresión de semántica en `SegmentedControl` (introducida en esta rama).** El arreglo del hallazgo de axe (`nav` con `role="group"`) convirtió los controles con enlaces en landmarks `nav`. Así perdieron el rol `group` del que dependen el tablero y 6 E2E de `dashboard` (pasan en la base). Ahora es siempre `<div role="group">`: misma semántica que antes y sin el hallazgo de axe.
4. **INCONSISTENCY** — «Enviaste esta ronda…» y «Estás revisando la versión enviada» se repetían en Revisión. Ahora cada uno aparece una vez.
5. **INCONSISTENCY** — botones «Continuar» idénticos cuando una faena tiene varios borradores. Ahora indican el período (con prueba).
6. **UX FINDING** — la descripción del encabezado del editor se truncaba; ahora muestra sólo el estado del documento.
7. Specs desactualizadas respecto del producto (avance, pluralización, «Actividades del plan de medidas», «Elaboró», pestaña «Inicio» en `accessibility.spec`): se actualizaron las specs, no el producto.
8. `doctor`: la `key` con índice se corrigió y `ReviewPanel` se partió en `PreparationSection` y `ReviewStateSection`; tras ese refactor, los E2E de MIPER y accesibilidad volvieron a pasar (222 de 222).

## Decisiones de producto aplicadas

- El editor de un riesgo conserva «Volver al documento» y «Ficha del documento»; sin pestañas.
- Las acciones del flujo (enviar, devolver, aprobar, «Más») se muestran en todas las áreas.
- «Preparación para enviar» en Revisión, con los bloqueos del validador del servidor agrupados.
- `kind` (`review`/`respond`/`continue`) en las acciones de la portada: «Con observaciones» lleva a Revisión con la acción «Responder».
- La barra «Recorrer riesgos» **no** es fija, a propósito: el plan exige que no tape campos enfocados.
- La importación prueba en navegador una fila fuera de escala («No se cargarán · 1») y la confirmación al descartar.

## Decisión pendiente

- **Nombre del módulo.** El menú dice «Matriz IPER» a propósito: un comentario de `modules/prevention/manifest.ts` lo justifica por el DS 44 art. 7 («matriz de riesgos» a secas es genérico, no el instrumento). El plan eligió «Matriz de riesgos» como título. No se cambió ninguno; elegir uno y alinear título, menú y migas.

## COVERAGE GAP

- **F0 y F7 sin hacer**: no hubo prueba de 5 segundos ni recorrido con usuarios. Métricas del §7 del plan sin medir.
- Sin lector de pantalla y sin otros navegadores (sólo Chromium). Móvil fuera de alcance acordado.
- No se corrió la suite E2E completa (141 specs): sólo MIPER y las pantallas que comparten los componentes cambiados.
- Estados poblados (programa con historial mensual, control con conflicto de verificador) e importación sólo con datos sembrados por los E2E; no con un Excel real de faena.

## Recomendaciones priorizadas

1. Ejecutar la prueba con usuarios del protocolo (F0/F7).
2. Decidir el nombre del módulo y la excepción de `npm audit`.
3. Corregir la spec de `correlativos-secciones`, que falla en `main`.
4. Antes de liberar, correr la suite E2E completa.
