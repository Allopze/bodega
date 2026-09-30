# AUDITORÍA — Integración transversal: motor de acreditación, evidencias, trazabilidad y operación

**Agente:** integracion (prefijo **INT-**) · **Fecha:** 2026-09-29 · **HEAD:** `11e67621`
**Entornos usados:** A (`:3100`, `bodega_audit_e2e`), B (`:3101`, `bodega_audit_real_e2e`, programa 2026 v2 real), PGlite con las 343 migraciones (sondas temporales), y una base propia desechable `bodega_auditlog_verif` en `:55432` (ya borrada).
**Evidencia cruda:** `scratchpad/audit/integracion/` (sondas `integracion-motor.audit-tmp.test.ts`, `integracion-tardio.audit-tmp.test.ts` y sus salidas `probe-results.json`, `probe-late.json`; `idor-output.txt`, `origin-output.txt`, `auditlog-append-only.txt`, `saneamiento-sim.txt`, `saneamiento-B.txt`, `wiring-B.txt`, `aprobaciones-1440.png`, `existing-suites.log`).

Rutas y archivos principales del alcance: `lib/services/pdtp/{accreditation,integration-evidence,fulfillment,trigger-events,obligations,executions,review-requests,evidence-references,evidence-gc,evidence-integrity}.ts`, `lib/services/pdtp-adapters/*`, `lib/services/prevention-evidence-upload.ts`, `db/migrations/0336…0342`, `scripts/report-pdtp-unverified-auto-approvals.ts`, `scripts/deploy-prod.sh`, `docker-compose.yml`, `app/api/cron/**`, `app/api/prevencion/**/[name]/route.ts`.

---

## Resumen

El **motor** quedó bien hecho donde se corrigió: la verificación de evidencia de integración (PRV-01) rechazó los 7 casos inválidos en las 5 fuentes que se auto-aprueban (35 de 35) y aceptó el caso válido (5 de 5). La segregación funciona en los 7 conectores que pasan el actor. Las revocaciones de inspección, capacitación, simulacro, CGRD, CPHS, EPP e indicadores operan. No hay IDOR en ninguna de las 10 rutas de descarga (probadas con `otrafaena` y `ti`, con rutas `../`, codificadas y subcadenas). La bitácora rechaza `UPDATE` y `DELETE` directos.

**Lo que no está listo:**

- **🟠 INT-01.** El paso de saneamiento que `deploy-prod.sh` corre en cada deploy (y la conciliación del libro de ese mismo deploy) se ejecuta en contenedores **sin el volumen de storage**. En la simulación, devolvió a revisión una aprobación automática legítima por `file_missing`. En producción, cada deploy desharía todas las auto-aprobaciones verificadas de alcotest, simulacros, CGRD, higiene y coordinación.
- **La verificación tiene dos atajos, ambos demostrados:**
  - higiene acepta el informe que subió otra persona, sin reclamarlo (INT-02);
  - la N°20 se auto-aprueba con cualquier documento corporativo de la biblioteca (INT-03).
- **La segregación tiene huecos, demostrados en PGlite y en B:**
  - cinco fuentes no guardan quién originó el hecho: N°17, N°18/23/63, N°46–49, N°50 y N°76 (INT-04). En B, la N°18 la aprobó la misma persona que cerró el acta;
  - las obligaciones integradas reportadas con texto quedan como «evidencia entregada» y se aprueban sin motivo (INT-05).
- **Integración y calendario no calzan:**
  - la integración acredita y auto-aprueba celdas futuras (INT-06). En B hay una N°53 de noviembre aprobada;
  - un hecho tardío nunca salda la celda que estaba planificada (INT-10);
  - un hecho sin verificar retira un «no aplica» ya aprobado por otra persona (INT-08).
- **Un error aprobado no tiene corrección:** una ejecución de integración aprobada por error en 12 fuentes no tiene cómo corregirse, porque el PDTP rechaza anular integraciones (INT-07).
- **La bitácora se puede eludir** con un GUC que cualquier rol puede fijar, con `TRUNCATE` o deshabilitando el trigger (INT-09).

**Notas:**

| | Nota |
|---|---:|
| Integración Programa ↔ Submódulos | **70/100** |
| Evidencias y trazabilidad | **70/100** |

Hallazgos: 🔴 0 · 🟠 1 · 🟡 12 · 🔵 18 · ⚪ 2.

---

## 1. Evidencia de integración (§22)

**Método.** Sonda PGlite `integracion-motor.audit-tmp.test.ts` con la capa de servicios real (`accreditPdtpFromEvent`) y reloj fijado al 29-09-2026. Para cada fuente se sembró la fila de dueño real de su dominio:

| Fuente | Tabla de dueño |
|---|---|
| alcotest | `prevention_alcotest_slot_evidence` |
| simulacro | `prevention_emergency_drill_evidence` |
| CGRD | `prevention_evidence_uploads` |
| higiene | `prevention_hygiene_measurement_evidence` |
| coordinación | `sst_document_versions` |

En todos los casos el archivo estuvo en disco. Todas las llamadas pasaron `autoApproveByUserId`.

### 1.1 Fuentes que se auto-aprueban con evidencia verificada

Resultado (`probe-results.json → s22_matrix_verificables`):

| Caso | alcotest (N°30) | simulacro (N°84) | CGRD (N°81) | higiene (N°45) | coordinación (N°20) |
|---|---|---|---|---|---|
| 1. Archivo real, misma faena | ✅ approved / provided | ✅ approved / provided | ✅ approved / provided | ✅ approved / provided | ✅ approved / provided |
| 2. Ruta inexistente | submitted · `not_registered` | idem | idem | idem | idem |
| 3. Archivo de OTRA faena | submitted · `other_worksite` | idem | idem | idem | idem |
| 4. Archivo de otro dominio | submitted · `wrong_domain` | idem | idem | idem | idem |
| 5. URL `https://x` | submitted · `external_url` | idem | idem | idem | idem |
| 6. Texto libre | submitted · `wrong_domain` | idem | idem | idem | idem |
| 7. sha256 alterado tras subir | submitted · `checksum_mismatch` | idem | idem | idem | idem |
| 8. Fila de dueño sin archivo | submitted · `file_missing` | idem | idem | idem | idem |
| 9. Documento **corporativo** cualquiera | — | — | — | — | 🔴 **approved / provided** (INT-03) |

- **Lectura:** el verificador (`lib/services/pdtp/integration-evidence.ts:144-170`) cumple lo que afirma el fix de PRV-01 en las cinco fuentes: 35 de 35 casos inválidos rechazados.
- **Motivo del rechazo:** queda en `source_metadata_json.evidenceRejection` (`accreditation.ts:863`).
- **Regla de auto-aprobación** (`accreditation.ts:619`): «incondicional» para inspección y ocurrencia de capacitación; «con evidencia verificada» para el resto.

**Casos límite de la cadena real, ejecutados con los servicios del submódulo:**

- **Higiene (INT-02):** `recordExposureMeasurement` aceptó el informe que otra persona (UC) había subido y **nunca reclamado** (`prevention_evidence_uploads.worksite_id = NULL`), para un GES de otra faena. La N°45 quedó `approved / provided`.
  - **Causa:** la medición lee la ruta del cliente (`prevention-hygiene.ts:421`) y escribe su propia fila de evidencia (`:466`) sin `claimPreventionEvidenceUpload`. El verificador valida la fila que el mismo acto acaba de crear.
  - **Consecuencia:** PRV-21 (el mismo PDF sosteniendo la N°45 en varias faenas) sigue abierto.
- **Coordinación (INT-03):** el verificador de `engagement` acepta cualquier `sst_document_versions` corporativa (`integration-evidence.ts:126-136, 158`). `createDocumentLink` deja vincular un documento corporativo a una coordinación de cualquier faena (`prevention-documents/links.ts:219`: la guarda sólo compara cuando ambos tienen faena). No se comprueba el tipo ni la vigencia del documento.

### 1.2 Fuentes incondicionales y fuentes que quedan `submitted`

`probe-results.json → s22_incondicionales_y_no_verificables`:

| Fuente | Rótulo | Archivo de otra faena y de otro dominio | Ruta inexistente | URL |
|---|---|---|---|---|
| inspección (N°10) | approved / `not_required` | approved / **`provided`** | approved / `not_required` | approved / `not_required` |
| capacitación ocurrencia (N°37) | approved / `not_required` | approved / **`provided`** | approved / `not_required` | approved / `not_required` |
| CPHS (N°11) | — | submitted / **`provided`** → otra persona aprueba **sin motivo** | — | — |

**Lectura:** fuera de las cinco fuentes verificables, «evidencia entregada» se decide sólo porque el archivo exista en **cualquier** dominio y de **cualquier** faena (`storageEvidenceExists`, `integration-evidence.ts:210-224`). Hoy los conectores pasan su propia ruta o un rótulo, así que el riesgo es teórico (INT-30). Pero un estado `provided` exime del motivo que exige PRV-02 (`executions.ts:771-773`).

### 1.3 Evidencia directa frente a evidencia interna

**Evidencia directa** es un archivo. Llega en alcotest, simulacro, CGRD, higiene N°45, capacitación (la primera evidencia activa de la ocurrencia) y EPP (el comprobante de la entrega).

**Evidencia interna** es el registro de origen. Las demás fuentes envían un rótulo: «Inspección completada: <run>», «Plan de emergencia aprobado: <código>», «MIPER vX publicada: <id>»…

- **Qué ve quien aprueba** (captura `aprobaciones-1440.png`, B, rol `prev2`):
  - un chip «Automático: Entrega EPP» repetido seis veces, o «Plan de emergencia aprobado»;
  - el id recortado a propósito (C-03, `evidence-href.ts:78`);
  - **ningún enlace ni identificador del registro de origen**. El único enlace de la fila es «Ver programa».
- **Archivo de otro módulo:** se ve como el chip «En el módulo de origen», sin enlace (`pdtp-evidence-thumbs.tsx:62-72`), salvo higiene, CGRD y campañas, que sí enlazan.
- **Contradicción con PRV-02:** se le exige a quien aprueba que escriba «qué revisaste», pero la plataforma no le lleva al registro que debe revisar (INT-11).

**¿Se evita subir un PDF artificial cuando ya existe el registro original?** No.

- `markPdtpExecution` permite el registro manual con archivo en actividades `enganche` (`executions.ts:50-120`). No mira el mecanismo, salvo para la exigencia de evidencia de las `constancia`.
- La planilla sólo avisa que «vale el mayor de los dos» (`pdtp-execution-form.tsx:249-253`). Con la regla `max(manual, Σ integración)` no se cuenta doble.
- Hay un caso en que el registro manual es la **única** forma de saldar una celda: cuando el hecho del submódulo ocurrió tarde (INT-10).

---

## 2. Segregación (PRV-02)

Con conectores reales, sin llamar directo al motor (`probe-results.json → prv02_conectores`). Quien origina el hecho es UA; la segunda persona es UB.

