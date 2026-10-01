# Auditoría de production readiness — PDTP · Registro del cumplimiento (agente `pdtp-cumplimiento`, prefijo CUM-)

**Fecha:** 2026-09-29 · **HEAD:** `11e67621` (build de producción servido en :3100 y :3101) · **Modo:** diagnóstico, sin cambios de producto.

**Alcance:** camino **manual** del Programa Anual y su modelo de estados: planilla de actividades y registro de ejecución, Aprobaciones, actividades a demanda y por evento (obligaciones), Medidas y Constancias.

**Evidencia generada** (carpeta `scratchpad/audit/pdtp-cumplimiento/`):

| Archivo | Qué contiene |
|---|---|
| `pdtp-cumplimiento-e2e.audit-tmp.test.ts` | Copia de la prueba E2E temporal sobre PGlite con la capa de servicios real. Ya se borró del repo. |
| `pglite-e2e-log.txt`, `pglite-e2e-run.txt` | Salida: 17/17 pasos ejecutados y un log de 170 líneas, una por acción. |
| `flow1.mjs` … `flow9.mjs`, `probe*.mjs` | Recorridos de navegador en el entorno B con `prevfaena`, `sup`, `prev`, `prev2`, `jefa`, `otrafaena`, `ti` y `cphs`. |
| `flows.txt` | Salida de esos recorridos. |
| `flow7.mjs` | Pruebas HTTP de la evidencia. |
| `shots/*.png` | 70 capturas, a 1440, 1024, 768 y 390 px. |
| `tests-pglite.txt`, `tests-unit.txt` | Suites existentes: 188 PGlite y 162 unitarias, todas en PASS. |
| `files/` | Archivos de prueba: PDF válido, `.exe` renombrado, 0 bytes, 26,5 MB y PDF políglota. |

Los datos creados en B llevan el rótulo `QA_CUM`. No se cerró ningún mes en B; el cierre se probó sólo en PGlite.

---

## 0. Resumen

| Submódulo | Nota | Lectura |
|---|---:|---|
| 1. Planilla de actividades y registro de ejecución | **72** | Funcional, requiere correcciones |
| 2. Aprobaciones | **81** | Muy próximo |
| 3. A demanda y por evento (obligaciones) | **86** | Muy próximo |
| 4. Medidas | **85** | Muy próximo (cobertura parcial de la auditoría) |
| 5. Constancias | **86** | Muy próximo |
| Promedio simple | **82** | |

**Hallazgos:** 0 🔴 · 0 🟠 · 11 🟡 · 21 🔵 · 5 ⚪. Los números CUM-27 y CUM-28 no se usaron (se fundieron en CUM-11 y CUM-12).

**Qué funciona, verificado en servicio real y en navegador:**

- el ciclo manual «registrar con archivo → otra persona aprueba»;
- la segregación en ejecuciones, «no aplica», anulaciones, cancelaciones y reducciones de meta;
- la guarda de semanas futuras en el camino manual;
- el complemento por celda;
- el mes cerrado, que bloquea las siete escrituras probadas;
- la concurrencia (doble envío y doble aprobación);
- la evidencia: MIME por bytes, tamaño, sha256, faena y descarga con alcance;
- el indicador, que cuadra celda por celda.

**Dónde está el riesgo:**

- **reglas de estado que esconden el atraso:** CUM-01 y CUM-02;
- **datos declarados que cambian sin aviso:** CUM-03;
- **cifras distintas entre el diálogo y el indicador:** CUM-04;
- **controles que no funcionan o no informan:** CUM-05, CUM-06, CUM-07 y CUM-12;
- **historia que desaparece:** CUM-08;
- **una deuda que no se salda:** CUM-09;
- **integración aprobada a futuro** (CUM-10, referencia cruzada).

---

## 1. Prueba de punta a punta del camino manual (§24)

### 1.1 En PGlite con la capa de servicios real (A01–A10 re-corridos y ampliados)

- **Configuración:** programa `QA_CUM` 2026, activado el 05-01, 18 actividades y una faena. Cuatro usuarios: REG (registra), APR y APR2 (aprueban) y SUP (supervisor sin autoridad sobre la actividad).
- **Reloj fijo:** 29-09-2026 11:00, hora de Chile; es decir, septiembre, semana 4.
- **Servicios ejecutados:**
  - `markPdtpExecution`, `approvePdtpExecution`, `recordPdtpDeviation` y `reviewPdtpNotApplicable`;
  - `requestPdtpExecutionAnnulment`, `reviewPdtpReviewRequest` y `setPdtpActivityOverride`;
  - `createPdtpObligation`, `reportPdtpObligation`, `requestPdtpObligationCancellation` y `closePdtpPeriod`;
  - `scanPdtpEvidenceIntegrity`, `getPdtpComplianceIndicators` y `getPdtpSheetViewByProgram`/`pdtpSheetActivityStatus`.

| # | Caso | Acciones | Resultado observado | ¿Correcto? |
|---|---|---|---|---|
| C01 | Realizada | Registrar marzo con PDF → aprobar quien registró → APR y APR2 aprueban a la vez | «Quien registró el cumplimiento no puede aprobarlo»; una aprobación gana y la otra recibe «La ejecución ya fue aprobada.» | ✅ |
| C02 | Sin evidencia · solo texto · cantidad 0 | Tres envíos | Los dos primeros se rechazan («adjunta un archivo…»). **Cantidad 0 sin evidencia: aceptada y aprobada** (no suma) | ✅ / 🔵 CUM-13 |
| C03 | Recurrente mensual | Enero a agosto registrados y aprobados; septiembre sin registrar | Septiembre queda «Pendiente», no «Atrasada» | ✅ |
| C04 | No realizada | Motivo «no» → motivo válido → octubre (futuro) → **SUP** la declara sobre una actividad que no puede registrar | Motivo corto rechazado (zod, CHECK ≥ 10). Válido: `active`, con autor y fecha. Futuro rechazado. **SUP: `assertPdtpActorMayRegister` lo rechaza, pero `recordPdtpDeviation` acepta su «no realizada», y agosto pasa de «Atrasada» a «No programada»** | ✅ / 🟡 CUM-01 |
| C05 | No aplica | Declarar julio → ejecutar sobre la celda → autorrevisión → rechazo sin motivo → aprobación por APR → otros intentos | En revisión, sigue contando (44). La ejecución se bloquea («tiene un 'no aplica' en revisión»). Autorrevisión rechazada, también por el CHECK `reviewer_not_creator`. Rechazo sin motivo, rechazado. Aprobado: plan 44 → 43. Futuro, celda ejecutada y celda sin plan: rechazados | ✅ |
| C06 | Atrasada / parcial (PRV-07) | Agosto sin nada. Mayo con 4 semanas: aprobar una · aprobar una y enviar otra · aprobar una y declarar «no realizada» en la semana 2 | Agosto: «Atrasada · 1 mes». 1 de 4: «Atrasada». **1 de 4 más una enviada: «No programada». 1 de 4 más una «no realizada»: «No programada»** (en los dos casos quedan dos semanas sin nada) | ✅ / 🟡 CUM-02 |
| C07 | Futura (PRV-03) | Noviembre, octubre, septiembre semana 4; aprobar una futura legada | Noviembre y octubre rechazados («aún no ocurre»); la semana 4 se acepta; la aprobación futura se rechaza | ✅ |
| C08 | Múltiples en la misma celda (PRV-08) | Febrero, plan 4: 2 aprobadas → +2 (complemento) → aprobado por REG y luego por APR → +3 sobre la celda completa | Complemento `seq 2` en revisión; la autoaprobación se rechaza; aprobado. La sobre-ejecución `seq 3` se admite y se aprueba, pero se topa: febrero 5/5 | ✅ / 🔵 |
| C09 | Anulación de una aprobada (PRV-12) | Abril aprobado → pedir con motivo corto → pedir → segunda solicitud → autorrevisión → **el registrante la rechaza** → pedir de nuevo → APR2 aprueba → reenviar | Motivo corto rechazado; duplicada rechazada; autorrevisión rechazada. **El registrante rechaza la anulación de su propia ejecución.** Tras la aprobación de APR2: `rejected`, «Aprobación anulada: …»; abril 2/2 → 2/1; se puede reenviar. **Historial: `revoked` sin motivo** | ✅ / 🔵 CUM-14 / 🟡 CUM-12 |
| C10 | Reducción de meta y reprogramación (M-06) | Bajar marzo semana 2 de 4 a 2 → subirla a 6 mientras espera → autorrevisión → APR aprueba · Reprogramar agosto semana 2 a septiembre semana 4 → APR aprueba · Reprogramar «atrasada» a diciembre | La reducción queda en revisión y la subida se aplica al tiro (plan 45). Autorrevisión rechazada. Aprobada: **se aplicó 6 → 2, aunque la solicitud decía «de 4 a 2»**. La reprogramación queda en revisión y agosto sigue «Atrasada» mientras tanto; aprobada, agosto pasa de 3 a 2 y septiembre de 5 a 6. La reprogramación «para esconder el atraso» también queda en revisión | ✅ / 🔵 CUM-15 |
| C11 | Cuando corresponda (PRV-05) | Obligación manual → reportar solo con texto → con archivo → cancelar la reportada → aprobar REG → aprobar APR. Segunda obligación: pedir cancelación → **reportarla mientras espera** → autorrevisión → APR2 aprueba | Solo texto rechazado; cancelar la reportada, rechazado; la aprobación de REG, rechazada; APR: `completed`. En la segunda: la obligación sigue exigida; el reporte se acepta y **la aprobación de la cancelación falla («reportada…») y la solicitud queda colgada**. `listPdtpObligationsPage` sólo devuelve casos abiertos | ✅ / 🔵 CUM-16 / 🟡 CUM-08 |
| C12 | Evidencia borrada | Borrar el archivo antes de aprobar · aprobar y después borrarlo | Antes: la aprobación se bloquea («sin evidencia verificable»). Después: **sigue aprobada y contando**; el escaneo la reporta (`missing=2`) | ✅ / M-12 conocido |
| C13 | Doble envío y concurrencia | Dos `markPdtpExecution` simultáneos en la misma celda · otra persona sobre un pendiente | Una fila, historial `submitted→resubmitted`. La otra persona se rechaza («enviado por otra persona…») | ✅ |
| C14 | Mes cerrado | Cerrar enero con un pendiente → aprobar → cerrar → registrar, complementar, «no realizada», anular, subir y bajar meta, reprogramar hacia enero | El cierre con pendiente se rechaza; el cierre posterior funciona; **las siete escrituras se rechazan** con «El mes de enero de 2026 está cerrado…» | ✅ |
| C15 | Integridad | `DELETE` de una actividad cumplida · `UPDATE approved_by = executed_by` · `approved` sin aprobador · `rejected` sin motivo · aprobar con alcance de otra faena | `DELETE` rechazado (FK RESTRICT). **Los tres `UPDATE` se aceptan** (no hay CHECK). Otra faena: «sin acceso a la faena» | ✅ / 🔵 CUM-24 |

