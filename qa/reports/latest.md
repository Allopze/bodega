# Implementación de la Ola 1 (integridad) del submódulo Inspecciones — 20 de octubre de 2026

Implementa la primera de las dos olas del plan derivado de [la auditoría del 19 de octubre](2026-10-19-inspecciones-uiux-audit.md). Rama `fix/inspecciones-uiux-ola1`, base `d8dc1eb3`, 18 commits. La Ola 2 (layout, listas y catálogo) queda pendiente.

**Alcance de la Ola 1:** captura en terreno y datos (el P0 y los P1 de guardado), KPI y filtros de la bandeja, un solo vocabulario de estados, exports Excel, y la lógica y los textos del catálogo y de Programación. No cambia el diseño de las pantallas: eso es la Ola 2.

## Resultado

| Medición | Antes | Después |
|---|---|---|
| P0 | 1 | **0** (verificado en navegador y con E2E) |
| P1 resueltos | 0 de 13 | **12 de 13** (P1-12, la vista previa de plantillas, queda para la Ola 2; P1-3 y P1-10 sin verificación en navegador, ver «Cobertura») |
| Puntaje de la auditoría | 11/20 | **no se repitió**: se mide al cerrar la Ola 2 |

**Veredicto:** la Ola 1 se puede liberar sola. Lo que la pantalla dice guardado es lo que el servidor tiene, una fila mala ya no frena el resto, y sin conexión el detalle no se cae. No se hizo push ni deploy.

## Verificaciones ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` (worktree desechable) | **Limpio.** La primera pasada marcó un error mío (`ReportCell` sin importar), corregido |
| `eslint` | Limpio en cada commit (el hook de commit corre el lint de todo el repo) |
| `npm run test:fast` completo | 11 942 ✓ · 2 ✗. Una era un defecto real nuestro (ver abajo, corregido); la otra, `solicitudes/item-editor`, **falla igual en `main`** |
| `npm run test:pglite` completo | 3 123 ✓ · 1 ✗: `miper-work-queue`, **falla igual en `main`** |
| Suite Postgres real de Inspecciones | **91 de 91**, ninguna omitida (contenedor `bodega-e2e-postgres`, base propia) |
| `npm run db:verify-migrations` | Limpio, 351 entradas, sin cambios de esquema |
| E2E completa (worktree desechable) | **842 ✓ · 4 omitidas · 1 ✗** en 34,9 min. La falla es `servicios-costo-pendiente` (ficha de Solicitudes busca un campo «Colaborador»): la misma zona del unit test que falla en `main`, y la rama no toca Solicitudes |
| 18 specs de Inspecciones y de shell, uno a uno | Todos en verde (ver línea 1K) |
| Recorrido en navegador (dev :3001, datos `QA_`) | Ver tabla más abajo |

Cada línea además comprobó **por mutación** que sus pruebas fallan si el defecto vuelve (por ejemplo, reintroducir el rearme del temporizador tras un éxito rompe 3 pruebas del hook; quitar el atajo de filas idénticas rompe la prueba PGlite).

## Defectos encontrados y corregidos durante la verificación

- **`ReportCell` sin importar** en el constructor de Excel (typecheck). Era mío; corregido.
- **`client-memo-boundary` (unitaria):** `run-detail-controls.tsx` no declaraba `"use client"` y, al importar `ConfirmDialog` (un `memo` de cliente), la regla de frontera servidor → cliente lo tomó por un Server Component. Corregido con la directiva.
- **Adjuntar una foto a una respuesta aún no guardada no subía nada ni avisaba** (preexistente en `main`; lo reveló el E2E de P1-6). `upload()` esperaba `ensureAnswerId()` antes de recorrer la `FileList`, y el `onChange` ya había vaciado el input; la `FileList` de Chromium es viva y llegaba vacía. Ahora copia los archivos antes de cualquier `await`. Sin prueba unitaria (jsdom no reproduce la lista viva): la regresión la cubre el E2E de captura.
- **El `next dev` de :3001 estaba detenido** cuando fui a usarlo (no encontré causa; lo más probable es presión de memoria con las puertas pesadas). Lo volví a levantar con `npm run dev`.

**Hallazgo nuevo, sin corregir:** con el resultado del acta sin elegir, el bloqueo dice «El resultado del acta no corresponde a las opciones de la plantilla.», que se lee como un error de la plantilla cuando solo falta elegirlo. Un E2E (`ejecucion.spec.ts:104`) afirma ese texto; es candidato para el pulido final (P3).

## Estado por hallazgo