| Fuente → actividad | `executed_by` | ¿UA puede aprobar? | ¿UB sin motivo? | Veredicto |
|---|---|---|---|---|
| CPHS constitución → N°11 | UA | ❌ «Quien registró… no puede aprobarlo» | ❌ exige motivo | ✅ |
| CPHS revisión por la dirección → N°9 | UA | ❌ | ❌ exige motivo | ✅ |
| MIPER publicada → N°35 | UA | ❌ | ❌ exige motivo | ✅ |
| Documento publicado → N°43 | UA | ❌ | ❌ exige motivo | ✅ |
| Cierre de indicadores → N°7 | UA | ❌ | ❌ exige motivo | ✅ |
| Plan de emergencia → N°83 | UA | ❌ | ❌ exige motivo | ✅ |
| Entrega EPP → N°62 | UA | ❌ | ❌ exige motivo | ✅ |
| Protocolo MINSAL → N°46 | **null** | ✅ **aprobó** | — | 🔴 INT-04 |
| Control de vigilancia → N°50 | **null** | ✅ **aprobó** | — | 🔴 INT-04 |
| RE-28 → N°17 | **null** | ✅ **aprobó** | — | 🔴 INT-04 |
| Seguimiento RE-20 → N°76 | **null** | ✅ **aprobó** | — | 🔴 INT-04 |
| Obligación RE-20 (N°68) reportada con texto | UA | ❌ | ✅ **aprobó sin motivo** (`evidenceStatus = provided`) | 🟡 INT-05 |

**Lo mismo en B, con datos reales creados hoy por otros agentes:**

- La N°18 del acta de trabajador nuevo `Qoz0FgXTKq55IPk1-Y51C` tiene `executed_by = NULL`. El acta la creó y cerró `qa-prev`, y la N°18 la **aprobó `qa-prev`** con motivo.
- La N°23 del acta, `IA-…`/N°63 y la N°17 también quedaron sin actor.
- Las obligaciones N°15/N°52 del alta de trabajador quedaron `provided` sin archivo.

**Causa:**

- `onProtocolApplicabilityAssessed` recibe `actorUserId` y no lo reenvía (`hygiene-accreditation-connector.ts:213-226`).
- No pasan actor: `onSurveillanceControlAttended` (`:254`), la acreditación directa del acta de ingreso (`worker-onboarding-connector.ts:197`), `onSensitiveWorkerIdentificationClosed` (`worker-sensitivity-connector.ts:43`) y `onIncidentFollowupRecorded` (`incident-accreditation-connector.ts:387`).
- En las obligaciones, `reportPdtpObligation` marca `provided` si hay **texto** (`obligations.ts:271, 326`). Los conectores siempre envían texto.

---

## 3. Revocación (PRV-04)

### 3.1 Tabla fuente → transición → ¿revoca?

| Fuente | Transición | ¿Revoca? | Evidencia |
|---|---|---|---|
| Inspección | Cancelar o volver a «en curso» una ejecutada | ✅ | `prevention-inspections/transitions.ts:170-176`; B: `inspeccion revoked` |
| Capacitación (ocurrencia) | Salir de «hecha» (a no hecha, no aplica o pendiente) | ✅ | `prevention-training-occurrences.ts:643-658`; B: 2 en `draft` |
| Simulacro | Cancelar uno completado | ✅ | DEMOSTRADO (N°84 → `draft`); `prevention-emergency.ts:1026-1080` |
| Plan de emergencia | Archivar | ❌ (decisión) | DEMOSTRADO: la N°83 sigue `approved` tras archivar «emitido por error» |
| CGRD | Terminar coordinador, disolver comité, anular acta | ✅ | `prevention-cgrd.ts:185-227, 301-335, 844-917` |
| CGRD | Matriz reemplazada o archivada | ❌ | Sin transición que revoque la N°80 |
| CPHS | Disolver comité | ✅ | `prevention-cphs.ts:154-195`; B: N°11 → `draft` |
| CPHS | **Vencimiento del mandato** | ✅ **revoca la N°11** | `prevention-cphs.ts:1045-1052` (criterio opuesto al de archivar) |
| CPHS | Revisión por la dirección (N°9) | ❌ | No hay reapertura ni anulación |
| Indicadores | Reabrir el período | ✅, sin actor en el historial PDTP | DEMOSTRADO (`userId null`); `prevention-indicadores.ts:712` |
| EPP | Anular la entrega | ✅ | `deliveries-void.ts:208-214` |
| Higiene | Protocolo vuelve a «pendiente de evaluar» | ✅ | `hygiene-accreditation-connector.ts:188-205` |
| Higiene | Vigilancia deja de estar «asistida» | ✅ | `prevention-hygiene.ts:875-892` |
| Higiene | **Anular una medición (N°45)** | ❌ | No existe la transición |
| Alcotest | **Anular un control o un envío** (N°30/31/32) | ❌ | No existe la transición (`prevention-alcotest.ts`) |
| MIPER | Revisión reemplazada | ❌ (decisión) | B: `riskmatrix-VDnh…` `superseded` con N°35 `approved` |
| Documentación | Archivar documento o versión | ❌ (decisión) | `prevention-documents/crud.ts` sin revocación |
| Coordinación | — | ❌ | `prevention-external-engagements.ts` sólo crea, agrega medidas y cierra: **no hay anulación** |
| Acta de ingreso / RE-28 | Acta cerrada | ❌ | Inmutable: sólo se borra en borrador (`sst-module/evaluations.ts:380-416`) |
| Incidentes RE-20 | Triage que reclasifica | ✅ cancela obligaciones pendientes; ❌ las reportadas o aprobadas | `incident-accreditation-connector.ts:270-327` |
| Programa (N°1) | — | n/a | — |

**Revocación en un mes cerrado:** DEMOSTRADO. Se revocó una inspección de mayo con mayo cerrado y la ejecución pasó a `draft`. La revocación no consulta el cierre (`accreditation.ts:1016-1150`). Sólo lo delata `driftedSinceClose`, por diseño.

**Vía de corrección en el PDTP:** no hay. `requestPdtpExecutionAnnulment` rechaza las integraciones: «se corrige anulando el registro de origen» (`review-requests.ts:157-159`). Donde el origen no tiene anulación (las ❌ de arriba), una aprobación errónea es **permanente** (INT-07).

### 3.2 ¿Es coherente la decisión de no revocar al archivar o reemplazar?

**En parte sí.** Cada ejecución de integración ocupa sólo la celda de su hecho (aprobación o publicación). «El período en que estuvo vigente queda cubierto y los siguientes no» se cumple en las actividades planificadas por celda: los meses siguientes necesitan un hecho propio.

**Hay tres incoherencias:**

1. **No se distingue «reemplazado» de «anulado por error».**
   - El archivo del plan exige un motivo libre (`prevention-emergency.ts:521-571`), pero el resultado es el mismo.
   - Un plan emitido por error sigue acreditando la N°83 (DEMOSTRADO), y el PDTP no deja anularlo (INT-07).
2. **Criterios opuestos para hechos equivalentes.** El vencimiento natural del mandato del CPHS **sí** revoca la N°11 del período en que se constituyó (`prevention-cphs.ts:1045`). El archivo de un plan, un documento o una MIPER no revoca.
3. **Actividades de «estado» planificadas cada mes.** N°35 «mantener actualizada la MIPER», N°36 y N°43 tienen 12 celdas en B, pero sólo las acredita un **evento** de publicación.
   - «Vigente» no se representa: un mes sin re-publicar queda adeudado aunque la matriz esté vigente, y re-publicar sólo para acreditar sería artificial (INT-16).
   - La N°19 (carpeta legal) sí usa el patrón correcto: acredita el mes si la carpeta está vigente.

### 3.3 Huérfanos (SQL, A y B)

**B** (15 fulfillment events, 38 ejecuciones de integración al cierre de la prueba):

- **Fuentes inexistentes:** ninguna. Las 6 entregas EPP existen y no están anuladas; los 6 planes existen.
- **Fuentes anuladas o archivadas con ejecución viva:**
  - plan `pemgp-35Dweg…` **archivado** con N°83 `submitted`;
  - MIPER `superseded` con N°35 `approved`.

  Ambos casos son coherentes con la decisión de §3.2.
- **Subidas y archivos:**
  - toda fila de `pdtp_evidence_uploads` y `prevention_evidence_uploads` tiene su archivo;
  - hay 1 subida CGRD sin reclamar (`fmbps1…`), que el GC nunca limpiará (INT-23);
  - no hay evidencia referenciada sin archivo.
- **Libro:** 1 evento `emergencia` en `error`: «La faena 8GEy… no pertenece al programa pdtp-2026-v1». Viene de antes del fix PREV-I16; la conciliación diaria lo pasaría a `rejected`.
- **Bindings sin fuente viva** (INT-24):
  - 13 `capacitacion/close` que apuntan a cursos `trc-*` cuya tabla ya no existe;
  - 35 `campana/close`, cuya campaña ya no acredita.

**A:** 3 ejecuciones con `storage/pdtp-evidence/e2e-acta-pdtp.pdf` sin fila de subida (semilla anterior a 0334, admitida por la «regla heredada»), y 1 subida CAPA sin reclamar. No hay huérfanos de fuente.

---

## 4. Eventos disparadores y obligaciones

Sonda `probe-results.json → trigger_events, mes_cerrado_y_futuro, prv22, idempotencia_libro`:

| Caso | Resultado | Veredicto |
|---|---|---|
| Evento del año de un programa en borrador (2027) | `pending` (espera la activación) | ✅ |
| Evento de un año sin programa (2028) | `pending`, indefinido hasta que exista el programa | ✅ por diseño |
| Doble evento (misma clave) | `created: false` | ✅ idempotente |
| Doble hecho en el libro de cumplimiento | 1 evento, 1 ejecución | ✅ |
| Evento sin actividad configurada | `ignored` (terminal: no se reprocesa si luego se configura) | 🔵 INT-17 |
| Evento de una faena **excluida** de la actividad | `error`, reintentado en cada corrida (`attempts` 2) | 🔵 INT-17 |
| Cabeza de cola: 1 evento en error más antiguo, `limit=1` | El evento nuevo válido queda `pending` (bloqueado) | 🔵 INT-17 (teórico con el `limit` 200 del cron) |
| Inspección acreditada en un **mes cerrado** | Se auto-aprueba dentro del mes cerrado | ✅ por diseño (`period-closures.ts:34-44`) |
| CPHS `submitted` en un mes cerrado → aprobar | Rechazado: «El mes de junio… está cerrado» | ✅ |
| **Celda futura:** acta CGRD verificada de hoy, casilla de diciembre | **approved en 2026-12 semana 1** | 🔴 INT-06 |
| PRV-22: N°20 como constancia → cierre de coordinación | Evento `rejected` con `deferredReason: mechanism_constancia` y actor conservado; 0 ejecuciones | ✅ |
| PRV-22: reproceso sin cambiar el mecanismo | `stillDeferred: 1` | ✅ |
| PRV-22: mecanismo a `enganche` → reproceso ×2 | 1 ejecución `submitted` (la primera vez), 0 la segunda; evento `accredited` | ✅ idempotente |