**Cifras del indicador (faena `QA_CUM`), verificadas a mano celda por celda**

| Momento | Anual (plan/ejec.) | A la fecha (hasta septiembre) | Qué cambió y por qué |
|---|---:|---:|---|
| Inicial | 44 / 0 | 40 / 0 | Plan = 1 + 12 + 1 + 1 + 1 + 4 × 3 + 1 + 4 + 1 + 4 + 1 + 1 + 2 + 1 + 1. Octubre a diciembre = 4 |
| «No aplica» de julio pendiente | 44 / 9 | 40 / 9 | 9 = realizada 1 + mensual 8. El pendiente no resta |
| «No aplica» aprobado | 43 / 9 | 39 / 9 | Julio 2 → 1 |
| Complemento y sobre-ejecución de febrero | 43 / 16 | 39 / 16 | Febrero: mínimo(2 + 2 + 3, 4) = 4 → 5/5 |
| Antes y después de anular abril | 43 / 17 → 43 / 16 | 39 / 17 → 39 / 16 | Abril 2/2 → 2/1 |
| Subida de meta con reducción pendiente | 45 / 16 | 41 / 16 | Marzo semana 2: 4 → 6 |
| Reducción aprobada | 41 / 16 | 37 / 16 | Marzo semana 2 queda en 2 (el salto real fue desde 6) |
| Reprogramación aprobada | 41 / 16 | 37 / 16 | Agosto 3 → 2, septiembre 5 → 6 |
| **Final** | **41 / 18** | **37 / 18 (49 %)** | Por mes: 2/2 5/5 4/2 2/1 13/4 2/1 1/1 2/1 6/1 1/0 2/0 1/0 |

En el total final, el septiembre semana 2 de `ev_borrada` suma 1 aunque su archivo ya no existe (M-12).

La suma a mano de las ejecuciones aprobadas y topadas da 18:

- mensual 8 (enero a agosto);
- cerrado 1 (enero);
- múltiple 4 (febrero, topado);
- realizada 1 (marzo);
- las tres parciales de mayo, 1 cada una;
- `ev_borrada` septiembre semana 2: 1.

No suman:

- la anulada de abril;
- la cantidad 0 de septiembre;
- las obligaciones, que no tienen plan.

### 1.2 En navegador (entorno B, programa 2026 v2 real, faena Horcones)

| # | Caso | Rol que registra → rol que aprueba | Acciones | Resultado | ¿Correcto? |
|---|---|---|---|---|---|
| N1 | Realizada | `prevfaena` → `prev` | N°28, septiembre semana 4, PDF | El diálogo ofrece sólo septiembre y las semanas 3–4 (activación del 17-09). Sin archivo: alerta «exige evidencia…». Con archivo: toast «Ejecución PDTP registrada.» (119 ms) y la fila queda «ENVIADA». En Aprobaciones basta 1 clic: «Ejecución de Sep semana 4 aprobada.»; la fila queda «APROBADA / EJECUTADO» | ✅ |
| N2 | Complemento (PRV-08) | `prevfaena` → `prev` y `prev2` | N°38 (plan 5): +2, aprobado; luego +3, aprobado | El diálogo dice «Registrar complemento · N°38» y «Esta semana ya tiene **1** de 5 aprobadas… se suma». En la base: integración 1 + manual 2 + manual 3; la celda cuenta máximo(5, 1) = 5; tras el primer +2 contaba 2, mientras el diálogo decía «3 de 5» | ✅ / 🟡 CUM-04 |
| N3 | Sobre-ejecución | `prevfaena` → `prev` (rechaza) | N°28 semana 4 (1/1) +1 | Se acepta (título «Registrar ejecución»). El rechazo desde Aprobaciones exige motivo ≥ 10; toast «devuelta al prevencionista». La planilla muestra «RECHAZADA» **sin el motivo** | ✅ / 🔵 |
| N4 | No aplica (Constancias) | `prevfaena` → `prev` | N°42, semana 4 | Toast «enviado a revisión…». Sigue «PENDIENTE» en Constancias mientras espera. Aprobado con 1 clic | ✅ |
| N5 | No aplica propio → rechazo | `prev` → `prev2` | N°6, semana 3 (desde la página del programa) | Su fila dice «Lo declaraste tú: lo revisa otra persona.», sin botones. `prev2` rechaza con motivo | ✅ |
| N6 | Reprogramación | `prev` → `prev2` | N°28, septiembre semana 3 → octubre semana 1 | En revisión y aprobada. **Toasts equivocados:** «Desvío registrado.» y «"No aplica" de N°28 aprobado.» | ✅ / 🔵 CUM-20 |
| N7 | No realizada sin autoridad | `sup` | N°17 (su cargo no es el responsable) | Sin botón «Registrar», pero con «Declarar desvío → No realizada». Toast «Desvío registrado.»; la fila queda «NO REALIZADA (CON MOTIVO)» | 🟡 CUM-01 |
| N8 | Anulación (PRV-12) | `prev` pide → `prev2` aprueba | N°28 semana 4 aprobada | Detalle → «Pedir anulación» → motivo → toast. **El botón sigue visible**; el segundo intento da «Ya hay una solicitud…». Tras aprobar: planilla «RECHAZADA»; detalle «REVERTIDO · QA_Prevencionista Dos», **sin motivo** | ✅ / 🟡 CUM-12 / 🔵 CUM-18 |
| N9 | Cuando corresponda (PRV-05) | `prevfaena` → `prev` | N°57: abrir caso, reportar con PDF, aprobar | El caso queda «Reportada». **«Ir a aprobación» lleva a `prevfaena` a `/forbidden`.** Aprobado → **el caso desaparece** y el filtro no ofrece «Completadas» | ✅ / 🟡 CUM-08 / 🔵 CUM-17 |
| N10 | Cancelación (PRV-05) | `prev` pide → `prev2` aprueba | Segundo caso N°57 | «Cancelación en revisión» y el caso sigue exigido. Aprobado → el caso desaparece | ✅ / 🟡 CUM-08 |
| N11 | Meta por faena (M-06) | `prev` | Botón «Fijar meta por faena» (N°6 y N°17) | **No abre ningún diálogo:** 0 diálogos tras clic, clic forzado y Enter | 🔴 función / 🟡 CUM-05 |
| N12 | Constancia «no se hizo» | `prevfaena` | N°6, semana 3 | Toast «Desvío registrado.». **Sigue «PENDIENTE» en Constancias y en `/pendientes`** | 🟡 CUM-09 |

**Clics:**

| Tarea | Clics | Detalle |
|---|---:|---|
| Registrar una actividad con evidencia | **3** | «Registrar», «Seleccionar archivo» más el selector del sistema, «Guardar ejecución». Mes, semana y cantidad vienen bien por defecto en la semana en curso |
| Aprobar | **1** | «✓ Sep · sem. 4», sin confirmación |
| Pedir una anulación | 3 | |
| Revisar una anulación | 1 | |
| Declarar «no aplica» | 3 | |
| Revisar un «no aplica» | 1 | |

**Cifras en B:** no se pueden verificar antes y después con confianza, porque otros diez agentes escriben en el mismo programa y en la misma faena. El tablero mostraba al cierre de la prueba «Ejecutadas 17 · 21 ejecuciones por aprobar →». La verificación a mano se hizo en PGlite (§1.1).

---

## 2. Modelo de cumplimiento (§21)

| Estado | Regla pedida | Backend (servicio) | Base de datos | UI | Veredicto |
|---|---|---|---|---|---|
| **Pendiente** | No se confunde con incumplimiento; una actividad cuya fecha no llegó sigue pendiente | Se atrasa sólo el mes terminado (`period.ts:215-223`, `263-273`). Una semana ya pasada dentro del mes en curso sigue «Pendiente» (granularidad mensual). No se registra el futuro (`executions.ts:110`) | — (depende del tiempo) | La planilla distingue Pendiente, Atrasada y No programada; el formulario no ofrece semanas futuras | ✅ (con CUM-02) |
| **Se hizo** | Exige evidencia válida cuando corresponde | Archivo obligatorio salvo `declaration_allowed` (`executions.ts:284-291`). El archivo debe existir, estar registrado para la faena y ser de quien vincula (`evidence-references.ts:280-321`). La aprobación vuelve a exigir el archivo (`executions.ts:496-507`). Segregación (`:579-581`) | Estados por CHECK. **Sin CHECK de segregación ni de consistencia** `approved ⇒ approved_by`, `rejected ⇒ motivo` (CUM-24) | Ok, pero la cantidad se reinicia tras un error (CUM-03) y se acepta cantidad 0 (CUM-13) | ✅ servicio / 🔵 base |
| **No se hizo** | Motivo, responsable, fecha, observación | `reason` ≥ 10 (zod); `created_by` y `created_at`. **No aplica la regla de autoridad de registro** (CUM-01). No lo revisa nadie, por diseño: no toca el denominador, pero sí apaga «Atrasada» | CHECK `reason ≥ 10`, `withdrawn_check` | Pide motivo; ofrece los 12 meses (el servidor rechaza los futuros) | 🟡 CUM-01 |
| **No aplica** | Justificación, trazabilidad, lo revisa otra persona | Nace `pending_review` (`deviations.ts:234`); no a futuro; no sobre una celda con ejecución; revisión por otra persona (`:375-377`); el mes debe estar abierto; entrada en `change_log` | CHECK `reviewer_not_creator`, `rejected_check` (motivo ≥ 10), índice único de un desvío abierto por celda | La propia fila sin botones; mensaje «enviado a revisión». En `/actividades` sólo se ofrece «No realizada» (CUM-19) | ✅ |
| Complemento, anulación, reprogramación, reducción | Segunda persona y mes abierto | `review-requests.ts`, `deviations.ts:234` | CHECK `reviewer_check`, índice `pending_unique` | La reducción de meta es inalcanzable (CUM-05) | ✅ servicio |

**¿Son suficientes y coherentes?** Los cuatro estados más los tres desvíos cubren los casos reales. Hay tres incoherencias:

1. Hay dos formas de hacer desaparecer la señal «Atrasada» sin que otra persona revise nada: una «no realizada» declarada por cualquiera con `execute`, o un envío pendiente parcial (CUM-01, CUM-02).
2. Constancias no reconoce la «no realizada» como constancia marcada (CUM-09).
3. El diálogo de complemento y el indicador suman distinto (CUM-04).

---

## 3. Evidencia directa (§22) — `POST /api/prevencion/pdtp/evidence` y `GET …/evidence/[name]`

