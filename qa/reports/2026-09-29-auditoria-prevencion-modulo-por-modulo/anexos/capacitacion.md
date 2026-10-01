# Auditoría de production readiness de Prevención — agente **capacitacion** (prefijo CAP-)

**Fecha:** 2026-09-29 · **HEAD:** `11e67621` · **Entornos:** A (`:3100`, `bodega_audit_e2e`) y B (`:3101`, `bodega_audit_real_e2e`, programa 2026 v2 real, activado el 17-09 = septiembre semana 3; «hoy» = septiembre semana 4).
**Alcance:** tres submódulos. (1) Campañas y Capacitación (`/prevencion/capacitacion`); (2) Campañas, el registro histórico (`/prevencion/campanas`); (3) Alcotest (`/prevencion/alcotest`).
**Evidencia:** scripts, capturas y salidas en `scratchpad/audit/capacitacion/`: `capops.mjs`, `alcops.mjs`, `review.mjs`, `approve-exec.mjs`, `api-cap.mjs`, `api-alco-camp.mjs`, `idor-*.mjs`, `responsive.mjs`, `state.sh`, `alc-state.sh`, `capacitacion-closed-month.audit-tmp.test.ts` + `probe-closed-month.log`, `tests-fast.log`, `tests-pglite.log`, `shots/` (85 capturas) y `capops-results.jsonl`.

**Datos `QA_CAP_` creados en B.** No borré ni alteré registros ajenos.
- **Capacitación en Horcones:**
  - CAP-16 m09-w4, hecha;
  - CAP-02 m09-w4, hecha → no hecha;
  - CAP-21 m09-w3, no hecha;
  - CAP-21 m09-w4, hecha → NA, rechazado en revisión;
  - CAP-21 m11-w4, hecha a futuro;
  - CAP-04 m09-w4, NA aprobado;
  - CAP-03 m09-w2, CAP-15 y CAP-20 (anuales), hechas;
  - CAP-22 m09-w3 y CAP-25 m09-w4, hechas;
  - CAP-23 m09-w4 y CAP-24 m09-w3, NA;
  - CAP-02 m03-w2 (obsoleta), hecha mediante una petición manipulada;
  - evidencias sueltas en CAP-16 m10-w2 y CAP-17 m08-w2.
- **Alcotest:**
  - Horcones: 7 controles (uno fechado en 2027) y 2 envíos (julio y agosto), con las casillas m08-w3, m09-w3, m12-w3 (control) y m09-w1, m12-w1 (envío) cumplidas, más evidencia huérfana en m06-w3 y m10-w3;
  - Cholguan: m09-w3 (con el archivo borrado a propósito);
  - Teno y Masisa: m09-w3 en NA.
- **Campañas:** CAMP-HORCONES-VIDA cerrada.
- **Revisiones hechas por `prev2`:** NA N°56 aprobado, NA N°38 aprobado, NA N°53 rechazado y N°30 de Cholguan aprobado con motivo.

---

## AUDITORÍA — Campañas y Capacitación (`/prevencion/capacitacion`)

**Rutas:**
- `/prevencion/capacitacion`
- APIs: `POST /api/prevencion/capacitacion/evidence`, `GET …/evidence/[name]` y `GET …/export`

**Archivos principales:**
- `app/(app)/prevencion/capacitacion/{page,actions,training-occurrence-list,loading}.tsx`
- `lib/services/prevention-training-occurrences.ts`, `prevention-training-export.ts`, `prevention-training-obligations.ts`
- `lib/prevention/training-occurrences-catalog.ts` (33 ítems, 390 casillas por faena)
- `lib/services/pdtp-adapters/{occurrence-gap-connector,slot-deviation-connector}.ts`
- `scripts/retire-obsolete-training-occurrences.ts`

**Permisos** (`modules/prevention/manifest.ts:991-1011`):
- `prevention:training:view`: prevencionista, prevencionista_faena, admin_contrato, jefe_terreno, supervisor_terreno, cphs, jefa_chome y administrador.
- `record`: prevencionista, prevencionista_faena, admin_contrato, jefa_chome y administrador.
- `export`: prevencionista, jefa_chome y administrador.

En B sobreviven además los permisos del modelo retirado (`training:ack/approve/deliver/manage…`); no afectan el flujo actual.

### A. UI/UX/Diseño
- Cumple el andamiaje: `PageHeader` + `PageContainer`, un solo `h1`, búsqueda del TopBar conectada, pestañas por estado con contadores (regla A5) y `EmptyState` con CTA. No aparecieron errores de consola ni respuestas ≥400 en ningún recorrido.
- **La lista es inmanejable (CAP-03).**
  - Hay 390 tarjetas por faena, ordenadas de enero a diciembre, sin filtro de mes ni vista «esta semana».
  - La charla diaria de la semana en curso (CAP-21, septiembre semana 4) es la tarjeta **n.° 289**: la página mide 83.290 px a 1440 y 171.390 px a 390.
  - Con «Todas las faenas», que es la vista inicial de los roles globales: **2.731 tarjetas, 93.231 nodos DOM, 578.613 px y un documento HTML de 20,3 MB**. Por faena son 3,0 MB.
  - La búsqueda no reconoce el mes: «septiembre» devuelve 0. «CAP-21» deja 48 tarjetas, y la de la semana en curso es la 36.
- **Estados poco claros:**
  - El badge de estado está en plural en cada tarjeta: «PENDIENTES», «HECHAS», «No aplican» (CAP-15).
  - «No aplica» se ve igual se haya aprobado, rechazado, retirado o perdido en el PDTP (CAP-05; captura `state-no-aplican.png`).
- **Jerga interna** (CAP-16): «Catálogo anual controlado · programa-capacitacion-2026-v1», códigos CAP/CAM sin explicación, títulos de CAP-22…26 de tres líneas cuyo «(charla n de 5)» queda al final, y «Programa anual 2026» presentado como si fuera un campo, sin selector de año (sólo `?year`).
- **Responsive:** sin desborde horizontal a 1440/1024/768/390. El diálogo cabe a 390 (358 px de ancho) y los botones se apilan.
- **Estados observados:**
  - Sin información: entorno A, 0 ocurrencias, `EmptyState` «Revisar faenas».
  - Con información: B.
  - Sin resultados: «Sin coincidencias» con «Limpiar filtros».
  - Operación exitosa: toast.
  - Operación fallida: toast de error; el diálogo sigue abierto.
  - Permisos insuficientes: `ti` → `/forbidden`.
  - No observado: «Cargando», aunque existe `loading.tsx`.

### Facilidad de uso
- **Marcar una charla hecha con evidencia** (prevencionista_faena, una faena): 5 clics — «Marcar hecha», «Seleccionar archivo», elegir en el sistema operativo, observación (opcional) y «Confirmar hecha».
  - Antes hay que localizar la tarjeta: escribir el código en el TopBar y bajar ~36 tarjetas, o ~289 sin buscar.
  - Un rol global suma 2 clics para elegir la faena; si no, trabaja sobre 2.731 tarjetas.
- **Fricciones:**
  - «Marcar hecha» sobre una ocurrencia «No aplica» **siempre falla**: la evidencia no se admite en NA y la acción la exige (CAP-09, demostrado).
  - La tarjeta dice «Requiere registro del prevencionista de faena» incluso en N°38 y N°53, cuyo responsable es Sup/JT (CAP-06).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Listar por faena y año, filtrar por estado y buscar | 🟡 | Funciona; sin filtro de mes, 390/2.731 tarjetas (CAP-03) |