**En B:** la N°53 de `ws-horcones` quedó **aprobada en 2026-11 semana 4**. Es la ocurrencia CAP-21 m11-w4, completada hoy por `qa-prev-faena`. Es la misma falla de INT-06 en el entorno real.

**En B, además, el programa v2 está desalineado con el contrato de mecanismos del código** (`scripts/apply-pdtp-2026-mechanisms.ts:105,130`, INT-19):

| Actividad | En B | Lo que espera el código |
|---|---|---|
| N°2 | retirada | reactivada el 23-09 |
| N°3 | `constancia` | `enganche` |
| N°20 | `constancia` | `enganche` |

Consecuencias mientras nadie firme y active la revisión que abre `apply-pdtp-mechanisms`:

- la toma de conocimiento del padrón no acredita la N°3;
- las coordinaciones con el mandante quedan diferidas: PRV-22 funciona, pero exige doble registro en Constancias.

---

## 5. NA propagado desde casillas (PRV-16)

Con `recordAlcotestSlotStatus` real (`probe-results.json → prv16`):

| Casilla | Resultado para la persona | Estado de la casilla | Desvío en el PDTP |
|---|---|---|---|
| Mes cerrado (junio) | ❌ Error visible: «El mes de junio… está cerrado» | sin cambio | — ✅ |
| Semana futura (noviembre) | ❌ Error visible: «…semana que aún no ocurre» | sin cambio | — ✅ |
| Celda **sin planificación** (agosto semana 2) | ✅ «ok» | **no_aplica** | **ninguno**, sin aviso 🟡 |
| Celda planificada (agosto semana 1) | ✅ | no_aplica | `not_applicable pending_review` ✅ |

- **Código:** las guardas visibles son `slot-deviation-connector.ts:187-195`. Los demás rechazos (sin plan, faena excluida, desvío de la planilla, celda con ejecución viva) se tragan en `:323`.
- **Camino que lo esconde todo:** en capacitación, la propagación que corre después del commit (salir de «hecha») se ejecuta con `.catch(logger.error)` (`prevention-training-occurrences.ts:691`). Ahí hasta el rechazo por mes cerrado queda invisible.
- **Veredicto: PRV-16 Parcial** (INT-13).

---

## 6. Evidencia a largo plazo

### 6.1 GC (PRV-17)

- `collectPdtpEvidenceReferences` suma las solicitudes de resultado (`evidence-references.ts:146-153`) y la descarga las autoriza (`:102-111`). La suite existente `pdtp-evidence-references.test.ts`, bloque «PRV-17», pasa.
- **Sigue en modo de prueba:** `docker-compose.yml:98` deja `PDTP_EVIDENCE_GC_DELETE` vacío, y la ruta es `dryRun` salvo que la variable esté en `"true"` (`app/api/cron/pdtp-evidence-gc/route.ts:41-44`).
- **Límite:** el GC sólo barre `pdtp-evidence/`, `inspection-evidence/` y `risk-map/`. Las subidas no reclamadas de CGRD, campañas, higiene y CAPA quedan para siempre (INT-23).
- **Veredicto: PRV-17 Corregido (verificado por código y prueba).**

### 6.2 Escaneo de integridad (M-12)

Sonda `integridad`:

- **Recorre todos los dominios, pero sólo lo que el PDTP referencia.** Detectó como faltante el acta CGRD de una ejecución `approved` que se borró (y los archivos inexistentes de la matriz). La evidencia de un módulo que no está en `evidence_url` no se escanea: fotos de respuestas de inspección, evidencias adicionales de simulacro y capacitación, documentos SST en Cloudreve.
- **La aprobada sin archivo sigue contando:** queda `approved / provided`. El escaneo sólo registra en el log y avisa.
- **La alteración no se detecta sin sha registrado.** Se alteró un archivo de capacitación y no hubo `mismatch`: hubo 17 `withoutChecksum`. Inspección y capacitación no guardan sha en la ejecución (sólo lo guardan las 5 fuentes verificables y la evidencia manual).
- **Veredicto: M-12 Parcial** (INT-12).

### 6.3 Descargas: IDOR, traversal y cabeceras

`idor.mjs` contra B, con filas y archivos `QA_INT` sembrados en `ws-horcones` (ajena a `otrafaena`) y `faLSIoq49…` (propia de `otrafaena`). Todo quedó borrado al terminar.

| Ruta | admin | prevfaena (horcones) | otrafaena ajena / propia | ti | Subcadena del nombre | Traversal (`../`, `%2e%2e`, doble codificación) |
|---|---|---|---|---|---|---|
| alcotest/evidence | 200 | 200 / 404 Biodiversa | **404 / 200** | 403 | 404 | 400/404, sin fuga |
| campanas/evidence | 200 | 200 / 404 | **404 / 200** | 403 | 404 | 400/404 |
| capacitacion/evidence | 200 | 200 / 404 | **404 / 200** | 403 | 404 | 400/404 |
| cgrd/evidence | 200 | 200 / 404 | **404 / 200** | 403 | 404 | 400/404 |
| cgrd/mapa | 200 | 200 / 404 | **404 / 200** | 403 | 404 | **500** (INT-22), sin fuga |
| emergencias/simulacros/evidencia | 200 | 200 / 404 | **404 / 200** | 403 | 404 | 400/404 |
| higiene/evidence | 200 | 200 / 404 | **404 / 200** | 403 | 404 | 400/404 |
| inspecciones/documento | 200 | 200 | **404** | 403 | 404 | 400/404 |
| inspecciones/evidence | 200 | 200 | **404** | 403 | 404 | 400/404 |
| pdtp/evidence | 200 | 200 | **404** | 403 | 404 | 400/404 |

- **Cabeceras:** todas llevan `nosniff`. Los documentos se sirven `inline` sólo si son PDF o imagen.
- **Veredicto:** no hay IDOR entre faenas ni para roles sin permiso. **PRV-18 Corregido (verificado)**: la subcadena da 404.
- **PRV-21:** la descarga de higiene existe con alcance ✅. El reuso del informe sigue abierto (INT-02), así que queda **Parcial**.
- **M-20 sigue abierto:** la descarga PDTP no distingue la clase de dato y no se audita (`app/api/prevencion/pdtp/evidence/[name]/route.ts`).
- **M-21:** la extensión sale del MIME (`prevention-evidence-upload.ts:84`). Corregido (código).

**M-02** (`origin-output.txt`, POST a `/api/prevencion/{pdtp,cgrd,higiene}/evidence`):

| Solicitud | Resultado |
|---|---|
| `Origin` ajeno | 403 «Origen no permitido» |
| `Sec-Fetch-Site: cross-site` | 403 |
| Mismo origen | Pasa al handler (400 de validación) |
| Sin `Origin` | Pasa, como corresponde a un cliente no navegador |

Con `Origin` ajeno más un `X-Forwarded-Host` falso también pasa, pero un navegador no puede enviar esa cabecera sin preflight (⚪ INT-33). **Corregido (verificado).**

---

## 7. Trazabilidad (§26) y bitácora append-only (PRV-13)

### 7.1 Quién, qué, cuándo, antes y después

| Cambio | Qué queda | Brecha |
|---|---|---|
| Acreditación de integración | Historial de la ejecución (`audit_log` `pdtp:execution`), con antes y después y el motivo «Acreditación por integración desde X (id)» (`accreditation.ts:1215-1233`) | El actor es `null` cuando no hay auto-aprobación |
| Aprobación o rechazo | Historial, `pdtp_change_log` y `operational_activity` | — |
| Revocación | Historial `revoked` con motivo; si había aprobación humana, además changelog (`accreditation.ts:1112-1140`) | Reapertura de indicadores y vencimiento del CPHS: actor `null` (DEMOSTRADO, INT-20) |
| Retiro automático de un desvío por integración | Changelog con `changedBy null` y el texto de la fuente | `withdrawn_by_user_id` = **el autor del NA**, no el sistema. El motivo dice «registró **evidencia real**» aunque fue un rótulo `submitted` (DEMOSTRADO, INT-08) |
| Eliminación de evidencia | Sólo el GC la borra, y deja `audit_log` `storage_orphan_sweep` | Alcotest, simulacro e higiene no tienen anulación de evidencia: no hay borrado ni corrección |
| Saneamiento del deploy | Historial `revoked` y changelog «PRV-01/PRV-03…» firmados por `PDTP_UNVERIFIED_ACTOR_USER_ID` o por el primer administrador | El «primer administrador» es `limit 1` sin orden (INT-27) |

### 7.2 Bitácora append-only (migración 0340)

Base propia `bodega_auditlog_verif` (nombre no exento), migrada con `node scripts/migrate.mjs` (`auditlog-migrate.log`). Salida en `auditlog-append-only.txt`.

| Prueba | Rol `postgres` (superusuario, como `POSTGRES_USER` en el contenedor oficial) | Rol NO superusuario con DML (`qa_int_app`) |
|---|---|---|
| `UPDATE audit_log` directo | ❌ «La bitácora audit_log es de sólo agregar» | ❌ |
| `DELETE audit_log` directo | ❌ | — |
| `UPDATE` o `DELETE` sobre `pdtp_change_log` con fila | ❌ | — |
| Borrar un programa (cascada al changelog) | ❌ (bloquea por el trigger) | — |
| `SET LOCAL app.audit_maintenance='on'` + `UPDATE` | ✅ **alteró la fila** | ✅ **alteró la fila** |
| `TRUNCATE audit_log` | ✅ **vació la tabla** (en rollback) | ✅ **vació la tabla** (en rollback) |
| `ALTER TABLE … DISABLE TRIGGER` | ✅ (dueño) | — |
| `session_replication_role = replica` | ✅ (superusuario) | — |

**Exención por nombre** (`0340:19-20`, regex `(^|[_-])(test|e2e|capture|tmp|temp)($|[_-])`):

| ¿Exento? | Nombres |
|---|---|
| No | `bodega` (el valor por defecto de `POSTGRES_DB`), `plataforma`, `bodega_prod`, `bodega_temporal`, `bodega_testing` |
| **Sí** | `bodega_restore_tmp`, `bodega-temp`, `bodega_capture`, `prod_e2e`, `temp` |

El riesgo está en promover a producción una base restaurada con un nombre así.

**Veredicto PRV-13: Parcial.** Protege de un `UPDATE` o `DELETE` accidental del código. No protege del rol de la aplicación ni de SQL deliberado: el GUC de mantenimiento no requiere privilegio y `TRUNCATE` no está cubierto (INT-09).

---

## 8. Saneamiento (`scripts/report-pdtp-unverified-auto-approvals.ts`)

**Contra B, sólo reporte** (`saneamiento-B.txt`): «aprobadas revisadas: 7 · hallazgos: 1», que es la N°53 de `ws-horcones` en 2026-11 semana 4 («semana futura aprobada», la de INT-06). El resultado fue el mismo con el `STORAGE_PATH` real y con uno vacío, porque en B no hay auto-aprobaciones de las 5 fuentes verificables.

