# Auditoría UI/UX del submódulo Inspecciones — 19 de octubre de 2026

**Alcance:** `/prevencion/inspecciones` (bandeja, alta «Nueva inspección», «Más filtros», export), `/seguimiento` (pantalla y export), `/programacion`, `/plantillas` (tabla, diálogos «Acreditación PDTP» y «Desviaciones»), el detalle `[runId]` en ejecución, pendiente de revisión y cancelada, y el acta imprimible `/print`.

**Método:**

- Impeccable `audit`, con 5 dimensiones técnicas.
- Tres revisiones de código aisladas, una por área: listados y navegación, detalle de ejecución, y catálogo de plantillas.
- Recorrido en navegador desde la sesión principal, que también verificó los hallazgos de esas revisiones.
- Detector determinista de Impeccable sobre `app/(app)/prevencion/inspecciones`.

**Entorno:**

- `next dev` en :3001 contra `bodega_dev`, con 351/351 migraciones aplicadas.
- Chromium headless de `@playwright/test` con la sesión QA regenerada (rol administrador global).
- Vistas a 1440×900, 390×844 (táctil) y 720×450 (equivalente a zoom 200 %), con axe (WCAG 2.2 AA).
- Los tiempos son de modo dev, no de producción.

**Datos:** `bodega_dev` tenía 2 ejecuciones, 24 plantillas, 0 programaciones y 0 hallazgos. Para recorrer el flujo completo se usó la propia interfaz:

- se creó `INSP-2026-U8K7E5H1` (Extintores, Santa Fe - Grúas, sujeto `QA_Extintor pasillo bodega`);
- se respondió con un «Malo», se firmó con `QA_Firmante 1/2` y se declaró ejecutada; generó 1 hallazgo ALTA;
- se respondieron 3 ítems de `QA_epp_run_1`.

En dev no hay clave de Resend, así que no salió ningún correo. No se ejecutó ninguna acción del catálogo (incorporar, aprobar, retirar, revertir) ni se creó una programación.

**Leyenda de evidencia:**

- **[V]** verificado en navegador o en ejecución;
- **[C]** deducido del código y revisado en la fuente por la sesión principal;
- **[D]** detector.

Las capturas están en [`evidence/2026-10-19-inspecciones-uiux/`](evidence/2026-10-19-inspecciones-uiux/).

## Resultado

| # | Dimensión | Pts | Hallazgo clave |
|---|---|---|---|
| 1 | Accesibilidad | 2 | axe casi limpio: 2 violaciones *serious* (`target-size` en la lista de bloqueos y región con scroll no enfocable en los KPI móviles). En las pruebas manuales: errores no asociados a campos, errores con estilo de éxito, nombres accesibles repetidos 24 veces y vista activa marcada solo por tinte. |
| 2 | Rendimiento | 2 | Cada autoguardado (~1,2 s) invalida `/dashboard`, `/pendientes` y los contadores globales. Cada cambio de filtro vuelve a consultar ejecuciones, programas, plantillas, faenas e inventario, sin indicador de carga. |
| 3 | Theming | 3 | Tokens bien usados y sin literales de color. Fallan: un token inexistente (`--color-danger-border`), errores pintados en `success-tint` y «Vencida» en rojo o naranja según la pantalla. |
| 4 | Responsive | 2 | Sin desborde a 390 ni a 720 px, y con barra fija de guardado en móvil. Pero en el teléfono no se ve el estado del autoguardado, la tabla de Plantillas se desborda a 1440 px, la ejecución tiene 51 objetivos táctiles bajo 44 px y las tarjetas no muestran al responsable. |
| 5 | Integridad de implementación | 2 | El detector da 0 hallazgos [D], pero hay deriva verificada: tres vocabularios para el mismo estado, enums crudos en lectura, acta y Excel, `ReasonDialog` que reimplementa `ConfirmDialog`, avisos hechos a mano en vez de `Callout` y `useOperation` sin manejo de excepciones. |
| | **Total** | **11/20** | **Aceptable**: necesita trabajo significativo |

| Severidad | Cantidad |
|---|---|
| P0 | 1 |
| P1 | 13 |
| P2 | 19 |
| P3 | 9 |

### Veredicto de integridad

**No pasa.** El dominio está bien modelado:

- segregación de la revisión, con la lista de quién puede cerrar y un recordatorio;
- motivo obligatorio para cada incumplimiento;
- cierre validado con la misma regla en cliente y servidor;
- bloqueo optimista por versión;
- el hallazgo se materializa al declarar ejecutada.

Lo que falla es la **capa de captura**, que es justo la que un inspector usa en terreno. Encadenadas, cuatro fallas verificadas producen pérdida silenciosa de datos:

1. una sola fila con error frena el envío de todas las respuestas;
2. sin señal, «Guardar» tumba la pantalla;
3. el borrador que se recupera dice «Guardado» y nunca se envía;
4. en el teléfono no hay ningún rótulo de estado.

El resto son inconsistencias de vocabulario y presentación entre pantalla, acta y Excel, más un catálogo de plantillas que se aprueba a ciegas.

**No liberar** sin corregir el P0 y P1-1 a P1-6.

## Hallazgos

### P0 — Bloqueante

**P0-1 [V] El borrador recuperado dice «Guardado» y nunca llega al servidor.**

- **Ubicación:**
  - `inspection-run-detail.tsx:202-224` restaura con `setDrafts`/`setRestoredDraft(true)` sin subir `revision`;
  - `:539` define `isDirty: revision > savedRevision`;
  - `:789` es el aviso;
  - `lib/.../inspection-draft-storage.ts:36` guarda el espejo en `sessionStorage`.
- **Reproducción:**
  1. En `QA_epp_run_1`, responder un ítem y recargar antes de 1 s.
  2. La pantalla muestra el valor, el rótulo **«Guardado»** y el aviso «Se recuperaron respuestas sin enviar… Se guardarán solas al recuperar conexión».
  3. A los 6 s sigue igual.
  4. Un contexto nuevo del navegador ve el ítem **«Sin responder»**.