| Prueba (HTTP con sesión real, B salvo indicación) | Resultado | ¿Correcto? |
|---|---|---|
| PDF válido (`prevfaena` → Horcones) | 201 `{path, checksumSha256}`; fila en `pdtp_evidence_uploads` con dueño, faena, sha256, tamaño y MIME | ✅ |
| `.exe` renombrado a `.pdf` (cabecera MZ) | 400 «No se pudo identificar el tipo del archivo…» | ✅ |
| 0 bytes | 400 «El archivo está vacío o es demasiado pequeño» | ✅ |
| 26,5 MB | 400 «supera el máximo permitido de 25 MB», en 99 ms (el cuerpo completo se lee antes: CUM-22) | ✅ / 🔵 |
| Nombre `../../../../etc/QA_CUM_evil.pdf` | 201: se guarda como `nanoid.pdf`, sin *traversal*; **el nombre original no se conserva** | ✅ / 🔵 |
| PDF políglota (`%PDF` + `<script>`) | 201; se sirve `application/pdf` con `nosniff` e *inline* | 🔵 teórico (CUM-23) |
| `prevfaena` → faena ajena | 403 | ✅ |
| `prev` → faena inexistente | **500** (violación de FK) | 🔵 CUM-21 |
| `ti` (sin permisos) · `Origin` ajeno (M-02) | 403 · 403 «Origen no permitido» | ✅ |
| Sin sesión | **307 a `/login` → el POST sigue la redirección → 500** («Failed to find Server Action») | 🔵 CUM-11 |
| Descarga: `prev`/`prevfaena` · `otrafaena` · `ti` · sin sesión | 200 `application/pdf`, `nosniff`, `private, max-age=300` · **404** · 403 · 307 | ✅ |
| Descarga con `..%2F..%2Fetc%2Fpasswd` o `..%2F..%2Fpackage.json` | 400 | ✅ |
| Archivo recién subido y sin vincular, descargado por quien lo subió | 404 (sólo se sirve lo referenciado) | ✅ (por diseño) |
| [A] `otrafaena` sobre la evidencia de `ws-e2e` | 404 | ✅ |
| Vincular una ruta de otra faena o de otra persona | Rechazado (`pdtp-evidence-link-ownership.test.ts`, PASS) | ✅ |

---

## 4. Casos borde (§27)

| Caso | Cómo | Resultado | ¿Correcto? |
|---|---|---|---|
| Doble submit | `dblclick` en «Guardar ejecución» (N°25) y dos clics separados por 150 ms (N°36) | Una fila, un historial y una subida; el botón se deshabilita | ✅ |
| Refresh a mitad de envío | Clic y `reload` a los 60 ms (N°41) | El envío se completó en el servidor (una fila, una subida): sin estado a medias | ✅ |
| Sesión expirada al enviar | `clearCookies()` con el diálogo abierto (N°33) | «Error al subir la evidencia.» genérico; sin redirección a login ni aviso de sesión | 🔵 CUM-11 |
| Pérdida de conexión | `context.setOffline(true)` (N°26) | «Error al subir la evidencia.» genérico. Al reconectar, **la observación y el archivo se borraron**; el reintento falla con «adjunta un archivo» | 🟡 CUM-03 |
| Error de validación | Cantidad 3 y observación, sin archivo (N°62) | **La cantidad vuelve a 1 y la observación queda vacía**; mes y semana se conservan | 🟡 CUM-03 |
| Doble aprobación concurrente | `prev` y `prev2` hacen clic a la vez (N°25) | Uno: «aprobada»; el otro: «La ejecución ya fue aprobada.» (también en PGlite) | ✅ |
| Evidencia eliminada antes o después de aprobar | PGlite C12 | Antes: la aprobación se bloquea. Después: sigue contando (M-12 conocido, el escaneo lo detecta) | ✅ / conocido |
| Eliminar o anular una actividad cumplida | PGlite C15 (`DELETE`), C09 (anulación) | FK RESTRICT; anulación con dos personas | ✅ |
| Registros duplicados | PGlite C13 y UI | Una fila por celda y secuencia; el complemento es explícito | ✅ |
| Período o mes cerrado | PGlite C14 | Las siete escrituras se rechazan; el cierre se niega con pendientes | ✅ |

---

## AUDITORÍA — 1. Planilla de actividades y registro de ejecución

**Rutas:**

- `/prevencion/pdtp/actividades` (vistas semana y anual);
- `/prevencion/pdtp/[programId]` (misma planilla con gestión);
- `/prevencion/pdtp/[programId]/ejecucion/[executionId]`;
- `POST /api/prevencion/pdtp/evidence`;
- `GET /api/prevencion/pdtp/evidence/[name]`.

**Archivos principales:**

- `pdtp-execution-form.tsx`, `pdtp-sheet-table.tsx`, `pdtp-deviation-form.tsx`, `pdtp-override-form.tsx`;
- `actividades/page.tsx`, `actions/executions.ts`, `actions/deviations.ts`;
- `lib/services/pdtp/{executions,deviations,period,period-guard,registration-authority,evidence-references,evidence-uploads,execution-history}.ts`.

**Permisos:**

- `prevention:pdtp:view` para ver;
- `execute` para registrar: sólo lo propio, salvo `override:manage` o `close_period` (`lib/auth/pdtp-registration.ts`);
- `override:manage` para «no aplica», reprogramar y meta;
- alcance por faena en servicio (`assertWorksiteAccess`).

### A. UI/UX/Diseño

- **Estructura:**
  - `PageHeader` y `PageContainer` correctos; un solo `h1` en todas las anchuras;
  - 0 px de desborde a 1440, 1024, 768 y 390;
  - los botones de página («Programas», «Gestionar programa») están en el header.
- **Vista semanal:**
  - por defecto en la semana en curso, bien pensada para faena: lista las actividades exigibles con «Registrar» y «Declarar desvío» en cada fila;
  - los contadores-pestaña son 7 (TODAS, EJECUTADAS, PENDIENTES, ATRASADAS, NO REALIZADAS, EN CERO, SIN PROGRAMAR). «EN CERO» y «PENDIENTES» se solapan (CUM-35).
- **Buscador del TopBar:** «Filtrar en esta página...» se muestra pero **no filtra** la planilla (CUM-07).
- **Diálogo «Registrar»:**
  - claro: nombra la actividad, muestra la evidencia exigida y avisa del «mayor de los dos» en actividades con conector;
  - «Semana 1–4» no dice qué días abarca (CUM-29);
  - **tras un error reinicia la cantidad y borra la observación y el archivo** (CUM-03);
  - en actividades con conector, el aviso de complemento contradice al de «el mayor de los dos» (CUM-04).
- **Detalle «Verificación»:**
  - el título se trunca en el header;
  - no dice el **estado actual** ni por qué se anuló;
  - media pantalla la ocupa un estado vacío («Esta actividad no se verifica con un formulario») y el plan de acción menciona un checklist retirado (CUM-12, CUM-33).
- **Estados observados:**
  - con información, operación exitosa (toasts), operación fallida (alerta en el diálogo) y permisos insuficientes (`ti` → `/forbidden`; `otrafaena` → 404 «No encontramos este registro»);
  - sin información, en A (programa de juguete);
  - cargando (`loading.tsx`, visto en la transición);
  - sin resultados: «Sin resultados para este filtro».
- **Responsive:**
  - a 390 px el diálogo cabe (358 px) y es usable;
  - la tabla exige desplazamiento horizontal para llegar a «Registrar», y los filtros más los chips ocupan unos 700 px antes de la primera fila (CUM-35).

### Facilidad de uso

- **Registrar con evidencia:** 3 clics (§1.2). Una persona nueva entiende «Registrar» porque el diálogo explica qué evidencia se exige.
- **Fricciones:**
  - «Declarar desvío» es jerga (esconde «No realizada», «No aplica» y «Reprogramada»);
  - en `/actividades` sólo se ofrece «No realizada», incluso a Prevención: «No aplica» y «Reprogramar» viven en la página del programa (CUM-19);
  - la meta por faena no se puede fijar desde ninguna parte (CUM-05);
  - el motivo del rechazo no se ve en la planilla (CUM-38).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Registrar ejecución con archivo | ✅ | N1, C01 |
| Exigir archivo; excepción `declaration_allowed` con observación | ✅ | C02; `executions.ts:284-291` |
| Rechazar semanas futuras (manual) | ✅ | C07, N1 (opciones) |
| Complemento en la misma celda | ✅ (🟡 mensaje) | C08, N2 |
| Reenvío tras rechazo o anulación | ✅ | C09 |
| No realizada | ✅ (🟡 autoridad) | C04, N7 |
| No aplica y reprogramar desde la planilla del programa | ✅ | N5, N6 |
| No aplica y reprogramar desde `/actividades` | ❌ no se ofrece | probe8: sólo «No realizada» |
| Meta por faena (subir o bajar) | 🔴 el botón no abre | N11 |
| Mes cerrado | ✅ | C14 |
| Detalle con historial de envíos | 🟡 | N8 (sin estado ni motivo de anulación) |
| Filtro de texto del TopBar | 🔴 no filtra | CUM-07 |
| Pedir anulación desde el detalle | ✅ (🔵 botón persistente) | N8 |

### C. Código y lógica

- **Reglas en el servicio, dentro de la transacción y con *advisory lock* por celda:** es bueno. TOCTOU cubierto (`executions.ts:143-192`).
- **Defectos de código:**
  - el `Tooltip` envuelto por `DialogTrigger asChild` no reenvía las props (`pdtp-override-form.tsx:53-64`; `components/ui/tooltip.tsx:48-70`);
  - `actividades/page.tsx:229` no pasa `canManageProgram` a `PdtpSheetTable`;
  - «visor global» por nombre de rol (`actividades/page.tsx:59`): `jefa_chome` cae en la vista semanal sin faena;
  - `partialApprovedCellsFor` suma todos los aprobados (`pdtp-sheet-table.tsx:131-144`) y el indicador toma `max(manual, integración)` (`compliance.ts:247-296`);
  - `recordPdtpDeviationAction` no pasa el actor de registro (`actions/deviations.ts:128-156`).
- **Positivo:** no hay `console.log`, `any` innecesarios ni `catch` vacíos en el camino revisado.

### D. Modelo de datos

- **`pdtp_executions`:**
  - índice único parcial `(actividad, faena, año, mes, semana, sequence) WHERE obligation_id IS NULL AND origin <> 'integration'`;
  - CHECK de mes, semana, cantidad ≥ 0, estado, origen y `evidence_status`;
  - FK RESTRICT a actividad y faena;
  - **sin CHECK de segregación ni de consistencia** del estado (C15, CUM-24).
- **`pdtp_execution_deviations`:** muy bien restringida: motivo, revisor ≠ creador, retiro, destino.
- **Borrado:** lógico; `DELETE` de actividad bloqueado.
- **`pdtp_evidence_uploads`:** `sha256` por CHECK, `size_bytes > 0`, FK de faena RESTRICT.

### E. Permisos y seguridad

- Alcance por faena: servicio más descarga; IDOR demostrado negativo (C15, D3, D9).
- Evidencia: §3.
- **Hueco:** la «no realizada» no respeta la autoridad de registro (CUM-01, demostrado).
- La segregación de la aprobación sólo existe en el servicio (CUM-24).

### F. Testing

