# Auditoría de production readiness — Documental (Registro documental · Datos personales · Ficha del trabajador)

**Agente:** documental (prefijo `DOC-`) · **Fecha:** 2026-09-29 · **HEAD:** `11e67621` · Diagnóstico, sin cambios en archivos versionados.

**Evidencia en** `scratchpad/audit/documental/`:
- capturas: `shots/`;
- bitácoras: `flow.log`, `visits.log`, `api.log`;
- sonda PGlite: `documental-integration.audit-tmp.test.ts` y `probe-notes-run4.txt`;
- salidas de pruebas: `unit-tests.log`, `pglite-tests.log`, `privacy-postgres.log`.

## Resumen

| Submódulo | Nota | Lectura |
|---|---:|---|
| Registro documental (incluye `/acuse`) | **66/100** | No listo: el ciclo segregado, la confidencialidad, el alcance por faena y M-03 funcionan. Lo que falla es la evidencia hacia el programa (DOC-01), el historial al archivar, la operación diaria (colas y errores silenciosos) y la configuración real de la N°19 y del panel. |
| Datos personales (privacidad, salud y casos reservados) | **84/100** | Muy próximo: la autorización, el propósito, la auditoría y M-04 están verificados. Salud y casos reservados existen sólo como API JSON, y la auditoría muestra enums, ids y horas en UTC. |
| Ficha del trabajador | **80/100** | Muy próximo: la ficha oculta las evaluaciones cerradas y ofrece "Iniciar evaluación" a quien ya tiene un acta cerrada (DOC-27). |

**Hallazgos por severidad:**

| 🔴 | 🟠 | 🟡 | 🔵 | ⚪ |
|---:|---:|---:|---:|---:|
| 0 | 1 | 13 | 13 | 1 |

### Advertencia de entorno (no es un defecto de producto)

**Qué pasa.** En el entorno B, las subidas de archivos **fallan** con "No se pudo completar la acción". La causa está en `system_settings`: `storage.cloudreve.backend=cloudreve`, apuntando a `https://drive.portalchome.cl`, con credenciales que el servidor no puede descifrar (log: `CloudreveError: Cloudreve no está configurado`). El servidor :3101 tiene `STORAGE_PATH` en el scratchpad, pero la BD manda.

**Qué intenté.** Intenté cambiar la configuración a `filesystem` y el clasificador de permisos lo denegó (recurso compartido). No escribí nada en B.

**Consecuencia.** Por esto la sección G se ejecutó con los servicios reales en una **sonda PGlite**, y la parte de B quedó en lectura (SQL y capturas). Afecta a cualquier agente que suba evidencia en B.

**Riesgo operativo.** Una copia de `bodega_dev` que traiga la llave podría escribir en ese drive.

---

## AUDITORÍA — Registro documental

**Rutas:**
- `/prevencion/documentacion`, `/[id]`, `/papelera`, `/regularizacion`;
- `/acuse/[kind]/[targetId]/[token]` (pública);
- API `app/api/prevencion/documentacion/**`.

**Código:**
- `app/(app)/prevencion/documentacion/**`;
- `lib/services/prevention-documents/*` (crud, workflow, publication, distribution, search, integrity, folders);
- `lib/security/file-response.ts`, `lib/file-validation.ts`;
- `lib/services/prevention-ack-*.ts`, `prevention-document-ack-reminders.ts`;
- conectores `pdtp-accreditation-connectors.ts:540-610`, `legal-folder-connector.ts`, `riohs-rollout-connector.ts`.

**Permisos** (A = defaultGrants; B coincide en `docs:*`):

| Rol | Permisos |
|---|---|
| administrador | todos |
| prevencionista | view, manage, submit_review, review, approve, publish, distribute, ack, link, archive, manage_restricted, `sign_own_work` |
| prevencionista_faena | view, manage, submit_review, distribute, ack |
| jefa_chome | view, review, approve, publish, distribute, ack, manage_sensitive, manage_restricted (sin manage ni archive) |
| jefe_terreno | view, ack |
| supervisor, cphs, legal, TI | sin `docs:*` |

### A. UI/UX/Diseño

**Cumple con el patrón de la plataforma:** `PageHeader` y `PageContainer`, acciones de página en el header ("Nueva carpeta", "Subir documento", "Papelera", "Regularización"), búsqueda del TopBar, tabla y grilla. Sin desborde a 1440 ni a 390 px, 0 errores de consola y 0 respuestas ≥ 400 en todas las visitas (`visits.log`).

**Subida tipada** (`typed-upload-form.tsx`): clara. Declara el tipo y la faena, avisa si queda vigente o en borrador, y muestra el efecto sobre la N°19/N°18. No menciona la N°43/N°36 que acreditará.

**Fricciones:**
- No hay cola de "pendientes de revisar, aprobar o publicar", ni filtro por estado, ni notificaciones (DOC-07).
- "N por revisar" es texto muerto.
- Se ofrecen botones que el servidor rechaza (DOC-13).
- Hay errores silenciosos (DOC-08).
- Las carpetas se ordenan lexicográficamente ("10_Mejora" antes que "4_Contexto", captura `B-prev-1440-_prevencion_documentacion.png`).
- El panel "Actividades programadas" dice "Sin trabajo del Programa Preventivo pendiente" en B (DOC-09).

**Acuse público a 390 px** (`shots/acuse-vencido-390.png`): mínimo, legible y sin desborde. El enlace vencido muestra "Enlace vencido"; el manipulado, un 404.

**Estados observados:**

| Estado | Observado en |
|---|---|
| Con información | biblioteca, detalle, papelera |
| Sin información | regularización "Sin inconsistencias automáticas" |
| Operación exitosa | toasts del ciclo |
| Operación fallida | toasts de segregación; `role=alert` en la subida de B |
| Permisos insuficientes | `sup` y `ti` → 403 en la API; `prev` → `/forbidden` en privacidad |

- **Sin resultados de búsqueda:** no verificado.
- **Cargando:** sólo `loading.tsx` en el código.

**Responsive:** se verificó a 1440 y 390 px; **no** a 1024 ni a 768 px.

### Facilidad de uso

**Tarea: subir un documento tipado.** 4–6 clics (tipo, faena, título, archivo, "Cargar documento").

**Tarea: subir y publicar una versión nueva.**

| Paso | Actor | Clics |
|---|---|---:|
| Pestaña Versiones → Seleccionar archivo → Subir versión → Enviar a revisión | autor | 4 + diálogo del SO |
| Registrar revisión | 2.ª persona | 1 |
| Aprobar | 3.ª persona, o la 2.ª si el autor se revisó a sí mismo | 1 |
| Publicar | alguien distinto del aprobador | 1 |