| Marcar hecha con evidencia | ✅ | B: T1, T1b, T6. La evidencia es obligatoria en el servidor (`prevention-training-occurrences.ts:545`) |
| Marcar hecha en semana futura | 🔴 | B: CAP-21 noviembre semana 4 → **aprobada en el PDTP** (CAP-01) |
| Marcar no hecha | ✅ | B: T2 → desvío `not_performed` activo |
| No aplica → revisión por otra persona | ✅/🟡 | B: queda `pending_review`; `prev2` aprueba. El rechazo no vuelve a la ocurrencia (CAP-05) |
| NA en semana futura | ✅ | B: toast «No se puede declarar «no aplica» para una semana que aún no ocurre…» |
| NA en mes cerrado (pendiente) | ✅ | PGlite P3: error visible y la casilla no cambia |
| Corregir hecha → no hecha / NA (revoca) | ✅/🟡 | B: ejecución → `draft`, evidencia anulada y conservada. En mes cerrado el NA se pierde (CAP-04) |
| De NA a hecha | 🔴 | Siempre falla (CAP-09) |
| Evidencia: MIME real, tamaño, nombre | ✅ | `.exe`/`.html` renombrado → 400; 26 MB → 413; nombre de 300 caracteres → 400; `../` guardado como nanoid |
| Descarga de evidencia con alcance | ✅ | Otra faena → 404; `ti` → 403; traversal → 400 |
| Exportar Excel | 🟡 | 3 hojas, 390 filas sin obsoletas. Fechas UTC crudas y sin actor de NA/no hecha (CAP-11) |
| Anuales (N°16, N°57) | ✅/🔵 | N°16 acredita en la semana del registro. N°57 no deja rastro en el PDTP (CAP-14) |

### C. Código y lógica
- El servicio es sólido:
  - bloqueo de fila y versión optimista;
  - auditoría (`recordAudit`);
  - acreditación y revocación durables (`recordPending…`);
  - desvío después del commit cuando se sale de «hecha».
- **Brechas:**
  - Ni `recordTrainingOccurrenceStatus` ni `uploadTrainingOccurrenceEvidence` validan la casilla contra el catálogo vigente: sólo filtra el listado, en `:327-328` (CAP-07).
  - Ningún guard de semana futura en el servicio ni en `accreditPdtpFromEvent` (CAP-01).
  - La propagación después del commit traga el error con `.catch(logger.error)` en `:691-693` (CAP-04).
  - Comentario obsoleto en `manifest.ts:999-1003`: habla de `deliver` para Sup/JT, y ese permiso ya no existe en el modelo (CAP-06).
  - La extensión guardada sale del nombre del cliente (`generateStorageName`, `prevention-documents/utils.ts:230-233`) (CAP-13).

### D. Modelo de datos
- `prevention_training_occurrences` es único por (ítem, faena, año, casilla), con `version`. La evidencia se anula en vez de borrarse.
- `source_id` hacia el PDTP es texto, sin FK.
- **PRV-06 en B:**
  - quedan **91 ocurrencias obsoletas `pending`** (13 por faena × 7 faenas);
  - el script no está aplicado;
  - en A no hay ninguna (A no tiene ocurrencias);
  - después de la prueba de CAP-07, una de ellas (CAP-02 m03-w2) quedó hecha y ahora se ve en el listado.
- El catálogo coincide celda a celda con el cronograma v2 de B en las 18 actividades programadas (comparación por SQL; `catalog-cells.json` y `pdtp-cells.json`).

### E. Permisos y seguridad
- IDOR demostrado como bloqueado en cuatro vías:
  - la server action con el `occurrenceId` de otra faena reescrito (otrafaena → Horcones) devuelve «Registro de capacitación no encontrado o fuera de alcance.»;
  - subir evidencia a otra faena → 400;
  - descargar evidencia de otra faena → 404;
  - `ti` → 403 en carga, descarga y exportación.
- `sup` sin `record` → 403 al subir.
- Exportar: prevencionista_faena → 403; la jefa exporta todo.
- Riesgo potencial: archivos `.html` en el storage (CAP-13). Se sirven con el `Content-Type` guardado y `nosniff`: **no es explotable por la ruta actual**.

### F. Testing
- Ejecuté 9 archivos non-PGlite: **69/69 PASS** (`tests-fast.log`).
- Ejecuté 7 archivos PGlite del alcance: **110/110 PASS** (`tests-pglite.log`).
- E2E existente (`e2e/prevencion-odi-capacitacion.spec.ts`): sólo carga la página y descarga el Excel si el botón existe. No marca, no adjunta y no revisa integración.
- Sin cobertura:
  - «hecha» en semana futura;
  - réplicas N°38;
  - NA rechazado que no vuelve;
  - hecha→NA en mes cerrado;
  - «Marcar hecha» desde NA.

### G. Integración con el Programa Anual (ejecutado en B y en PGlite)
- **Acredita, verificado en B:**
  - N°16, N°37, N°38, N°53, N°54 y N°63 por acreditación directa;
  - N°57 por obligación, que sólo nace si vence o se declara «no hecha».
- **Funcionamiento de la acreditación:**
  - es automática, `approved` y `evidenceStatus=provided`;
  - la ejecución registra ejecutor = aprobador = quien marca: no hay segunda persona (CAP-08);
  - la celda es la del mes y semana planificados.
- Resultados observados:

| Caso | Resultado observado |
|---|---|
| CAP-16 m09-w4 hecha con PDF | N°37 2026-9-w4 `approved`, `provided`, ejecutor y aprobador `qa.prevfaena` ✅ |
| CAP-21 m09-w3 no hecha | Desvío N°53 `not_performed` activo con el motivo ✅ |
| CAP-04 m09-w4 NA | N°56 `pending_review` → `prev2` aprueba → `active`; septiembre planificado 1→0 ✅ |
| CAP-02 hecha → no hecha | N°54 → `draft` y `not_performed`; evidencia `annulled` ✅ |
| CAP-21 m09-w4 hecha → NA | N°53 → `draft` y NA `pending_review` ✅ → `prev2` rechaza → **la ocurrencia sigue «No aplica»** ❌ (CAP-05) |
| CAP-21 diciembre semana 4, NA | Rechazado con error visible ✅ (PRV-16) |
| CAP-21 noviembre semana 4, hecha | **N°53 2026-11-w4 `approved`**; `effectiveCountedTotalExecuted` = 1 ❌ (CAP-01) |
| N°38: CAP-22 m09-w3 hecha + CAP-24 m09-w3 NA | Ejecución 1/5; el NA **no llega** al PDTP (celda con ejecución), la ocurrencia dice NA ❌ |
| N°38: CAP-23 m09-w4 NA aprobado | Septiembre planificado de N°38 **20 → 15**: el NA de 1 de 5 charlas sacó las 5 ❌ |
| N°38: luego CAP-25 m09-w4 hecha | El NA aprobado por `prev2` pasa a **`withdrawn` automáticamente**; CAP-23 sigue «No aplica» ❌ (CAP-02) |
| PGlite P1/P2: hecha en febrero → se cierra febrero → NA / no hecha | Sin error; ocurrencia NA; **ejecución del mes cerrado revocada (`draft`)**; desvío no escrito (sólo `logger.error`) ❌ (CAP-04) |
| PGlite P4: pendiente en mes cerrado → hecha | Ejecución `approved` en febrero cerrado. Es por diseño (`period-closures.ts:32-41`, `driftedSinceClose`) |
| Obsoleta CAP-02 m03-w2 (petición reescrita) | N°54 2026-3-w2 `approved` sin planificado (v1) ❌ (CAP-07) |

### H. Hallazgos