- **Corrí:**
  - 10 suites PGlite (188 PASS: review-requests, production-readiness, deviations, execution-integrity, constancias, execution-history, evidence-link-ownership, registration-authority, period-closures, obligations-pagination);
  - 15 archivos unitarios y de componentes (162 PASS: formulario, botones de aprobación, secciones de Aprobaciones, obligaciones, filtros de actividades, historial, miniaturas, formulario de desvío, rutas de evidencia, acciones).
- **Caminos sin cubrir:**
  - un E2E que abra «Meta por faena» (habría detectado CUM-05);
  - el reinicio del formulario tras un error;
  - el mensaje de complemento con integración;
  - el filtro del TopBar en la planilla.

### G. Integración con el Programa Anual

**Es el PDTP mismo:** acredita la actividad (N°) elegida, en la celda (mes y semana) elegida.

- **Cómo acredita:**
  - manual, con evidencia de archivo verificada por existencia, faena, dueño y sha256;
  - queda `submitted` y otra persona lo aprueba;
  - la anulación revierte con dos personas.
- **Cómo cuenta:** el indicador suma sólo lo `approved`, topado por actividad y mes, con `max` frente a la integración; lo cuadré a mano (§1.1).
- **Problemas:**
  - la señal de atraso diverge del porcentaje en los casos de CUM-02 y CUM-01;
  - el diálogo de complemento no dice cómo se va a contar (CUM-04);
  - en la vía de integración se aprueban celdas futuras (CUM-10).

### H. Hallazgos

Ver §H global (CUM-01 a 05, 07, 10, 12, y 🔵 13, 19, 22-24, 29, 33, 35, 36, 38).

### I. Readiness individual: **72/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 19 | −3 CUM-05 · −2 CUM-02 · −0,5 CUM-13 · −0,5 CUM-19 |
| UI/UX | 20 | 13 | −2,5 CUM-03 · −1,5 CUM-07 · −1 CUM-04 · −1 CUM-12 · −0,5 CUM-29 · −0,5 CUM-35/38 |
| Integridad de datos | 15 | 11 | −2 CUM-03 (cantidad cambia en silencio) · −1 CUM-01 · −1 CUM-24 |
| Integración PDTP | 15 | 11 | −1,5 CUM-02 · −1,5 CUM-10 · −1 CUM-04 |
| Código | 10 | 8 | −1 CUM-05 · −0,5 CUM-19 · −0,5 CUM-36 |
| Permisos y seguridad | 5 | 3,5 | −1,5 CUM-01 |
| Testing | 5 | 3,5 | −1,5 (sin E2E de meta, formulario ni TopBar) |
| Manejo de errores | 5 | 3 | −1,5 CUM-11 · −0,5 CUM-03 |

---

## AUDITORÍA — 2. Aprobaciones

**Ruta:** `/prevencion/pdtp/aprobaciones`, con cuatro secciones:

- ejecuciones;
- «No aplica» y reprogramaciones (más las ocurrencias);
- solicitudes (anulación, cancelación, reducción);
- programadas de la semana.

**Archivos:** `aprobaciones/page.tsx`, `pdtp-approval-buttons.tsx`, `not-applicable-review-section.tsx`, `review-requests-section.tsx`, `lib/services/pdtp/review-requests.ts`, `executions.ts:556-822`.

**Permisos:** `prevention:pdtp:approve` (`prev`, `prev2`, `jefa`, `admin`). `prevfaena`, `sup` y `ti` → `/forbidden` (verificado).

### A. UI/UX/Diseño

- **Encabezado:** `PageHeader` con descripción según el alcance.
- **Tabla de ejecuciones:** Faena · Actividad · Periodos pendientes.
  - **No muestra** la cantidad declarada, quién registró, cuándo, el plan de la celda ni si es complemento.
  - Varias ejecuciones de la misma celda son **botones idénticos** («✓ Sep · sem. 2» siete veces en Biodiversa N°62).
  - Las miniaturas de evidencia van en otra columna, sin rótulo de período (CUM-06).
- **Buscador del TopBar:** visible, **no filtra** (33 → 33 filas). La regla `"/aprobaciones"` de `ROUTES_WITH_OWN_SEARCH` no calza con `/prevencion/pdtp/aprobaciones` (CUM-07).
- **Estado vacío:** propio, no `EmptyState` (⚪).
- **Secciones de «no aplica» y solicitudes:** claras. Rótulo, motivo, «Declarado/Pedido por … · fecha» y botones Aprobar/Rechazar. La propia fila sin botones y con «Retirar».
- **Rótulos:**
  - las etiquetas sintéticas de integración ya no traen ids y llevan un chip con ícono (C-03 y C-04 corregidos);
  - la reprogramación aprobada se anuncia como «"No aplica" … aprobado» (CUM-20).
- **Responsive:** a 390 px los botones de aprobar quedan fuera de la vista y exigen desplazamiento horizontal dentro de la tabla (CUM-26). Sin desborde de página.

### Facilidad de uso

- **Aprobar:** 1 clic; rechazar: 2 más el motivo; revisar un «no aplica» o una solicitud: 1 clic.
- **Fricción principal:** el aprobador aprueba sin ver qué cantidad y quién. Para verlo tiene que ir a la planilla o al detalle, y desde la cola no hay enlace al detalle.

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Aprobar y rechazar (motivo ≥ 10) | ✅ | N1, N3, C01 |
| Segregación (registrante ≠ aprobador) | ✅ | C01, C08, C11 |
| Aprobación concurrente | ✅ | N (flujo 6e), C01 |
| Revisar «no aplica» y reprogramación | ✅ | N4, N5, N6, C05, C10 |
| Solicitudes: anulación, cancelación, reducción | ✅ | N8, N10, C09, C10, C11 |
| Retirar la propia solicitud | ✅ (unitario) | `review-requests-section.tsx` |
| Paginación de la cola | ❌ | CUM-25 (M-11) |
| Filtro de texto | 🔴 | CUM-07 |

### C. Código y lógica

- La reducción aprobada aplica el payload sin comparar el valor vigente con `previousQuantity` (`review-requests.ts:173-199`; CUM-15).
- El revisor sólo se compara con quien pidió; no con quien ejecutó (`:258-260`; CUM-14).
- La anulación no pasa el motivo al historial de la ejecución (`:230-237`; CUM-12).
- `approvePdtpExecution` tampoco pasa el motivo de aprobación al historial (`executions.ts:640-647`).

### D. Modelo de datos

`pdtp_review_requests` está bien restringida:

- `reviewer_check` (≠ solicitante);
- `rejected_check` (motivo ≥ 10);
- `reviewed_check` y `withdrawn_check`;
- índice único de una solicitud en revisión por objeto;
- FK RESTRICT a programa y faena.

### E. Permisos y seguridad

- El alcance de faena se aplica en cada revisión (`assertWorksiteAccess`).
- La página exige `approve`.
- El registrante original puede vetar la anulación de su propia ejecución (CUM-14; bajo, porque otra persona puede volver a pedirla).

### F. Testing

- **Unitarios:** `pdtp-approval-buttons.test.tsx`, `not-applicable-review-section.test.tsx`, `weekly-scheduled-section.test.tsx`.
- **PGlite:** `pdtp-review-requests.test.ts`, en PASS.
- **Falta:** un E2E de anulación, cancelación y reducción en navegador (lo admite el informe de fixes). Aquí se recorrió a mano.

### G. Integración con el Programa Anual

Es la compuerta del cumplimiento: sólo lo `approved` cuenta.

- **Efecto verificado de cada decisión:**
  - «no aplica» aprobado: 44 → 43;
  - anulación: abril 2/2 → 2/1;
  - reducción: marzo semana 2 de 6 → 2;
  - reprogramación: agosto → septiembre.
- **Riesgo:** con la información de la cola no se verifica lo aprobado (CUM-06).

### H. Hallazgos

CUM-06, CUM-07, CUM-12 (🟡); CUM-14, 15, 18, 20, 25, 26 (🔵).

### I. Readiness individual: **81/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 22,5 | −1 CUM-25 · −0,5 CUM-14 · −0,5 CUM-15 · −0,5 CUM-16 |
| UI/UX | 20 | 12,5 | −4 CUM-06 · −1,5 CUM-07 · −1 CUM-26 · −0,5 CUM-20 · −0,5 (aprobar anulación sin confirmar) |
| Integridad | 15 | 12 | −1,5 CUM-12 · −1 CUM-15 · −0,5 CUM-24 |
| Integración PDTP | 15 | 12 | −2 CUM-06 · −1 CUM-12 |
| Código | 10 | 9 | −1 (helpers `scopeToIds`/`fail` duplicados por archivo; estado vacío propio) |
| Permisos | 5 | 4,5 | −0,5 CUM-14 |
| Testing | 5 | 4 | −1 (sin E2E de solicitudes) |
| Errores | 5 | 4,5 | −0,5 CUM-16 |

---

## AUDITORÍA — 3. A demanda y por evento (obligaciones)

**Ruta:** `/prevencion/pdtp/obligaciones` (en `ROUTES_WITH_OWN_SEARCH`, con búsqueda propia en la base).

**Archivos:** `pdtp-obligations-workbench.tsx`, `obligaciones/actions.ts`, `lib/services/pdtp/obligations.ts`.

**Permisos:**

- `view` para ver;
- `execute` para abrir y reportar;
- `obligation:cancel` para pedir la cancelación;
- `approve` para aprobar y revisar.

### A. UI/UX

- **Estructura:**
  - `PageHeader` con la acción «Registrar necesidad o evento»;
  - tres tiles accionables más un `Select` de estado: la misma dimensión dos veces (CUM-30);
  - búsqueda y faena;
  - lista paginada en el servidor;
  - estado vacío con CTA: «Esto no equivale a 0 % ni a 100 %».
- **Origen del caso:** muestra ids internos («worker:VoRAccr…:alta») (CUM-34).
- **Tras reportar:**
  - «Ir a aprobación» aparece a quien tiene `execute` y lleva a `prevfaena` a `/forbidden` (CUM-17);
  - una vez completado o cancelado, **el caso no se puede volver a ver**; el filtro sólo ofrece abierto, pendiente, vencido y por aprobar (CUM-08).
- **Responsive:** sin desborde en las cuatro anchuras.

### Facilidad de uso

- Abrir un caso: 4 clics más el motivo.
- Reportar: 3 más el archivo.
- Pedir la cancelación: 2 más el motivo.
- Los textos explican bien que el reporte «aún no contará».

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Abrir un caso manual (motivo ≥ 10, plazo de la actividad) | ✅ | N9, C11 |
| Reportar con archivo (sin archivo, rechazado) | ✅ | N9, C11 |
| Aprobar → `completed` | ✅ | N9, C11 |
| Pedir cancelación → revisión por otra persona | ✅ | N10, C11 |
| Mes cerrado para la cancelación | ✅ (PGlite existente) | `pdtp-review-requests.test.ts` |
| Consultar casos cerrados | ❌ | CUM-08 |
| Reportar con la cancelación en revisión | 🟡 (la solicitud queda colgada) | C11 → CUM-16 |