**Simulación del contenedor del deploy** (`saneamiento-sim.txt`, base propia con dos aprobaciones automáticas CGRD legítimas: agosto y diciembre):

| `STORAGE_PATH` | Hallazgos |
|---|---|
| Con el archivo (como `app`) | 1: diciembre («semana futura») |
| **Vacío (como el one-shot del compose)** | **2: agosto «auto-aprobada sin evidencia verificable (file_missing)»** + diciembre |

**Causa:** los servicios one-shot `apply-pdtp-unverified-approvals` (`docker-compose.yml:831-846`) y `reconcile-pdtp-fulfillment-events` (`:809-822`) no declaran `STORAGE_PATH` ni `volumes`. El storage cae entonces en `/app/storage`, vacío en la imagen (`lib/storage/config.ts:39-44`). El `app` monta `bodega-storage:/data/storage` (`:127, 151-152`).

**Idempotencia y no-aborto del deploy:**

- En `DEPLOY_MODE`, un error sale con código 0 y el deploy sigue (`report-…ts:165-171`, `deploy-prod.sh:643`).
- No toca meses cerrados (`:135-141`).
- Sólo toca filas `approved`. Pero **se repite en cada deploy**: todo lo auto-aprobado desde el deploy anterior vuelve a revisión.
- La conciliación del deploy acredita los eventos pendientes de las 5 fuentes como `submitted` con `evidenceRejection: file_missing`, en vez de auto-aprobarlos (INT-01).

---

## 9. Observabilidad y operación (§29)

**Crons** (`docker-compose.yml:257-372`). El contenedor `cron` llama por HTTP a `app` (`scripts/cron-runner.mjs`), así que estos jobs **sí ven el storage**:

| Job | Hora |
|---|---|
| `pdtp-daily-reconcile` | 05:45 |
| `prevention-cron-staleness` | cada hora, :40 |
| `backup-health` | 08:40 |
| `pdtp-evidence-integrity` | 05:15 |
| `pdtp-evidence-gc` | 04:30, modo de prueba |

- **Conciliación diaria:** pasos independientes con try/catch; falla la corrida si falla un paso, y avisa (`app/api/cron/pdtp-daily-reconcile/route.ts:36-68`).
- **Vigilancia de staleness** (`lib/services/cron-staleness.ts:5-19`): cubre 13 jobs de Prevención. **No cubre `backup-health`**, que no usa `withCronLock` y por eso no deja fila en `cron_runs`. Tampoco puede detectar la caída del contenedor `cron`, del que depende. El healthcheck del contenedor sólo lo marca `unhealthy`; `restart: unless-stopped` no lo reinicia.
- **Respaldos:** `backup-scheduler` corre bajo `profiles: ["backup"]` (`:171-172`) y `deploy-prod.sh` no lo levanta. La doc pide comprobarlo a mano después de cada deploy (`RESPALDOS_Y_RESTAURACION.md`, sección PRV-14). `backup-health` avisa si falta el respaldo (notificación a `admin:backups`).
- **Logging:**
  - en producción el nivel es `warn` (`lib/logger.ts:17`), así que las líneas `info` de acreditación y revocación no se emiten;
  - `onRequestError` registra los errores no capturados (`instrumentation.ts:26-45`);
  - no hay captura externa (Sentry o equivalente);
  - no hay configuración de `logging` ni rotación en el compose: los logs viven en el `json-file` del contenedor y se pierden al recrearlo en cada deploy (INT-25).
- **Health:** `/api/health` con healthcheck del `app` (`:158-162`).

**«Si mañana desaparecen evidencias de actividades, ¿podemos saber qué ocurrió y recuperarlas?»**

- **Detectarlo: sí, al día siguiente.** Cubre los archivos que el PDTP referencia, en todos los dominios (DEMOSTRADO). No cubre la evidencia de módulos que el PDTP no referencia, y sin sha no detecta alteraciones (INT-12). En la configuración de producción con documentos SST en Cloudreve, el escaneo lee disco local: da falsos «faltantes» y nunca ve el archivo real (INT-14).
- **Saber qué ocurrió: sólo si lo hizo la aplicación.** El GC deja fila de auditoría. Un borrado fuera de la aplicación no deja rastro: los logs no persisten más allá del contenedor y no hay auditoría de archivos. Tampoco se sabe quién descargó (M-20).
- **Recuperarlas: sí, del snapshot nocturno.** Está cifrado, se retiene 30 días, trae sha256 en el manifiesto, y hay un procedimiento de restauración selectiva documentado y coherente con la estructura del tar (`backup-orchestrator.sh:213-223`). Con tres condiciones: RPO de 24 h, un `backup-scheduler` que nadie levanta en el deploy, y que alguien actúe, porque la ejecución aprobada sigue contando mientras tanto.
- **Riesgo operativo añadido:** si ese día hay un deploy, el saneamiento devuelve a revisión las auto-aprobaciones, pero por la razón equivocada (INT-01).

---

## 10. §23 Mapa de integración consolidado

**Leyenda:** ✅ integrada · 🟡 parcial · ❌ no integrada (y no debe) · 🔴 integrada incorrectamente.

**Fuentes de las actividades N°:** programa 2026 v2 de B (`b-activities.txt`), bindings de B y conectores del código.

| Submódulo | Estado | Actividades que acredita (B) | Vía / aprobación | Revoca | Observaciones y descuentos |
|---|---|---|---|---|---|
| Inspecciones | ✅ | 10, 24–27, 29, 33, 34, 39–41, 64, 65 (13 bindings) | Directa, auto-aprobada con actor | ✅ | La evidencia es un rótulo; las fotos no se escanean (INT-12) |
| Capacitación | 🟡 | 16, 37, 38, 51, 53–60, 63, 85–89 (CAM-*) | Directa auto-aprobada; obligación en 16/57 | ✅ | Celda futura auto-aprobada (INT-06, B N°53 nov). N°38/N°53: sus responsables (sup, jt) no tienen `training:record` según el propio preflight (INT-18). Sin sha (INT-12) |
| Campañas | ❌ (legado, correcto) | — (85–89 pasaron a CAM-*) | Sólo el evento `campaign_closed`, que se ignora | — | 35 bindings muertos (INT-24) |
| Alcotest | 🟡 | 30/31 (según rol), 32 | Directa, auto-aprobada con archivo verificado (PRV-01 ✓ 8/8) | ❌ no hay anulación | INT-07, INT-06 (casilla futura) |
| Emergencias / simulacros | 🟡 | 83 (plan), 84 (simulacro) | 84 auto-aprobado; 83 `submitted` | 84 ✅; 83 ❌ (decisión) | La N°83 aprobada en septiembre no salda la celda de marzo (INT-10); archivar por error no revoca (INT-07) |
| CGRD | 🟡 | 79, 80, 81 | 81 auto-aprobado; 79/80 `submitted` | 79/81 ✅; 80 ❌ | Celda futura (INT-06) |
| CPHS | 🟡 | 11 (constitución), 9 (revisión por la dirección) | `submitted`, segregación ✅ | 11 ✅ (incluso al vencer); 9 ❌ | Criterio opuesto al de archivar (§3.2); N°9: Legal no tiene el permiso (preflight) |
| Estructura preventiva | ✅ | 11 (obligación por dotación) | Obligación | n/a | Texto = `provided` (INT-05) |
| Higiene | 🟡 | 45 (auto), 46–49, 50 (44 como constancia) | Directa | 46–50 ✅; 45 ❌ | **INT-02** (informe ajeno), **INT-04** (46–50 sin actor) |
| Incidentes RE-20 | 🟡 | 66–75, 77, 78 (obligación); 76 (directa) | Obligación `submitted` | Triage ✅ sobre las pendientes | INT-05 (texto = `provided`), INT-04 (76 sin actor), sin corrección de lo reportado |
| Evaluaciones SST / habilitación | 🟡 | 15, 52 (obligación); 17 (RE-28); 18, 23, 63 (acta) | Directa y obligación | ❌ (acta inmutable) | **INT-04** (B: N°18 aprobada por quien cerró el acta); 18 y 63 también por otras vías (INT-31) |
| Indicadores | ✅ | 7 | Directa, `plannedPeriod` = mes del indicador | ✅ (sin actor, INT-20) | Mes con 0 HH: decisión de negocio abierta |
| MIPER | 🟡 | 35 | Directa `submitted` | ❌ reemplazo (decisión) | La N°35 mensual «mantener» sólo acredita al publicar (INT-16) |
| Requisitos legales | 🟡 indirecta (correcto) | (19 vía carpeta) | Indirecta | — | Sin conector propio, por diseño |
| Documentación | 🟡 | 43 (publicación), 36 (acuses), 19 (carpeta legal mensual), 18 (RIOHS por obligación) | Directa y obligación | ❌ archivo (decisión) | 36/43 mensuales frente a eventos (INT-16); SST en Cloudreve (INT-14) |
| Visitas y coordinación | 🟡 | 20 | Directa, auto-aprobada con acta | ❌ (no hay anulación) | En B la N°20 es `constancia` → hechos diferidos (PRV-22 ✓) y doble registro hasta aplicar mecanismos (INT-19); **INT-03** |
| EPP | ✅ | 62 | Directa `submitted` | ✅ (anular entrega) | El hecho tardío no salda (INT-10); `not_required` porque la actividad no declara requisito de evidencia |
| CAPA | ❌ (correcto) | — | — | — | Trazabilidad de origen, sin acreditación |
| Permisos de trabajo | ❌ (correcto) | — | — | — | — |
| PPA | ❌ (correcto) | — | — | — | — |
| Privacidad | ❌ (correcto) | — | — | — | — |
| Daño material | ❌ indirecta (correcto) | — (vía incidentes) | — | — | — |
| Constancias | ✅ manual | 3, 6, 20, 22, 28, 42, 44, 61, 82 | Manual con segunda persona | Desvío o anulación | N°82 «Mapa de riesgo» podría engancharse al plano de `cgrd/mapa` (doble registro) |
| Programa (N°1) | ✅ | 1 | Directa, actor = decisor | n/a | — |

**Actividades huérfanas:** ninguna.

- Toda actividad `enganche` o `compuesta` activa de v2 tiene un conector vivo en el código.
- Ningún conector apunta a una N° retirada (2, 5, 12, 13, 14, 21) ni inexistente.
- El preflight de cableado corrido contra B (`wiring-B.txt`) no reporta `inspectionGaps`, `lostRuns` ni `activitiesWithoutApprovedInstrument`. Sí reporta 7 roles responsables sin permiso de ejecución y la N°56 sin padrón.
- El preflight evaluó `pdtp-2028-v1`, que otro agente activó en B, y no el año en curso (INT-26).

**Duplicados de camino (INT-31):**

- N°63 llega por CAP-03 y por el acta de ingreso;
- N°18 llega por el acta de ingreso y por la entrega del RIOHS.