Son **≥ 7 clics** en 3–4 sesiones, más la navegación hasta el documento. Ninguna persona recibe aviso de que le toca su paso (DOC-07).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Carga tipada (vigente directo o borrador) | ✅ | UI A (`flow.log`) y sonda |
| Carga masiva sin clasificar | 🟡 | Funciona para roles globales; para faena falla sin motivo en la raíz (DOC-08) |
| Validación MIME real, tamaño, Office sin macros | ✅ | `.html` rechazado; SVG/XHTML aceptados como XML y servidos como descarga |
| Ciclo borrador → revisión → aprobación → publicación | 🟡 | Uploader ≠ aprobador, revisor ≠ aprobador y aprobador ≠ publicador sin `sign_own_work`, todos DEMOSTRADOS. Autorrevisión permitida (DOC-02) |
| Observar / devolver a borrador | 🟡 | CÓDIGO y tests unitarios; no recorrido en UI |
| Nueva versión reemplaza la vigente | ✅ | Sonda: v1 queda `reemplazado` |
| Distribución, exención, acuse | 🟡 | Sonda: acuse propio e idempotente; ajeno rechazado. Distribución a quien no puede acusar (DOC-05); exención de 3 caracteres (DOC-01) |
| Acuse público con token | ✅ | Sólo permisos (AST). Vencido / manipulado / basura / destino inexistente (DEMOSTRADO) |
| Vínculos a entidades | 🟡 | No ejecutado; tests unitarios |
| Archivar / papelera / restaurar | 🟡 | Funciona, pero reescribe el historial (DOC-03), es re-archivable y deja huérfanos (DOC-14, DOC-17) |
| Regularización / export Excel | ✅ | Pantalla vacía; export con `sanitizeCell` (CÓDIGO) |
| Descarga, versión, expediente Excel, ZIP | ✅ | API por rol (`api.log`) |
| Búsqueda | 🟡 | CÓDIGO: TopBar filtra sólo la carpeta abierta; `?q=` usa `LIKE` sensible a mayúsculas (DOC-12) |
| Carpetas | 🟡 | Crear OK; duplicado falla en silencio (DOC-08) |

### C. Código y lógica

- `clientCtx` toma la IP de `x-forwarded-for` (`actions/shared.ts:25`), DOC-06.
- `archiveDocument`:
  - no valida el estado previo;
  - sólo escribe en `sst_document_audit`: no en `audit_log` ni `recordStatusChange`, a diferencia de `restoreDocument` (`crud.ts:363-434`).
- `setRiohsSectionsAction` lee `sstDocuments` sin alcance antes de delegar (`actions/riohs.ts:382-398`); el servicio sí valida.
- El filtro "clínico" en la biblioteca general es una regex sobre título y nombre de archivo (`utils.ts:259-286`): fácil de eludir, riesgo TEÓRICO.
- `generateStorageName` conserva la extensión del cliente (`utils.ts:314-318`), DOC-16.
- Sin TODO/`console.log` en el alcance; los `catch` que tragan están justificados como efectos post-commit o compensación.

### D. Modelo de datos

- Borrado lógico (`archivado`).
- Checksum sha256 por versión; firma del acuse = sha256(versión, checksum, usuario, fecha, método).
- Distribución con snapshot de cargo.
- **Problema:** el archivado reescribe `sst_document_versions.status` de las versiones `reemplazado`, `borrador` y `en_revision` a `archivado`, y restaurar no lo revierte (DOC-03).
- La bitácora `sst_document_audit` no está entre las tablas del trigger append-only 0340 (según el informe de correcciones: `audit_log`, `pdtp_change_log`); **no verificado** en BD.

### E. Permisos y seguridad

- **IDOR entre faenas** (DEMOSTRADO, `api.log`), sobre descarga, versión, expediente y ZIP:
  - `prevfaena` → documento de `otrafaena`: 404;
  - `otrafaena` → documento de `ws-e2e`: 404;
  - versión cruzada: 400;
  - ZIP: sólo entrega lo legible.
- **Confidencialidad** (DEMOSTRADO): `prev` (sin `manage_sensitive`) y `prevfaena`/`jt` (sin `manage_restricted`) reciben 404 en versión y expediente del documento sensible o restringido. `sup` y `ti` reciben 403.
- **M-03** (DEMOSTRADO):
  - SVG y XHTML con `<script>` se sirven `application/xml` + `attachment` + `nosniff`;
  - el PDF va `inline` + `nosniff`;
  - la CSP real lleva `script-src` con nonce;
  - al abrirlos en el navegador: descarga y 0 diálogos (`xss-open.mjs`).
- **M-04 en documentación** (DEMOSTRADO): la IP falsificada 6.6.6.6 / 7.7.7.7 quedó en `sst_document_audit.ip` (DOC-06).
- **Token de acuse:** HMAC v2 con vencimiento firmado. Vencido → "Enlace vencido"; exp o firma alterada → 404; no revela existencia. La reutilización se bloquea en el servicio con `acknowledgedAt IS NULL` y `FOR UPDATE` (`prevention-permits.ts:759-783`, CÓDIGO; no hay tripulación en A para probarlo). Rate limit por IP confiable.

### F. Testing

| Suite | Resultado |
|---|---|
| Unitarias del alcance (39 archivos, incl. rutas API y componentes) | **209/209 PASS** |
| PGlite (`pdtp-document-accreditation`, `prevention-documents-persistence`, `privacy-reserved-redaction`, `privacy-execution-authorization`, `sst-document-taxonomy-pglite`, `permit-crew-ack-blocker`) | **68/68 PASS** |
| `prevention-privacy-postgres` sobre base propia `bodega_test_privacy_documental` | **6/6 PASS**, no omitidas |

E2E: leídos, no ejecutados.

**Caminos sin cobertura:**
- autorrevisión;
- historial al archivar;
- exención masiva de la N°18;
- distribución a destinatarios sin permiso;
- aprobar una ejecución PDTP cuya fuente fue archivada.

### G. Integración con el Programa Anual

**Sonda PGlite** con servicios reales (`probe-notes-run4.txt`). Programa activo 2026 con N°43/N°36/N°18; tipos PTS y MIPER-DIF sembrados por migración.

**N°43 (publicar PTS):**
- La segregación se cumple (prev sube, prev2 revisa, jefa aprueba, jefa no puede publicar, prev publica).
- Crea una ejecución `submitted`, `origin=integration`, `executedByUserId=prev`, `evidence_status=not_required` y texto "Versión de documento publicada: sdv-…".
- **PRV-02:**
  - el publicador no puede aprobar;
  - sin evidencia verificable exige un motivo ≥ 10 caracteres;
  - otra persona con motivo → `approved`.
- Publicar la v2 crea **otra** ejecución en la misma celda (DOC-15).