### C. Código y lógica

- `listPdtpObligationsPage` fija `status IN ('pending','overdue','reported')` (`obligations.ts:566-570`).
- `reportPdtpObligation` no mira las solicitudes de cancelación pendientes (`:225-260`).
- `reportedAt` lo fija el servidor, sin antedatar (PREV-I11): ✅.

### D. Modelo de datos

- CHECK de motivo de cancelación ≥ 10 y de motivo manual ≥ 10.
- Una ejecución por obligación (índice único).
- Idempotencia por clave.

### E. Permisos

- Alcance por faena en servicio y en lista.
- `otrafaena` no ve los casos de Horcones (lista vacía, verificado).

### F. Testing

- `obligaciones/actions.test.ts`, `pdtp-obligations-workbench.test.tsx`, `pdtp-obligations-pagination.test.ts`: PASS.
- Sin E2E de cancelación.

### G. Integración PDTP

- La obligación alimenta el indicador de plazos (`closed_on_time`).
- La cancelación aprobada la saca del denominador; la solicitud pendiente no.
- La ejecución de la obligación pasa por la misma cola y la misma segregación.

### I. Readiness individual: **86/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 21 | −3 CUM-08 · −1 CUM-16 |
| UI/UX | 20 | 16,5 | −1,5 CUM-17 · −1 CUM-08 · −0,5 CUM-30 · −0,5 CUM-34 |
| Integridad | 15 | 13,5 | −1 CUM-08 (historia invisible) · −0,5 CUM-16 |
| Integración PDTP | 15 | 13 | −1 CUM-08 · −1 (en la cola, la ejecución de un caso figura como «Sep · sem. 4», sin su plazo) |
| Código | 10 | 9 | −1 CUM-16 |
| Permisos | 5 | 5 | — |
| Testing | 5 | 4 | −1 (sin E2E de cancelación) |
| Errores | 5 | 4 | −1 CUM-16 |

---

## AUDITORÍA — 4. Medidas

**Rutas:**

- `/prevencion/pdtp/acciones` (vista transversal);
- creación y seguimiento en el detalle de la ejecución (`execution-action-plan-panel.tsx`).

**Archivos:** `acciones/page.tsx`, `acciones-table.tsx`, `actions/action-plan-actions.ts`, `lib/services/pdtp/action-plan.ts` (sobre CAPA).

**Permisos:** `action:manage` para crear y editar; `action:verify` para verificar y reabrir. El alcance se valida en cada acción (`assertPdtpExecutionAccess` / `assertPdtpActionPlanItemAccess`).

### A. UI/UX

- **Página:**
  - `DataTable` con el TopBar conectado;
  - 4 filtros (estado, prioridad, faena, vencimiento), dentro de la regla A2;
  - tarjetas en móvil; 0 desbordes.
- **Alta:**
  - la medida se crea desde el detalle («Agregar acción»);
  - el daño potencial calcula prioridad y plazo (`DatePicker`);
  - «Responsable» es texto libre, sin usuario (CUM-31);
  - el estado vacío del detalle habla de un checklist retirado (⚪).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Crear una medida desde una ejecución | ✅ | flujo 8: «#1 QA_CUM … Plazo 2026-10-06 · Pendiente media» |
| Verla en la vista transversal con faena y actividad | ✅ | flujo 8 (`prevfaena`) |
| Filtros por URL con `replace` y `scroll:false` | ✅ | `acciones-table.tsx:50-56` |
| Cancelar (baja lógica), verificar eficacia, reabrir | 🟡 no ejecutado en esta auditoría | Código: `action-plan.ts:207-307` (transiciones CAPA con versión) |

### C. Código

- `canManage` y `canVerify` llegan a `AccionesTable` y no se usan (⚪).
- `capaAccess` concede todos los permisos CAPA internamente: depende de que la acción valide antes. La acción valida (`action-plan-actions.ts`).

### D. Datos

- CAPA con `version` optimista, transiciones auditadas y cancelación en vez de borrado.

### E. Permisos

- Alcance por faena, verificado en código.
- `prevfaena` sólo ve las de Horcones.

### F. Testing

- No encontré pruebas específicas de `/acciones`; la CAPA tiene las suyas (no se corrieron aquí).

### G. Integración PDTP

- Las medidas pertenecen a una ejecución (`source_type = 'pdtp'`) y alimentan los ejes de verificación y cierre del índice integral.
- **No lo verifiqué ejecutando** (lo cubre pdtp-programa).

### I. Readiness individual: **85/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 21 | −3 (verificación, cierre y reapertura no ejecutados) · −1 CUM-31 |
| UI/UX | 20 | 17 | −1 CUM-31 · −1 ⚪ copia del checklist · −1 (el alta sólo existe desde el detalle; no se descubre desde `/acciones`) |
| Integridad | 15 | 14 | −1 (responsable sin FK) |
| Integración PDTP | 15 | 12 | −3 (efecto en el integral no verificado) |
| Código | 10 | 9 | −1 ⚪ props muertas |
| Permisos | 5 | 4,5 | −0,5 (`capaAccess` omnipotente, depende de la acción) |
| Testing | 5 | 3,5 | −1,5 (sin pruebas de `/acciones`) |
| Errores | 5 | 4 | −1 (errores sólo como texto; sin toast) |

---

## AUDITORÍA — 5. Constancias

**Ruta:** `/prevencion/constancias`.

**Archivos:** `constancias-workbench.tsx`, `page.tsx`, `lib/services/pdtp/constancias.ts`. Reutiliza `PdtpExecutionForm` y `PdtpDeviationForm`.

**Permisos:**

- `prevention:constancias:view` y `constancias:execute`, acotados al mecanismo `constancia` en servidor (`assertPdtpActivityMechanism`);
- la regla de autoridad (PREV-I03) sólo decide dónde se ofrece «Registrar».

### A. UI/UX

- **Encabezado:** la descripción es clara («se hicieron o no se hicieron…»).
- **Controles:** dos tiles más un `Select` de estado: la misma dimensión dos veces (CUM-30).
- **Filas:** estado, N°, faena, responsable y evidencia exigida, más «Mes que corresponde marcar» (sin la semana) y los botones «Registrar» y «Declarar desvío». Ahí sí se ofrece «No aplica».
- **Estados vacíos:** con y sin programa activo, «Sin resultados» con «Limpiar filtros».
- **Responsive:** sin desborde.

### Facilidad de uso

- Registrar: 3 clics.
- «No aplica»: 3 clics.
- **Fricción:** tras declarar «No realizada», la constancia **sigue** en la lista (CUM-09).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Listar deudas (primer mes impago) | ✅ | captura |
| Registrar (archivo obligatorio si hay requisito) | ✅ | `executions.ts:274-277` |
| «No aplica» con revisión | ✅ | N4 |
| «No realizada» salda la constancia | ❌ | N12 → CUM-09 |
| Deuda del año en cierre | ✅ (código, PREV-C03.7) | `constancias.ts:167-196` |

### C. Código

- `paidMonths` sólo cuenta ejecuciones con cantidad > 0 (`constancias.ts:122-128`) e ignora la «no realizada», que la planilla sí trata como explicada (`period.ts:246-273`).

### D-E

- Mismos datos y permisos que la planilla.
- El acotamiento por mecanismo se prueba en servidor (código); el alcance, por faena.

### F. Testing

- `pdtp-constancias.test.ts` (PGlite): PASS.
- No cubre la «no realizada».

### G. Integración PDTP

- Acredita por la misma vía manual (N° de la constancia, celda elegida, aprobación de otra persona).
- La regla de deuda difiere de la planilla (CUM-09).

### I. Readiness individual: **86/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 21 | −4 CUM-09 |
| UI/UX | 20 | 16,5 | −1,5 CUM-09 · −1 CUM-03 (formulario compartido) · −0,5 CUM-30 · −0,5 (sin la semana) |
| Integridad | 15 | 13,5 | −1,5 CUM-09 |
| Integración PDTP | 15 | 12,5 | −2,5 CUM-09 |
| Código | 10 | 9 | −1 (regla de deuda duplicada con la planilla y `/pendientes`) |
| Permisos | 5 | 5 | — |
| Testing | 5 | 4,5 | −0,5 |
| Errores | 5 | 4 | −1 CUM-03/CUM-11 (formulario compartido) |

---

## H. Hallazgos (formato §6)