El tope mensual por actividad lo contiene (`compliance.ts:370`).

**Asociaciones rotas:**

- 13 bindings a cursos `trc-*` inexistentes (INT-24);
- la N°2 retirada en el programa real, contra el contrato del código (INT-19).

---

## H. Hallazgos

### 🟠 Críticos

```
ID: INT-01
Severidad: 🟠 CRÍTICO
Submódulo: Motor transversal / despliegue
Categoría: Integración / Operación / Evidencia
Título: El saneamiento y la conciliación del deploy corren sin el volumen de storage y devuelven a revisión todas las auto-aprobaciones legítimas en cada deploy
Archivo(s): docker-compose.yml; scripts/report-pdtp-unverified-auto-approvals.ts; scripts/deploy-prod.sh; lib/services/pdtp/integration-evidence.ts; lib/storage/config.ts
Línea(s): docker-compose.yml:809-822 y 831-846 (sin STORAGE_PATH ni volumes; comparar con 127 y 151-152 del app); report-…ts:104-113; deploy-prod.sh:636 y 643; integration-evidence.ts:161-166; config.ts:39-44
Pantalla/ruta: —
Endpoint: one-shots `reconcile-pdtp-fulfillment-events` y `apply-pdtp-unverified-approvals`
Rol: operación (firma PDTP_UNVERIFIED_ACTOR_USER_ID o el primer administrador)
Descripción: `verifyIntegrationEvidence` lee el archivo del disco. En los contenedores one-shot el storage cae en /app/storage, que está vacío. Cada ejecución auto-aprobada de alcotest, simulacro, CGRD, higiene o coordinación se clasifica entonces como `file_missing` y se devuelve a `submitted` (evidenceStatus `pending`). Como el paso corre en cada deploy, todo lo auto-aprobado desde el deploy anterior vuelve a la cola. La conciliación del mismo deploy acredita los eventos pendientes de esas fuentes como `submitted` con `evidenceRejection: file_missing`, en vez de auto-aprobarlos.
Evidencia: DEMOSTRADO. Base propia con dos aprobaciones automáticas CGRD legítimas y el archivo presente.
- report con STORAGE_PATH=<dir con archivo> → 1 hallazgo (sólo la de diciembre, futura);
- report con STORAGE_PATH=<dir vacío, igual al contenedor> → 2 hallazgos, incluida «qa-int-e1 · N°81 · 2026-08 sem 1 · auto-aprobada sin evidencia verificable (file_missing)» (saneamiento-sim.txt).
CÓDIGO: compose sin volumen (líneas citadas).
Cómo reproducir:
1. Tener una N°81 auto-aprobada con su acta en /data/storage.
2. Correr `docker compose run --rm apply-pdtp-unverified-approvals` (como lo hace deploy-prod.sh:643).
3. La ejecución vuelve a `submitted` con motivo `file_missing`, firmada por el primer administrador.
Resultado actual: en cada deploy, el cumplimiento auto-aprobado y verificado baja a revisión; la cola se llena y el historial registra un motivo falso.
Resultado esperado: el paso ve el mismo storage que `app`, o se abstiene si el storage no está montado.
Impacto: cumplimiento subrepresentado de forma sistemática después de cada deploy, trabajo de re-aprobación con motivo obligatorio, y trazas que acusan pérdida de evidencia inexistente. El propósito del fix de PRV-01 (confiar en la evidencia verificada) queda anulado en producción.
Causa probable: los one-shots se modelaron como scripts de base de datos y se olvidó que la verificación lee el disco.
Solución recomendada: agregar `STORAGE_PATH=/data/storage` y `bodega-storage:/data/storage:ro` a ambos servicios (como en las líneas 933-935). En el script, abortar sin escribir si `resolveStorageDir()` no contiene los directorios esperados (la misma precondición que el respaldo, PREV-I13-D). Agregar una prueba del compose.
Esfuerzo: Bajo
Bloquea producción: No (sí bloquea desplegar sin corregirlo)
Clasificación: A obligatorio antes de producción
```

### 🟡 Importantes

```
ID: INT-02
Severidad: 🟡 IMPORTANTE
Submódulo: Higiene (N°45) / motor de evidencia
Categoría: Evidencia / Integridad
Título: La medición de higiene usa un informe subido por otra persona o para otra faena sin reclamarlo, y la N°45 se auto-aprueba
Archivo(s): lib/services/prevention-hygiene.ts; lib/services/pdtp/integration-evidence.ts; lib/services/prevention-evidence-upload.ts
Línea(s): prevention-hygiene.ts:421 (lee la ruta del cliente), 466-476 (escribe la fila de evidencia sin claimPreventionEvidenceUpload); integration-evidence.ts:113-124 (el dueño es esa misma fila); prevention-evidence-upload.ts:115-138 (el reclamo, que higiene no usa)
Pantalla/ruta: /prevencion/higiene (registrar medición)
Endpoint: recordExposureMeasurement
Rol: quien tenga prevention:hygiene:measure en la faena destino
Descripción: CGRD y campañas reclaman la subida (dueño y faena) dentro de la transacción. Higiene no lo hace: acepta cualquier ruta de `storage/hygiene-evidence/` que exista en disco. El verificador de PRV-01 comprueba contra la fila que la propia medición acaba de escribir, así que el control es circular. La subida queda sin reclamar (worksite_id NULL) y el mismo PDF puede sostener la N°45 de varias faenas (PRV-21).
Evidencia: DEMOSTRADO (sonda PGlite `higiene_reuso_informe_ajeno`). Informe subido por UC con `storePreventionEvidence`; medición de UA para un GES de WS1 con esa ruta → «registrada». Ejecución N°45 `approved / provided / approvedBy u-int-a`. Fila de subida: `uploadedBy u-int-c, worksiteId null, claimedAt null`.
Cómo reproducir:
1. Usuario X sube un informe en la faena A (POST /api/prevencion/higiene/evidence).
2. Usuario Y registra una medición en la faena B con esa ruta (visible en el PDTP y en el enlace de descarga).
3. La N°45 de B queda aprobada automáticamente con el informe de A.
Resultado actual: auto-aprobación con evidencia ajena.
Resultado esperado: el mismo reclamo que CGRD: sólo quien la subió y para esa faena, y después sólo dentro de la misma faena.
Impacto: la N°45 afirma, ante un fiscalizador, una medición que respalda un informe de otra faena.
Causa probable: el reclamo (0336) se cableó en CGRD y campañas, pero no en la medición.
Solución recomendada: llamar a `claimPreventionEvidenceUpload(tx, {domain:"hygiene", worksiteId: group.worksiteId, userId})` antes del insert, y hacer que el verificador de higiene exija además la fila reclamada en `prevention_evidence_uploads`. Prueba de regresión.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A obligatorio antes de producción
```

```
ID: INT-03
Severidad: 🟡 IMPORTANTE
Submódulo: Visitas y coordinación (N°20)
Categoría: Evidencia
Título: La N°20 se auto-aprueba con cualquier documento corporativo de la biblioteca vinculado a la coordinación
Archivo(s): lib/services/pdtp/integration-evidence.ts; lib/services/prevention-documents/links.ts; lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts
Línea(s): integration-evidence.ts:125-136, 158 (allowCorporate); links.ts:219 (sin guarda si el documento no tiene faena); external-engagement…:70-92 (toma el último documento vinculado)
Pantalla/ruta: /prevencion/coordinacion, /prevencion/documentacion (vincular)
Endpoint: closeExternalEngagement → onExternalEngagementClosed
Rol: prevention:engagement:manage más acceso a la biblioteca
Descripción: el verificador acepta cualquier versión de un sst_document corporativo (faena NULL), sin mirar el tipo documental, el estado ni si es un acta de coordinación. Vincular, por ejemplo, la «Política SST» corporativa a la coordinación basta para que la N°20 quede aprobada y `provided` sin segunda persona.
Evidencia: DEMOSTRADO (sonda PGlite, caso `9_documento_corporativo_cualquiera`) → approved / provided / approvedBy u-int-a.
Cómo reproducir:
1. Crear una coordinación con el mandante en la faena A.
2. Vincular un documento corporativo cualquiera.
3. Cerrar la coordinación: la N°20 queda aprobada automáticamente.
Resultado actual: evidencia genérica cuenta como acta.
Resultado esperado: auto-aprobar sólo con un documento de la faena (o un tipo documental «acta de coordinación») vigente y vinculado a esa coordinación; en otro caso, `submitted`.
Impacto: N°20 cumplida sin acta verificable.
Causa probable: se asumió que un documento corporativo sirve a todas las faenas.
Solución recomendada: quitar `allowCorporate` o restringirlo a un tipo documental declarado; filtrar por `status = vigente`.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-04
Severidad: 🟡 IMPORTANTE
Submódulo: Higiene (N°46–49, N°50), Evaluaciones SST (N°17, 18, 23, 63), Incidentes (N°76)
Categoría: Permisos / Segregación
Título: Cinco conectores no guardan a quien originó el hecho: esa persona aprueba su propio cumplimiento
Archivo(s): lib/services/pdtp-adapters/hygiene-accreditation-connector.ts; worker-onboarding-connector.ts; worker-sensitivity-connector.ts; incident-accreditation-connector.ts
Línea(s): hygiene…:213-226 (recibe actorUserId y no lo reenvía), 254-269; worker-onboarding…:197-213; worker-sensitivity…:43-58; incident…:386-395
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: prevencionista, administrador o jefatura con prevention:pdtp:approve que además registró el hecho
Descripción: `approvePdtpExecution` sólo impide aprobar a `executedByUserId` (executions.ts:579). En estas fuentes queda NULL, así que quien cerró el acta, evaluó el protocolo, registró la vigilancia o el seguimiento puede aprobar su propia ejecución (escribiendo un motivo).
Evidencia: DEMOSTRADO.
- PGlite (`prv02_conectores`): N°46, N°50, N°17 y N°76 con `executedBy null`; UA (el originador) aprobó las cuatro.
- B (SQL): N°18 del acta `Qoz0FgXTKq55IPk1-Y51C` (creada y cerrada por qa-prev) con executed_by NULL y approved_by qa-prev; N°23, N°63 y N°17 también con executed_by NULL.
Cómo reproducir:
1. Como prevencionista, cerrar un acta de trabajador nuevo o evaluar un protocolo MINSAL.
2. Ir a Aprobaciones con el mismo usuario.
3. Aprobar con motivo: se acepta.
Resultado actual: segregación ausente en 8 actividades.
Resultado esperado: `actorUserId` en todas las llamadas, como el resto de los conectores.
Impacto: la condición mínima PRV-02 no se cumple en todo el programa.
Causa probable: el fix se aplicó a `pdtp-accreditation-connectors.ts` y a algunos adaptadores, no a todos.
Solución recomendada: pasar `actorUserId` en los 5 conectores (el acta tiene `created_by`; la vigilancia y el seguimiento tienen `access.userId`), más una prueba de paridad que recorra `recordPdtpFulfillmentEvent` y falle si falta el actor en una fuente humana.
Esfuerzo: Bajo
Bloquea producción: No (es parte de la condición mínima PRV-02)
Clasificación: A obligatorio antes de producción
```