- **Impacto:** la persona cree que su trabajo está a salvo y se va; la respuesta solo existe en esa pestaña. Al cerrarla (`sessionStorage`) se pierde. Quien revisa desde otro equipo ve la inspección vacía.
- **Recomendación:** al restaurar, `setRevision(r => r + 1)` para que el autoguardado lo tome. El rótulo debe decir «Cambios sin guardar» mientras exista un borrador sin enviar. Pasar el espejo a `localStorage` o IndexedDB con clave por ejecución. Agregar un test de regresión en `inspection-run-autosave.test.tsx`.

### P1 — Mayores

**P1-1 [V] Una fila inválida detiene el guardado de toda la inspección.**

- **Ubicación:** el autoguardado tiene `enabled: editable && rowProblems.length === 0` (`inspection-run-detail.tsx:551`) y «Guardar» queda deshabilitado con `rowProblems.length > 0` (`:736`, `:1185`).
- **Evidencia:** se respondieron 6 ítems de Extintores con un «Malo» sin motivo. El estado quedó fijo en «Cambios sin guardar». La sesión siguiente (otro contexto) encontró los 6 ítems «Sin responder»: se perdieron.
- **Impacto:** en terreno, un motivo pendiente en el ítem 3 congela el envío de los ítems 4 a 75. Junto con P0-1, el trabajo de la jornada depende de que la pestaña no se cierre.
- **Recomendación:** guardar siempre las filas válidas y retener solo la fila con problema, o guardarla como borrador del servidor. La validación de motivo debe bloquear el **cierre**, no el guardado.

**P1-2 [V] Sin conexión, «Guardar respuestas» reemplaza la pantalla por «Algo salió mal».**

- **Ubicación:** `lib/hooks/use-operation.ts:52-53` hace `startTransition(async () => { const result = await operation()` sin try/catch. Cuando la Server Action rechaza, el error llega a `app/(app)/error.tsx`.
- **Evidencia:** con `context.setOffline(true)`, al pulsar «Guardar respuestas» apareció «Algo salió mal · Ocurrió un error inesperado». Al volver la red siguió en el error ([`v-offline-guardar.png`](evidence/2026-10-19-inspecciones-uiux/v-offline-guardar.png)). En consola: `TypeError: Failed to fetch`.
- **Impacto:** justo el caso que la función #9 (cola offline) quería cubrir. El hook es compartido, así que **todos** los diálogos de la plataforma que usan `useOperation` caen igual sin señal.
- **Recomendación:** capturar la excepción en el hook y devolver `{ ok: false, message: "Sin conexión. Tus cambios quedan en este dispositivo…" }`. Corregirlo en el hook y no por pantalla.

**P1-3 [C · alta confianza] Derivar a CAPA desde «Revisar y cerrar» también envía la revisión.**

- **Ubicación:** `CapaDialog` está anidado dentro del `<form onSubmit>` de revisión (`review-dialog.tsx:48-56`, `:78`). Su `submit` hace `preventDefault()` pero no `stopPropagation()` (`finding-dialogs.tsx:42-53`). React propaga el evento a través del portal.
- **Impacto:** si quien revisa ya escribió 10 caracteres de comentario, derivar el hallazgo dispara `reviewInspectionRunAction` en paralelo. La inspección puede cerrarse sin que nadie pulse «Revisar y cerrar», o devolver un error confuso.
- **Por qué no está verificado:** reproducirlo exige un revisor distinto del ejecutor, y la sesión QA es la única disponible.
- **Recomendación:** `event.stopPropagation()` en el submit del CAPA, o sacar el `CapaDialog` fuera del `<form>`. Agregar un test en `review-dialog.test.tsx`.

**P1-4 [C] El autoguardado reintenta sin fin ante rechazos permanentes, y recargar descarta el borrador.**

- **Ubicación:** `use-debounced-autosave.ts:146-150` vuelve a armar el temporizador al bajar `pending`, también tras un conflicto de versión, la guarda de evidencia (`runs.ts:275`) o una inspección ya ejecutada. Además, `snapshot.version !== run.version` borra el espejo (`inspection-run-detail.tsx:205-206`).
- **Impacto:** se dispara una petición cada ~1,2 s y ningún otro cambio se guarda. El mensaje pide «Recarga y reintenta», pero al recargar se pierden las respuestas. El texto «Tus respuestas siguen guardadas en este dispositivo» (`:797`) es falso fuera de la pestaña.
- **Recomendación:** separar los errores que se arreglan reintentando de los que no, rebasar el borrador sobre la versión nueva y corregir la copia.

**P1-5 [C] La cola offline puede descartar el cierre o no enviarlo nunca.**

- **Ubicación:** todo rechazo se marca como permanente (`inspection-run-detail.tsx:270`). Al volver la señal, el autoguardado y `flushQueue` compiten con el mismo `expectedVersion`. El envío solo ocurre con el evento `online` y con esta página abierta (`:289`). Una entrada descartada sigue contando como «1 cierre pendiente» (`:836`) y «Sincronizar» se la salta (`offline-inspection-queue.ts:150-153`).
- **Impacto:** el cierre con firmas puede perderse por un conflicto de versión que provocó el propio autoguardado.
- **Recomendación:** un único canal de envío serializado (`autosave.saveNow()` antes del cierre), flush al montar y reconciliar los descartados con un mensaje.

**P1-6 [C] No hay forma de quitar una fotografía.**

- **Ubicación:** `deleteAnswerEvidence` y `deleteRunDocument` existen (`lib/services/prevention-inspections/evidence.ts:95,199`), pero ninguna acción ni pantalla los usa. El servidor exige «Quita las fotografías primero» para cambiar una respuesta con evidencia (`runs.ts:275`).
- **Impacto:** una foto equivocada deja el ítem sin poder corregirse, y alimenta el bucle de P1-4.
- **Recomendación:** agregar «Quitar foto», con confirmación por ser destructiva, mientras la inspección esté en ejecución.

**P1-7 [V] En el teléfono no existe el rótulo de autoguardado.**

- **Ubicación:** el rótulo `role="status"` es `hidden … md:inline` (`inspection-run-detail.tsx:741`). La barra fija móvil (`:1185`) solo tiene «Guardar» y «Declarar ejecutada».
- **Evidencia:** [`run-epp-mobile.png`](evidence/2026-10-19-inspecciones-uiux/run-epp-mobile.png).
- **Impacto:** INS-02 se creó para que quien ejecuta sepa si puede irse de la pantalla, y en el dispositivo de terreno no lo ve.
- **Recomendación:** mostrar el estado dentro de la barra fija móvil.