```text
ID: CUM-01
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla / Constancias
Categoría: Permisos · Reglas de negocio
Título: "No realizada" se declara sin la regla de autoridad de registro y apaga la señal de atraso
Archivo(s): app/(app)/prevencion/pdtp/actions/deviations.ts; lib/services/pdtp/deviations.ts; app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx; lib/services/pdtp/period.ts
Línea(s): actions/deviations.ts:128-156 (no pasa actor); deviations.ts:116-124 (sin parámetro de actor); pdtp-sheet-table.tsx:583-592 (el formulario se ofrece sin canRegister); period.ts:246-273 (hasDeclaredNotPerformed)
Pantalla/ruta: /prevencion/pdtp/actividades → "Declarar desvío"
Endpoint: recordPdtpDeviationAction
Rol: supervisor_terreno (y cualquiera con prevention:pdtp:execute en la faena)
Descripción: PREV-I03 limita quién registra "Se hizo" (su cargo, su asignación o Prevención). "No se hizo" no pasa por esa regla. Un supervisor sin botón "Registrar" en una actividad ajena puede declararla no realizada, y el mes vencido deja de contarse como "Atrasada" porque la deuda queda "explicada". Nadie revisa esa declaración.
Evidencia: DEMOSTRADO.
  PGlite C04: assertPdtpActorMayRegister(SUP) → "Esta actividad no es de tu cargo…"; recordPdtpDeviation(not_performed, SUP) → active; estado de agosto: overdue → not_scheduled.
  Navegador B (sup, N°17): botones = [Declarar desvío] (sin Registrar); "No realizada" → "Desvío registrado."; fila "NO REALIZADA (CON MOTIVO)".
Cómo reproducir:
1. Como sup en /prevencion/pdtp/actividades, elegir una actividad sin "Registrar".
2. "Declarar desvío" → "No realizada" → motivo → guardar.
3. En un mes vencido, la actividad deja de aparecer en "Atrasadas".
Resultado actual: cualquiera con execute explica, y con eso oculta, el atraso de actividades que no son suyas.
Resultado esperado: la misma regla de autoridad que "Registrar". Opcionalmente, que el "no realizada" de un mes vencido siga mostrándose como deuda explicada, distinta de "al día".
Impacto: la jefatura deja de ver atrasos reales en el KPI y en la lista.
Causa probable: PREV-I03 se cableó en markPdtpExecution y reportPdtpObligation, no en desvíos.
Solución recomendada: pasar pdtpRegistrationActorFromSession a recordPdtpDeviation (not_performed) y llamar assertPdtpActorMayRegister; esconder el tipo en la UI donde canRegister es falso; prueba PGlite.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-02
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla
Categoría: Reglas de negocio · Indicadores (PRV-07)
Título: Un envío pendiente parcial o una sola "no realizada" esconden el faltante del resto del mes
Archivo(s): lib/services/pdtp/period.ts
Línea(s): 263-273 (isUnpaidMonth: submitted === 0 && !hasDeclaredNotPerformed)
Pantalla/ruta: planilla y KPI "Atrasadas" de /prevencion/pdtp
Endpoint: —
Rol: jefatura, Prevención
Descripción: PRV-07 se corrigió para "ejecutado < planificado", pero la regla D9 deja que cualquier cantidad enviada, o un "no realizada" en una semana, pague todo el mes.
Evidencia: DEMOSTRADO (PGlite C06).
  Mayo con plan 4 y 1 aprobada → overdue (corregido).
  1 aprobada + 1 enviada → not_scheduled, overdueMonths 0.
  1 aprobada + "no realizada" en la semana 2 → not_scheduled.
  En los dos casos las semanas 3 y 4 quedan sin nada.
Cómo reproducir:
1. Actividad con 1 por semana en un mes vencido.
2. Aprobar una semana y enviar (o declarar "no realizada") otra.
3. La actividad no figura "Atrasada".
Resultado actual: la lista de atrasadas no coincide con lo que el % dice que falta (4 → 1 cuenta).
Resultado esperado: deuda si aprobado + enviado + explicado < planificado, idealmente por celda y no por mes.
Impacto: faltantes invisibles, justo el caso que PRV-07 quería cerrar.
Causa probable: D9 ("un envío paga el mes") es anterior al criterio parcial.
Solución recomendada: comparar planned con approved + submitted + (celdas con no realizada); mostrar "faltan N".
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-03
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla / Constancias (formulario compartido)
Categoría: UI/UX · Integridad de datos
Título: Tras un error de envío, el formulario "Registrar" vuelve la cantidad a 1 y borra la observación y el archivo
Archivo(s): app/(app)/prevencion/pdtp/pdtp-execution-form.tsx
Línea(s): 88-130 (useActionState), 168-171 (<form action>), 224-236 (cantidad no controlada, defaultValue "1"), 255-273 (observación y archivo no controlados)
Pantalla/ruta: diálogo "Registrar ejecución"
Endpoint: markPdtpExecutionFormAction
Rol: prevfaena, sup, jt (registran)
Descripción: el formulario usa un <form action> de React 19, que reinicia los campos no controlados al terminar la acción, también cuando falla. Mes y semana (controlados) se conservan; la cantidad vuelve a 1 y la observación y el archivo se vacían. La persona corrige lo que el error le pidió (p. ej. adjunta el archivo) y reenvía cantidad 1 sin notarlo.
Evidencia: DEMOSTRADO (navegador B).
  probe6 (N°62): cantidad 3 + observación, sin archivo → alerta "adjunta un archivo…" → cantidad "1", observación "".
  flujo 6b (sin conexión): la observación y el archivo desaparecen; el reintento falla con "adjunta un archivo".
Cómo reproducir:
1. Registrar con cantidad 3 y observación, sin archivo.
2. Leer la alerta.
3. La cantidad dice 1 y la observación está vacía.
Resultado actual: la cantidad declarada cambia en silencio si se reenvía.
Resultado esperado: conservar lo ingresado tras un error (campos controlados, o devolver los valores en el estado).
Impacto: cantidades mal declaradas y retrabajo en faena, con mala conexión.
Causa probable: reinicio automático del form action.
Solución recomendada: controlar executedQuantity y evidenceText (y conservar el File en el estado); prueba de componente.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-04
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla (registro de complemento)
Categoría: Lógica · UI (PRV-08)
Título: El diálogo de complemento suma lo acreditado por el submódulo con lo manual; el indicador toma el mayor
Archivo(s): app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx; lib/services/pdtp/compliance.ts; app/(app)/prevencion/pdtp/pdtp-execution-form.tsx
Línea(s): pdtp-sheet-table.tsx:131-144 (suma todo lo approved); compliance.ts:247-296 (max(manual, integración)); pdtp-execution-form.tsx:175-179 y 249-253 (dos avisos contradictorios)
Pantalla/ruta: "Registrar complemento" en actividades con conector (enganche/compuesta)
Endpoint: —
Rol: registrantes
Descripción: con 1 aprobada por integración, el diálogo dice "Esta semana ya tiene 1 de 5 aprobadas. Lo que registres se suma como complemento". El mismo diálogo dice también "vale el mayor de los dos, no la suma". Registrar 2 deja la celda en max(2, 1) = 2 y no en 3. El diálogo siguiente dice "3 de 5" mientras el indicador cuenta 2.
Evidencia: DEMOSTRADO (navegador B, N°38 semana 4) + SQL: integración 1, manual 2 y 3; los textos del diálogo quedaron en flows.txt (flow3 B).
Cómo reproducir:
1. Actividad con conector y 1 acreditada en la semana.
2. "Registrar" (título "Registrar complemento · 1 de 5") con 2.
3. El indicador de la semana suma 2, no 3.
Resultado actual: cifras distintas para el mismo hecho.
Resultado esperado: el diálogo explica el max y el faltante real (faltan 5 − max), o el modelo suma.
Impacto: registros de menos creyendo haber completado; confianza en las cifras.
Causa probable: el complemento (PRV-08) se diseñó sobre las filas manuales.
Solución recomendada: calcular partialApprovedCells con la misma regla (max(manual, integración)) y un solo mensaje coherente.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-05
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla (meta por faena, M-06)
Categoría: Funcionalidad · Código
Título: El botón "Fijar meta por faena" no abre su diálogo: la meta por faena, incluida su reducción con revisión, no es operable desde la UI
Archivo(s): app/(app)/prevencion/pdtp/pdtp-override-form.tsx; components/ui/tooltip.tsx
Línea(s): pdtp-override-form.tsx:53-64 (DialogTrigger asChild → <Tooltip>); tooltip.tsx:48-70 (Tooltip no acepta ni reenvía props, ref ni onClick)
Pantalla/ruta: /prevencion/pdtp/[programId]?faena=… (planilla con gestión)
Endpoint: setPdtpActivityOverrideFormAction
Rol: prevencionista, administrador
Descripción: Radix Slot entrega el onClick y el ref del DialogTrigger al componente Tooltip, que los descarta. El botón (ícono de deslizadores, aria-label "Fijar meta por faena") no tiene aria-haspopup ni aria-expanded del diálogo.
Evidencia: DEMOSTRADO (navegador B, prev): 0 diálogos tras clic, clic forzado y Enter en N°6 y N°17 (probe4, probe7). El servicio funciona (PGlite C10). Defecto preexistente: el Tooltip envuelve desde 2026-07-06 (git blame).
Cómo reproducir:
1. Como prev, abrir /prevencion/pdtp/pdtp-2026-v2?faena=ws-horcones.
2. Clic en el ícono "Fijar meta por faena" de cualquier fila.
3. No pasa nada.
Resultado actual: no se puede subir ni bajar la meta de una faena.
Resultado esperado: abre el diálogo "Meta por faena".
Impacto: las faenas con otra dotación no pueden ajustar su denominador; M-06 se declaró corregido y es inalcanzable.
Causa probable: Tooltip usado como hijo de un Trigger asChild.
Solución recomendada: invertir el anidado (Tooltip > DialogTrigger asChild > Button), o que Tooltip reenvíe props y ref; E2E que abra el diálogo.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```text
ID: CUM-06
Severidad: 🟡 IMPORTANTE
Submódulo: Aprobaciones
Categoría: UI/UX · Control
Título: La cola de aprobación no muestra qué se aprueba (cantidad, quién, cuándo, plan) y repite botones idénticos
Archivo(s): app/(app)/prevencion/pdtp/aprobaciones/page.tsx; app/(app)/prevencion/pdtp/pdtp-approval-buttons.tsx
Línea(s): page.tsx:106-132 (descarta executedQuantity, executedByUserId, executedAt), 183-200 (evidencias en otra columna, sin período); pdtp-approval-buttons.tsx:18-20, 99-127 (rótulo sólo "mes · sem.")
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: prev, prev2, jefa
Descripción: cada fila es Faena · Actividad · botones "✓ Sep · sem. 4". No se ve la cantidad declarada (que decide el %), quién la registró, cuándo, cuánto había planificado, ni si es un complemento. Con varias ejecuciones en la misma celda (integraciones o complemento más integración) aparecen N botones iguales y N chips de evidencia sin forma de emparejarlos. No hay enlace al detalle.
Evidencia: DEMOSTRADO (navegador B, capturas B-flow1-aprobaciones-antes-1440.png y R-aprobaciones-390.png): Biodiversa N°62 con 7 botones "Sep · sem. 2" idénticos; fila N°28 sin cantidad ni autor. CÓDIGO: los datos existen en PendingPdtpExecution y la página los descarta.
Cómo reproducir:
1. Abrir Aprobaciones como prev.
2. Buscar una actividad con más de un pendiente en la misma semana.
3. Intentar saber qué botón aprueba qué.
Resultado actual: se aprueba a ciegas o hay que salir a la planilla.
Resultado esperado: por ejecución, cantidad/plan, registrante, fecha, evidencia al lado de su botón y un enlace a "Ver verificación".
Impacto: aprobaciones sin verificar lo aprobado; la segunda persona pierde su valor de control.
Causa probable: la cola se diseñó para una ejecución por celda.
Solución recomendada: una sub-fila por ejecución con esos campos; M-11 (paginar) en el mismo cambio.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-07
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla / Aprobaciones
Categoría: UI/UX (arquitectura de búsqueda)
Título: El buscador del TopBar se muestra en la planilla y en Aprobaciones pero no filtra nada
Archivo(s): components/layout/top-bar.tsx; app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx; app/(app)/prevencion/pdtp/aprobaciones/page.tsx
Línea(s): top-bar.tsx:33 ("/aprobaciones" no calza con /prevencion/pdtp/aprobaciones), 77; pdtp-sheet-table.tsx (no usa useSafeShellHeader/searchQuery)
Pantalla/ruta: /prevencion/pdtp/actividades, /prevencion/pdtp/[programId], /prevencion/pdtp/aprobaciones
Endpoint: —
Rol: todos
Descripción: la regla de AGENTS.md dice que el TopBar filtra la lista de la página o se oculta. Aquí se muestra "Filtrar en esta página..." y la lista no cambia.
Evidencia: DEMOSTRADO (navegador B): "Charlas" en la planilla → siguen las 13 filas (N°6, N°17…); en Aprobaciones, 33 → 33 filas (probe-rows2, probe7).
Cómo reproducir:
1. Abrir /prevencion/pdtp/actividades.
2. Escribir un texto en el buscador superior.
3. La tabla no cambia.
Resultado actual: una búsqueda placebo, en listas de 87 actividades paginadas de a 30.
Resultado esperado: filtrar por N°, nombre o responsable, o esconder el input.
Impacto: la gente cree que no existe lo que busca.
Causa probable: la tabla no se conectó al ShellHeader; prefijo equivocado en ROUTES_WITH_OWN_SEARCH.
Solución recomendada: consumir searchQuery en PdtpSheetTable y en la cola; o agregar las rutas a ROUTES_WITH_OWN_SEARCH con su propio input.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-08
Severidad: 🟡 IMPORTANTE
Submódulo: A demanda y por evento
Categoría: Funcionalidad · Trazabilidad
Título: Los casos completados y cancelados desaparecen: no hay dónde consultarlos
Archivo(s): lib/services/pdtp/obligations.ts; app/(app)/prevencion/pdtp/obligaciones/page.tsx; pdtp-obligations-workbench.tsx
Línea(s): obligations.ts:566-570 (baseWhere fija pending/overdue/reported); page.tsx:17 (FILTERS); workbench.tsx:122-129 (opciones del Select)
Pantalla/ruta: /prevencion/pdtp/obligaciones
Endpoint: —
Rol: todos
Descripción: una vez aprobada (completed) o cancelada, la obligación no aparece con ningún filtro. No hay lista de lo que se hizo "cuando correspondió", con su evidencia, su plazo y si se cumplió a tiempo, ni de lo cancelado y por qué.
Evidencia: DEMOSTRADO. Navegador B: tras aprobar y tras cancelar, "casos N°57 manuales: 0"; opciones "Trabajo abierto | Pendientes | Vencidas | Por aprobar". PGlite C11: listPdtpObligationsPage devuelve sólo reported.
Cómo reproducir:
1. Abrir, reportar y aprobar un caso.
2. Volver a /prevencion/pdtp/obligaciones.
3. El caso no está y no hay filtro que lo muestre.
Resultado actual: la historia de las actividades a demanda es invisible en su pantalla.
Resultado esperado: filtros "Completadas" y "Canceladas" (con motivo, quién aprobó y enlace a la ejecución).
Impacto: ante una fiscalización no se puede mostrar desde aquí qué casos se cerraron ni cuáles se cancelaron.
Causa probable: la pantalla se pensó como bandeja de trabajo.
Solución recomendada: dos filtros más en la base y en el Select; el conteo de los tiles no cambia.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-09
Severidad: 🟡 IMPORTANTE
Submódulo: Constancias
Categoría: Reglas de negocio
Título: Declarar "No se hizo" no salda la constancia: sigue pendiente (y vencerá) en Constancias y en /pendientes
Archivo(s): lib/services/pdtp/constancias.ts
Línea(s): 122-128 (paidMonths sólo con ejecuciones de cantidad > 0)
Pantalla/ruta: /prevencion/constancias, /pendientes
Endpoint: —
Rol: responsables de constancias (prevfaena, jt, sup…)
Descripción: la página promete "se hicieron o no se hicieron, con evidencia u observación". Con "No realizada" declarada, la fila sigue "PENDIENTE" y al mes siguiente pasa a "Vencida". La planilla, en cambio, la muestra "No realizada (con motivo)" y no la cuenta como atraso.
Evidencia: DEMOSTRADO (navegador B, flujo 9): N°6 → "Declarar desvío → No realizada" → "Desvío registrado."; tras recargar, la lista sigue igual y /pendientes aún trae N°6.
Cómo reproducir:
1. En Constancias, "Declarar desvío → No realizada" en una fila.
2. Recargar.
3. La fila sigue como deuda.
Resultado actual: la persona no puede vaciar su bandeja diciendo la verdad.
Resultado esperado: una celda con "no realizada" vigente se marca como constancia dejada, con otro rótulo.
Impacto: bandejas que no bajan, doble registro y desconfianza en /pendientes.
Causa probable: la regla de deuda se escribió sólo con ejecuciones.
Solución recomendada: incluir desvíos not_performed activos en paidMonths (y la misma regla en operational-work-queue); prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-10
Severidad: 🟡 IMPORTANTE
Submódulo: Registro de ejecución (vía de integración; referencia cruzada con el agente integracion)
Categoría: Reglas de negocio (PRV-03)
Título: Las acreditaciones de submódulos se aprueban en semanas futuras
Archivo(s): lib/services/pdtp/accreditation.ts
Línea(s): 294-301 (el slot sale de plannedPeriod sin guarda de futuro); compárese con executions.ts:110 y :587
Pantalla/ruta: capacitación (ocurrencias), alcotest, higiene
Endpoint: accreditPdtpFromEvent
Rol: quien marca la casilla o ocurrencia
Descripción: PRV-03 se cerró en el camino manual: no se registra ni se aprueba lo que no ocurrió. La integración, en cambio, usa el período planificado de la casilla, y una casilla de noviembre marcada hoy queda "approved" en noviembre.
Evidencia: DEMOSTRADO (SQL de lectura en B; filas creadas por otros agentes hoy):
  N°53 2026-11 s4 approved (capacitacion_ocurrencia, 21:20);
  N°30 2026-12 s3 approved (alcotest, 21:42);
  N°45 2026-12 s3 approved (higiene, 21:45).
  Las tres con evidence_status 'provided', registradas y aprobadas por qa-prev-faena.