**N°36 (acuse MIPER-DIF):**
- Publicar no acredita. Cada acuse crea una ejecución `submitted` con `executedBy=destinatario`. El acuse repetido es idempotente y la exención no acredita.
- El destinatario no puede aprobar; el publicador aprueba con motivo.
- **Sólo acusan usuarios con cuenta y `docs:ack`.** El acuse público no cubre documentos (DOC-21).

**N°18 (RIOHS de faena):**
- La publicación abre la obligación (plazo 30 días) y auto-asigna la dotación.
- **Un `prevencionista_faena` exime a todos (incluido un trabajador con cuenta) con motivo "abc":**
  - la obligación queda `reported`;
  - la ejecución queda `evidence_status=provided` ("0 acuse(s) y 2 exención(es)");
  - **otra persona la aprueba sin motivo**;
  - la obligación queda `completed` (DOC-01).

**N°19 (carpeta legal):** en B, `pdtp_activity_document_requirements` tiene **0 filas** para el programa `pdtp-2026-v2` activo, y sólo se editan en borrador. La carpeta no puede acreditar la N°19: la pantalla `?carpeta=requisitos-legales&faena=ws-horcones` responde "Selecciona la faena… el programa activo todavía no declara qué documentos debe contener" (DOC-10).

**Archivar (PRV-04):**
- La N°43/N°36 aprobada sigue aprobada, que es la decisión declarada y coherente.
- Pero una ejecución **pendiente** de un documento ya archivado se aprueba igual, sin aviso.
- Archivar el RIOHS no cierra ni marca su entrega (DOC-04).

**B (lectura):**
- bindings `documento`: PTS→publish→043 y MIPER-DIF→acknowledge→036;
- N°43/36/19 planificadas en septiembre (semanas 3/4/2) en 6 faenas, sin ejecuciones;
- `pdtp_scheduled_instances` vacío, y por eso el panel dice que no hay nada pendiente (DOC-09).

**M-20:** en Documentación la ejecución sólo lleva el id de versión (sin archivo), así que el PDTP no expone el contenido. No se verificó para otros dominios.

### H. Hallazgos (🟠/🟡)

```
ID: DOC-01
Severidad: 🟠 CRÍTICO
Submódulo: Registro documental (RIOHS → N°18)
Categoría: Evidencia / Integración PDTP
Título: La entrega del RIOHS (N°18) se cierra y aprueba sin ningún acuse, eximiendo a toda la dotación con un motivo de 3 caracteres
Archivo(s): lib/services/prevention-documents/distribution.ts; lib/services/pdtp-adapters/riohs-rollout-connector.ts
Línea(s): distribution.ts:354-362 y 413-470 (motivo ≥3, sin distinguir si el destinatario tiene cuenta); riohs-rollout-connector.ts:305-316 (reporta con texto; queda evidence_status=provided)
Pantalla/ruta: /prevencion/documentacion/[id] (tarjeta de entrega RIOHS)
Endpoint: exemptSstDocumentRecipientsAction / exemptSstDocumentRecipientAction
Rol: prevencionista_faena (docs:distribute) y cualquiera con distribute
Descripción: la exención nació para quien no tiene cuenta, pero se acepta para cualquiera (también un usuario con cuenta y docs:ack) con 3 caracteres. Al quedar todos exentos la obligación se reporta y la ejecución nace con evidencia "provided", así que otra persona la aprueba sin motivo.
Evidencia: DEMOSTRADO (sonda PGlite, probe-notes-run4.txt): "prevfaena exime a TODOS con motivo 'abc': OK" → obligación reported → ejecución {evidenceStatus:"provided", evidenceText:"… 0 acuse(s) y 2 exención(es) sobre 2 trabajador(es)"} → "prev aprueba SIN motivo: OK approved" → obligación completed.
Cómo reproducir:
1. Publicar un RIOHS de faena (se abre la N°18 y se asigna la dotación).
2. Eximir en lote a todos los pendientes con el motivo "abc".
3. Aprobar la ejecución N°18 en /prevencion/pdtp/aprobaciones sin motivo.
Resultado actual: la N°18 cuenta como entregada a toda la dotación, con 0 acuses y evidencia "verificada".
Resultado esperado: sólo se exime a quien no puede acusar (sin cuenta), con motivo ≥10 y medio de entrega; una entrega sin acuses deja la ejecución con evidencia no verificada (exige motivo al aprobar o respaldo adjunto).
Impacto: afirma ante un fiscalizador el cumplimiento del DS 44 art. 56 sin constancia.
Causa probable: el reporte de obligación trata el texto descriptivo como evidencia.
Solución recomendada: validar el destinatario (sin cuenta) y el motivo mínimo; reportar con evidence_status "not_required/pending" cuando acknowledged=0 o exentos>0, o exigir un respaldo (planilla Talana) adjunto.
Esfuerzo: Bajo–Medio
Bloquea producción: No
Clasificación: A
```