**P1-8 [C] Los errores de guardado se pintan como éxito.**

- **Ubicación:** `inspection-run-detail.tsx:782` hace `operation.message && <p role="status" … bg-[var(--color-success-tint)] text-[var(--color-success-ink)]>`. Como `saveAnswers` pasa `onSuccess`, ese mensaje solo existe cuando hay error, por ejemplo «La inspección cambió en otra sesión…».
- **Recomendación:** dar el tono según `ok`, usar `role="alert"` en los errores y ubicar el mensaje junto a la acción.

**P1-9 [V] Los KPI de la bandeja afirman estados falsos.**

- **Ubicación:**
  - `inspections-screen.tsx:77` calcula el resumen con `filter.view`;
  - `queries.ts:167` excluye lo que ejecutó el propio usuario, y el filtro `vista=pending_review` (`:81`) no lo excluye;
  - `inspection-run-list.tsx:199` aplica el texto de «estado bueno» al cero.
- **Evidencia:**
  - `?estado=completed` muestra 1 fila, y el tile dice «Pendientes de revisión **0** · *Nada esperando revisión*»;
  - `?vista=pending_review` muestra 1 fila, y el tile activo dice 0;
  - `?vista=overdue` dice «*Sin hallazgos abiertos*», con 1 hallazgo ALTA abierto ([`v-kpi-pending.png`](evidence/2026-10-19-inspecciones-uiux/v-kpi-pending.png), [`v-kpi-overdue.png`](evidence/2026-10-19-inspecciones-uiux/v-kpi-overdue.png)).
- **Impacto:** la jefatura lee «todo al día» cuando no lo está, y el tile y la lista que abre no coinciden.
- **Recomendación:** resumen sin `view` ni `estado`, el mismo predicado en tile y lista, y nunca la frase de estado bueno bajo un filtro.

**P1-10 [C] El filtro «Faena» está casi vacío para los roles de solo lectura.**

- **Ubicación:** `inspections-screen.tsx:80` hace `canExecute ? listInspectionWorksites(access) : Promise.resolve([])`, aunque el servicio solo exige `view` (`catalogs.ts:118-120`). Las opciones se completan con las faenas de las 50 filas visibles (`inspection-run-list.tsx:123-127`).
- **Impacto:** jefa_chome, cphs y jefe_mantencion no pueden filtrar por una faena que no aparezca en la página actual.
- **Recomendación:** cargar siempre las faenas del alcance.

**P1-11 [C] Un anexo oficial incorporado sin fuente queda en un callejón sin salida.**

- **Ubicación:** «Declarar paridad» requiere `item.sourceDocumentVersionId` (`inspection-catalog.tsx:517`), y aprobar exige fuente y paridad (`templates.ts:448-454`). Ninguna acción permite vincular la fuente después; solo queda Retirar y volver a incorporar. El diálogo de importación no avisa que la fuente es obligatoria.
- **Recomendación:** exponer `needsOfficialSource`, marcar el campo como obligatorio y agregar «Vincular fuente» en los borradores.

**P1-12 [V] Se aprueba y se declara paridad sin poder ver el cuestionario.**

- **Ubicación:** `ApproveDialog` dice «Congela el contenido» (`inspection-catalog.tsx:1248`). La paridad pide contrastar la transcripción con el papel (`:569`). Ninguna ruta muestra las secciones e ítems de una plantilla, y la fila no responde al clic (verificado).
- **Recomendación:** una vista previa de solo lectura (Sheet), tal como la verá el inspector, que se abra desde la fila y desde ambos diálogos.

**P1-13 [V] Tres vocabularios para la misma respuesta y el mismo estado.**

- **Evidencia:**
  - las opciones del ítem son «Bueno / Malo», el bloqueo dice *«un "No cumple" exige indicar el motivo»* y el resumen del acta dice «Cumple / Regular / No cumple»;
  - el estado es «Pendiente de revisión» en bandeja y detalle, y «**Ejecutada**» en el acta ([`v-print.png`](evidence/2026-10-19-inspecciones-uiux/v-print.png)) y en el Excel (verificado abriendo el `.xlsx`).
- **Ubicación:** `lib/prevention/inspection-list-query.ts:65-71` frente a `lib/prevention/inspections.ts:10-16`, usados por `prevention-inspections-export.ts:126` y `print/document.tsx:77`.
- **Impacto:** quien filtra «Pendiente de revisión» y exporta lee otra cosa, y un fiscalizador ve en el acta un estado distinto al del sistema.
- **Recomendación:** un solo mapa de etiquetas de estado. El mensaje de bloqueo debe usar la etiqueta de la escala del ítem («Malo»).

### P2 — Menores

1. **[V] La lista de bloqueos asusta, miente y no explica.** Una ejecución recién abierta muestra, en rojo, «Corrige antes de **guardar** o declarar ejecutada» con los 24 ítems. Sin embargo:
   - solo los motivos faltantes impiden guardar; las respuestas faltantes no (el autoguardado funcionó con 23 vacías);
   - cada línea es solo el nombre del ítem (`inspections.ts:646-656`), sin decir si falta la respuesta o el motivo;
   - el diálogo de cierre vuelve a cortar en «y N más…» y no trae enlaces para saltar al ítem (`complete-dialog.tsx:69-79`).

   Recomendación: separar «Para guardar» (rojo) de «Para declarar ejecutada» (neutro, como progreso) y decir qué falta en cada línea. `inspection-run-detail.tsx:850-866`.

2. **[V] Valores crudos a la vista:**
   - «Tipo de extintor: **pqs**», aunque se eligió «PQS (Polvo Químico Seco)», en pantalla de lectura (`inspection-run-detail.tsx:943,1055`), acta y Excel;
   - en el Excel, `platform_definition`, `approved`/`superseded` en la hoja Plantillas, el encabezado en inglés «Status» y la hoja «SEGUIMENTO INSPECCIONES» (`prevention-inspection-followup.ts:109`);
   - el acta muestra «Sujeto: QA_Extintor» (el tipo, sin la etiqueta);
   - «Faltan firmas del acta: jefe_area» [C] (`inspections.ts:613`).

   Va contra A6.