Cómo reproducir:
1. En capacitación, completar la ocurrencia de noviembre.
2. SELECT de pdtp_executions con mes > 9 y status 'approved'.
3. Aparece aprobada.
Resultado actual: el anual incluye cumplimiento de semanas que no han ocurrido.
Resultado esperado: la misma regla que la vía manual (rechazar, o dejar submitted hasta que la semana llegue), o una decisión explícita de "adelantar" con rótulo.
Impacto: el avance anual y la comparativa por faena se inflan.
Causa probable: la guarda de PRV-03 sólo se cableó en markPdtpExecution/approvePdtpExecution.
Solución recomendada: aplicar isPdtpCellInFuture en accreditPdtpFromEvent; coordinar con el agente integracion.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: CUM-12
Severidad: 🟡 IMPORTANTE
Submódulo: Planilla (detalle de ejecución) / Aprobaciones (anulación)
Categoría: Trazabilidad · UI
Título: El detalle de una ejecución no dice su estado actual, y la anulación queda como "Revertido" sin motivo ni solicitante
Archivo(s): lib/services/pdtp/review-requests.ts; app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/page.tsx; submission-history.tsx; lib/services/pdtp/executions.ts
Línea(s): review-requests.ts:230-237 (recordPdtpExecutionHistory sin reason); ejecucion/page.tsx:67-73 (header sin estado); submission-history.tsx:43-48 (motivo sólo desde entry.reason); executions.ts:640-647 (la aprobación con motivo tampoco lo guarda en el historial)
Pantalla/ruta: /prevencion/pdtp/[programId]/ejecucion/[executionId]
Endpoint: reviewPdtpReviewRequestAction
Rol: registrante, jefatura, auditor
Descripción: tras anular, el historial muestra "ENVIADO → APROBADO → REVERTIDO · QA_Prevencionista Dos", sin el motivo ni quién lo pidió. El encabezado dice período y cantidad, no el estado. En la planilla la fila pasa a "RECHAZADA" sin motivo. El motivo existe en rejection_reason, en pdtp_review_requests y en pdtp_change_log, pero no donde se mira el registro.
Evidencia: DEMOSTRADO (navegador B, flujo 4, captura B-flow4-detalle-anulada-1440.png; PGlite C09: historial "revoked(u-aprueba2, motivo=∅)").
Cómo reproducir:
1. Anular una ejecución aprobada (pedido + aprobación).
2. Abrir "Ver verificación".
3. No se sabe por qué se revirtió.
Resultado actual: trazabilidad incompleta en la ficha del registro.
Resultado esperado: una insignia de estado en el encabezado y, en "Revertido", el motivo, quien pidió y quien aprobó.
Impacto: el registrante no sabe qué corregir; un auditor ve un cumplimiento que desapareció sin explicación.
Causa probable: se reutilizó el historial sin su campo reason.
Solución recomendada: pasar reason (y requestId) a recordPdtpExecutionHistory en la anulación y en la aprobación con motivo; mostrar el estado.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### Mejoras y cosméticos (formato condensado)