```
ID: DOC-02
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Permisos / Segregación
Título: Quien cargó la versión puede registrar su propia revisión
Archivo(s): lib/services/prevention-documents/workflow.ts
Línea(s): 211-218 (markDocumentVersionReviewed sin preventUploader)
Pantalla/ruta: /prevencion/documentacion/[id] → Versiones
Endpoint: markSstDocumentVersionReviewedAction
Rol: prevencionista
Descripción: el ciclo de cuatro pasos se reduce a dos personas: el autor se revisa, otro aprueba y el autor publica. "Revisado por" pasa a ser el autor.
Evidencia: DEMOSTRADO (UI, A): prev "Enviar a revisión" → prev "Registrar revisión" → toast "Revisión registrada."; prev2 ya no ve el botón.
Cómo reproducir:
1. Subir un documento como prev.
2. Enviarlo a revisión.
3. Pulsar "Registrar revisión" como prev.
Resultado actual: la revisión queda firmada por el autor.
Resultado esperado: "Quien cargó la versión no puede revisarla" (o una excepción explícita y auditada).
Impacto: la revisión documental no aporta un segundo par de ojos.
Causa probable: se aplicó preventUploader sólo en approve.
Solución recomendada: preventUploader en markDocumentVersionReviewed y en observe; una prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-03
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Integridad de datos / Trazabilidad
Título: Archivar reescribe el estado histórico de las versiones y restaurar no lo devuelve
Archivo(s): lib/services/prevention-documents/crud.ts
Línea(s): 382 (UPDATE a 'archivado' de toda versión ≠ vigente/aprobado, incluido 'reemplazado'); 403-433 (restore sólo toca el documento)
Pantalla/ruta: /prevencion/documentacion/papelera
Endpoint: archiveSstDocumentAction / restoreSstDocumentAction
Rol: prevention:docs:archive
Descripción: la v1 "reemplazado" pasa a "archivado" y así queda tras restaurar; las en revisión o borrador también se pierden.
Evidencia: DEMOSTRADO (sonda): tras archivar y restaurar, vers=[{v:1,s:"archivado"},{v:2,s:"vigente"}].
Cómo reproducir:
1. Publicar la v1 y luego la v2 de un documento.
2. Archivar el documento.
3. Restaurarlo y mirar el historial de versiones.
Resultado actual: la v1 dice "Archivado".
Resultado esperado: el historial de versiones es inmutable (el estado del documento basta para archivar) o se restaura el estado anterior.
Impacto: la cadena de versiones de un expediente de fiscalización queda alterada.
Causa probable: se buscó congelar borradores sin distinguir las versiones históricas.
Solución recomendada: no tocar 'reemplazado'; guardar el estado previo o bloquear las transiciones por el estado del documento.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-04
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Integración PDTP (PRV-04)
Título: Archivar la fuente no afecta a las ejecuciones pendientes: se aprueban sin aviso, y la entrega RIOHS sigue abierta
Archivo(s): lib/services/prevention-documents/crud.ts
Línea(s): 363-387 (archiveDocument: sin efectos PDTP ni onLegalFolderDocumentChanged)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: archiveSstDocumentAction → approvePdtpExecutionAction
Rol: aprobadores PDTP
Descripción: la decisión PRV-04 ("un documento archivado respalda el período en que estuvo vigente") es coherente para lo aprobado. Pero una ejecución submitted de un PTS ya archivado se aprueba con un motivo genérico sin que la cola lo advierta. Un RIOHS archivado mantiene su obligación N°18, y la carpeta N°19 no se reevalúa al archivar.
Evidencia: DEMOSTRADO (sonda): "archivar PTS: OK" → "N°43: aprobar DESPUÉS de archivar (jefa, con motivo): OK approved"; "archivar RIOHS" → obligación sigue reported/completed.
Cómo reproducir:
1. Publicar un PTS (queda la N°43 submitted).
2. Archivar el PTS.
3. Aprobar la N°43.
Resultado actual: se aprueba sin mención del archivado.
Resultado esperado: la cola marca "fuente archivada" (o la devuelve a revisión); archivar un vigente reevalúa la N°19 y cierra o cancela la entrega del RIOHS.
Impacto: cumplimiento aprobado sobre una fuente retirada.
Causa probable: PRV-04 cerrado por decisión sin cubrir lo pendiente.
Solución recomendada: mostrar el estado de la fuente en la cola; hook de archivado a los conectores.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-05
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Funcionalidad / Permisos
Título: Se asigna la lectura y acuse a personas que nunca podrán acusar (restringido sin permiso, o sin docs:view/ack)
Archivo(s): lib/services/prevention-documents/distribution.ts; lib/services/prevention-document-ack-reminders.ts
Línea(s): distribution.ts:81-120 (no valida los permisos del destinatario) y 253 (el acuse exige la confidencialidad); distribution.ts:527-531 (las opciones incluyen a todo usuario activo); reminders:76-97
Pantalla/ruta: /prevencion/documentacion/[id] → Distribución
Endpoint: assignSstDocumentRecipientsAction / acknowledgeSstDocumentVersionAction
Rol: distribuidores; destinatarios jefe_terreno, supervisor, cphs
Descripción: el destinatario queda "pendiente" para siempre, los recordatorios lo llevan a una página prohibida y a diario se escala a la jefatura.
Evidencia: DEMOSTRADO (sonda): "prev asigna restringido a REC (sin manage_restricted): OK" → "REC acusa restringido: ERROR No tienes permisos para gestionar documentos restringidos." DEMOSTRADO (API A): sup → 403 en /api/prevencion/documentacion/*; el selector ofrece a todo usuario activo (CÓDIGO).
Cómo reproducir:
1. Publicar un MIPER-DIF restringido.
2. Asignarlo a un jefe_terreno.
3. Iniciar sesión con ese usuario e intentar acusar.
Resultado actual: el acuse es imposible y la asignación queda abierta.
Resultado esperado: sólo se asigna a quien puede leer y acusar, o el acuse propio de una asignación nominativa no exige manage_*.
Impacto: la difusión N°36 no se completa y hay ruido de recordatorios.
Causa probable: se exige "gestionar" para acusar.
Solución recomendada: validar al asignar, y permitir el acuse con la asignación como credencial.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-06
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Seguridad / Trazabilidad (M-04 residual)
Título: La bitácora documental y el acuse registran la IP de X-Forwarded-For (falsificable)
Archivo(s): app/(app)/prevencion/documentacion/actions/shared.ts
Línea(s): 25
Pantalla/ruta: toda acción de /prevencion/documentacion
Endpoint: server actions de documentación
Rol: cualquiera
Descripción: M-04 se corrigió en salud, privacidad y casos reservados (trustedAuditIp), pero no en documentación. También afecta a sst_document_acknowledgments.ip, que es la evidencia del acuse.
Evidencia: DEMOSTRADO (A): acciones enviadas con la cabecera X-Forwarded-For: 6.6.6.6 / 7.7.7.7 → sst_document_audit.ip = 6.6.6.6 (en_revision) y 7.7.7.7 (vigente).
Cómo reproducir:
1. Enviar a revisión con la cabecera X-Forwarded-For: 6.6.6.6.
2. Consultar sst_document_audit.
Resultado actual: queda la IP que escribió el cliente.
Resultado esperado: trustedAuditIp(headers) (null si no se resuelve).
Impacto: la evidencia de distribución y acuse es manipulable.
Causa probable: clientCtx propio de la biblioteca.
Solución recomendada: usar trustedAuditIp en clientCtx; la ruta /upload tampoco pasa IP (upload/route.ts:71).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-07
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: UI/UX / Flujo
Título: El ciclo de revisión no tiene cola ni avisos: nadie sabe que le toca revisar, aprobar o publicar
Archivo(s): app/(app)/prevencion/documentacion/documentacion-view.tsx; lib/services/prevention-documents/workflow.ts
Línea(s): documentacion-view.tsx:87-96 (los "N por revisar" sin enlace); workflow.ts (sin createNotifications en todo el módulo, grep)
Pantalla/ruta: /prevencion/documentacion
Endpoint: —
Rol: revisores, aprobadores, publicadores
Descripción: no hay filtro por estado ni vista "pendiente de mí"; hay que recorrer carpetas.
Evidencia: CÓDIGO (grep sin notificaciones) + UI (la tira de atención es texto).
Cómo reproducir:
1. Enviar una versión a revisión.
2. Entrar como otro prevencionista a /prevencion/documentacion.
3. Buscar qué debe revisar.
Resultado actual: sólo aparece un contador "1 por revisar" no navegable.
Resultado esperado: un filtro o pestaña por estado con enlace desde el contador, y una notificación al siguiente responsable.
Impacto: versiones estancadas; un PTS no publicado no acredita la N°43.
Causa probable: el ciclo se construyó sin la vista operativa.
Solución recomendada: filtro ?estado= enlazado desde la tira, y una notificación al pasar de estado.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-08
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Manejo de errores / UX
Título: Fallas silenciosas al crear carpetas y en la carga masiva
Archivo(s): documentacion-header-actions.tsx; documentacion-upload.ts
Línea(s): header-actions.tsx:71-80 (si !ok no muestra nada) y 230-236 (sólo "N con error"); documentacion-upload.ts:51-55 (descarta result.message)
Pantalla/ruta: /prevencion/documentacion (Nueva carpeta; Subir documento → Carga masiva)
Endpoint: createSstDocumentFolderAction / createAndUploadSstDocumentAction
Rol: todos los que suben
Descripción: se dan cuatro casos:
- una carpeta duplicada deja el diálogo abierto sin mensaje;
- la carga masiva dice "Listo: 0 de 1 subidos · 1 con error" sin decir por qué;
- un prevencionista_faena en la raíz siempre falla, porque no hay campo de faena;
- se ofrece "Sensible preventivo" a quien no puede usarlo.
Evidencia: DEMOSTRADO (A): captura flow-A-prev-1440-folder-dup-…png; flow.log: prev "Sensible preventivo" → 0 de 1; prevfaena y otrafaena "Operacional" en la raíz → 0 de 1; xss.html → "1 con error".
Cómo reproducir:
1. Crear dos veces la carpeta "X".
2. Como prevencionista_faena, en la raíz, hacer una carga masiva de un PDF.
Resultado actual: la acción no ocurre y no se explica.
Resultado esperado: el mensaje del servidor por archivo o carpeta; faena preseleccionada u opciones filtradas por permiso.
Impacto: pérdida de tiempo y documentos que no se cargan sin que nadie lo sepa.
Causa probable: la UI ignora ActionState.message.
Solución recomendada: mostrar el error (toast o lista), filtrar las opciones por permiso, y agregar el campo de faena en modo masivo.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-09
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental
Categoría: Integración PDTP / UX
Título: "Sin trabajo del Programa Preventivo pendiente en documentación" con N°43/N°36/N°19 planificadas y sin ejecutar
Archivo(s): components/prevention/pdtp-scheduled-activity-panel-server.tsx; lib/services/pdtp/executable-instances.ts
Línea(s): panel-server.tsx:17-19 (sólo lista instancias programadas y obligaciones)
Pantalla/ruta: /prevencion/documentacion (entorno B)
Endpoint: —
Rol: prevencionista
Descripción: en B, pdtp_scheduled_instances está vacío. Las actividades enganche de septiembre (43 s3, 36 s4, 19 s2 en 6 faenas) no aparecen, y el panel afirma que no hay nada.
Evidencia: DEMOSTRADO (B): captura B-prev-1440-_prevencion_documentacion.png; SQL (lectura) pdtp_activity_schedule y pdtp_executions = 0 para esas actividades.
Cómo reproducir:
1. En B, entrar como prev a /prevencion/documentacion.
2. Leer el panel "Actividades programadas".
Resultado actual: "Sin trabajo… pendiente".
Resultado esperado: listar las celdas enganche del mes con su CTA (publicar PTS, distribuir MIPER), o decir "sin instancias generadas".
Impacto: la pantalla oculta lo que el programa exige.
Causa probable: el panel depende de instancias que no se generaron para enganche.
Solución recomendada: derivar desde el cronograma, o generar las instancias al activar el programa.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: DOC-10
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental (N°19)
Categoría: Integración PDTP / Configuración
Título: El programa 2026 v2 activo no declara la carpeta de requisitos legales: la N°19 no puede acreditarse
Archivo(s): lib/services/pdtp/document-requirements.ts; app/(app)/prevencion/documentacion/legal-folder-panel.tsx
Línea(s): document-requirements.ts:146 (assertPdtpProgramEditableState: sólo en borrador)
Pantalla/ruta: /prevencion/documentacion?carpeta=requisitos-legales&faena=ws-horcones
Endpoint: setPdtpActivityDocumentRequirementsAction
Rol: prevencionista / JDPR
Descripción: pdtp_activity_document_requirements tiene 0 filas en B. El mapa afirma que la N°19 se acredita desde la carpeta.
Evidencia: DEMOSTRADO (B): SQL count=0; pantalla "Selecciona una faena… el programa activo todavía no declara qué documentos debe contener" aunque la URL trae la faena (captura …carpeta_requisitos_legales….png).
Cómo reproducir:
1. En B, abrir la URL indicada.
Resultado actual: no hay carpeta ni acreditación posible.
Resultado esperado: requisitos configurados en el programa activo (vía una nueva versión) y verificados como condición de despliegue.
Impacto: la N°19 (mensual) no se cumple por la vía declarada.
Causa probable: configuración de datos pendiente.
Solución recomendada: cargar la carpeta en la próxima versión del programa y agregarla al checklist; el panel debe mostrar la faena seleccionada.
Esfuerzo: Bajo (datos)
Bloquea producción: No (condición de despliegue)
Clasificación: A
```