```
ID: CAP-01
Severidad: 🟠 CRÍTICO
Submódulo: Capacitación y Alcotest (transversal a la acreditación por integración)
Categoría: Integración PDTP / Integridad
Título: Un hecho registrado hoy para una semana futura crea una ejecución PDTP aprobada (PRV-03 sigue abierto por la vía de integración)
Archivo(s): lib/services/prevention-training-occurrences.ts; lib/services/prevention-alcotest-slots.ts; lib/services/prevention-alcotest.ts; lib/services/pdtp/accreditation.ts
Línea(s): training-occurrences.ts:500-547 y 620-636 (sin guard de futuro); alcotest-slots.ts:239-293; alcotest.ts:181-185 y 323-327 (plannedPeriod = casilla); el guard sólo existe en executions.ts:110 y 587
Pantalla/ruta: /prevencion/capacitacion, /prevencion/alcotest
Endpoint: recordTrainingOccurrenceStatusAction, recordAlcoholTestAction, recordAlcoholTestDispatchAction
Rol: prevencionista_faena (y todo rol con record/register/dispatch)
Descripción: marcar «hecha» una ocurrencia de noviembre, o ligar un control o envío de hoy a la casilla de diciembre, acredita y autoaprueba la celda futura. El saneamiento de deploy (report-pdtp-unverified-auto-approvals.ts:95) la revertiría sólo en el próximo deploy.
Evidencia: DEMOSTRADO (B). CAP-21 m11-w4 → N°53 2026-11-w4 approved/provided, que la vista de hoja cuenta (effectiveCountedTotalExecuted = 1). Control del 29-09 en la casilla dic w3 → N°30 2026-12-w3 approved. Envío de julio en la casilla dic w1 → N°32 2026-12-w1 approved. Las casillas quedan «Hecha».
Cómo reproducir:
1. Como prevfaena, en Capacitación: CAP-21 «noviembre · semana 4» → Marcar hecha + PDF.
2. SQL: pdtp_executions de N°53, Horcones, 2026-11-w4 → approved.
3. En Alcotest: Registrar control con la casilla «Dic · semana 3» → N°30 2026-12-w3 approved.
Resultado actual: cumplimiento aprobado de algo que no pudo ocurrir; la casilla queda cumplida.
Resultado esperado: el servicio de la casilla rechaza (o deja pendiente) una celda posterior a la semana en curso, y accreditPdtpFromEvent aplica isPdtpCellInFuture al plannedPeriod.
Impacto: infla el avance anual y por faena; es exactamente el defecto PRV-03 que se declaró corregido.
Causa probable: el guard de PRV-03 se agregó sólo a markPdtpExecution y approvePdtpExecution.
Solución recomendada: assertPdtpCellNotInFuture en recordTrainingOccurrenceStatus (completed) y en fulfillAlcotestSlotTx; defensa en accreditPdtpFromEventInTransaction; quitar las casillas futuras de los selectores; pruebas PGlite.
Esfuerzo: Bajo
Bloquea producción: No (condición mínima: sí corregir antes)
Clasificación: A
```

```
ID: CAP-02
Severidad: 🟠 CRÍTICO
Submódulo: Capacitación
Categoría: Integridad / Integración PDTP
Título: Las 5 réplicas de la N°38 (CAP-22…26) comparten una celda; un «no aplica» de una charla saca las cinco, y completar otra lo retira en silencio
Archivo(s): lib/prevention/training-occurrences-catalog.ts; lib/services/prevention-training-occurrences.ts; lib/services/pdtp-adapters/slot-deviation-connector.ts
Línea(s): catálogo :505-571 (5 ítems con allWeeksOfYear → [38]); occurrences.ts:665-680; slot-deviation-connector.ts:262-324 (desvío por celda)
Pantalla/ruta: /prevencion/capacitacion → /prevencion/pdtp/aprobaciones
Endpoint: recordTrainingOccurrenceStatusAction, reviewPdtpNotApplicableAction
Rol: prevencionista_faena (declara), prevencionista (revisa)
Descripción: el desvío del PDTP es por celda (actividad, faena, año, mes, semana), pero la N°38 planifica 5 por semana con 5 ocurrencias distintas. El revisor ve «N°38 Horcones · Sep · semana 4» y el motivo, sin saber que era «charla 2 de 5».
Evidencia: DEMOSTRADO (B + servicio de hoja).
 - NA en CAP-23 m09-w4, aprobado por prev2 → septiembre planificado de N°38: 20 → 15, total anual 240 → 235.
 - Luego, CAP-25 m09-w4 hecha → el NA aprobado pasa a «withdrawn» sin aviso a nadie; CAP-23 sigue mostrando «No aplica».
 - NA en CAP-24 m09-w3 con CAP-22 m09-w3 ya hecha → el PDTP lo rechaza (celda con ejecución) y sólo queda en el log; la ocurrencia dice NA.
Cómo reproducir:
1. Declarar NA en CAP-23 «septiembre · semana 4».
2. Aprobarlo con otra persona.
3. Ver que N°38 septiembre queda con 15 planificadas; marcar hecha CAP-25 de la misma semana y consultar pdtp_execution_deviations.
Resultado actual: el denominador baja 5 por una declaración de 1; aprobaciones de segunda persona que desaparecen solas.
Resultado esperado: el NA de una réplica reduce 1 (meta por celda) o se prohíbe por réplica; ninguna aprobación se retira sin traza visible.
Impacto: la N°38 es 240 de las 390 casillas por faena: el grueso del cumplimiento de capacitación.
Causa probable: el conector de casillas se diseñó para 1 casilla = 1 celda.
Solución recomendada: modelar la N°38 como una casilla por semana con cantidad (5), o desviar por cantidad; mostrar la réplica en la revisión.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: A
```

```
ID: CAP-03
Severidad: 🟠 CRÍTICO
Submódulo: Capacitación
Categoría: UI/UX / Performance
Título: La grilla anual es una lista de 390 tarjetas por faena (2.731 y 20 MB para roles globales) sin filtro de período
Archivo(s): app/(app)/prevencion/capacitacion/training-occurrence-list.tsx; page.tsx; lib/services/prevention-training-occurrences.ts
Línea(s): list.tsx:140-148 (la búsqueda ignora mes y semana) y 228-232 (render completo); page.tsx:42-47; service :316-322 (orden enero→diciembre)
Pantalla/ruta: /prevencion/capacitacion
Endpoint: —
Rol: todos; peor en admin, prevencionista y jefa (vista inicial «Todas las faenas»)
Descripción: sin paginar, sin agrupar por mes y sin «esta semana». La tarea semanal (N°53 diaria, N°38 ×5) obliga a recorrer la lista cada semana.
Evidencia: DEMOSTRADO (navegador y HTTP, B). Por faena: 391 tarjetas, 83.290 px a 1440 y 171.390 px a 390; la tarjeta de la semana en curso es la n.° 289. Admin: 2.731 tarjetas, 93.231 nodos, 578.613 px, 20,31 MB de HTML. La búsqueda «septiembre» devuelve 0.
Cómo reproducir:
1. Como prevfaena, abrir /prevencion/capacitacion.
2. Buscar la charla diaria de hoy.
3. Como admin, abrir sin ?faena.
Resultado actual: la operación principal exige desplazarse decenas de miles de píxeles.
Resultado esperado: vista por defecto del mes o semana en curso (y atrasadas), agrupación por mes y filtro de período; roles globales con una faena elegida o un resumen.
Impacto: registro tardío u omitido de charlas → incumplimiento aparente; carga pesada en red real y móvil.
Causa probable: se reutilizó la tarjeta de detalle como lista.
Solución recomendada: filtro mes/semana sincronizado con la URL (por defecto el actual), tabla densa, paginación o agrupación, y exigir faena para roles globales.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: A
```