| ID | Estado | Dónde |
|---|---|---|
| **P0-1** borrador recuperado dice «Guardado» y no se envía | ✅ Verificado en navegador: tras recargar en menos de 1 s la respuesta vuelve, dice «Cambios sin guardar» y «Recuperamos cambios… Se están guardando», a los 5 s «Guardado», y un contexto nuevo la ve en el servidor | 1A, 1J |
| P1-1 una fila inválida frena el guardado | ✅ Navegador: «Guardado, salvo 1 respuesta incompleta», «Guardar respuestas» habilitado, el servidor tiene las demás | 1A, 1C, 1J |
| P1-2 sin conexión tira la pantalla | ✅ Navegador: sin «Algo salió mal»; «Sin conexión · se enviará al volver la señal»; al volver, «Guardado» | F0, 1J |
| P1-3 derivar a CAPA también envía la revisión | ✅ jsdom (el test falla con el código viejo); ⚠️ no verificado en navegador (falta un segundo usuario revisor) | 1D |
| P1-4 reintentos sin fin y pérdida al recargar | ✅ | 1A, 1C, 1J |
| P1-5 cola offline | ✅ E2E: cierre guardado, envío al volver la señal, idempotente ante respuesta perdida | 1B, 1J |
| P1-6 no se puede quitar una foto | ✅ E2E y jsdom. Las fotos quitadas quedan en disco (seguimiento) | 1C, 1D |
| P1-7 sin estado de guardado en el teléfono | ✅ Navegador a 390×844: la barra inferior muestra «Guardado» | 1J |
| P1-8 errores pintados como éxito | ✅ | F0, 1D, 1J |
| P1-9 KPI que afirman estados falsos | ✅ Navegador y PGlite: tile y lista usan el mismo predicado; el total de la paginación conserva el filtro | 1F |
| P1-10 filtro de faena casi vacío para solo lectura | ✅ jsdom; ⚠️ no verificado con un rol de solo lectura | 1F |
| P1-11 anexo oficial sin fuente: callejón sin salida | ✅ «Vincular fuente» (servicio, acción y diálogo) | 1H, 1I |
| P1-12 aprobar sin ver el cuestionario | ⏭ Ola 2 (vista previa) | — |
| P1-13 tres vocabularios | ✅ Un solo mapa de estados (acta y Excel dicen «Pendiente de revisión»), mensaje de motivo con la escala del ítem. Excel con encabezados de agregados renombrados | F0, 1E, 1G |
| P2-1 (texto) · P2-2 · P2-3 · P2-4 · P2-6 · P2-9 · P2-11 · P2-13 · P2-14 · P2-15 · P2-16 | ✅ | 1C–1J |
| P2-17 (sujeto, «vencidas», estado vacío) | ✅ parcial: la barra de filtros es de la Ola 2 | 1H, 1I |
| P2-19 (revalidación en cada autoguardado) | ✅ parcial: la consulta de riesgos por faena y el conteo de vencidas son de la Ola 2 | F0 |
| P2-5, P2-10, P2-12, P2-18, L1–L16 (layout) | ⏭ Ola 2 | — |
| P3-6 · P3-7 · P3-8 · P3-9 | ✅ | F0, 1D, 1E |
| P3-1 · P3-2 · P3-3 · P3-4 | ⏭ Diferidos con motivo (ver el plan) | — |

## Cambios de comportamiento que los usuarios notarán

- **Guardar ya no se detiene por una fila mala:** esa fila se queda en el dispositivo y lo que se bloquea es declarar ejecutada.
- **«Encolar cierre» desaparece de la página.** Sin conexión, el diálogo de cierre ofrece «Guardar cierre en este dispositivo»; después la pantalla queda bloqueada hasta «Seguir editando» y el cierre se envía solo al volver la señal.
- **Lo no enviado sobrevive al cierre de la pestaña** (`localStorage` por ejecución y pestaña) y se borra al cerrar sesión.
- **Los KPI de la bandeja ya no cambian con estado ni vista.** «Pendientes de revisión» significa *para mí* (lo que no ejecutó quien mira, salvo plantillas con ejecutor declarado en el formulario) y lo mismo cuenta la vista y el Excel filtrado por ella.
- **«Planificada» y «Ejecutada» desaparecen** del acta y del Excel: ahora «Pendiente de ejecución» y «Pendiente de revisión».
- **Excel:** fechas reales en hora de Chile (antes texto en UTC, 3 horas adelantado; **puede romper macros que leían texto**), etiquetas en vez de enums, hoja «Metadatos», columnas nuevas a la derecha. **El Anexo 15 conserva sus encabezados y nombres de hoja** y gana seis columnas a la derecha. «Generado» de Metadatos sale en hora de Chile en **todos** los exports de la plataforma.
- **Catálogo:** «Aprobar» ya no se ofrece donde el servidor lo rechazaría; importar crea los vínculos con el catálogo de actividades; el tipo (inspección, observación, auditoría) sale de la definición; revertir solo acepta la versión que la actual reemplazó y verifica el anexo oficial; retirar dice qué pasa con las programaciones.
- **«Cancelar inspección» / «Volver»:** el botón que confirma deja de llamarse «Cancelar».
- **`useOperation` ya no deja que una excepción de red tire la página** en las 88 pantallas que lo usan: avisa y expone `offline`.