3. **[V] El Excel exporta las fechas en UTC y como texto.** «Ejecutada» sale como `2026-10-19 18:34:14.564+00`, mientras la pantalla dice 19-10-2026 15:34 (hora de Chile). La hoja Plantillas, columna «Aprobada», tiene el mismo problema. Recomendación: celdas de fecha de Excel en la zona de Chile, con `formatDateTime` como referencia.

4. **[V] El diálogo «Cancelar» es ambiguo.** El disparador es un «Cancelar» rojo junto a «Declarar ejecutada». Dentro del diálogo, el botón que **confirma** la cancelación se llama «Cancelar» y el que la descarta, «Cerrar» ([`run-cancel-dialog.png`](evidence/2026-10-19-inspecciones-uiux/run-cancel-dialog.png), `run-detail-controls.tsx:104`). El motivo mínimo evita el clic accidental, pero el texto invita al error. Recomendación: «Cancelar inspección» / «Volver», variante destructiva, y usar `ConfirmDialog` con `reasonLabel` en vez de `ReasonDialog`.

5. **[V] Muro de metadatos en el detalle de escritorio:**
   - 12 celdas siempre abiertas, entre ellas «Origen: Departamento de Prevención», un dato que la bandeja quitó por repetirse en todas las filas (I-18);
   - «**Resultado normalizado 100 %**» con 1 de 24 ítems respondidos, una cifra engañosa ([`run-epp-tall-desktop.png`](evidence/2026-10-19-inspecciones-uiux/run-epp-tall-desktop.png));
   - el estado aparece dos veces (celda y badge).

   En móvil sí existe «Ver contexto completo». Recomendación: 4 datos clave (faena, sujeto, responsable, avance), el resto plegado, y no mostrar cumplimiento hasta declarar ejecutada.

6. **[V] Ruido repetido por fila.** Cada uno de los 24 ítems muestra «Adjuntar fotos» deshabilitado más «Responde el ítem para habilitar fotografías.». Todos los inputs de archivo se llaman «Adjuntar evidencia fotográfica», igual que «Cerrar» o «Quitar» por fila, sin el nombre del ítem (WCAG 2.4.6). Recomendación: explicar la regla una vez, ocultar el control hasta que haya respuesta e incluir el ítem en el `aria-label`.

7. **[V] Accesibilidad medida por axe:**
   - `target-size` *serious*: los enlaces de la lista de bloqueos miden 18,6 px de alto;
   - en el detalle móvil hay 51 objetivos táctiles bajo 44 px (enlaces de bloqueo, chips de sección de 34 px y «Ver CAPA» de ~32 px [C]);
   - la tira de KPI móvil es una región con scroll horizontal que no recibe foco (`scrollable-region-focusable`);
   - el tile de vista activa solo se distingue por el tinte, y `activeChips` no incluye `vista` (`inspection-run-list.tsx:164-179,207`; WCAG 1.4.1).

8. **[C] Los diálogos dan poca respuesta a las mutaciones** (patrón sistémico en el detalle y en el catálogo):
   - los errores salen como `<p role="status" className="text-sm">` neutro (`complete-dialog.tsx:83`, `review-dialog.tsx:89`, `inspection-catalog.tsx:591,1154,1251`…) y en el alta (`inspection-run-list.tsx:625`);
   - `operation.fieldError` no se pasa a ningún `Field` (WCAG 3.3.1);
   - no hay `Button loading` ni toast de éxito.

9. **[C] Hay carreras de guardado.** «Guardar», la foto (`ensureAnswerSaved`, `inspection-run-detail.tsx:486`) y el cierre (`complete-dialog.tsx:41`) mandan el mismo `expectedVersion` que el autoguardado. Aparece «cambió en otra sesión» aunque todo quedó guardado. El acta, la ubicación y los participantes no entran al espejo ni suben `revision` (`:297`, `:1112`, `deviation-panels.tsx:88-136`).

10. **[V] Seguimiento oculta la faena y no es una herramienta:**
    - «Área» muestra el sujeto y la faena desaparece, en pantalla y en el Excel (`prevention-inspection-followup.ts:89`);
    - «Sin CAPA» aparece dos veces en la fila, junto a «% Cumplimiento 0 %»;
    - «Fecha ejecución MC» va sin expansión;
    - no hay filtros ni enlaces al hallazgo o la CAPA, el orden va del más antiguo al más nuevo y el estado es texto plano;
    - la descripción dice «No mantiene una base paralela», jerga de implementación ([`v-seguimiento.png`](evidence/2026-10-19-inspecciones-uiux/v-seguimiento.png)).

11. **[C] El export de Seguimiento ignora el interruptor del submódulo.** `api/.../seguimiento/export/route.ts` no llama a `assertInspectionOperationEnabled()` (el export principal sí). Con Inspecciones apagado, el Excel se sigue descargando, y el `catch {}` no registra el error.

12. **[V] La tabla de Plantillas se desborda a 1440 px.** El contenedor tiene 1266 px de contenido en 1126 px visibles, así que «Desviaciones» y «Acción» quedan fuera ([`plantillas-tall-desktop.png`](evidence/2026-10-19-inspecciones-uiux/plantillas-tall-desktop.png)). Además:
    - «Acredita PDTP» es prosa en monoespaciada con filas de 10 líneas;
    - la columna «Fuente / paridad» dice «Definición de plataforma» en todas las filas;
    - las versiones reemplazadas aparecen intercaladas con las vigentes;
    - el identificador principal es el código interno (`inspeccion_condiciones_ambientales`);
    - se muestran hashes SHA-256 y JSON (`inspection-catalog.tsx:391-392`);
    - un borrador oficial llega a 5 botones en «Acción» (`:514-522`).

13. **[C] La acreditación PDTP se lee de dos fuentes.** La tabla lee `pdtpActivityNumbers` (`inspection-catalog.tsx:423`) y el diálogo edita *bindings* (`:516`). `importInspectionTemplate` solo graba números. Guardar el diálogo vacío apaga la acreditación (`templates.ts:296-303`). **No se reproduce con los datos de dev**: las 13 plantillas aprobadas con número tienen su binding. El riesgo está en el próximo borrador incorporado. Recomendación: una sola fuente, y que la importación cree los bindings.