```
ID: INT-05
Severidad: 🟡 IMPORTANTE
Submódulo: Obligaciones integradas (RE-20 N°66–78, alta de trabajador N°15/52, organización preventiva N°11, ocurrencias N°16/57, RIOHS N°18)
Categoría: Evidencia / Segregación
Título: Una obligación integrada reportada sólo con texto queda como «evidencia entregada» y se aprueba sin motivo
Archivo(s): lib/services/pdtp/obligations.ts; lib/services/pdtp/executions.ts
Línea(s): obligations.ts:271 (hasEvidence incluye texto), 326 y 341 (evidenceStatus provided); executions.ts:490-495 y 771-773 (sin motivo si es provided)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: aprobador PDTP
Descripción: los conectores reportan las obligaciones con un rótulo («Informe preliminar enviado: <id>», «Reglamento Interno v… entregado…»). Como el texto cuenta como evidencia, la ejecución queda `provided` y PRV-02 no le pide motivo al aprobador, aunque no hay archivo ni registro verificado.
Evidencia: DEMOSTRADO. PGlite (`prv02_obligacion_integrada_texto`): N°68 `origin integration, evidenceStatus provided`; el mismo usuario queda bloqueado (correcto), pero otra persona aprueba sin motivo. B (SQL): obligaciones N°15 y N°52 del alta de trabajador con `provided` y sin archivo.
Cómo reproducir:
1. Registrar un incidente y su informe preliminar (reporta la N°68).
2. Aprobar la ejecución en Aprobaciones sin escribir motivo.
3. Se acepta.
Resultado actual: la excepción de PRV-02 («integración sin evidencia verificada exige motivo») no alcanza a las obligaciones.
Resultado esperado: `evidenceStatus = provided` sólo con un archivo verificado; el texto automático, `pending`.
Impacto: 20 actividades (el bloque RE-20 completo) se aprueban sin constancia de qué se revisó.
Causa probable: la regla de obligaciones es anterior a PRV-01/02 y no distingue el texto de un conector del de una persona.
Solución recomendada: para `origin = integration`, calcular `evidenceStatus` con el mismo criterio que el motor (archivo verificado); agregar una prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-06
Severidad: 🟡 IMPORTANTE
Submódulo: Motor / casillas (CGRD, capacitación, alcotest, simulacros, higiene)
Categoría: Lógica / Fechas
Título: La acreditación por integración acepta y auto-aprueba celdas futuras (PRV-03 no aplica a integración) y el deploy la revierte después
Archivo(s): lib/services/pdtp/accreditation.ts; lib/services/prevention-cgrd.ts; scripts/report-pdtp-unverified-auto-approvals.ts
Línea(s): accreditation.ts:299-303 (el slot sale de plannedPeriod, sin guarda de futuro) y 619-622; prevention-cgrd.ts:645-667 (cualquier casilla no cumplida, incluso futura); report-…ts:95-98
Pantalla/ruta: /prevencion/cgrd, /prevencion/capacitacion, etc. (elegir casilla)
Endpoint: recordGrdMeeting, recordTrainingOccurrenceStatus, recordAlcoholTest, completeEmergencyDrill
Rol: operadores de los submódulos
Descripción: el registro manual rechaza semanas futuras (PRV-03). En cambio, un hecho de hoy que llena la casilla de noviembre o diciembre se acredita y se auto-aprueba en esa celda. El script del deploy la clasifica después como «semana futura aprobada» y la devuelve a revisión: el sistema se contradice consigo mismo.
Evidencia: DEMOSTRADO. PGlite: acta CGRD verificada de hoy con plannedPeriod 2026-12 → `approved / provided` en la celda 2026-12-w1. B (SQL y saneamiento en modo reporte): N°53 de ws-horcones `approved` en 2026-11 semana 4 (ocurrencia CAP-21 m11-w4, completada hoy); el script la reporta.
Cómo reproducir:
1. En capacitación, completar hoy la ocurrencia de noviembre.
2. Mirar la N°53 del PDTP: queda aprobada en noviembre.
3. Correr el saneamiento: la reporta como futura.
Resultado actual: cumplimiento anticipado del año, revertido de forma no determinista en el próximo deploy.
Resultado esperado: el mismo criterio en ambas vías: rechazar en la casilla (o imputar la semana real).
Impacto: el anual se infla hasta el próximo deploy; se usan casillas futuras para adelantar metas.
Causa probable: `isPdtpCellInFuture` sólo se cableó en las escrituras manuales.
Solución recomendada: en los submódulos, impedir llenar una casilla posterior a la semana en curso con un error visible (como PRV-16); en el motor, rechazar `plannedPeriod` futuro.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-07
Severidad: 🟡 IMPORTANTE
Submódulo: Motor / alcotest, higiene N°45, coordinación N°20, CPHS N°9, CGRD N°80, MIPER, documentación, plan de emergencia, actas de ingreso y RE-28, hitos RE-20
Categoría: Trazabilidad / Integridad
Título: Una ejecución de integración aprobada por error no tiene vía de corrección
Archivo(s): lib/services/pdtp/review-requests.ts; lib/services/prevention-alcotest.ts; lib/services/prevention-external-engagements.ts; lib/services/prevention-hygiene.ts; lib/services/prevention-emergency.ts
Línea(s): review-requests.ts:157-159 (rechaza anular integraciones: «se corrige anulando el registro de origen»); prevention-external-engagements.ts:81-230 (sólo crear, agregar medida y cerrar); prevention-emergency.ts:538-571 (archivar no revoca)
Pantalla/ruta: /prevencion/pdtp/[programId]/ejecucion/[id]
Endpoint: requestPdtpExecutionAnnulmentAction
Rol: aprobadores y jefatura
Descripción: el PDTP delega la corrección al módulo de origen, pero doce fuentes no tienen anulación, o la tienen sin revocación (tabla de §3.1). Un control de alcotest mal digitado, una medición equivocada, una coordinación mal clasificada o un plan emitido por error dejan la actividad cumplida para siempre.
Evidencia: DEMOSTRADO para el plan de emergencia (archivado «emitido por error» → N°83 sigue `approved`) y CÓDIGO para el resto (ausencia de funciones de anulación en los servicios citados).
Cómo reproducir:
1. Aprobar la N°83 de un plan.
2. Archivar el plan con el motivo «emitido por error».
3. Intentar anular la ejecución desde el PDTP: se rechaza.
Resultado actual: no hay forma de corregir.
Resultado esperado: o anulación en el origen con revocación, o permitir en el PDTP la anulación revisada (PRV-12) también para integraciones, con referencia a la fuente.
Impacto: el cumplimiento no se puede corregir ante un error conocido.
Causa probable: PRV-12 se limitó a lo manual bajo el supuesto de que todo origen tiene anulación.
Solución recomendada: extender `requestPdtpExecutionAnnulment` a integraciones con doble firma y marca en la fuente, o agregar la anulación a los orígenes listados.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-08
Severidad: 🟡 IMPORTANTE
Submódulo: Motor (desvíos)
Categoría: Integridad / Trazabilidad
Título: Un hecho de integración sin verificar retira un «no aplica» ya aprobado por otra persona, se lo atribuye al autor del NA y afirma que hubo «evidencia real»
Archivo(s): lib/services/pdtp/accreditation.ts
Línea(s): 765-816 (withdrawDeviationForAccreditedCell), 788 (motivo), 793 (withdrawnByUserId), 832 (se llama siempre, antes de saber si se aprueba)
Pantalla/ruta: planilla PDTP
Endpoint: accreditPdtpFromEvent
Rol: —
Descripción: cualquier acreditación, aunque quede `submitted` con un rótulo, retira el desvío activo de la celda (incluido un NA aprobado). Si después se rechaza esa ejecución, el NA no vuelve: la celda queda planificada y sin ejecución, adeudada. El retiro se atribuye (`withdrawn_by_user_id`) a quien declaró el NA.
Evidencia: DEMOSTRADO (sonda `trazabilidad` y `trazabilidad_rechazo_tras_retiro`):
- NA de la N°9 declarado por UC y aprobado por UB;
- hecho CPHS con rótulo → ejecución `submitted`;
- desvío `withdrawn`, withdrawnBy u-int-c, motivo «…registró evidencia real en esta celda»;
- rechazo de la ejecución → el desvío sigue `withdrawn`.
Cómo reproducir:
1. Declarar y aprobar el NA de un mes.
2. Que un módulo emita un hecho con rótulo en ese mes.
3. Rechazar esa ejecución: el mes queda adeudado.
Resultado actual: una decisión de dos personas se deshace sin verificación y la traza queda falseada.
Resultado esperado: retirar el desvío sólo cuando la ejecución queda `approved` (auto o manual), con actor del sistema y un motivo veraz; restaurarlo si la ejecución se rechaza.
Impacto: denominador alterado y trazabilidad incorrecta.
Causa probable: «la evidencia gana» se implementó antes de que existiera la distinción entre verificado y no verificado.
Solución recomendada: mover el retiro al momento de la aprobación y corregir el actor y el texto.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-09
Severidad: 🟡 IMPORTANTE
Submódulo: Trazabilidad (audit_log, pdtp_change_log)
Categoría: Seguridad / Trazabilidad
Título: La bitácora «de sólo agregar» se elude con un GUC que cualquier rol puede fijar, con TRUNCATE o deshabilitando el trigger
Archivo(s): db/migrations/0340_audit_append_only.sql
Línea(s): 17-28 (la condición del GUC y del nombre de la base), 25-28 (trigger BEFORE UPDATE OR DELETE FOR EACH ROW, sin TRUNCATE)
Pantalla/ruta: —
Endpoint: —
Rol: el rol de la aplicación (superusuario en el contenedor oficial) o cualquiera con DML
Descripción: `app.audit_maintenance` es un GUC personalizado que cualquier sesión fija con `SET LOCAL`. TRUNCATE no dispara triggers de fila. El dueño puede deshabilitar el trigger.
Evidencia: DEMOSTRADO en la base propia `bodega_auditlog_verif` (auditlog-append-only.txt):
- UPDATE y DELETE directos rechazados (✅);
- con `SET LOCAL app.audit_maintenance='on'` el UPDATE pasó, con postgres y con un rol no superusuario;
- `TRUNCATE audit_log` vació la tabla (en rollback) con ambos roles;
- `DISABLE TRIGGER` y `session_replication_role=replica` también pasaron.
Cómo reproducir: `BEGIN; SET LOCAL app.audit_maintenance='on'; UPDATE audit_log SET reason='x' WHERE id=…; COMMIT;`
Resultado actual: protege de errores del código, no de un actor con acceso SQL.
Resultado esperado: sólo la función de retención puede borrar.
Impacto: el valor probatorio depende todavía de quién tenga la conexión.
Causa probable: se eligió una excepción por GUC en vez de por rol.
Solución recomendada: `cleanup_old_audit_log` como SECURITY DEFINER propiedad de un rol dedicado, y en el trigger exigir `current_user = <ese rol>`; `REVOKE TRUNCATE, UPDATE, DELETE` al rol de la aplicación (que no sea superusuario ni dueño); trigger `BEFORE TRUNCATE`. Revisar la exención por nombre (bodega_restore_tmp y prod_e2e quedan exentas).
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-10
Severidad: 🟡 IMPORTANTE
Submódulo: Motor / fuentes sin casilla (plan N°83, MIPER N°35, documentos N°36/43, CPHS N°9, EPP N°62, actas)
Categoría: Lógica / Integración
Título: Un hecho tardío de integración nunca salda la celda que estaba planificada; sólo el registro manual la recupera
Archivo(s): lib/services/pdtp/accreditation.ts; lib/services/pdtp/compliance.ts
Línea(s): accreditation.ts:299-303 (sin plannedPeriod se imputa la semana del hecho); compliance.ts:370-372 (min(ejecutado, planificado) por mes: un mes sin plan cuenta 0)
Pantalla/ruta: /prevencion/pdtp (indicador y planilla)
Endpoint: —
Rol: —
Descripción: sólo los submódulos con casillas pasan `plannedPeriod`. El resto imputa la fecha del hecho. Si la actividad estaba planificada en marzo y el plan se aprueba en septiembre, la ejecución cae en septiembre (plan 0, aporta 0) y marzo queda atrasado para siempre. El registro manual en la celda de marzo sí cuenta: se empuja a subir un PDF «artificial» por encima del registro original.
Evidencia: DEMOSTRADO (sonda `integracion-tardio`): plan aprobado en septiembre (ejecución `approved` en 2026-09) → marzo con 1 actividad en cero, anual 1 de 2; la carga manual tardía de la otra actividad en la celda de marzo sí cuenta. SQL en B: la N°83 sólo está planificada en marzo y las 7 aprobaciones reales de plan son de septiembre.
Cómo reproducir:
1. N°83 planificada en marzo.
2. Aprobar el plan en septiembre.
3. Marzo sigue atrasado aunque la ejecución esté aprobada.
Resultado actual: el cumplimiento real queda subrepresentado y se induce el doble registro.
Resultado esperado: una regla explícita: imputar a la celda adeudada más antigua del año (con marca «tardío»), o permitir al aprobador reasignar la celda con motivo.
Impacto: indicadores bajos y evidencia duplicada.
Causa probable: el modelo de celdas se pensó para las casillas.
Solución recomendada: decidir la regla con Prevención e implementarla en el motor; mientras tanto, avisarlo en Aprobaciones.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-11
Severidad: 🟡 IMPORTANTE
Submódulo: Aprobaciones PDTP
Categoría: UI/UX / Trazabilidad
Título: La cola de aprobaciones no identifica ni enlaza el registro de origen, pero exige escribir «qué revisaste»
Archivo(s): app/(app)/prevencion/pdtp/pdtp-evidence-thumbs.tsx; lib/services/pdtp/evidence-href.ts
Línea(s): pdtp-evidence-thumbs.tsx:62-72 (chip sin enlace) y 93-94; evidence-href.ts:78-90 (recorta el id)
Pantalla/ruta: /prevencion/pdtp/aprobaciones (1440 px)
Endpoint: —
Rol: prev2 (aprobador)
Descripción: la fila muestra «Automático: Entrega EPP» (seis veces seguidas en Biodiversa) o «Plan de emergencia aprobado», sin id, sin fecha del hecho y sin enlace al registro. La evidencia de alcotest, simulacro y capacitación aparece como «En el módulo de origen» sin enlace. `returnHref` existe en el libro, pero no se usa.
Evidencia: DEMOSTRADO (aprobaciones-1440.png, B): los únicos enlaces de la tabla son «Ver programa».
Cómo reproducir: abrir Aprobaciones en B como prev2.
Resultado actual: quien aprueba no puede revisar el hecho sin buscarlo a mano.
Resultado esperado: un enlace al registro de origen (inspección #, entrega #, plan PE-…) y a su evidencia.
Impacto: la segregación se vuelve una firma a ciegas; el motivo obligatorio pierde sentido.
Causa probable: D12 (sin enlace) más C-03 (quitar el id), sin reemplazo.
Solución recomendada: construir el href de la fuente con `sourceType/sourceId` (como `pdtp-coverage-workbench.tsx:31`).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-12
Severidad: 🟡 IMPORTANTE
Submódulo: Evidencia a largo plazo (M-12)
Categoría: Evidencia / Integridad
Título: Una aprobada cuyo archivo desapareció sigue contando; sin sha registrado no se detecta la alteración, y la evidencia no referenciada por el PDTP no se escanea
Archivo(s): lib/services/pdtp/evidence-integrity.ts; lib/services/pdtp/accreditation.ts
Línea(s): evidence-integrity.ts:54 (sólo referencias del PDTP), 93-95 (sin sha se salta la comparación), 117-129 (sólo registra en el log); accreditation.ts:858-862 (el sha sólo se guarda si la evidencia se verificó)
Pantalla/ruta: —
Endpoint: cron pdtp-evidence-integrity
Rol: —
Descripción: el escaneo detecta el faltante, pero la ejecución sigue `approved / provided` y contando. Las integraciones incondicionales (inspección, capacitación) y las no verificables (EPP) no guardan sha. Las evidencias adicionales de simulacro y capacitación, las fotos de inspección y los documentos SST en Cloudreve no se revisan.
Evidencia: DEMOSTRADO (sonda `integridad`): acta CGRD de una ejecución `approved` borrada → reportada en `missing`, pero la ejecución sigue `approved / provided`; archivo de capacitación alterado → 0 `mismatches`, `withoutChecksum` 17.
Cómo reproducir: borrar o alterar el archivo de una ejecución aprobada y correr el escaneo.
Resultado actual: alerta sin efecto sobre el cumplimiento; alteraciones invisibles.
Resultado esperado: marcar la celda «evidencia faltante» o dejar de contarla hasta restaurar; guardar el sha en toda integración que traiga un archivo.
Impacto: el programa puede afirmar evidencia que ya no existe o fue alterada.
Causa probable: M-12 se cerró sólo en la parte de «recorrer dominios».
Solución recomendada: persistir el hallazgo (tabla o marca en la ejecución), calcular el sha en `accreditPdtpFromEvent` para cualquier archivo existente y extender el escaneo a las tablas de evidencia de los módulos.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B recomendable antes o inmediatamente después
```