## Decisiones tomadas durante la ejecución

- **El nombre de la primera hoja del Anexo 15 es «SEGUIMENTO INSPECCIONES»** (con la errata, como en el código y en la auditoría); el plan lo había copiado mal como «SEGUMENTO». Como la decisión era conservar los nombres oficiales, el test fija el nombre real.
- **Una fila heredada que ya no cumple la regla de motivo no bloquea el guardado, pero sí el cierre** (el cierre revalida todas las filas).
- **`registerDeviation` y `registerInspectionPreventiveAction` devuelven la versión solo cuando la subieron**, para que el cliente no adopte la versión de otra sesión y pise sus respuestas.
- **La fuente documental de una plantilla oficial es obligatoria solo cuando hay con qué cumplirla:** con checksum conocido se ofrece el archivo que coincide; si la Biblioteca no lo tiene, se avisa y se puede vincular después.

## Datos que quedaron en `bodega_dev`

Ejecuciones `QA_` creadas por la interfaz, para reproducir los casos:

- `INSP-2026-U8K7E5H1` (Extintores): completada, con 1 hallazgo ALTA abierto, firmada `QA_Firmante 1/2`.
- `INSP-2026-JVE5OWTP` (Extintores, sujeto `QA_Ola1 extintor`): en ejecución, con respuestas y una fila retenida (un «Malo» sin motivo).
- `QA_INS-EPP-001`: con 3 respuestas.

## Evidencia

Capturas en [`evidence/2026-10-19-inspecciones-ola1/`](evidence/2026-10-19-inspecciones-ola1/) (ignoradas por git): recuperación tras recargar, fila retenida, sin conexión, barra móvil, acta, importar plantilla y acreditación PDTP. Los dos `.xlsx` se abrieron con ExcelJS: «Ejecutada» llega como fecha con formato `dd-mm-yyyy hh:mm` y valor 15:34 donde antes decía 18:34; «Metadatos» dice «19-10-2026 18:36 (hora de Chile)»; el Anexo 15 trae sus nueve encabezados originales y seis columnas nuevas.

## Cobertura: lo que no se recorrió

- **Revisión por un segundo usuario** (P1-3 en navegador): hay una sola sesión QA. Cubierto por jsdom y por el E2E de cierre.
- **Roles distintos de administrador** (P1-10, plantillas con permisos parciales): cubierto por jsdom y por `roles-permisos`.
- **Subida real de fotos en navegador contra `bodega_dev`:** cubierta por el E2E, no por el recorrido manual.
- **Cola offline de punta a punta en el dispositivo real:** cubierta por E2E con `setOffline`, no con una red móvil real.
- **Gestos táctiles reales:** solo viewport emulado.
- **Lector de pantalla real, rendimiento en producción.**
- **E2E en navegadores móviles** (`mobile-safari`, `mobile-chrome`): solo Chromium de escritorio.

## Pendientes que quedan

1. **Ola 2:** layout del detalle (cabecera de trabajo, botones de 44 px por ítem, hallazgos como tarjetas, modo lectura), bandeja, Plantillas (vista previa y una fila por instrumento), Programación y Seguimiento.
2. Repetir `/impeccable audit` al cerrar la Ola 2 para medir el puntaje.
3. **Fotos quitadas:** el archivo físico queda en disco; el recolector de evidencias no cubre este directorio y conectarlo tal como está borraría documentos y evidencias de hallazgos.
4. `linkInspectionTemplateSource` no vuelve a comprobar confidencialidad ni alcance de faena de la versión documental elegida (igual que importar); endurecerlo es una decisión aparte.
5. El mensaje del acta sin resultado (arriba).
6. Fallas preexistentes en `main`, ajenas a esta rama: `item-editor` (Solicitudes), `miper-work-queue` (MIPER) y el E2E `servicios-costo-pendiente`.