14. **[C] Las acciones de catálogo mienten sobre sí mismas:**
    - el diálogo «Desviaciones» se ofrece en todos los instrumentos y, en los que no registran desviaciones, dice «El catálogo maestro está vacío» (`page.tsx:50-61,94`; `inspection-catalog.tsx:515,874`);
    - «Declarar paridad» y «Aprobar» se ofrecen cuando el servidor los va a rechazar (`:518`; `templates.ts:394-396`);
    - el texto de importación exige «otra persona con permiso de aprobación», y el servicio permite al autor (`:1071` frente a `templates.ts:463-469`);
    - una plantilla retirada se muestra como «Reemplazada» y se descarta el resultado de «Retirar» (`:324,396,1294`).

15. **[C] El catálogo clasifica mal y revierte mal.** El diálogo de importación inicia y reinicia `kind` en `"inspection"` (`inspection-catalog.tsx:1024,1059`). Una auditoría incorporada sin tocar «Tipo» queda como inspección, coherente con lo visto: «Observación de Seguridad: Camión Ampliroll» figura como «Inspección». Además, «Revertir versión» toma la primera `superseded`, aunque haya sido retirada a propósito, y sin la verificación documental que exige aprobar (`:512`; `templates.ts:533-543`).

16. **[C] `DeviationRow` no muestra los errores.** Llama a `operation.run` desde la casilla y desde el selector y nunca pinta `operation.message` (`inspection-catalog.tsx:906-958`). La casilla vuelve a su estado sin explicación.

17. **[C/V] Programación:**
    - el sujeto elegido del inventario aparece como «No especificado» (`inspection-catalog.tsx:698,737`);
    - el select «Vencidas» y el botón «Sólo vencidas» representan lo mismo, y la combinación `estado=paused&vista=vencidas` siempre da un vacío falso (`:662-680`);
    - el estado vacío nombra el botón sin ofrecerlo ([`programacion-desktop.png`](evidence/2026-10-19-inspecciones-uiux/programacion-desktop.png));
    - la descripción del encabezado aparece truncada con «…».

18. **[V] Las tarjetas móviles de la bandeja no muestran al responsable** ni los hallazgos graves, que la tabla sí muestra (`inspection-run-list.tsx:326-345`; [`lista-mobile.png`](evidence/2026-10-19-inspecciones-uiux/lista-mobile.png)). Va contra el principio «faena y responsabilidad siempre visibles».

19. **[C] Rendimiento:**
    - cada autoguardado invalida `/dashboard`, `/pendientes` y `BADGE_COUNTS_TAG` (`actions.ts:66-71`, `operational-cache.ts:65-72`);
    - cada filtro vuelve a consultar el inventario de todas las faenas y todos los programas para un solo conteo (`inspections-screen.tsx:77-94`), sin `useTransition` ni `aria-busy`;
    - «Actividades programadas» se pinta al pie, bajo la paginación, con un segundo select «Faena» del mismo nombre y `toLocaleDateString` (`pdtp-scheduled-activity-panel.tsx:34-36,161`).

### P3 — Pulido

1. **[V]** Los badges de estado mezclan dos tipografías en la misma columna: «EN EJECUCIÓN» en mono mayúscula y «Cancelada» en sans. «No calculable» va en mono y parte en dos líneas.
2. **[V]** El hallazgo toma el nombre de la condición *conforme*: «Manómetro: aguja en zona verde. — QA_ aguja en zona roja…» se lee como un cumplimiento. Conviene anteponer «No cumple:».
3. **[V]** Los códigos `INSP-2026-U8K7E5H1` / `INSP-2026-MEX_JILF` son aleatorios: difíciles de dictar o buscar.
4. **[V]** El selector de «Nueva inspección» muestra etiquetas de versión (`· 03-jt`) y tres variantes de EPP sin explicar JT/PRF. «Observación planeada (Anexo 7)» queda fuera del orden alfabético.
5. **[V]** Hay jerga sin Tooltip:
   - «Encolar cierre en este dispositivo» (deshabilitado de forma permanente);
   - «materializa un hallazgo»;
   - «identidad corporativa… revisión segregada»;
   - PDTP, CAPA, SGSST y «DS 44 art. 22 n°4».
6. **[V]** El acta imprimible no tiene `<title>` propio («Plataforma Chome»), y «Volver al Acta» lleva al detalle [C].
7. **[C]** El visor de la planilla fuente muestra como `<img>` rota un `.docx` o `.xlsx`, que el input sí acepta (`source-form.tsx:27,51-56,122`). No comunica el límite de 25 MB.
8. **[C]** Usos de `--color-danger-border`, un token inexistente: en Inspecciones, `inspection-catalog.tsx:288` (con fallback a `--color-border`); fuera del módulo, `epp-gap-list.tsx:80` (con fallback) y `campanas-client.tsx`, `re20-panel.tsx` y `suplencias-client.tsx` (sin fallback). Hay avisos hechos a mano donde existe `Callout`, y un `GHOST_DANGER_CLASS` local.
9. **[C]** Queda código muerto: `// inspeccionesModule,` en `modules/registry.ts:71` (Inspecciones vive en `preventionModule`; la paridad de navegación y autorización está correcta) y el mensaje inalcanzable «Selecciona conscientemente…». `seguimiento/` hereda un esqueleto titulado «Inspecciones».

## Patrones sistémicos

- **La captura en terreno no tolera fallas.** P0-1, P1-1, P1-2, P1-4, P1-5, P1-7 y P2-9 son una misma deuda: autoguardado, espejo local, cola offline y guardado manual son cuatro canales que no se coordinan entre sí. Conviene corregirlos juntos, con un solo canal serializado.
- **Feedback de mutaciones.** En 15 o más diálogos los errores salen como `role="status"` neutro, sin `fieldError`, sin `loading` y sin toast. `useOperation` no captura excepciones. Corregirlo en el hook y en un patrón de diálogo común.
- **Etiquetas duplicadas.** Estado, resultado de ítem, tipo y procedencia tienen mapas distintos en pantalla, acta y Excel, y en lectura o export aparecen valores crudos.
- **Móvil y escritorio divergen.** Las tarjetas de bandeja y catálogo muestran otros datos que las tablas, y el estado del autoguardado solo existe en escritorio.