```
ID: CAP-04
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación (y Alcotest)
Categoría: Integración / Manejo de errores
Título: PRV-16 parcial: hay tres caminos en que el «no aplica»/«no hecha» que el PDTP rechaza sigue quedando sólo en el log
Archivo(s): lib/services/prevention-training-occurrences.ts; slot-deviation-connector.ts
Línea(s): occurrences.ts:678 y 687-693 (después del commit, .catch(logger.error)); connector :185-191 (el guard sólo cubre futuro y mes cerrado) y :309-324 (el resto se traga)
Pantalla/ruta: /prevencion/capacitacion, /prevencion/alcotest
Endpoint: recordTrainingOccurrenceStatusAction, recordAlcotestSlotStatusAction
Rol: prevencionista_faena, administrador
Descripción: la casilla cambia y dice «No aplica» mientras la celda sigue exigida, en tres casos: (a) de hecha a NA/no hecha, incluido un mes cerrado; (b) celda con ejecución (réplica N°38); (c) alcotest declarado por un rol sin N°30/N°31 (CAP-20).
Evidencia: DEMOSTRADO. PGlite P1/P2: hecha en febrero → se cierra febrero → NA → sin error; ejecución del mes cerrado → draft; ningún desvío; logger.error. B: CAP-24 m09-w3 NA con toast de éxito y sin desvío; admin NA en Teno m09-w3 sin desvío y sin aviso.
Cómo reproducir: ver la tabla G (filas N°38) y capacitacion-closed-month.audit-tmp.test.ts.
Resultado actual: submódulo y programa se contradicen, y el usuario ve éxito.
Resultado esperado: validar antes, dentro de la transacción de la casilla, con las mismas guardas, y mostrar el rechazo; o, si se acepta, decirlo en pantalla.
Impacto: incumplimientos «fantasma», y un mes cerrado alterado por una revocación.
Causa probable: la propagación posterior al commit es best-effort por diseño.
Solución recomendada: pre-validación (mes cerrado, celda con ejecución, actividad resoluble) antes de confirmar; devolver una advertencia a la UI.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-05
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación y Alcotest
Categoría: Integración / UX
Título: El resultado de la revisión del «no aplica» nunca vuelve a la ocurrencia o casilla
Archivo(s): lib/services/pdtp/deviations.ts; training-occurrence-list.tsx; components/prevention/program-slot-list.tsx
Línea(s): deviations.ts:350-455 (review sin retroalimentación); list.tsx:321-322; program-slot-list.tsx:147-151
Pantalla/ruta: /prevencion/capacitacion, /prevencion/alcotest
Endpoint: reviewPdtpNotApplicableAction
Rol: todos
Descripción: la tarjeta muestra «No aplica» ya sea que el NA esté en revisión, aprobado, rechazado, retirado automáticamente o perdido. Tras un rechazo, la casilla sigue en NA: queda excluida del barrido de brechas (occurrence-gap-connector.ts:212) y su «Marcar hecha» falla (CAP-09).
Evidencia: DEMOSTRADO (B). NA de N°53 m09-w4 rechazado por prev2 → CAP-21 m09-w4 sigue «No aplica»; en la pestaña «No aplican» las 4 tarjetas son idénticas (state-no-aplican.png) aunque en el PDTP estén aprobada, rechazada, retirada y ausente.
Cómo reproducir:
1. Declarar NA.
2. Otra persona lo rechaza en Aprobaciones.
3. Volver a la tarjeta.
Resultado actual: la persona cree resuelto algo que el programa sigue exigiendo.
Resultado esperado: estado derivado («NA en revisión / aprobado / rechazado») y, al rechazar, volver a pendiente.
Impacto: celdas incumplidas sin que nadie lo note.
Causa probable: el desvío no guarda su casilla de origen (slot-deviation-connector.ts:40-43).
Solución recomendada: guardar source_module/source_slot_id en el desvío y reflejar la decisión en la casilla.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-06
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación
Categoría: Permisos / Reglas de negocio
Título: Las charlas N°38 y N°53, responsabilidad de Supervisor/Jefe de terreno, sólo las puede registrar Prevención
Archivo(s): modules/prevention/manifest.ts; training-occurrence-list.tsx
Línea(s): manifest.ts:998-1004 (Sup/JT sólo training:view; el comentario habla de un `deliver` retirado); list.tsx:328
Pantalla/ruta: /prevencion/capacitacion
Endpoint: POST /api/prevencion/capacitacion/evidence
Rol: supervisor_terreno, jefe_terreno
Descripción: pdtp_activities v2 declara N°38 y N°53 → «Supervisor de terreno, Jefe de terreno». Ellos no tienen botones y reciben 403 al subir evidencia; la tarjeta dice «Requiere registro del prevencionista de faena».
Evidencia: DEMOSTRADO (B: la tarjeta de sup no tiene acciones; la subida de sup → 403) + SQL (responsible_display) + CÓDIGO.
Cómo reproducir: iniciar sesión como sup en /prevencion/capacitacion y buscar CAP-21.
Resultado actual: quien ejecuta no puede registrar; quien registra no es el responsable, y además autoaprueba (CAP-08).
Resultado esperado: record para Sup/JT sobre sus actividades y su faena, o una decisión explícita documentada.
Impacto: trazabilidad de «quién hizo» débil en el 74 % de las casillas.
Causa probable: el retiro del modelo por persona (19-09) no remapeó los permisos.
Solución recomendada: conceder training:record acotado (por actividad) o corregir el texto y el responsable.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-07
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación
Categoría: Integridad / Integración
Título: PRV-06 parcial: 91 ocurrencias obsoletas siguen en B y el servicio todavía acepta marcarlas
Archivo(s): lib/services/prevention-training-occurrences.ts; scripts/retire-obsolete-training-occurrences.ts
Línea(s): occurrences.ts:327-328 (sólo el listado filtra); 500-547 y 715-747 (record/upload sin validar la casilla)
Pantalla/ruta: /prevencion/capacitacion
Endpoint: recordTrainingOccurrenceStatusAction, POST /api/prevencion/capacitacion/evidence
Rol: cualquiera con training:record
Descripción: el listado oculta las pendientes obsoletas ✅, pero el script no se aplicó y el servicio no rechaza una casilla fuera del catálogo.
Evidencia: DEMOSTRADO. SQL en B: 91 pendientes (13 por faena: CAP-02 m03-w2 y m04-w3, CAM-05 annual…); en A, 0. Subida a CAP-02 m03-w2 → 201; server action reescrita a ese id → «Capacitación marcada como hecha.» → N°54 2026-3-w2 approved sin planificado.
Cómo reproducir: subir evidencia por API a training-occurrence-2026-ws-horcones-cap-02-m03-w2 y reescribir el occurrenceId de la acción.
Resultado actual: acreditación sin plan (requiere una petición manipulada).
Resultado esperado: rechazo en el servicio y datos retirados.
Impacto: bajo con la UI normal; residuo en producción si se sembró antes del 23-09.
Causa probable: la corrección sólo filtró la lectura.
Solución recomendada: validar trainingCatalogSlotKeysForYear en record/upload; aplicar el script en el deploy (dry-run antes).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-08
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación (y Alcotest con archivo)
Categoría: Segregación / Integración
Título: El cumplimiento de capacitación se autoaprueba sin segunda persona y con cualquier archivo de un tipo permitido
Archivo(s): lib/services/pdtp/accreditation.ts; prevention-training-occurrences.ts
Línea(s): accreditation.ts:523-526 (capacitacion_ocurrencia «incondicional») y 619-622; occurrences.ts:422 (autoApproveByUserId = actor)
Pantalla/ruta: /prevencion/capacitacion, /prevencion/alcotest
Endpoint: —
Rol: prevencionista_faena
Descripción: ejecutor = aprobador en todas las ejecuciones de capacitación y en las de alcotest con archivo. La evidencia de capacitación no se verifica con verifyIntegrationEvidence ni guarda su sha en la ejecución (basta que el archivo exista).
Evidencia: DEMOSTRADO (B: 9 ejecuciones «approved» con executed_by = approved_by = qa.prevfaena) + CÓDIGO.
Cómo reproducir: marcar hecha cualquier ocurrencia y consultar pdtp_executions.
Resultado actual: el grueso de la actividad del programa no pasa por ninguna revisión.
Resultado esperado: decisión de negocio explícita (muestreo, revisión por lote o autoaprobación documentada) y verificación de dominio y sha como en alcotest.
Impacto: ante una fiscalización, «cumplido» descansa sólo en quien registró.
Causa probable: se consideró el cierre de la ocurrencia como validación completa.
Solución recomendada: sumar capacitacion_ocurrencia a VERIFIERS; evaluar una revisión por muestreo.
Esfuerzo: Bajo–Medio
Bloquea producción: No
Clasificación: B (decisión de negocio)
```