```
ID: DOC-21
Severidad: 🟡 IMPORTANTE
Submódulo: Registro documental (N°36)
Categoría: Integración PDTP / Funcionalidad
Título: La difusión N°36 sólo la acreditan usuarios con cuenta: no existe acuse público de documentos
Archivo(s): app/(public)/acuse/actions.ts; app/(public)/acuse/[kind]/[targetId]/[token]/page.tsx
Línea(s): actions.ts:30 y page.tsx:85 (sólo kind "permiso")
Pantalla/ruta: /acuse/*
Endpoint: submitPublicAcknowledgement
Rol: trabajador sin cuenta
Descripción: el acuse de documentos exige sesión, docs:ack y docs:view. La mayor parte de la dotación sólo puede ser eximida, y la exención no acredita la N°36 (correcto). El mapa declara "#36 depende de que cada destinatario registre acuse".
Evidencia: CÓDIGO + DEMOSTRADO (/acuse/capacitacion/… → 404; sonda: la exención no crea ejecución N°36).
Cómo reproducir:
1. Distribuir un MIPER-DIF a trabajadores sin cuenta.
2. Buscar cómo acusan.
Resultado actual: no hay canal.
Resultado esperado: un enlace de acuse tokenizado por asignación (el mismo patrón HMAC v2) o una constancia de charla con firma.
Impacto: la N°36 no se puede evidenciar para la mayoría de los trabajadores.
Causa probable: el acuse público se diseñó para permisos.
Solución recomendada: kind "documento" en /acuse, firmado por el target.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **66/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 18,5 | DOC-03 −1,5 · DOC-05 −1,5 · DOC-21 −1,5 · DOC-12 −1 · DOC-15 −0,5 · DOC-17 −0,5 |
| UI/UX | 20 | 12,5 | DOC-07 −2,5 · DOC-08 −2,5 · DOC-13 −1 · DOC-14/18/19/20 −1,5 |
| Integridad de datos | 15 | 10 | DOC-03 −2 · DOC-04 −1,5 · DOC-06 −1 · DOC-14 −0,5 |
| Integración con el Programa Anual | 15 | 6,5 | DOC-01 −4 · DOC-04 −1 · DOC-09 −1 · DOC-10 −1 · DOC-21 −1 · DOC-15 −0,5 |
| Código y mantenibilidad | 10 | 8,5 | DOC-16 −0,5 · filtro clínico por regex −0,5 · DOC-17 −0,5 |
| Permisos y seguridad | 5 | 3,5 | DOC-02 −1 · DOC-06 −0,5 |
| Testing | 5 | 3,5 | sin pruebas de DOC-01/02/03/05 −1,5 |
| Manejo de errores | 5 | 3 | DOC-08 −1,5 · error genérico ante caída del storage −0,5 |

---

## AUDITORÍA — Datos personales (privacidad, salud y casos reservados)

**Rutas:** `/prevencion/privacidad`, `/solicitudes`, `/solicitudes/[id]`, `/auditoria`.

**API:**
- `/api/prevencion/privacidad/solicitudes/**` (crear, transición, ejecutar con `Idempotency-Key`, exportar XLSX con checksum);
- `/api/prevencion/salud/**`;
- `/api/prevencion/casos-reservados/**`;
- `/api/prevencion/archivos-sensibles/[id]`.

**Permisos:**
- `privacy:audit` y `manage_requests`: jefa y administrador;
- `export_subject`: sólo administrador;
- `health:view_restrictions`: jefa y administrador;
- clínico, reservado y vigilancia: sólo administrador (grants nominativos).

### A. UI/UX/Diseño

- Portada con dos tarjetas según el permiso.
- Lista de solicitudes con creación en diálogo (`PageHeader.actions`).
- Detalle con inventario por dominio y "Evidencia de ejecución".
- Sin desborde a 1440 ni a 390 px, 0 errores de consola (`visits.log`).
- **Auditoría** (captura `A-jefa-1440-_prevencion_privacidad_auditoria.png`) — DOC-23:
  - muestra enums crudos (`reserved_case`, `read_reserved`) e ids de usuario (`qa-ti`, `user-admin-e2e`);
  - la **hora en UTC** figura como "2026-09-30 01:10" cuando en Chile eran las 22:10 del 29-09;
  - sin filtros, sin paginación y sin EmptyState.
- El breadcrumb "Datos personales" del detalle apunta a `/auditoria` (DOC-24).

**Estados observados:**
- Con información; Permisos insuficientes (`prev` → `/forbidden`).
- Sin información: detalle "Aún no hay una mutación demostrable".
- No observados: Error y Cargando.

### Facilidad de uso

Crear una solicitud desde el header toma 5 clics. **No se recorrió en UI:** ejecutar el derecho, exportar ni transicionar (sólo API y suites).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Crear solicitud (plazo legal 30 d) | ✅ | API como jefa → 201 |
| Máquina de estados / retención | ✅ | Suites unitarias y postgres (6/6) |
| Ejecución por dominio (salud, reservado, PPA, documento) con hashes antes/después e idempotencia | ✅ | `prevention-privacy-postgres` 6/6 |
| Exportación minimizada | ✅ | Suite unitaria; no descargada en UI |
| Supresión de un documento vinculado | 🟡 | Sólo desvincula; el binario queda (DOC-25) |
| Salud: crear, leer restricciones, leer clínico | ✅ | API: admin 201/200; jefa restricciones 200 y clínico 404; prev/ti 404; sin propósito 400 |
| Casos reservados: crear, leer | ✅ | Admin 201/200; jefa POST 403, GET 404 (sin membresía) |
| UI de salud y casos reservados | ❌ | No existe (DOC-22) |
| Auditoría de accesos | 🟡 | Registra lo permitido y lo denegado; la presentación es cruda (DOC-23) |

### C. Código y lógica

- Autorización por propósito, alcance y membresía nominativa, con una respuesta indistinguible (404) para inexistente o fuera de alcance: correcto.
- `transitionPreventionPrivacyRequest` lee y actualiza sin `FOR UPDATE` ni condición de estado (`prevention-privacy.ts:223-260`), riesgo TEÓRICO de doble transición.
- Propósito libre de ≥ 3 caracteres ("curiosidad" se acepta como propósito; queda auditado).

### D. Modelo de datos

- Payload clínico y del caso cifrados (AES con key version).
- Historial de solicitud, ejecuciones con hashes, restricciones de tratamiento y entregas con sha256.
- Auditoría en `prevention_sensitive_access_audit`.

### E. Permisos y seguridad

- **M-04 corregido (DEMOSTRADO):** con `X-Forwarded-For: 6.6.6.6` las filas de auditoría de salud, casos reservados y privacidad quedaron con `ip = null`, no con la IP falsificada.
- Denegaciones auditadas.
- El inventario oculta los casos reservados sin membresía y los documentos sensibles sin permiso (CÓDIGO, `prevention-privacy-rights.ts:513-529`).
- El POST de salud responde sin `Cache-Control: no-store` (🔵 menor).

### F. Testing

Pasaron las suites unitarias de privacidad, salud y casos reservados, las PGlite de redacción y autorización de ejecución, y `prevention-privacy-postgres` (6/6).

### G. Integración con el Programa Anual

No acredita ni debe hacerlo (coincide con el mapa, "Brecha"). **Relación indirecta:** no expone datos del programa. Sus supresiones de vínculos documentales no afectan a las ejecuciones PDTP, porque las ejecuciones de documentos sólo guardan el id de versión.

### H. Hallazgos (🟡)

```
ID: DOC-22
Severidad: 🟡 IMPORTANTE
Submódulo: Datos personales (salud / casos reservados)
Categoría: Funcionalidad / UX
Título: Salud ocupacional y casos reservados (Ley Karin) existen sólo como API JSON, sin pantalla
Archivo(s): app/api/prevencion/salud/**, app/api/prevencion/casos-reservados/**; lib/services/prevention-documents/utils.ts; regularizacion/document-integrity-workbench.tsx
Línea(s): utils.ts:274-276 ("deben registrarse en su dominio seguro"); document-integrity-workbench.tsx:95 (reubicar exige tipear el id de destino)
Pantalla/ruta: ninguna (grep: ningún componente consume esas rutas)
Endpoint: POST /api/prevencion/salud, POST/GET /api/prevencion/casos-reservados
Rol: administrador (únicos grants)
Descripción: la biblioteca rechaza lo clínico o reservado y remite a un "dominio seguro" que no tiene interfaz; la reubicación desde Regularización pide un id que la UI no muestra en ninguna parte. La privacidad sí los inventaría.
Evidencia: DEMOSTRADO (API: creación y lectura OK con JSON crudo) + CÓDIGO (grep sin consumidores UI).
Cómo reproducir:
1. Intentar registrar un caso Ley Karin o una aptitud desde la UI.
Resultado actual: imposible sin herramientas técnicas.
Resultado esperado: una pantalla mínima con propósito y membresía, o retirar la promesa de la UI hasta tenerla.
Impacto: el dominio sensible no es operable; se arriesga a que esos archivos terminen fuera de la plataforma o mal clasificados.
Causa probable: se construyó el backend primero.
Solución recomendada: decidir el alcance; si va, formularios mínimos sobre la API existente.
Esfuerzo: Medio–Alto
Bloquea producción: No
Clasificación: C (B si Ley Karin entra en el lanzamiento)
```

### I. Readiness individual: **84/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 18 | DOC-22 −6 · DOC-25 −1 |
| UI/UX | 20 | 16 | DOC-23 −3 · DOC-24 −0,5 · flujos de ejecución no recorridos −0,5 |
| Integridad | 15 | 14 | DOC-26 −1 |
| Integración con el Programa Anual (indirecta) | 15 | 14 | aislamiento correcto; −1 sin guía de retención DS 44 frente a supresión |
| Código | 10 | 9 | DOC-26 −1 |
| Permisos y seguridad | 5 | 4,5 | propósito libre −0,5 |
| Testing | 5 | 4,5 | sin E2E de ejecución −0,5 |
| Errores | 5 | 4,5 | 404 sin `no-store` −0,5 |

---

## AUDITORÍA — Ficha del trabajador (`/prevencion/trabajador/[workerId]`)

**Qué es en la práctica:** no es una ficha preventiva. Es el espacio de **Evaluaciones SST** de una persona, con tres tarjetas: prevencionista, administrador de contrato y conductor líder.

**Acceso:** `sst:view` o `sst:evaluate_acompanamiento`, más el alcance por faena, que redirige a `/forbidden`.

**Consume:** `listWorkerEvaluations` y `deleteEvaluationAction`. Las evaluaciones cerradas no se borran; los borradores se borran con revocación PDTP (`sst-module/evaluations.ts:345-405`, CÓDIGO).

### A. UI/UX y facilidad de uso

- A 1440 y 390 px, sin desborde.
- Aviso "No hay una visita en borrador…" (tokens warning, tinte con texto muted).
- El breadcrumb "Evaluaciones SST" lleva a `/prevencion`, no a `/prevencion/evaluaciones`.
- **EPP preventivo** enlaza aquí (`epp-gap-list.tsx:160`), pero la página no muestra EPP (DOC-28).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Ver evaluaciones de la visita abierta | ✅ | — |
| Iniciar evaluación por rol | ✅ | Botón habilitado según el rol |
| Ver historial / evaluaciones cerradas | 🔴 | DOC-27 |
| Eliminar un borrador con confirmación | ✅ | CÓDIGO; no ejecutado |

### C–F

- Alcance verificado en el código (`page.tsx:63-66`) y en pruebas (`sst-worker-evaluations-scope.test.ts`, `visit-context.test.ts`: PASS).
- Sin datos sensibles expuestos: RUT y faena, nada de salud.

### G. Integración con el Programa Anual

No acredita por sí misma. Las actas que muestra (trabajador nuevo) sí acreditan la N°18/23/63; la ficha **oculta el acta cerrada que acreditó** (DOC-27), y la trazabilidad desde el trabajador se pierde.

### H. Hallazgos (🟡)

```
ID: DOC-27
Severidad: 🟡 IMPORTANTE
Submódulo: Ficha del trabajador
Categoría: Funcionalidad / Trazabilidad
Título: La ficha dice "Sin evaluación iniciada" a un trabajador con acta cerrada y ofrece iniciar otra
Archivo(s): app/(app)/prevencion/trabajador/[workerId]/page.tsx; visit-context.ts
Línea(s): page.tsx:72-76; visit-context.ts:142-162 (sólo visitas con alguna evaluación en borrador; las sin visitId o cerradas no se muestran)
Pantalla/ruta: /prevencion/evaluaciones → fila → /prevencion/trabajador/[id]
Endpoint: —
Rol: prevencionista_faena y quien tenga sst:view
Descripción: el listado muestra "Cerrado · cumple", pero al entrar las tres tarjetas dicen "Sin evaluación iniciada" y el único camino desde el listado no permite abrir el acta cerrada.
Evidencia: DEMOSTRADO (A, prevfaena): capturas A-prevfaena-1440-_prevencion_evaluaciones.png y …trabajador_worker_e2e.png; SQL (lectura): worker-e2e tiene trabajador_nuevo cerrado (visit_id null).
Cómo reproducir:
1. /prevencion/evaluaciones como prevfaena.
2. Clic en "Trabajador E2E".
Resultado actual: tarjetas vacías y "+ Iniciar Evaluación".
Resultado esperado: historial de visitas y actas cerradas con enlace a /prevencion/[id].
Impacto: evaluaciones duplicadas; la evidencia que acreditó la N°18/23/63 no se encuentra desde el trabajador.
Causa probable: la página se centró en la visita en curso.
Solución recomendada: sección "Historial" con las evaluaciones del alcance y enlace al acta.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **80/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad | 25 | 19 | DOC-27 −6 |
| UI/UX | 20 | 15 | DOC-27 −3 · DOC-28 −2 |
| Integridad | 15 | 14 | ausencia de historial visible −1 |
| Integración con el Programa Anual (indirecta) | 15 | 12 | DOC-27 −3 |
| Código | 10 | 9 | −1 visitas legadas sin visitId excluidas sin fallback |
| Permisos y seguridad | 5 | 5 | — |
| Testing | 5 | 3 | sin prueba del historial −2 |
| Errores | 5 | 3 | redirige a `/prevencion` si no existe el trabajador, sin mensaje −2 |

---

## Hallazgos 🔵/⚪ (condensado)

| ID | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|
| DOC-11 | Documental | Caída del storage (Cloudreve) llega al usuario como "No se pudo completar la acción"; copias de BD traen el backend del drive de producción | `actions/shared.ts:16-20`; `system_settings` | DEMOSTRADO B (log) | Mensaje "almacenamiento no disponible"; saneamiento de settings al clonar | B |
| DOC-12 | Documental | TopBar filtra sólo la carpeta abierta; `?q=` usa `LIKE` sensible a mayúsculas | `documentacion-view.hooks.ts:305-320`; `search.ts:85` | CÓDIGO | Búsqueda global con `ilike` desde el TopBar | B |
| DOC-13 | Documental | Se muestran "Aprobar" al autor y "Publicar" al aprobador; el servidor los rechaza con toast | `[id]/versions-tab.tsx:193-236` | DEMOSTRADO A | Ocultar o deshabilitar con explicación | B |
| DOC-14 | Documental | Una subida fallida deja un documento vacío archivado en la Papelera ("xss") | `actions/crud.ts:198-210`; `typed-upload.ts` | DEMOSTRADO A (captura papelera) | Crear el documento y la versión en una transacción, o borrar el vacío | B |
| DOC-15 | Documental | Publicar una nueva versión crea una segunda ejecución N°43 en la misma celda | `publication.ts:223-233`; `pdtp-accreditation-connectors.ts:549-570` | DEMOSTRADO sonda | Decidir si una revisión cuenta; agrupar por documento o mes | B |
| DOC-16 | Documental | Almacenamiento y descarga conservan la extensión del cliente (`polyglot.pdf.html` servido como PDF, guardado como `.html`) | `utils.ts:314-318` | DEMOSTRADO A | Extensión según el MIME detectado | B |
| DOC-17 | Documental | Archivar un archivado vuelve a registrar; archivar y publicar no van a `audit_log` global | `crud.ts:363-387` | DEMOSTRADO sonda | Guardia de estado + `recordStatusChange` | B |
| DOC-19 | Documental | El expediente Excel muestra ids de usuario y faena, no nombres | `[id]/expediente/route.ts:258-312` | CÓDIGO | Hidratar nombres | B |
| DOC-20 | Documental | La subida tipada preselecciona "Nueva versión de «…»" si ya existe un documento del tipo | `typed-upload-form.tsx` (efecto `listSstDocumentsOfTypeAction`) | DEMOSTRADO A | Sin preselección, o confirmación explícita | B |
| DOC-23 | Privacidad | La auditoría muestra enums e ids crudos, hora UTC y no tiene filtros ni paginación | `privacidad/auditoria/page.tsx:108-113,138-140` | DEMOSTRADO captura | `formatDateTime`, etiquetas, nombres, filtros | B |
| DOC-24 | Privacidad | El breadcrumb "Datos personales" del detalle apunta a `/auditoria` | `privacidad/solicitudes/[id]/page.tsx:270` | CÓDIGO | `/prevencion/privacidad` | B |
| DOC-25 | Privacidad | La supresión de un documento vinculado sólo quita el vínculo; el binario con datos queda (`documentBinaryUnchanged`) | `prevention-privacy-rights.ts:359-375` | CÓDIGO | Declararlo en la UI y en la respuesta al titular (retención DS 44) | B |
| DOC-26 | Privacidad | Transición de solicitud sin lock ni versión | `prevention-privacy.ts:223-260` | TEÓRICO | `UPDATE … WHERE status = from` | B |
| DOC-28 | Ficha | No es una ficha preventiva (sólo evaluaciones SST); EPP enlaza aquí sin mostrar EPP; breadcrumb inconsistente | `trabajador/[workerId]/page.tsx:106-116`; `epp-gap-list.tsx:160` | DEMOSTRADO captura | Renombrar o ampliar a una ficha real | M |
| DOC-18 ⚪ | Documental | Toast "versión anterior reemplazada" en la primera publicación; carpetas ordenadas "10_" antes de "4_" | `actions/workflow.ts:82`; `labels.ts:70` | DEMOSTRADO | Texto condicional; orden natural | B |

## Estado de hallazgos previos en este alcance

| Hallazgo | Dictamen | Evidencia |
|---|---|---|
| **PRV-02** (Documentación) | **Corregido (verificado)** | Sonda: el publicador no aprueba la N°43; el destinatario no aprueba su N°36; sin evidencia verificable exige motivo ≥ 10. Queda la brecha distinta de DOC-01 (evidencia "provided" en la N°18) |
| **PRV-04** (archivar documento, N°36/43) | **Sigue abierto por decisión; coherencia parcial** | Lo aprobado sigue aprobado (coherente con la decisión); lo pendiente se aprueba sin aviso y la N°18 no se cierra (DOC-04) |
| **M-03** | **Corregido (verificado)** | HTTP: XML/SVG `attachment` + `nosniff`, PDF `inline`, CSP con nonce; navegador: descarga, sin ejecución |
| **M-04** | **Parcial** | Salud, privacidad y casos reservados corregidos (IP null ante XFF falsa); documentación sigue con XFF (DOC-06) |
| **M-20** | **No verificable / no aplica a Documentación** | La ejecución de documentos no lleva archivo; los documentos se sirven por su ruta con clase de dato. No se revisó la ruta de evidencia PDTP de otros dominios |

## Qué no se pudo verificar y por qué

- **Recorrido UI de la integración en B** (publicar, distribuir, acusar, archivar sobre el programa real): las subidas fallan en B por la configuración de storage, y cambiarla fue denegado. Se ejecutó por sonda PGlite con los servicios reales; en B sólo lectura.
- **Distribución y acuse por UI:** A sólo tiene el tipo RIOHS-SEREMI, que no exige acuse. Se verificó por sonda.
- **Acuse público de una tripulación real** (uso único, doble acuse): no hay tripulaciones en A. Sólo se verificaron token vencido, manipulado, basura y destino inexistente.
- **Anchos 1024 y 768 px:** sólo 1440 y 390.
- **Búsqueda en UI:** el script de carpeta y búsqueda se cortó al abrir la carpeta. DOC-12 queda como CÓDIGO.
- **UI de ejecución, exportación y transición de privacidad:** cubiertas por suites (postgres 6/6), no por navegador.
- **Si `sst_document_audit` es append-only en BD:** no consultado.
- **Contenido del ZIP por rol:** no se abrió; la lógica se leyó en el código.
- **Contenido de las notificaciones de recordatorio:** leído en el código, no observado.

## Datos creados y cambios de entorno

- **En A:** documentos `QA_DOC_*`, `pts-v1`, `xss`, `polyglot.pdf`, `restr-v1`, `sens-v1`; carpeta "QA_DOC Carpeta Sub"; registro de salud `phr-zhxg92cOnjaxLIl46xaHr`; caso reservado `prc-7-NKPpjyUZhPrCLop6e6N`; solicitud de privacidad `ppr-P0HX3-MouswanA0PCpfGi`.
- **En B:** nada.
- **Base propia:** `bodega_test_privacy_documental` (la suite postgres la reinicia).
- **Repo:** el archivo temporal `lib/__tests__/documental-integration.audit-tmp.test.ts` se copió a mi carpeta y se **borró** del repo.