## Lo que funciona y conviene conservar

- **[V]** El autoguardado, en el caso feliz, pasa de «Cambios sin guardar» a «Guardando…» y a «Guardado» en ~2 s, y la respuesta persiste al recargar.
- **[V]** Los filtros viajan en la URL con `replace` (el historial no crece) y se conservan al volver desde el detalle. «Más filtros» lleva contador y hay chips con «Limpiar filtros».
- **[V]** El foco vuelve al disparador al cerrar los diálogos («Cancelar» y «Nueva inspección»).
- **[V]** «Nueva inspección» exige faena y plantilla explícitas y abre la ejecución creada.
- **[V]** El diálogo de cierre lista lo que falta.
- **[V]** Segregación de la revisión: un aviso claro con quién puede cerrar y «Recordar a quien revisa» (máximo uno al día).
- **[V]** Las 15 cargas de página (7 rutas en dos vistas, más el detalle de Extintores) respondieron HTTP 200, sin errores de consola ni respuestas fallidas, y sin desborde a 390 ni a 720 px.
- **[V]** Ambos exports son `.xlsx` reales, con `no-store` y `nosniff`.
- **[V]** En móvil hay barra fija «Guardar / Declarar ejecutada», «Ver contexto completo» plegado y CTA «Continuar» por tarjeta.
- **[C]** Filtrado y paginación ocurren en SQL, con los KPI sobre el universo completo. Cada página exige permiso en el servidor, y la ruta está bien declarada en `ROUTES_WITH_OWN_SEARCH`.
- **[C]** Las reglas de cierre son las mismas en cliente y servidor; hay bloqueo optimista por versión, reenvío idempotente desde la cola y filtro por faena en el GET de evidencia.
- **[C]** Se usan bien `Field`, `DatePicker`, `formatDate*`, `todayInChile` y los tokens `-ink`.
- **[D]** El detector de Impeccable da 0 hallazgos en el código del submódulo.

## Acciones recomendadas

1. **[P0/P1] `/impeccable harden` — captura en terreno.**
   - Restaurar el borrador con `revision` y rótulo honesto (P0-1).
   - Guardar las filas válidas pese a una inválida (P1-1).
   - `useOperation` con try/catch (P1-2).
   - Reintentos solo ante errores transitorios y rebase del borrador (P1-4).
   - Cola offline serializada con flush al montar (P1-5).
   - Estado del autoguardado en la barra móvil (P1-7).
   - Espejo en almacenamiento persistente y que cubra acta, ubicación y participantes (P2-9).
   - Tests de regresión para P0-1 y P1-1.
2. **[P1] `/impeccable harden` — flujos de revisión y evidencia.**
   - `stopPropagation` o sacar el CAPA del form de revisión (P1-3).
   - «Quitar foto» (P1-6).
   - Tono de error y `role="alert"` (P1-8, P2-8).
   - KPI con el mismo predicado que la lista y sin texto de estado bueno bajo filtro (P1-9).
   - Faenas para roles de solo lectura (P1-10).
   - Assert del toggle en el export de seguimiento (P2-11).
3. **[P1] `/impeccable shape` — catálogo.**
   - Vista previa de solo lectura de la plantilla (P1-12).
   - Vincular fuente en borradores (P1-11).
   - Una sola fuente de acreditación PDTP (P2-13).
   - Tipo derivado de la definición y reversión segura (P2-15).
4. **[P1/P2] `/impeccable clarify`.**
   - Un mapa de etiquetas para estado y escala (P1-13).
   - Enums crudos (P2-2).
   - «Corrige antes de guardar» separado en guardar/declarar (P2-1).
   - Diálogo «Cancelar inspección / Volver» (P2-4).
   - Copias falsas de catálogo (P2-14).
   - Jerga y siglas (P3-5).
5. **[P2] `/impeccable distill`.**
   - Metadatos del detalle y cumplimiento parcial (P2-5).
   - Ruido de fotos por fila (P2-6).
   - Columnas, versiones reemplazadas y acciones del catálogo (P2-12).
   - Programación duplicada (P2-17).
6. **[P2] `/impeccable adapt`.**
   - Desborde de Plantillas a 1440 px (P2-12).
   - Objetivos táctiles y región de KPI enfocable (P2-7).
   - Responsable en las tarjetas móviles (P2-18).
7. **[P2] `/impeccable harden` — exports.** Fechas en hora de Chile como celdas de fecha, encabezados en español y errata de la hoja (P2-3, P2-2).
8. **[P2] `/impeccable shape` — Seguimiento como herramienta.** Faena y sujeto separados, filtros, enlace por fila, Badge y orden por vencimiento (P2-10).
9. **[P2] `/impeccable optimize`.** Revalidación por autoguardado y recarga completa por filtro, con feedback de transición (P2-19).
10. **[P2/P3] `/impeccable onboard`.** Estados vacíos con CTA real en Programación, Plantillas y Seguimiento (P2-17).
11. **`/impeccable polish`.** Pasada final con los P3.

## Layout (segunda pasada, mismo día)

**Método:** guía `layout` de Impeccable.

- Capturas a 1024×768, 1280, 1440×900 y 390×844 (táctil), a largo completo.
- Medición en el DOM de los intervalos entre bloques, del desborde de cada tabla y del comportamiento `sticky` al desplazar el contenedor `[data-shell-scroll]`.
- Detector con `--scope layout`: **0 hallazgos** [D]. Un escaneo limpio no prueba jerarquía ni ritmo; todo lo de abajo sale de lo renderizado.

**Veredicto:**

- La shell se respeta: `PageContainer` y `PageHeader` sin `<h1>` propio ni envoltorios de padding, y ningún desborde de documento a ningún ancho.
- La **estructura interna no sigue la prioridad de la tarea**:
  - en el detalle, el trabajo queda enterrado bajo el contexto;
  - en móvil, la captura tiene la densidad de un formulario de escritorio;
  - en anchos de portátil, las tablas esconden justo la columna de acción.

### Respuestas a la guía