```
ID: CAP-09
Severidad: 🟡 IMPORTANTE
Submódulo: Capacitación
Categoría: Funcionalidad / UX
Título: «Marcar hecha» desde «No aplica» es un callejón sin salida
Archivo(s): training-occurrence-list.tsx; prevention-training-occurrences.ts
Línea(s): list.tsx:271-273 y 416-419; service :743-745 (sin evidencia en NA) y :545-547 (hecha exige evidencia)
Pantalla/ruta: /prevencion/capacitacion
Endpoint: POST /api/prevencion/capacitacion/evidence
Rol: prevencionista_faena
Descripción: el botón se ofrece, pero la subida se rechaza con «no admite evidencia» y sin evidencia no hay «hecha».
Evidencia: DEMOSTRADO (B: CAP-24 m09-w3 → toast de error; el diálogo sigue abierto).
Cómo reproducir: sobre una tarjeta «No aplica» → Marcar hecha + PDF.
Resultado actual: hay que pasar por «no hecha», lo que escribe un not_performed espurio.
Resultado esperado: permitir el paso NA→hecha (subida admitida en ese flujo) o no ofrecer el botón.
Impacto: correcciones que dejan historial falso.
Causa probable: dos reglas correctas por separado que chocan.
Solución recomendada: permitir la evidencia cuando el destino es «hecha».
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

Hallazgos 🔵 y ⚪ de Capacitación:

| ID | Sev. | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|---|
| CAP-10 | 🔵 | M-22 residual: 13 bindings `capacitacion` a cursos `trc-*` retirados siguen activos en B, y las configuraciones de N°16/37/38/51/53/57/59/60 apuntan a ellos; `pdtpConnectorAcceptsFulfillmentSource` descarta la fuente si `bindingSourceType≠sourceType`, así que si se materializan instancias nunca se enlazarán | `connectors.ts:264`; `fulfillment.ts:293-356` | SQL (B) + CÓDIGO; no hay instancias en B → latente | Migrar las configuraciones a `capacitacion_ocurrencia` y desactivar los bindings | Bajo |
| CAP-11 | 🔵 | Excel: fechas UTC crudas («2026-09-29 21:21:01.074+00»); «Tipo: Curso» (la UI dice «Capacitación»); no exporta quién declaró NA/no hecha ni el estado de revisión; prevencionista_faena no puede exportar su faena | `prevention-training-export.ts:54,104`; `manifest.ts:994-995` | DEMOSTRADO (xlsx parseado) | `formatDateTime` en Chile y columnas de actor | Bajo |
| CAP-12 | 🔵 | La tarjeta NA/no hecha no muestra quién ni cuándo (existe `notApplicableByUserId`; el actor de «no hecha» sólo está en `audit_log`) | `list.tsx:316-329`; `service:554-563` | CÓDIGO + captura | Guardar y mostrar el actor | Bajo |
| CAP-13 | 🔵 | Extensión tomada del nombre del cliente (PNG llamado `x.html` se guarda como `.html`); en Campañas sí se corrigió (M-21) | `prevention-documents/utils.ts:230-233` | DEMOSTRADO (201 con `.html`); mitigado por `Content-Type`+`nosniff` | Extensión según el MIME | Bajo |
| CAP-14 | 🔵 | N°57 hecha no deja ningún rastro en el PDTP (sólo `reportSubjectObligation`, sin obligación abierta) | `occurrence-gap-connector.ts:265-285` | DEMOSTRADO (CAP-20 hecha: 0 ejecuciones, 0 obligaciones) | Registrar la evidencia en el PDTP o mostrarla en la hoja | Bajo |
| CAP-15 | ⚪ | Badge en plural en cada tarjeta («PENDIENTES», «HECHAS», «No aplican») | `training-occurrence-list.tsx:56-66` | Captura | Rótulos en singular | Bajo |
| CAP-16 | ⚪ | Jerga interna («programa-capacitacion-2026-v1»), «Programa» con aspecto de campo sin selector de año, títulos CAP-22…26 kilométricos | `list.tsx:175-183`; `catalog:525-571` | Captura | Título corto + «charla n de 5» visible | Bajo |
| CAP-17 | ⚪ | El breadcrumb de `loading.tsx` difiere del de la página | `loading.tsx:10-13` vs `page.tsx:57-61` | CÓDIGO | Unificar | Bajo |

### I. Readiness individual: **61/100** — No listo
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16 | CAP-01 −3, CAP-02 −2,5, CAP-06 −1,5, CAP-07 −1, CAP-09 −1 |
| UI/UX | 20 | 12 | CAP-03 −6, CAP-05 −1, CAP-12 −0,5, CAP-15/16/17 −0,5 |
| Integridad de datos | 15 | 8 | CAP-01 −2,5, CAP-02 −2, CAP-04 −1,5, CAP-07 −1 |
| Integración PDTP | 15 | 7 | CAP-01 −2, CAP-02 −2, CAP-04 −1, CAP-05 −1, CAP-08 −1, CAP-10 −0,5, CAP-14 −0,5 |
| Código | 10 | 7,5 | CAP-07 −1, CAP-06 −0,5, CAP-10 −0,5, CAP-13 −0,5 |
| Permisos y seguridad | 5 | 4,25 | CAP-06 −0,5, CAP-13 −0,25 |
| Testing | 5 | 3 | E2E sólo de humo −1; sin regresión para CAP-01/02/05 −1 |
| Manejo de errores | 5 | 3,5 | CAP-04 −1, CAP-09 −0,5 |

---

## AUDITORÍA — Alcotest (`/prevencion/alcotest`)

**Rutas:**
- `/prevencion/alcotest`
- APIs: `POST /api/prevencion/alcotest/evidence` y `GET …/evidence/[name]`

**Archivos principales:**
- `app/(app)/prevencion/alcotest/{page,actions,alcotest-workbench,slot-selection}.tsx`
- `lib/services/prevention-alcotest.ts`, `prevention-alcotest-slots.ts`
- `lib/validation/prevention-module/alcotest.ts`
- `lib/prevention/program-slots-2026.ts` (N°30 PRF / N°31 Sup-JT / N°32)

**Permisos** (`manifest.ts:688-702`):
- `view`/`register`: prevencionista, prevencionista_faena, admin_contrato, supervisor_terreno, jefe_terreno y administrador.
- `dispatch`: prevencionista, prevencionista_faena y administrador.
- En B, jefa_chome no tiene permisos de alcotest → `/forbidden`.

### A. UI/UX/Diseño
- Página simple: `PageHeader` con dos acciones, tres secciones (controles recientes, envíos, casillas del programa) y ningún KPI.
- Sin desborde a 1440/1024/768/390. A 390 el diálogo «Registrar control» tiene scroll interno (845/760 px) y el botón queda bajo el pliegue.
- **Fricciones (CAP-25):**
  - la casilla por defecto es «Ninguna (control extraordinario)»: el camino por defecto no cumple la casilla;
  - «Controles recientes» mezcla todas las faenas aunque el selector diga otra;
  - no hay selector de año;
  - `datetime-local` nativo con un helper local, en vez de `toLocalInputValue`;
  - los meses aparecen abreviados en el selector («Sep · semana 3») y completos en la lista.
- **La casilla muestra «1 evidencia adjunta» sin enlace**, y ninguna pantalla enlaza la descarga (CAP-22).
- **Estados observados:** sin información (A), con información, error del servidor (`role=alert`), NA futuro rechazado (mensaje visible en el diálogo) y permisos insuficientes (jefa y `ti` → `/forbidden`). No observado: cargando.

### Facilidad de uso
- **Registrar un control con casilla y archivo: 8 clics** — Registrar control, persona (2), casilla (2), archivo (2) y Registrar.
- **Envío mensual: 10 clics.**
- El administrador completa todo el formulario y recién al final recibe «Tu rol no está habilitado…» (CAP-21).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Control con casilla y archivo (PRF) | ✅ | N°30 2026-9-w3 `approved`/`provided` |
| Control (Sup/JT) | ✅ | N°31 por rol (sup y jt) |
| Control extraordinario sin casilla | ✅ | N°30/31 `submitted`, `evidenceRejection=wrong_domain` |
| Con archivo borrado del disco (PRV-01) | ✅ | Cholguan: `submitted`, `file_missing`; la aprobación exige motivo |
| Autoaprobación del propio registrante (PRV-02) | ✅ | prev → «Quien registró el cumplimiento no puede aprobarlo»; prev2 aprueba con motivo, `evidenceStatus` sigue `pending` |
| Casilla de una semana futura | 🔴 | CAP-01 |
| Casilla compartida N°30/N°31 | 🔴 | CAP-20 |
| Envío mensual (N°32) | 🟡 | Mes en curso rechazado ✅; mes/casilla no se cotejan; envío con 0 controles acredita (CAP-23) |
| NA / no hecha de casilla | 🟡 | Futuro rechazado ✅; NA de admin sin desvío; NA sólo sobre la actividad del rol (CAP-20) |
| Anular o corregir un control | ❌ | No existe (CAP-24) |
| Evidencia: carga, MIME y tamaño; descarga con alcance | ✅ | `.exe` → 400, 26 MB → 413, otra faena → 400/404, `ti`/`cphs` → 403 |
| IDOR sobre la acción de casilla | ✅ | otrafaena reescribe `slotId` → rechazado (mensaje engañoso «Actividad PDTP no encontrada…») |

### C. Código y lógica
- `listAlcoholTests` y `listAlcoholTestDispatches` cargan la tabla entera y filtran en JS (`prevention-alcotest.ts:232-236,352-355`).
- La columna `alcohol_tests.evidence_url` está muerta: zod descarta `evidenceUrl` (`validation/alcotest.ts:3-32`).
- `performedAt: z.string().min(1)` acepta cualquier fecha (`:6`).
- Mensajes de alcance engañosos: reutiliza `assertWorksiteAccess` del PDTP.
- A favor: gate de evidencia en la transacción, historial de módulo y sha calculado en el servidor.

### D. Modelo de datos
- `alcohol_tests` no tiene estado ni anulación.
- `prevention_alcotest_slots.test_id`/`dispatch_id` son texto sin FK.
- Hay una sola serie de 12 casillas de control para dos actividades de 12 celdas cada una (CAP-20).
- Queda evidencia huérfana activa en las casillas (m06-w3 por el administrador).

### E. Permisos y seguridad
- Alcance por faena correcto en carga, descarga, acción y registro (demostrado).
- Incoherencia: administrador y admin_contrato tienen `register` pero ninguna actividad (CAP-21). La lista de «dispatch» usa `canDispatch`, mientras la acción de casilla exige `register`.

### F. Testing
- `prevention-alcotest.test.ts`, `slot-selection.test.ts`, `validation/alcotest.test.ts` y `pdtp-slot-deviation-propagation.test.ts` pasan (incluidos en los totales de arriba).
- No hay E2E de alcotest.
- Sin pruebas de casilla futura, de casilla compartida entre PRF y Sup ni de cotejo mes/casilla.

### G. Integración con el Programa Anual
- Acredita N°30 (PRF), N°31 (Sup/JT) según el rol, y N°32 con el envío. La celda es la de la casilla.
- **Con archivo verificado:** se autoaprueba, con el mismo registrante como aprobador.
- **Sin archivo, o con archivo inexistente:** queda `submitted` y otra persona aprueba con motivo. ✅ PRV-01 y PRV-02.
- **Archivo de otra faena:** no se puede inyectar. `evidenceRef` sale de la casilla (`fulfillAlcotestSlotTx` exige la misma faena) y `evidenceUrl` se descarta (CÓDIGO).
- No hay revocación posible, porque no hay anulación (CAP-24).

### H. Hallazgos

```
ID: CAP-20
Severidad: 🟡 IMPORTANTE
Submódulo: Alcotest
Categoría: Integración PDTP / Reglas de negocio
Título: Una sola serie de 12 casillas para dos actividades (N°30 y N°31, 24 celdas planificadas)
Archivo(s): lib/prevention/program-slots-2026.ts; prevention-alcotest-slots.ts; prevention-program-slots.ts
Línea(s): program-slots-2026.ts:33-56 y 103-112; alcotest-slots.ts:204-223 (declareOn por rol) y 255-257; workbench:262
Pantalla/ruta: /prevencion/alcotest
Endpoint: recordAlcoholTestAction, recordAlcotestSlotStatusAction
Rol: prevencionista_faena, supervisor_terreno, jefe_terreno, administrador
Descripción: al cumplir el PRF la casilla, el Sup ya no puede ligar su control (N°31 queda extraordinario → submitted, requiere aprobación con motivo y cae en la semana real). El NA o «no hecha» de la casilla se escribe sólo sobre la actividad del rol que declara, aunque la casilla quede «No aplica» para ambos; el administrador no escribe ninguno.
Evidencia: DEMOSTRADO (B). Horcones m09-w3 cumplida por prevfaena → el control de sup queda sin casilla (N°31 2026-9-w4 submitted). NA de prev en Masisa m09-w3 → sólo N°30 pending_review. NA de admin en Teno m09-w3 → ningún desvío y sin aviso.
Cómo reproducir: ver alcops.mjs y alc-state.sh.
Resultado actual: la N°31 casi nunca puede cumplirse por casilla, y el NA se declara a medias.
Resultado esperado: una casilla por actividad (control PRF y control Sup/JT), o un estado por actividad.
Impacto: la N°31 (12 celdas) queda crónicamente incumplida o en revisión manual.
Causa probable: el modelo supuso un control por mes.
Solución recomendada: sembrar 12+12 casillas (kind control_prf / control_supjt), o un estado por actividad.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-21
Severidad: 🟡 IMPORTANTE
Submódulo: Alcotest
Categoría: Permisos / UX / Integridad
Título: administrador y admin_contrato pueden abrir y completar «Registrar control», pero su rol no mapea a ninguna actividad: falla al final y deja evidencia huérfana
Archivo(s): modules/prevention/manifest.ts; prevention-alcotest.ts; alcotest-workbench.tsx
Línea(s): manifest.ts:694,701; alcotest.ts:117-120; workbench.tsx:304-315 (sube antes de registrar)
Pantalla/ruta: /prevencion/alcotest
Endpoint: POST /api/prevencion/alcotest/evidence, recordAlcoholTestAction
Rol: administrador, admin_contrato
Descripción: el botón se muestra por permiso; el servicio rechaza por rol después de que el archivo ya quedó activo en la casilla.
Evidencia: DEMOSTRADO (B: admin, casilla jun w3 + PDF → «Tu rol no está habilitado…»; la casilla m06-w3 queda pending con 1 evidencia activa).
Cómo reproducir: como admin, Registrar control con casilla y archivo.
Resultado actual: trabajo perdido y evidencia sin hecho.
Resultado esperado: coherencia entre permiso y rol (quitar register o mapear a una actividad) y validar antes de subir.
Impacto: confusión y basura en las casillas; la evidencia huérfana permite después cumplir la casilla sin subir nada.
Causa probable: el permiso y la regla por rol viven en lugares distintos.
Solución recomendada: ocultar el botón si resolveAlcotestActivityNumber(roles) es null; pre-validar el rol en la ruta de subida.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-22
Severidad: 🟡 IMPORTANTE
Submódulo: Alcotest
Categoría: Evidencia / Trazabilidad
Título: La evidencia de alcotest no se puede abrir desde ninguna pantalla
Archivo(s): components/prevention/program-slot-list.tsx; lib/services/pdtp/evidence-href.ts; app/(app)/prevencion/pdtp/pdtp-evidence-thumbs.tsx
Línea(s): program-slot-list.tsx:138-143 (sólo el conteo); evidence-href.ts:35-39 (sin prevention-alcotest-evidence); thumbs:64-72 (chip «En el módulo de origen» sin enlace)
Pantalla/ruta: /prevencion/alcotest, /prevencion/pdtp/aprobaciones
Endpoint: GET /api/prevencion/alcotest/evidence/[name] (existe, sin ningún enlace: grep)
Rol: revisores y fiscalización interna
Descripción: quien revisa un N°30/31/32 submitted no puede ver el archivo; el PDTP lo manda al «módulo de origen», y ese módulo no lo muestra.
Evidencia: DEMOSTRADO (captura alco-full-prev-cholguan.png: «1 evidencia adjunta» sin enlace) + CÓDIGO (el único uso de la ruta en la UI es el POST, workbench.tsx:71).
Cómo reproducir: registrar un control con archivo y buscar cómo abrirlo.
Resultado actual: evidencia existente pero no consultable.
Resultado esperado: enlaces de descarga en la casilla y mapeo en evidence-href (como higiene, CGRD y campañas).
Impacto: la revisión sin evidencia visible vacía de sentido PRV-02; fiscalización más lenta.
Causa probable: PRV-21 mapeó sólo tres dominios.
Solución recomendada: agregar el prefijo a MODULE_DOWNLOAD_ROUTES (y el de capacitación) y listar los archivos en la casilla.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```
ID: CAP-23
Severidad: 🟡 IMPORTANTE
Submódulo: Alcotest
Categoría: Validaciones / Integridad
Título: No se cotejan la casilla, el período y la fecha: envío de julio en la casilla de diciembre, control fechado en 2027, envío de 0 controles
Archivo(s): lib/validation/prevention-module/alcotest.ts; prevention-alcotest.ts; prevention-alcotest-slots.ts
Línea(s): validation :6 (performedAt libre); alcotest.ts:255-347 (sin cotejo mes vs casilla; testCount 0 permitido); slots.ts:239-265
Pantalla/ruta: /prevencion/alcotest
Endpoint: recordAlcoholTestAction, recordAlcoholTestDispatchAction
Rol: prevencionista_faena
Descripción: el servidor acepta cualquier combinación de mes del envío y casilla, y cualquier performedAt.
Evidencia: DEMOSTRADO (B). Envío de julio en la casilla «Dic · semana 1» → casilla de diciembre «Hecha» y N°32 2026-12-w1 approved. Control con performedAt 2027-03-15 guardado y listado primero (acreditación rechazada en silencio). Envíos de agosto y julio con test_count 0 acreditan la N°32.
Cómo reproducir: diálogo «Enviar registros del mes»: Mes = Jul, Casilla = Dic.
Resultado actual: registros incoherentes que acreditan.
Resultado esperado: la casilla de envío corresponde al mes siguiente al período declarado; performedAt ≤ ahora; advertencia o confirmación con 0 controles.
Impacto: cumplimiento en la celda equivocada y datos inverosímiles.
Causa probable: validación sólo en el cliente (selector libre).
Solución recomendada: validar en el servicio; derivar la casilla del período.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CAP-24
Severidad: 🟡 IMPORTANTE
Submódulo: Alcotest
Categoría: Funcionalidad / CRUD con relaciones
Título: Un control o envío registrado no se puede anular ni corregir; la casilla y la acreditación quedan fijas
Archivo(s): lib/services/prevention-alcotest*.ts; db/schema/prevention/alcotest.ts
Línea(s): alcotest-slots.ts:154-164 (una casilla cumplida no se corrige; «deshacerlo es desvincularlo», pero no existe ese desvincular); schema :20-48 (sin estado)
Pantalla/ruta: /prevencion/alcotest
Endpoint: —
Rol: todos
Descripción: un control con persona o resultado equivocado (p. ej. «positivo» por error) o ligado a la casilla equivocada no tiene vía de corrección ni de revocación del PDTP.
Evidencia: CÓDIGO (grep sin annul/unlink/revoc) + DEMOSTRADO (las casillas cumplidas no ofrecen acciones).
Cómo reproducir: registrar un control en la casilla equivocada y buscar cómo corregirlo.
Resultado actual: el error queda permanente y acreditado.
Resultado esperado: anulación con motivo que libere la casilla y llame a recordPdtpFulfillmentRevocation (patrón de CGRD).
Impacto: datos personales sensibles (resultado positivo) incorregibles; cumplimiento que no se sostiene.
Causa probable: el alcance inicial sólo cubrió el alta.
Solución recomendada: implementar annulAlcoholTest/annulDispatch con revocación y auditoría.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

Hallazgos 🔵 de Alcotest:

| ID | Sev. | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|---|
| CAP-25 | 🔵 | Casilla por defecto «Ninguna»; «Controles recientes» de todas las faenas; sin año; `datetime-local` con helper duplicado; meses abreviados en el selector | `alcotest-workbench.tsx:53-57,116-145,253,362-370` | Captura | Preseleccionar la casilla del mes; filtrar la lista por la faena | Bajo |
| CAP-26 | 🔵 | Consultas de tabla completa filtradas en JS; columna `evidence_url` muerta; mensaje de alcance «Actividad PDTP no encontrada» en alcotest | `prevention-alcotest.ts:229-237,349-356` | CÓDIGO + DEMOSTRADO (mensaje) | `WHERE` en SQL + límite; mensaje propio | Bajo |
| CAP-13 | 🔵 | También aplica aquí: PNG llamado `.html` se guarda como `.html` | `alcotest-slots.ts:465` | DEMOSTRADO | Extensión según el MIME | Bajo |

### I. Readiness individual: **64/100** — No listo
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 14 | CAP-20 −3,5, CAP-01 −2, CAP-23 −2, CAP-24 −2, CAP-21 −1,5 |
| UI/UX | 20 | 14,5 | CAP-22 −2, CAP-25 −2, CAP-21 −1, CAP-05 −0,5 |
| Integridad | 15 | 8 | CAP-01 −2, CAP-23 −2, CAP-24 −1,5, CAP-20 −1, CAP-21 −0,5 |
| Integración PDTP | 15 | 9 | CAP-20 −3, CAP-01 −2, CAP-05 −0,5, CAP-08 −0,5 |
| Código | 10 | 8,5 | CAP-26 −1, CAP-25 −0,5 |
| Permisos y seguridad | 5 | 4 | CAP-21 −1 |
| Testing | 5 | 3 | Sin E2E −1,5; sin pruebas de casilla futura o compartida −0,5 |
| Manejo de errores | 5 | 3,5 | CAP-20 (NA de admin sin aviso) −1, CAP-23 (control 2027 sin aviso) −0,5 |

---

## AUDITORÍA — Campañas, registro histórico (`/prevencion/campanas`)

**Rutas:**
- `/prevencion/campanas`, que **no está en el menú**; se llega por URL directa y el conector PDTP `campaigns` apunta a ella (`connectors.ts:106`)
- APIs: `POST /api/prevencion/campanas/evidence` y `GET …/[name]`

**Archivos principales:**
- `app/(app)/prevencion/campanas/{page,actions,campanas-client}.tsx`
- `lib/services/prevention-campaigns.ts`

**Permisos:** `campaign:view`/`manage` para prevencionista, prevencionista_faena, admin_contrato y administrador.

### A. UI/UX/Diseño
- **Confunde con Capacitación (CAP-30).**
  - Tabla con **35 campañas legado «Pendiente»** en B (5 por faena: CAMP-HORCONES-CIEGOS/VIAL/ALCOHOL/ESTRES/VIDA), que son las mismas N°85–89 que viven como CAM-* en Capacitación.
  - Cada fila ofrece un botón primario verde «Marcar como hecha» y un selector «Actividad PDTP» editable que ya no tiene ningún efecto.
  - Un `Callout` y la descripción del diálogo sí advierten que no acredita (PREV-I10).
- **Detalles de navegación y estilo (CAP-32):**
  - la búsqueda del TopBar no filtra (5→5 filas, DEMOSTRADO);
  - el menú marca **«Evaluaciones SST»** como activo (`nav-items.ts:183-188`, DEMOSTRADO con `aria-current`);
  - sin breadcrumb;
  - jerga «(R9)»;
  - botón con clase local `bg-[var(--color-success-ink)]`, contra la regla de `AGENTS.md`;
  - un rol sin permiso termina en `/prevencion` en vez de `/forbidden`.
- Responsive: sin desborde a 1440/1024/768/390.
- **Estados observados:** con información, operación exitosa (fila «Hecha»), permisos insuficientes (`ti` → `/forbidden`; jefa → `/prevencion`). No observados: vacío, error y cargando.

### Facilidad de uso
- Cerrar una campaña: 5 clics (Marcar como hecha, abrir fecha, elegir día, elegir archivo, Confirmar cierre).
- El problema no es cuántos clics cuesta: es que la acción no sirve al programa.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear campaña | ❌ (a propósito) | `createCampaignAction` devuelve error de dominio (`actions.ts:161-173`) |
| Cerrar con fecha y evidencia | ✅ | CAMP-HORCONES-VIDA → `done`, `held_on` 2026-09-25, 0 ejecuciones PDTP, evento `campaign_closed` `pending` |
| Cambiar la actividad PDTP | 🟡 | Persiste, sin efecto (CAP-30) |
| Evidencia (MIME, extensión por MIME, alcance) | ✅ | `.exe` → 400; PNG `.html` → guardado `.png` (M-21 ✅); otra faena → 404; sufijo parcial → 404 (PRV-18 ✅) |

### C–F.
- **Código:**
  - quedan `createCampaign` y `setCampaignPdtpActivities`, y `pdtpAccredited`/`pdtpPending` siempre valen `false` (`prevention-campaigns.ts:217-220`);
  - `closeCampaign` no es transaccional: reclama la evidencia y actualiza por separado, sin `status` en el `WHERE` (`:164-176`) (CAP-31);
  - la subida no pre-chequea `content-length` (`campanas/evidence/route.ts:27-42`).
- **Modelo:** 35 bindings `campana` activos sin consumidor.
- **Permisos:** correctos.
- **Testing:** `prevention-campaigns.test.ts` y `campanas-client.test.tsx` pasan, incluido el caso de no doble conteo; no hay E2E.

### G. Integración con el Programa Anual
- No acredita, y **no debe**: la N°85–89 se acredita por CAM-* y así no hay doble conteo (probado en `prevention-campaigns.test.ts:422-423`).
- **Relación indirecta débil:**
  - las 35 pendientes duplican trabajo que en realidad se exige en Capacitación: cerrar la legado no mueve el PDTP;
  - el evento `campaign_closed` queda `pending` sin consumidor;
  - el conector `campaigns` sigue declarado con `moduleHref=/prevencion/campanas`.

### H. Hallazgos
```
ID: CAP-30
Severidad: 🟡 IMPORTANTE
Submódulo: Campañas (registro histórico)
Categoría: UX / Integración indirecta
Título: La pantalla legado ofrece como pendientes 35 campañas que duplican las CAM-* y un selector de actividad PDTP sin efecto
Archivo(s): app/(app)/prevencion/campanas/campanas-client.tsx; lib/services/prevention-campaigns.ts; lib/services/pdtp/connectors.ts
Línea(s): client.tsx:173-195 (selector y botón primario); service :109-127 (setCampaignPdtpActivities vivo) y 217-220; connectors.ts:105-112
Pantalla/ruta: /prevencion/campanas
Endpoint: closeCampaignAction, setCampaignPdtpActivitiesAction
Rol: prevencionista, prevencionista_faena
Descripción: la ruta sigue alcanzable (URL directa y conector) y presenta trabajo «pendiente» que no cuenta para el programa.
Evidencia: DEMOSTRADO (B: 35 pendientes; cierre de CAMP-HORCONES-VIDA sin ejecución PDTP; la búsqueda del TopBar no filtra; aria-current = «Evaluaciones SST»).
Cómo reproducir: abrir /prevencion/campanas como prevfaena.
Resultado actual: riesgo de dar la N°85–89 por hecha cerrando la legado, mientras la CAM-* sigue pendiente (lo mitiga el aviso).
Resultado esperado: sólo lectura (sin «pendiente», sin selector) o retirar la ruta y el conector; migrar o archivar las 35.
Impacto: doble registro aparente y confusión entre dos pantallas de campañas.
Causa probable: se conservó el cierre para las legado de dev.
Solución recomendada: vista histórica de sólo lectura y archivado de las pendientes.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```
| ID | Sev. | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|---|
| CAP-31 | 🔵 | Cierre no transaccional (carrera de doble cierre); subida sin tope previo de `content-length` | `prevention-campaigns.ts:156-178`; `evidence/route.ts:27-42` | CÓDIGO | Transacción + `WHERE status='pending'` | Bajo |
| CAP-32 | ⚪ | La búsqueda del TopBar no filtra; el menú activa «Evaluaciones SST»; sin breadcrumb; «(R9)»; botón con clase local; sin permiso → `/prevencion` | `campanas-client.tsx:107-115,187-189`; `nav-items.ts:183-188`; `page.tsx:21-23` | DEMOSTRADO | Patrones de `AGENTS.md` | Bajo |

### I. Readiness individual: **79/100** — Funcional, requiere correcciones
La integración se puntúa por la calidad de la relación indirecta, porque no debe acreditar.

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 21 | CAP-30 −3, CAP-31 −1 |
| UI/UX | 20 | 12,5 | CAP-30 −5, CAP-32 −2,5 |
| Integridad | 15 | 13 | CAP-31 −1, CAP-30 (bindings vivos) −1 |
| Integración (indirecta) | 15 | 12 | CAP-30 −3 |
| Código | 10 | 8 | CAP-30 (código muerto) −1,5, CAP-31 −0,5 |
| Permisos | 5 | 4,5 | CAP-32 −0,5 |
| Testing | 5 | 4 | Sin E2E −1 |
| Errores | 5 | 4,5 | CAP-32 −0,5 |

---

## Estado de hallazgos previos en este alcance
| ID | Dictamen | Evidencia propia |
|---|---|---|
| PRV-01 (alcotest) | **Corregido (verificado)** | Archivo borrado → `submitted`/`file_missing`; `evidenceUrl` descartado; otra faena bloqueada por la casilla. Resto: la verificación exige la misma faena, no la misma casilla (`integration-evidence.ts:84-89`) |
| PRV-02 (alcotest/integración) | **Corregido (verificado)** | Autoaprobación rechazada; la aprobación exige motivo; `evidenceStatus` sigue `pending`. La autoaprobación con archivo por el mismo registrante sigue abierta por diseño (CAP-08) |
| PRV-03 | **Sigue abierto por la vía de integración** | Capacitación y alcotest aprueban celdas futuras (CAP-01) |
| PRV-06 | **Parcial** | El listado filtra; 91 obsoletas en B; script sin aplicar; el servicio las acepta (CAP-07) |
| PRV-16 | **Parcial** | Semana futura y mes cerrado sobre casilla pendiente: error visible ✅. Hecha→NA, celda con ejecución, rol sin actividad y rechazo en revisión: silencio (CAP-04/05/20) |
| PRV-18 (campañas) | **Corregido (verificado)** | Sufijo parcial → 404; otra faena → 404 |
| M-01 | **Corregido**, pero la tarjeta no refleja la revisión (CAP-05) | El texto del diálogo dice «queda en revisión» |
| M-21 | **Corregido en Campañas (verificado)**; el mismo patrón sigue en Capacitación y Alcotest (CAP-13) | PNG `.html` → `.png` en campañas y `.html` en los otros dos |
| M-22 | **Parcial** | Código muerto retirado; 13 bindings y 8 configuraciones a cursos retirados siguen en B (CAP-10) |
| PRV-04 (capacitación) | **Corregido (verificado)** | Hecha→no hecha/NA → ejecución `draft` + evento `revoked`. En alcotest no hay anulación posible (CAP-24) |

## Qué no se pudo verificar y por qué
- **Estado «Cargando»:** existe `loading.tsx`, pero no llegué a observarlo en navegador.
- **Mes cerrado en B:** no cerré meses en B para no bloquear a otros agentes. Lo probé en PGlite (P1–P4).
- **Instancias programadas:** no hay en B, así que el efecto real de CAP-10 no fue ejecutable.
- **Consumidor del evento `campaign_closed`:** sólo vi que queda `pending`.
- **Transición anual 2026→2027:** el catálogo 2027 es una copia congelada del 2026 y no se deriva del programa 2027. Riesgo teórico; no lo ejecuté.
- **No ejecutado:** WebKit, lector de pantalla, red lenta real (el documento de 20 MB se midió en localhost) y `prevention:retire-obsolete-training-occurrences --apply`, porque B no es mía.
- **E2E:** no corrí Playwright test (prohibido por el brief); leí las specs.

**Repositorio:** mi archivo temporal `lib/__tests__/capacitacion-closed-month.audit-tmp.test.ts` quedó copiado en mi carpeta y borrado del repo. `git status` muestra además `lib/__tests__/documental-integration.audit-tmp.test.ts`, `lib/__tests__/inspecciones-compliance.audit-tmp.test.ts` y `.claude/settings.local.json`, que no son míos.