```
ID: INT-13
Severidad: 🟡 IMPORTANTE
Submódulo: Casillas (PRV-16)
Categoría: Integración / Manejo de errores
Título: El «no aplica» de una casilla sobre una celda sin plan (o excluida) cambia la casilla sin desvío ni aviso
Archivo(s): lib/services/pdtp-adapters/slot-deviation-connector.ts; lib/services/prevention-training-occurrences.ts
Línea(s): slot-deviation-connector.ts:183-195 (sólo futuro y mes cerrado son visibles), 311-324 (lo demás se traga); prevention-training-occurrences.ts:691 (`.catch(logger.error)` después del commit)
Pantalla/ruta: casillas de alcotest, simulacros, CGRD, capacitación e higiene
Endpoint: recordAlcotestSlotStatus y equivalentes
Rol: responsables de las casillas
Descripción: PRV-16 se corrigió para dos causas. Para una celda sin planificación, una actividad excluida o una celda con un desvío de la planilla, la casilla dice «No aplica» y el PDTP no registra nada. En capacitación, al salir de «hecha», incluso el mes cerrado se traga.
Evidencia: DEMOSTRADO (sonda `prv16`): casilla de agosto semana 2 (sin plan) → «ok», slot `not_applicable`, sin desvío; mes cerrado y semana futura → errores visibles (✅).
Cómo reproducir: declarar NA en una casilla de una semana sin plan.
Resultado actual: submódulo y programa se contradicen en silencio (menos grave: sin plan no hay deuda).
Resultado esperado: un aviso («esa semana no está planificada en el programa») o una validación previa.
Impacto: confusión en las celdas excluidas o con desvío previo.
Causa probable: la validación previa se limitó a dos guardas.
Solución recomendada: devolver el motivo del rechazo como advertencia visible, y quitar el `.catch` silencioso de capacitación.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: C post-producción
```

### 🔵 Mejoras y ⚪ cosméticos