| Pregunta | Resultado | Evidencia |
|---|---|---|
| Orden de lectura (squint) | **Falla en el detalle** | En escritorio, lo que domina arriba es la grilla de 12 metadatos (213 px) y el recuadro rojo de bloqueos (285 px). El primer ítem empieza en y≈870 en escritorio y y≈960 en móvil ([`C-run-epp-m-0.png`](evidence/2026-10-19-inspecciones-uiux/C-run-epp-m-0.png)). La bandeja sí pasa: KPI, filtros y lista. |
| Agrupación | **Parcial** | La barra de estado y su fila «Encolar» son un mismo grupo, pero quedan tan separadas como dos secciones ajenas. El estado se repite en la tarjeta «Trabajo actual» y en la fila de estado. |
| Ritmo | **Monótono** | El detalle usa `space-y-6` (`inspection-run-detail.tsx:678`). Medidos los 8 bloques: 24 / 24 / 24 / 24 / 24 / 24 / 24 px. Los títulos de sección («1. Inventario del extintor», «Hallazgos (1)») van en 13 px semibold, el mismo peso visual que el cuerpo, así que las secciones no se distinguen al entrecerrar los ojos. |
| Estructura | **No calza con el contenido** | En EPP, cada prenda aparece **dos veces** como fila o tarjeta independiente (`usa` / `estado`). El contenido es una matriz prenda × {usa, estado}. En Plantillas, cada versión reemplazada ocupa su propia fila intercalada. |
| Densidad | **Falla en móvil** | Cada ítem es una tarjeta de **~400 px**: selector, textarea de 80 px siempre abierta, 2 ayudas, botón de foto y 2 ayudas más. La ficha EPP mide **11.792 px** (~14 pantallas) y la de Extintores 3.456 px ([`C-run-epp-m-1.png`](evidence/2026-10-19-inspecciones-uiux/C-run-epp-m-1.png)). Plantillas en móvil mide 7.632 px. |
| Adaptación | **Falla entre 1024 y 1440** | Detalle en la tabla siguiente. |
| Extremos | **Fallan** | `thead sticky` inerte, scroll anidado y tabla de escritorio en móvil (ver L7, L11 y L3). |

**Adaptación, columnas ocultas tras el scroll horizontal de cada tabla:**

| Pantalla | 1024 px (pozo de 776 px) | 1280 px | 1440 px |
|---|---|---|---|
| Bandeja | Fecha clave, Cumplimiento, Hallazgos (969/710 px) | Hallazgos | Ninguna |
| Plantillas | Gravedad, Acredita PDTP, Desviaciones, Acción | Acredita PDTP, Desviaciones, Acción | Acción |
| Seguimiento | Responsable, Fecha MC, Estado, % Cumplimiento, Comentarios | Estado, % Cumplimiento, Comentarios | % Cumplimiento, Comentarios |

### Hallazgos de layout

#### P1

- **L1 [V] La captura móvil tiene densidad de escritorio.**
  - Una tarjeta de ~400 px por ítem, con la textarea abierta aunque el comentario sea opcional.
  - En EPP, dos tarjetas por prenda.
  - Para un inspector en terreno son ~14 pantallas de scroll por trabajador.
- **L2 [V] El detalle invierte el orden de lectura.** Antes del primer ítem hay:
  - 12 metadatos siempre abiertos;
  - una fila de estado;
  - una fila «Encolar»;
  - el muro rojo de bloqueos;
  - los chips de sección.

  Lo que lidera debería ser el avance y el siguiente ítem pendiente.
- **L3 [V] Los hallazgos en móvil usan la tabla de escritorio.** A 390 px:
  - la descripción se parte en 7 líneas en una columna de ~80 px;
  - «Derivar a CAPA» y «Cerrar» quedan fuera de la pantalla, detrás del scroll horizontal ([`C-run-ext-m-0.png`](evidence/2026-10-19-inspecciones-uiux/C-run-ext-m-0.png)).

  Es la acción que una revisión en terreno necesita.
- **L4 [V/C] Ítems marcados «Opcional» que bloquean el cierre.**
  - La tarjeta y la fila usan `item.required` (`inspection-run-detail.tsx:907,988`).
  - El contador y el bloqueo usan `effectiveRequiredItems()`, que además exige los ítems puntuables (`lib/prevention/inspections.ts:531-533`).
  - En EPP, las 24 tarjetas dicen «Opcional», el encabezado dice «2 de 24 obligatorios» y «Declarar ejecutada» las exige.
- **L5 [V] En anchos de portátil, las tablas esconden la columna que pide acción.** Ver la tabla de adaptación:
  - en Plantillas, «Acción» queda fuera incluso a 1440 px;
  - en la bandeja, «Hallazgos» queda fuera a 1280 px;
  - en Seguimiento, «Responsable» y «Estado» quedan fuera a 1024 px.

  Con el menú lateral abierto, el pozo de 1024 px mide solo 776 px.

#### P2

- **L6 [V] El ritmo es plano y la jerarquía de secciones, débil.** El detalle separa todo con 24 px. Las secciones del cuestionario y «Hallazgos» no tienen un título que las distinga del cuerpo.
- **L7 [V] Las cabeceras `sticky` de las tablas no funcionan.**
  - Tras desplazar 1500 px, el `thead` de Plantillas queda en -1361 px y el de EPP en -627 px.
  - Causa: `TableRoot` tiene `overflow-x-auto` (`components/ui/table.tsx:38`), así que el `sticky top-0` del `thead` (`:68`) es inerte.
  - El primitivo ofrece `stickyHeader`, pero crea un scroll anidado de 70vh. En un formulario conviene más acortar las tablas (matriz EPP, versiones plegadas) que activarlo.
- **L8 [V] El modo de lectura conserva la estructura de edición.**
  - Siguen la columna «Evidencia» vacía, «Opcional» en cada tarjeta y «La foto queda vinculada a este ítem» sin foto.
  - Quien revisa lee cuatro tablas de «—» ([`L-run-ext-t1024.png`](evidence/2026-10-19-inspecciones-uiux/L-run-ext-t1024.png)).
  - Recomendación: resumen primero (cumplimiento, hallazgos, firmas), los incumplimientos abiertos y lo conforme plegado por sección.