| ID | Sev. | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|---|
| CUM-11 | 🔵 | Registro | Con la sesión vencida o sin conexión, el registro dice «Error al subir la evidencia.». El POST sin sesión recibe 307 a `/login`, el `fetch` lo sigue y termina en 500 («Failed to find Server Action») | `pdtp-execution-form.tsx:105-117`; proxy (307 en `/api`) | DEMOSTRADO (flujo 6c, `curl -D`, `server-real.log`) | 401 JSON en `/api/**` sin sesión; mensajes «sin conexión» y «tu sesión venció» | B |
| CUM-13 | 🔵 | Registro | Se acepta «Se hizo» con cantidad 0, sin evidencia y aprobable | `lib/validation/prevention-module/pdtp.ts:36`; `executions.ts:485` | DEMOSTRADO (PGlite C02) | `min(0.01)`, o tratarla como «no realizada» con motivo | B |
| CUM-14 | 🔵 | Aprobaciones | Quien registró puede rechazar la anulación de su propia ejecución (otro puede volver a pedirla) | `review-requests.ts:258-260` | DEMOSTRADO (PGlite C09) | Excluir también a `executedByUserId` y al aprobador original | B |
| CUM-15 | 🔵 | Aprobaciones | La reducción de meta aprobada aplica un payload obsoleto: se aprobó «de 4 a 2» y se aplicó 6 → 2 | `review-requests.ts:173-199` | DEMOSTRADO (PGlite C10) | Comparar el valor vigente con `previousQuantity`; si cambió, rechazar por obsoleta | B |
| CUM-16 | 🔵 | Obligaciones | Reportar un caso con la cancelación en revisión deja la solicitud imposible de aprobar (colgada hasta que alguien la retire o la rechace) | `obligations.ts:225-260`; `review-requests.ts:268-272` | DEMOSTRADO (PGlite C11) | Retirar la solicitud al reportar, o bloquear el reporte | B |
| CUM-17 | 🔵 | Obligaciones | «Ir a aprobación» se muestra a quien no aprueba y lo lleva a `/forbidden` | `pdtp-obligations-workbench.tsx:173` | DEMOSTRADO (`prevfaena`, flujo 4) | Mostrarlo sólo con `approve`, o texto «En aprobación» | B |
| CUM-18 | 🔵 | Aprobaciones/Detalle | «Pedir anulación» sigue visible con una solicitud en revisión; el segundo intento da error | `ejecucion/[executionId]/page.tsx:62-71` | DEMOSTRADO (flujo 4) | Mostrar «Anulación en revisión» | B |
| CUM-19 | 🔵 | Planilla | En `/actividades` sólo se ofrece «No realizada», incluso a Prevención; «no aplica», reprogramar y meta viven en la página del programa | `actividades/page.tsx:229` (sin `canManageProgram`) | DEMOSTRADO (probe8) | Pasar `canManageProgram`, o enlazar a la vista de gestión | B |
| CUM-20 | 🔵 | Planilla/Aprobaciones | La reprogramación anuncia «Desvío registrado.» (no dice que queda en revisión) y al aprobarla «"No aplica" de N°… aprobado.» | `pdtp-deviation-form.tsx:102-106`; `not-applicable-review-section.tsx` | DEMOSTRADO (flujo 3F) | Mensajes por tipo | B |
| CUM-21 | 🔵 | Evidencia | Faena inexistente → 500 por FK; `activityId` inventado se acepta; el nombre original del archivo no se conserva | `evidence/route.ts:112-138`; `evidence-uploads.ts:33-40` | DEMOSTRADO (U5, U8, U12) | Validar la faena (404); guardar `originalName` saneado | B |
| CUM-22 | 🔵 | Evidencia | El tope de 25 MB se valida después de `request.formData()`: el cuerpo entero se carga en memoria | `evidence/route.ts:60, 95` | TEÓRICO | Revisar `Content-Length` o limitar en el proxy | B |
| CUM-23 | 🔵 | Evidencia | Se acepta un PDF políglota (`%PDF` + HTML); se sirve *inline* como PDF con `nosniff` | `lib/file-validation.ts:83-119`; `[name]/route.ts:66-74` | DEMOSTRADO (subida U6) · riesgo TEÓRICO | Sanear o `attachment` para PDF no parseable | M |
| CUM-24 | 🔵 | Planilla | `pdtp_executions` no tiene CHECK de segregación (`approved_by ≠ executed_by`) ni de consistencia (`approved ⇒ approved_by`/`approved_at`; `rejected ⇒ motivo`). Hoy la auto-aprobación por integración usa el mismo actor, así que la regla vive sólo en el servicio | `db/schema/prevention/pdtp.ts` (`pdtpExecutions`) | DEMOSTRADO (PGlite C15: los tres `UPDATE` pasan) | CHECK de consistencia; segregación con excepción `origin='integration'` | M |
| CUM-25 | 🔵 | Aprobaciones | La cola no se pagina (M-11) | `executions.ts:775-822` | CÓDIGO (33 filas en B) | Paginar por faena y actividad | B |
| CUM-26 | 🔵 | Aprobaciones | A 390 px los botones quedan fuera de la vista (desplazamiento horizontal en la tabla) | `aprobaciones/page.tsx:165-205` | DEMOSTRADO (`R-aprobaciones-390.png`) | Tarjetas en móvil | B |
| CUM-29 | 🔵 | Registro | «Semana 1–4» sin rango de días (la 4 va del 22 a fin de mes); el hecho no tiene fecha real, sólo mes y semana | `pdtp-execution-form.tsx:207-223` | CÓDIGO + captura | Rótulo «Sem. 4 (22–30)» y, opcional, la fecha del hecho | B |
| CUM-30 | 🔵 | Obligaciones/Constancias | Tiles de estado más un `Select` de estado: la misma dimensión dos veces (A5) | `constancias-workbench.tsx:66-86`; `pdtp-obligations-workbench.tsx:104-129` | Captura | Dejar los tiles como filtro | B |
| CUM-31 | 🔵 | Medidas | «Responsable» es texto libre: la CAPA queda sin usuario (sin avisos ni «Mis pendientes») | `execution-action-plan-panel.tsx:205-207`; `action-plan.ts:134-137` | CÓDIGO + flujo 8 | Selector de usuario (`responsibleUserId`) | M |
| CUM-35 | 🔵 | Planilla | 7 contadores-pestaña (EN CERO y PENDIENTES se solapan). A 390 px, unos 700 px de filtros antes de la primera fila | `pdtp-sheet-table.tsx` | Capturas `R-actividades-390.png` | Agrupar en 4 más «Más» | B |
| CUM-36 | 🔵 | Planilla | «Visor global» por nombre de rol: `jefa_chome` abre en vista semanal sin faena | `actividades/page.tsx:59` | CÓDIGO + captura `jefa` | Decidir por alcance o permiso | B |
| CUM-38 | 🔵 | Planilla | El registrante no ve el motivo del rechazo en la planilla (sólo en «Ver verificación») | `pdtp-sheet-table.tsx:519-540` (la tarjeta de ejecución no lee `rejectionReason`) | DEMOSTRADO (flujo 4, `prevfaena`) | Mostrarlo bajo la insignia RECHAZADA | B |
| CUM-32 | ⚪ | Planilla | El formulario de desvío ofrece los 12 meses (el servidor rechaza los futuros) | `pdtp-deviation-form.tsx:183-193` | DEMOSTRADO (probe8) | Filtrar como el formulario de registro | B |
| CUM-33 | ⚪ | Detalle | Un estado vacío de «formulario» ocupa la parte superior; el plan de acción habla de un checklist retirado | `ejecucion/[executionId]/page.tsx:94-105`; `execution-action-plan-panel.tsx:82` | Captura | Evidencia y estado arriba; corregir la copia | B |
| CUM-34 | ⚪ | Obligaciones | El origen muestra ids internos («worker:VoRAccr…:alta») | `pdtp-obligations-workbench.tsx:332-344` | Captura `R-obligaciones-1440.png` | Rótulo legible, como C-03 | B |
| CUM-37 | ⚪ | Medidas | Props `canManage` y `canVerify` sin uso en `AccionesTable` | `acciones-table.tsx:36-44` | CÓDIGO | Quitar | B |
| CUM-39 | ⚪ | Aprobaciones | El estado vacío de ejecuciones es un `div` propio («Sin pendientes»), no `EmptyState` | `aprobaciones/page.tsx:157-163` | CÓDIGO | `EmptyState` | B |

---

## Estado de hallazgos previos en este alcance

| Hallazgo | Dictamen | Evidencia propia |
|---|---|---|
| PRV-03 (futuro) | **Parcial** | Manual corregido y verificado: PGlite C07 más el formulario, que sólo ofrece hasta la semana en curso (N1). **Sigue abierto en integración** (CUM-10, SQL en B) |
| PRV-05 (cancelación de obligación) | **Corregido (verificado)** | Revisión por otra persona, sigue exigida mientras espera, mes cerrado (PGlite C11 y suite) y navegador N10. Residuo CUM-16 |
| PRV-07 (parcial oculta atraso) | **Parcial** | 1 de 4 ya es «Atrasada», pero un envío pendiente o una «no realizada» vuelven a esconderlo (CUM-02, PGlite C06) |
| PRV-08 (múltiples en celda) | **Corregido (verificado)** | Complemento `seq 2` en revisión; tope en el indicador (C08, N2). Residuo CUM-04 (mensaje y suma con integración) |
| PRV-12 (anular aprobada) | **Corregido (verificado)** | Pedido, segunda persona y mes abierto; el indicador baja (C09, N8). Residuos CUM-12, CUM-14, CUM-18 |
| PRV-16 (lado PDTP) | **Parcial** | Futuro y mes cerrado ahora frenan la casilla con error visible (`slot-deviation-connector.ts:181-190`). «Celda sin plan», «celda con ejecución» y «otro desvío» siguen sólo en el log (`:302-323`). CÓDIGO; E2E desde una casilla no ejecutado (lo cubre integracion) |
| PRV-20 (pendientes invisibles) | **Corregido (verificado)** | Tablero: «Ejecutadas 17 … 21 ejecuciones por aprobar →» (`prev`) y «· 19 por aprobar» (`prevfaena`) (probe7) |
| M-01 (texto de «no aplica» en casilla) | **Corregido (código)** | `components/prevention/program-slot-list.tsx:241` («Queda en revisión…») |
| M-06 (reducción y reprogramación sin segunda persona) | **Parcial** | Servicio corregido (PGlite C10: las dos en revisión, autorrevisión rechazada). Reprogramación en navegador ✓ (N6). **La reducción es inalcanzable en la UI** (CUM-05) y el payload puede quedar obsoleto (CUM-15) |
| M-09 (motivo 3 frente a 10) | **Corregido (verificado SQL)** | CHECK `pdtp_scheduled_instances_{not_applicable,cancel}_reason_check` ≥ 10, `NOT VALID` (`convalidated = f`, a propósito) en B |
| M-10 (`.catch(() => null)`) | **Corregido (código)** | `prevention-cphs-access.ts:43-52` (`nullIfCphsNotFound`); `faenas/[worksiteId]/page.tsx:30` |
| M-11 (N+1 y cola sin paginar) | **Parcial** | Recordatorios por lote y destinatarios por faena (`reminders.ts:284-307`). La cola sigue sin paginar (CUM-25; decisión declarada) |
| C-03 (ids en la evidencia) | **Corregido (verificado)** | Aprobaciones B: «Entrega EPP» y «Programa aprobado por Legal y RRHH», sin id. Persiste en el origen de obligaciones (CUM-34) |
| C-04 (rótulo sintético y observación humana) | **Corregido (verificado)** | Chip con ícono de «automático» para `origin = integration` (captura de Aprobaciones) |

---

## Qué no se pudo verificar y por qué

- **Cierre de mes en B:** la instrucción era no cerrar meses del programa real; se probó completo en PGlite (C14).
- **Cifras antes y después en B:** otros agentes escriben en el mismo programa y la misma faena; la verificación a mano se hizo en PGlite.
- **Meta por faena en navegador:** el diálogo no abre (CUM-05); la reducción se probó sólo por servicio.
- **Medidas:** verificación de eficacia, reapertura, cancelación y su efecto en el índice integral no se ejecutaron (se leyó el código).
- **PRV-16 de punta a punta** desde un módulo con casillas (alcotest o capacitación): corresponde a integracion; lo mío se dictaminó por código.
- **Aviso o correo al registrante** cuando lo rechazan o lo anulan: SMTP deshabilitado; no se revisaron las notificaciones in-app.
- **WebKit y Firefox; lector de pantalla:** sólo Chromium, con roles y teclado básico (Enter en el botón de meta).
- **Trigger de bitácora append-only (0340):** no aplica en bases `*_e2e`; es de otro agente.

## Limpieza

- **PGlite:** el archivo temporal `lib/__tests__/pdtp-cumplimiento-e2e.audit-tmp.test.ts` se copió a la carpeta del agente y **se borró del repo**.
- **Estado del repo al cierre:** `git status --porcelain` ya no lo muestra. Sí muestra `.audit-*` (del orquestador); tres `*.audit-tmp.test.ts` de **otros** agentes (capacitacion-closed-month, documental-integration, inspecciones-compliance); y `M .claude/settings.local.json`, que este agente no tocó.
- **Datos creados en B, todos `QA_CUM`, sin borrar a propósito:**
  - ejecuciones N°28 (s4, dos rechazadas), N°38 (s4, dos aprobadas), N°25 (aprobada), N°36 y N°41 (enviadas);
  - desvíos: «no aplica» N°42 aprobado, N°6 s3 rechazado, reprogramación N°28 s3 → oct s1, «no realizada» N°17 s4 (`sup`) y N°6 s3;
  - dos obligaciones N°57, una completada y una cancelada;
  - dos solicitudes aprobadas;
  - una medida CAPA sobre N°38;
  - subidas huérfanas de las pruebas HTTP, que el GC barre a las 24 h.