| ID | Sev. | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|---|
| INT-14 | 🔵 | Documentación / N°20 | Con el backend de documentos SST en Cloudreve, los archivos nuevos no están en disco. El verificador y el escaneo leen disco: la N°20 nunca se auto-aprueba y el escaneo da falsos faltantes | `lib/storage/sst-backend.ts:102-107`; `integration-evidence.ts:126,163`; `evidence-integrity.ts:85-88` | CÓDIGO | Leer con `readSstDocument` o `statSstDocument` | B |
| INT-15 | 🔵 | Doc | `MAPA_MODULOS_ACREDITACION_PDTP_2026.md` sigue diciendo que se auto-aprueba con «ruta `storage/` o URL `http(s)`» (anterior a PRV-01) | `docs/prevencion/MAPA…:19,35,81` | CÓDIGO | Actualizar | B |
| INT-16 | 🔵 | MIPER / Documentación | N°35, 36 y 43 planificadas mensualmente como «estado», pero acreditadas sólo por eventos puntuales (N°19 sí usa el estado mensual) | B: 12 celdas; `pdtp-accreditation-connectors.ts:499-637` | SQL + CÓDIGO | Decidir con Prevención: acreditación de estado vigente mensual | M |
| INT-17 | 🔵 | Eventos disparadores | Un error permanente (faena excluida) se reintenta para siempre y bloquea la cabeza de la cola; `ignored` es terminal aunque luego se configure la actividad | `trigger-events.ts:101-105,171` | DEMOSTRADO (limit=1) | Clasificar la exclusión como `ignored`; cursor por `updatedAt` | B |
| INT-18 | 🔵 | Contrato de responsables | El preflight de B: N°38 y N°53 (sup, jt sin `training:record`), N°9 (Legal sin `governance:review`) y 7 roles con actividades que no pueden ejecutar | `wiring-B.txt` (`responsibleExecution`) | DEMOSTRADO (script) | Ajustar los grants o los responsables | B |
| INT-19 | 🔵 | Programa real | En B, N°2 retirada, N°3 y N°20 `constancia`, contra el contrato del código (`apply-pdtp-2026-mechanisms.ts:105,130,226`): la N°3 no se acredita por acuses y la N°20 queda diferida | SQL B | DEMOSTRADO | Condición de deploy: firmar y activar la revisión que abre `apply-mechanisms` | B |
| INT-20 | 🔵 | Trazabilidad | La revocación por reapertura de indicadores (y por vencimiento del CPHS) queda sin actor en el historial PDTP | `pdtp-accreditation-connectors.ts:729-741`; `prevention-indicadores.ts:712` | DEMOSTRADO | Pasar `revokedBy` | B |
| INT-21 | 🔵 | Motor | `evidenceRejection: wrong_domain` se escribe para rótulos legítimos de fuentes verificables (p. ej. «Plan de emergencia aprobado») | `accreditation.ts:863` | DEMOSTRADO | Registrar el rechazo sólo si la referencia parece una ruta | B |
| INT-22 | 🔵 | Descargas | `cgrd/mapa/[name]` con un nombre inválido responde 500 («error no capturado»), sin fuga | `app/api/prevencion/cgrd/mapa/[name]/route.ts:35` | DEMOSTRADO | Capturar y responder 400 | B |
| INT-23 | 🔵 | GC | El GC no barre las subidas no reclamadas de CGRD, campañas, higiene y CAPA (B: 1) | `evidence-gc.ts:84-117` | SQL + CÓDIGO | Barrido con la misma ventana | B |
| INT-24 | 🔵 | Datos | 13 bindings `capacitacion/close` a cursos `trc-*` inexistentes y 35 `campana/close` que ya no acreditan (M-22 residual) | SQL B | SQL | Migración de limpieza | B |
| INT-25 | 🔵 | Operación | Logs de producción en `warn`, sin rotación ni persistencia (se pierden al recrear); sin captura externa; `backup-health` fuera de `cron_runs` y de staleness; nadie vigila la caída del contenedor `cron` | `lib/logger.ts:17`; `cron-staleness.ts:5-19`; `docker-compose.yml:257-378` | CÓDIGO | Driver de logs con rotación y envío externo; heartbeat externo | M |
| INT-26 | 🔵 | Operación | El preflight de cableado evalúa el programa activo más reciente (2028 en B), no el año en curso | `wiring-B.txt` | DEMOSTRADO | Evaluar cada programa activo | B |
| INT-27 | 🔵 | Saneamiento | «El primer administrador» es `limit 1` sin orden (firma no determinista) | `report-…ts:58-63` | CÓDIGO | Exigir `PDTP_UNVERIFIED_ACTOR_USER_ID` en deploy | B |
| INT-28 | 🔵 | Bitácora | La exención por nombre calza con `bodega_restore_tmp`, `prod_e2e`, `*_capture` | `0340:20` | DEMOSTRADO (SQL) | Lista explícita o marca en `system_settings` | B |
| INT-29 | 🔵 | Performance | La revocación bloquea `FOR UPDATE` todas las ejecuciones de integración de la faena | `accreditation.ts:1016-1042` | CÓDIGO | Filtrar por `source_type/source_id` en SQL | B |
| INT-30 | 🔵 | Evidencia | En las fuentes no verificables, `provided` = «existe en cualquier dominio o faena» → exime del motivo (hoy los conectores pasan su propia ruta) | `integration-evidence.ts:210-224` | DEMOSTRADO (motor) / TEÓRICO (conectores) | Verificar dominio y faena también | B |
| INT-31 | 🔵 | Mapa | Dos caminos para la misma actividad (N°63: CAP-03 y acta de ingreso; N°18: acta y RIOHS); el tope mensual lo contiene | SQL B | SQL | Documentar qué camino manda | B |
| INT-32 | ⚪ | Libro | `last_error` obsoleto («[no-active-program]…») en eventos ya `accredited` | SQL B | SQL | Limpiar al acreditar | B |
| INT-33 | ⚪ | Proxy (M-02) | Con `Origin` ajeno más un `X-Forwarded-Host` falso se pasa la guarda (sólo fuera de un navegador) | `lib/security/same-origin.ts` | DEMOSTRADO | Confiar en XFH sólo desde el proxy | B |

---

## I. Notas

### Integración Programa ↔ Submódulos: **70/100**

| Descuento | Puntos |
|---|---:|
| INT-01: el deploy revierte las auto-aprobaciones legítimas | −8 |
| INT-04: segregación ausente en 8 actividades | −4 |
| INT-07: sin corrección de integraciones aprobadas | −4 |
| INT-10: el hecho tardío no salda su celda | −4 |
| INT-05: obligaciones con texto = `provided` | −2 |
| INT-06: celdas futuras por integración | −2 |
| INT-08: un hecho sin verificar retira un NA aprobado | −2 |
| INT-13: PRV-16 parcial | −1 |
| INT-16: actividades de estado frente a eventos | −1 |
| INT-19: programa real desalineado | −1 |
| INT-17: cola de disparadores | −0,5 |
| INT-18: responsables sin permiso | −0,5 |

**A favor:** conectores vivos para todas las actividades de enganche, sin huérfanas; idempotencia; eventos diferidos y reproceso (PRV-22); revocaciones en 9 de las transiciones de cancelación; aislamiento por faena.

### Evidencias y trazabilidad: **70/100**

| Descuento | Puntos |
|---|---:|
| INT-02: higiene sin reclamo | −4 |
| INT-01: la verificación se rompe en el deploy (la parte de evidencia) | −3 |
| INT-03: documento corporativo como acta | −3 |
| INT-09: bitácora eludible | −3 |
| INT-11: evidencia interna sin enlace | −3 |
| INT-12: integridad sin efecto y sin sha | −3 |
| INT-25: logs efímeros y sin captura | −2 |
| INT-08: atribución falsa del retiro | −1 |
| INT-14: Cloudreve | −1 |
| INT-20: revocación sin actor | −1 |
| M-20 abierto | −1 |
| INT-23: GC de dominios | −0,5 |

**A favor:** PRV-01 verificado en 40 de 40 casos; sin IDOR en 10 rutas; traversal bloqueado; M-02 operativo; la bitácora rechaza la alteración directa; historial con antes y después en acreditación y revocación; GC en modo de prueba con referencias completas; restauración selectiva documentada y coherente.

---

## Estado de hallazgos previos en este alcance

| ID | Dictamen | Evidencia propia |
|---|---|---|
| PRV-01 | **Parcial** | El motor está verificado (40/40, PGlite). Quedan dos atajos: higiene (INT-02) y documento corporativo en la N°20 (INT-03). El deploy lo anula en producción (INT-01) |
| PRV-02 | **Parcial** | 7 fuentes OK (PGlite). 5 conectores sin actor: N°17, 18/23/63, 46–49, 50, 76 (INT-04, también en B). Obligaciones con texto sin motivo (INT-05) |
| PRV-04 | **Parcial** | Tabla §3.1: 12 fuentes sin revocación ni corrección (INT-07). El criterio del CPHS es opuesto (§3.2) |
| PRV-13 | **Parcial** | UPDATE y DELETE directos bloqueados; GUC, TRUNCATE y DISABLE lo eluden (INT-09, DB propia) |
| PRV-14 | **Parcial** | Crons agendados vía `app`, staleness y `backup-health` presentes. Sin vigilancia externa del contenedor `cron`, `backup-scheduler` fuera del deploy y logs efímeros (INT-25). No verificable en producción |
| PRV-16 | **Parcial** | Futuro y mes cerrado visibles; celda sin plan o excluida en silencio (INT-13) |
| PRV-17 | **Corregido (verificado)** | Código más la prueba existente PASS; GC en modo de prueba por defecto |
| PRV-18 | **Corregido (verificado)** | HTTP: subcadena → 404; igualdad exacta |
| PRV-21 | **Parcial** | Descarga con alcance ✅ (HTTP); el mismo informe sirve a varias faenas (INT-02) |
| PRV-22 | **Corregido (verificado)** | PGlite: diferido → reproceso idempotente. En B la N°20 sigue como constancia (condición de deploy, INT-19) |
| M-02 | **Corregido (verificado)** | HTTP: 403 con `Origin` ajeno o `cross-site` |
| M-07 | **Corregido (verificado)** | SQL: RESTRICT en desvíos, subidas, overrides, cierres y solicitudes. Las cascadas restantes sólo alcanzan faenas sin historia |
| M-12 | **Parcial** | INT-12 |
| M-16 | **Corregido (código)** | `lib/user-facing-error.ts` filtra `ENOENT` y rutas |
| M-20 | **Sigue abierto** | Decisión de negocio; la descarga PDTP no audita ni clasifica |
| M-21 | **Corregido (código)** | `prevention-evidence-upload.ts:84` |
| M-22 | **Parcial** | Código limpiado; bindings huérfanos en datos (INT-24) |
| M-23 | **Corregido (código)** | `incident-accreditation-connector.ts:289-297` (después del commit, idempotente) |

---

## F. Testing ejecutado

| Prueba | Resultado |
|---|---|
| Sonda `integracion-motor.audit-tmp.test.ts` (PGlite) | 12/12 PASS (registra lo observado); salida en `probe-results.json` |
| Sonda `integracion-tardio.audit-tmp.test.ts` (PGlite) | 1/1; salida en `probe-late.json` |
| Suites existentes (vitest.pglite): `pdtp-evidence-references`, `pdtp-production-readiness`, `pdtp-revocations`, `pdtp-slot-deviation-propagation`, `external-engagement-accreditation-connector`, `pdtp-accreditation` | **141/141 PASS** |
| HTTP (IDOR, traversal, Origin) contra B | Scripts `idor.mjs` y `origin.mjs` |
| Base propia (0340) y saneamiento simulado | `auditlog-append-only.txt`, `saneamiento-sim.txt` |
| Contra B | Saneamiento en modo reporte y preflight de cableado (sólo lectura) |

**Qué no cubren las suites existentes:** el despliegue sin storage (INT-01), higiene sin reclamo (INT-02), el documento corporativo (INT-03), los conectores sin actor (INT-04), las obligaciones con texto (INT-05), la celda futura por integración (INT-06) y el retiro de NA por un hecho no verificado (INT-08).

---

## Qué no se pudo verificar y por qué

- **Producción:**
  - si `backup-scheduler` corre;
  - el nombre real de la base y el rol de la aplicación (supuestos: `bodega` y superusuario, por el compose);
  - si el backend SST es Cloudreve;
  - el estado real de `cron_runs`.
- **El contenedor del deploy:** INT-01 se reprodujo simulando el storage vacío. No se corrió `docker compose`.
- **Un flujo de navegador de aprobación con motivo:** lo cubren los E2E del fix. Aquí sólo se capturó la cola.
- **Otras transiciones:** la anulación de evidencia de capacitación por separado (sin cambiar la ocurrencia) y la baja de trabajadores con obligaciones N°15/52 abiertas.
- **WebKit y el responsive de Aprobaciones:** fuera del foco transversal.

## Limpieza

- Sondas temporales borradas del repo; hay copias en `scratchpad/audit/integracion/`. `git status --porcelain`: sólo `.audit-login.mjs` y `.audit-seed-qa-roles.ts`, que son del orquestador.
- **Base desechable:** `bodega_auditlog_verif` borrada con `DROP DATABASE`, y también el rol `qa_int_app`.
- **B:** se borraron todas las filas `QA_INT_*` sembradas para IDOR (alcotest, campañas, capacitación, CGRD, plano, simulacros, higiene, documentos y evidencias de inspección) y sus archivos. Quedan 0.