- **L9 [V] La bandeja a 1024 px y en móvil se desordena.**
  - A 1024 px, el rótulo «CON HALLAZGOS ABIERTOS» se parte en dos líneas y desalinea su cifra respecto de las otras tres.
  - «Más filtros» cae solo a una segunda fila ([`L-lista-t1024.png`](evidence/2026-10-19-inspecciones-uiux/L-lista-t1024.png)).
  - En móvil, los 4 KPI van en una tira con scroll horizontal y el cuarto queda oculto. Mejor una grilla de 2×2.
- **L10 [V] En Plantillas, la altura de fila la fija la prosa.**
  - «Acredita PDTP» va en monoespaciada y en una columna angosta, con 80–170 px por fila.
  - Las versiones reemplazadas duplican filas.
  - Recomendación: una fila por instrumento vigente, el historial dentro de la vista previa y la acreditación como «N° 41» con Tooltip.
- **L11 [V] La lista de bloqueos tiene scroll propio** (`max-h-56 overflow-y-auto`, `inspection-run-detail.tsx:854`). En móvil es un scroll dentro de otro, con 24 enlaces.
- **L12 [V] «Actividades programadas» ocupa una fila al pie, incluso vacío** («Sin trabajo…»). Con contenido, quedaría bajo 50 filas y la paginación. Recomendación: un aviso sobre la lista solo cuando haya algo pendiente.
- **L13 [V] Las descripciones del encabezado se truncan con «…».** Ocurre en la bandeja a 1024 px y en Programación a 1440 px. El texto que se pierde es información, no adorno.

#### P3

- **L14 [V]** Los filtros de Programación tienen tres alturas: input de 34 px, selects de 36 px y el botón «Sólo vencidas» de 30 px.
- **L15 [V]** En «Nueva inspección», las ayudas de distinto largo desalinean las filas de dos columnas. «Origen», un campo avanzado con valor por defecto, queda entre los obligatorios y el sujeto. «Tipo» e «Identificación del sujeto» libres se ven aunque se elija del inventario.
- **L16 [V]** En el detalle móvil hay un hueco de ~45 px entre «Capturar ubicación / Cancelar» y «Encolar».

### Tesis espacial propuesta (detalle de ejecución)

- **Recorrido principal:**
  1. responder el siguiente ítem pendiente;
  2. resolver lo que bloquea;
  3. declarar ejecutada.
- **Lidera:** el cuestionario y su avance.
- **Apoya:**
  - el contexto (faena · sujeto · responsable), en una línea, con el resto plegado;
  - las acciones de la inspección.
- **Grupos:**
  1. **cabecera de trabajo:** contexto, avance y un rótulo de guardado visible también en móvil;
  2. **secciones:** título real, avance por sección y salto al siguiente pendiente;
  3. **cierre:** acta, firmas y «Declarar».

  Los bloqueos pasan a ser parte del avance («3 sin responder · 1 sin motivo»), no un muro rojo.
- **Ritmo:**
  - 4–8 px dentro de un ítem;
  - 12–16 px entre ítems;
  - 32–40 px entre secciones;
  - 24 px entre la cabecera y el trabajo.
- **Ítem compacto:**
  - etiqueta y escala como botones segmentados de 44 px (Sí/No/N/A o Bueno/Regular/Malo) en vez de un Select;
  - comentario y foto detrás de «Agregar comentario / foto», abiertos solos cuando la respuesta exige motivo.
- **Matriz EPP:** prenda × {usa, estado}.
- **Estimación** (no medida): con ítems de ~130 px, la ficha EPP en móvil bajaría a unos 3.300 px.
- **Modo lectura:** resumen, luego los incumplimientos, y lo conforme plegado.

### Acciones recomendadas (layout)

1. **[P1] `/impeccable layout` sobre el detalle de ejecución.** Aplicar la tesis anterior: L1, L2, L4, L6, L8, L11 y L16. Es el cambio de mayor impacto para terreno y conviene hacerlo junto al bloque `harden` de captura (P0-1 a P1-7), porque tocan el mismo componente.
2. **[P1] `/impeccable adapt` sobre las tablas.**
   - Hallazgos en móvil como tarjetas (L3).
   - Prioridad de columnas a 1024 y 1280 px en bandeja, Plantillas y Seguimiento (L5): tipo y fecha como sublínea, cumplimiento junto a hallazgos y la acción siempre visible.
   - KPI en 2×2 en móvil (L9).
3. **[P2] `/impeccable distill` sobre Plantillas.** Una fila por instrumento, historial en la vista previa y acciones en un menú (L10, junto con P1-12 y P2-12).
4. **[P2] `/impeccable layout` sobre la bandeja.** «Actividades programadas» como aviso condicional (L12), descripciones sin truncar (L13) y alineación de filtros (L14).
5. **`/impeccable polish`.**

## Cobertura y límites

**Recorrido en navegador:**

- las 4 pantallas de lista;
- el detalle en ejecución (EPP y Extintores), pendiente de revisión y cancelado;
- el acta;
- los diálogos «Nueva inspección», «Más filtros», «Cancelar», «Declarar ejecutada», «Acreditación PDTP» y «Desviaciones»;
- los dos exports;
- guardado sin conexión y recuperación del borrador.

**Sin recorrer:**

- **Revisión por un segundo usuario:** solo hay una sesión QA; por eso P1-3 queda como [C].
- **Roles distintos de administrador:** por eso P1-10 queda como [C].
- **Subida real de fotos y de planilla.**
- **Cola offline de punta a punta:** P1-5 queda como [C].
- **Acciones de catálogo que cambian datos:** incorporar, aprobar, retirar, revertir y paridad.
- **Altas de programación.**
- **PDF del acta** (`/print/pdf`).
- **Gestos táctiles reales:** solo hubo viewport emulado con `hasTouch`.
- **Lector de pantalla real.**
- **Rendimiento en producción.**

**Detector:** no se escaneó por URL, porque no lleva la sesión autenticada.

**Datos de dev que quedan para reproducir:**

- `INSP-2026-U8K7E5H1`, pendiente de revisión, con 1 hallazgo ALTA abierto;
- 3 respuestas en `QA_epp_run_1`.

Esto cubre los flujos recorridos del submódulo, no todos los estados posibles.
