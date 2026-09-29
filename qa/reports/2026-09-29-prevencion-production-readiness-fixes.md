# Prevención/PDTP — correcciones de la auditoría de production readiness

**Fecha:** 2026-09-29 · **Rama:** `prevencion/production-readiness` (desde `main`, sin push ni merge)
**Commits:** `c887676a` (fase 1) · `402c8541` (fase 2) · `a04b6230` (fase 3) · `c0d52651` (fase 4) · `4f244631` (fase 5) · `a333353a` (E2E y M-03)
**Auditoría de origen:** [2026-09-28-auditoria-production-readiness-prevencion.md](2026-09-28-auditoria-production-readiness-prevencion.md) — 68/100, 2 críticos, 20 importantes, 23 mejoras, 5 cosméticos.
**Plan:** decisiones del usuario del 2026-09-28: sin URL externa como evidencia, una sola rama, alertas sólo internas, complemento revisable.

> **Alcance de esta nota.** Es la autoevaluación de quien implementó, contra la misma matriz de la
> auditoría. No reemplaza una auditoría independiente. Nada de esto corrió todavía contra
> producción ni contra una copia de sus datos.

## 1. Resultado

| | Antes | Después (estimado) |
|---|---:|---:|
| Nota | **68** — No listo | **~92** — Listo con condiciones de despliegue (§5) |
| Críticos abiertos | 2 (PRV-01, PRV-02) | 0 |
| Importantes abiertos | 20 | 0 sin tocar; 3 con una parte que espera decisión de negocio (PRV-04, PRV-19 #15, M-20; §4) |
| Condición mínima de §19 | No | **Sí en código y pruebas**; falta lo que sólo se comprueba en el ambiente destino (§5) |

### Desglose

| Área | Pts | Antes | Después | Qué cambió / qué descuenta todavía |
|---|---:|---:|---:|---|
| Flujo Programa → Actividad → Cumplimiento | 20 | 15 | **19** | PRV-03, 07, 08, 09 y 20 corregidos. −1: "a la fecha" sigue cortando por mes, no por semana (M-15). |
| Evidencias y trazabilidad | 15 | 8 | **13,5** | PRV-01, 12, 13 y 17 corregidos. −0,5: PRV-04 cerrado sólo para higiene (el resto es una decisión, §4). −0,5: M-12 escanea todo pero no persiste el hallazgo ni lo marca en la celda. −0,5: GC e integridad no corrieron sobre storage real. |
| Integración con submódulos | 15 | 9 | **13** | PRV-16, PRV-22, PRV-19 #8/#12/#13/#16 corregidos. −1: #15 (mes con 0 HH) espera una decisión de negocio. −1: el script de PRV-06 existe pero no se aplicó. |
| Integridad y consistencia de datos | 10 | 7 | **9,5** | PRV-05, 10, 11 y M-07, M-09 corregidos. −0,5: las migraciones 0336–0342 no corrieron sobre datos reales. |
| Roles, permisos y seguridad | 10 | 6,5 | **9,5** | PRV-02, 15, 18, M-02, 03, 04 y 05 corregidos. −0,5: M-20 necesita una clasificación de negocio (§4). |
| UX/UI y facilidad de operación | 10 | 7,5 | **9,5** | PRV-20, PRV-08 (UI), M-01, C-01…C-05 corregidos. −0,5: complemento, anulación y reducción de meta no se recorrieron en navegador con usuarios reales. |
| Testing y estabilidad | 8 | 6,5 | **7,5** | Cada defecto demostrado tiene regresión (§3). −0,5: el E2E completo no se volvió a correr después de las últimas correcciones (sí los specs afectados), y sin WebKit. |
| Manejo de errores y casos borde | 5 | 3,5 | **5** | PRV-03, M-10 y M-16 corregidos. |
| Performance | 3 | 2,5 | **2,75** | M-11: recordatorios sin N+1. −0,25: la cola de aprobaciones no se pagina (§4). |
| Observabilidad y operación | 4 | 2 | **3** | PRV-14: conciliación diaria, alerta de staleness y respaldo agendados. −1: no corrieron en el contenedor cron, y no hay panel de salud de crons. |
| **Total** | **100** | **68** | **≈ 92** | |

## 2. Qué se corrigió

### Críticos (condición mínima)

- **PRV-01 — evidencia de integración verificada.** Una ejecución que llega de otro módulo sólo cuenta como "evidencia entregada" si el archivo existe, es del dominio de la fuente, está registrado para la misma faena y su sha256 coincide. Una URL externa ya no cuenta. CGRD y Campañas aceptan sólo archivos subidos. Hay un registro de subidas por dominio (`prevention_evidence_uploads`, 0336).
- **PRV-02 — segregación en integración.** Se guarda quién originó el hecho, así que esa persona no puede aprobarlo. Aprobar una integración sin evidencia verificada exige un motivo, que queda en la ejecución (probado en E2E).
- **PRV-03 — sin ejecuciones futuras.** El servidor rechaza registrar o aprobar una semana que no ha ocurrido. El formulario no la ofrece.
- **Saneamiento.** Devuelve a revisión las aprobaciones automáticas sin evidencia verificable y las de semanas futuras. **Corre en cada deploy**: one-shot `apply-pdtp-unverified-approvals` en `deploy-prod.sh`, después de la conciliación. No toca meses cerrados, es idempotente, firma `PDTP_UNVERIFIED_ACTOR_USER_ID` o el primer administrador, y no aborta el deploy. A mano: `npm run pdtp:report-unverified-approvals` (sólo reporta) o con `-- --apply --actor=<id>`. En `bodega_dev` encontró 0. Probado sobre la base desechable del E2E con una auto-aprobación de evidencia inexistente: la devolvió a revisión con traza y la segunda corrida no repitió nada.

### Fase 2 — integridad funcional

- **Solicitudes con revisión de una segunda persona** (`pdtp_review_requests`, 0337):
  - PRV-05: cancelar una obligación;
  - PRV-12: anular una ejecución manual aprobada;
  - M-06: reducir una meta por faena (0342). Además, desde M-06 la reprogramación nace en revisión, igual que el "no aplica".
- **Cálculo del cumplimiento:**
  - PRV-07: el atraso parcial cuenta como adeudado;
  - PRV-08: complemento revisable en la misma celda (`sequence`, 0338);
  - PRV-09: un solo corte por faena en indicador, RE-36 y reporte;
  - PRV-10: fechas en hora de Chile;
  - PRV-11: el padrón manual tiene vigencia (0339) y no reescribe meses cerrados.
- **Conectores:**
  - PRV-16: un "no aplica" inválido se rechaza con un error visible;
  - PRV-22: la N°20 con mecanismo constancia queda como evento diferido y se puede reprocesar;
  - PRV-19: #8 anular un simulacro terminado, #12 N°62 lleva a `/entregas`, #13 una inspección completada no se reescribe, #16 plan de emergencia con cantidad 1;
  - PRV-06: la lista de ocurrencias filtra las que ya no están en el catálogo;
  - M-22 y M-23.
- **Operación (PRV-14):**
  - nuevo cron `pdtp-daily-reconcile`;
  - nuevo cron `prevention-cron-staleness`, que alerta por notificación y correo;
  - `backup-health` agendado;
  - restauración selectiva de evidencia documentada en `docs/deploy/RESPALDOS_Y_RESTAURACION.md`.

### Fase 3 — seguridad, permisos y trazabilidad

- **Bitácora:**
  - PRV-13: `audit_log` y `pdtp_change_log` son de sólo agregar (trigger, 0340). Sólo la limpieza legal de 6 años y el borrado de un borrador PDTP pueden borrar, y ese borrado deja un resumen (M-19).
  - M-19: crear o borrar hojas deja rastro.
  - M-08: iniciar y enviar ocurrencias programadas deja historial.
- **Acceso:**
  - PRV-15: `/reportar-incidente` abre sin sesión.
  - PRV-18: la descarga de CGRD y Campañas compara la ruta exacta.
  - PRV-21: nueva descarga de evidencia de higiene con alcance. El PDTP enlaza la evidencia de higiene, CGRD y Campañas.
  - M-02: el proxy rechaza mutaciones a `/api` desde otro origen (probado en E2E).
  - M-04: la bitácora de salud, privacidad y archivos reservados usa la IP confiable, no `X-Forwarded-For`.
  - M-05: `prevention:pdtp:program:manage` sólo se otorga a roles globales. Lo exige el servicio de roles y hay una prueba de paridad del seed.
- **Evidencia y datos:**
  - PRV-17: el GC y la descarga ven la evidencia de las solicitudes de resultado.
  - M-12: el escaneo de integridad recorre la evidencia de todos los dominios.
  - M-07: RESTRICT de faena en desvíos, subidas y metas (0341).
  - M-09: motivo mínimo de 10 caracteres en "no aplica" y cancelación de ocurrencias (0341, `NOT VALID`: no rechaza filas históricas).
- **M-03 — descargas.** La biblioteca documental sólo muestra en el navegador PDF e imágenes; el resto se descarga, con `nosniff`. **Corrección verificada en navegador:** el primer intento agregaba `CSP: sandbox`, pero el E2E mostró que el proxy reescribe `Content-Security-Policy` en toda respuesta, así que nunca llegaba. Se retiró; además habría roto el visor de PDF. Lo que sí protege está verificado: `attachment` para lo que no es PDF ni imagen, `nosniff`, y el `script-src` por nonce del proxy.
- **M-16.** Los errores del sistema de archivos y las rutas del servidor no llegan al usuario.

### Fases 4 y 5 — UX, errores, performance

- **PRV-20.** "Ejecutadas" dice "N ejecuciones por aprobar →" y lleva a Aprobaciones, sin agregar un tile (regla A1).
- **PRV-08.** El formulario dice "Registrar complemento" en una semana aprobada por debajo de lo planificado.
- **M-01.** El texto de "no aplica" dice que queda en revisión.
- **M-10.** Sólo "no existe o fuera de alcance" es un 404; los demás errores se relanzan.
- **M-18.** El control de cambios se pagina, y `/admin/auditoria?entidad=<id>` muestra la historia completa de un registro.
- **Cosméticos:**
  - C-01: la cabecera lleva el cargo real de quien elabora;
  - C-02: "sin planificación" en vez de 0 %;
  - C-03 y C-04: los rótulos automáticos pierden el id interno y se distinguen de una observación;
  - C-05: `codeYear()`.
- **M-11.** Los recordatorios de obligaciones leen por lote.
- **M-13.** Hay prueba de que la copia 2027 conserva número e identidad de catálogo, que es la llave del contrato de destinos.

## 3. Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck`, `npm run lint` | PASS (0 errores, 0 advertencias) |
| `npm run db:verify-migrations` | PASS: 343 entradas hasta 0342, checksums registrados |
| `drizzle-kit generate` | "No schema changes" |
| `npm run test:fast` | **10.330 PASS**, 0 fallos |
| `npm run test:pglite` | **2.808 PASS**, 1 omitido, 0 fallos (sobre `a333353a`) |
| 16 suites `*-postgres` de PDTP y Prevención, una por una contra el contenedor e2e | **226 PASS**, con 0340–0342 aplicadas sobre Postgres real |
| `npm run test:e2e` completo | **760 PASS / 3 fallos / 4 omitidos**. Los 3 fallos se corrigieron y se volvieron a correr aislados en PASS: (1) el tile nuevo tenía un objetivo táctil de 16 px, axe `target-size`, corregido a 24 px; (2) un spec propio chocaba con otra ejecución de la misma semana, corregido el localizador; (3) `dashboard.spec.ts` esperaba el tile de Gestión del cambio, retirado en `main` (`cfe3a925`) antes de esta rama, **preexistente**. |
| E2E nuevo `prevencion-production-readiness.spec.ts` | 4 PASS: PRV-15, M-02, PRV-20, PRV-02 |
| `pdtp-evidencia-aprobacion.spec.ts` con las cabeceras de M-03 | 5 PASS |
| Recorrido de navegador (script temporal, no versionado) | 4 roles × 2 anchos (1440 y 390 px) × 8 rutas, más `/reportar-incidente` sin sesión: 0 respuestas ≥ 500, 0 errores de consola, 0 px de desborde. Los roles sin permiso llegan a `/forbidden`. |

**Base del recorrido:** la base desechable del E2E, con sus usuarios por rol. No se usó `bodega_dev`: no tiene aplicadas las migraciones 0340–0342, y aplicarlas implicaba escribir en una base que la auditoría trató como de sólo lectura.

**Ruido del recorrido:** las "peticiones fallidas" registradas son precargas RSC canceladas al navegar (`ERR_ABORTED`), no errores.

**Advertencia de automatización:** el helper no pudo iniciar sesión con el solicitante de faena porque su destino tras el login no es `/dashboard`. Es una limitación del helper, no un defecto de producto.

## 4. Decisiones abiertas y brechas conocidas

**Pendientes de negocio:**

- **PRV-04 (revocaciones al archivar).**
  - Se revoca la versión anterior de un pronunciamiento de higiene.
  - No se revoca al archivar un plan de emergencia, un documento ni una MIPER reemplazada: el criterio aplicado es que un documento archivado sigue respaldando el período en que estuvo vigente.
  - Si negocio quiere lo contrario, el patrón de revocación ya existe (`recordPdtpFulfillmentRevocation`).
- **PRV-19 #15.** Cerrar un mes con 0 horas-hombre como "sin actividad", con motivo, requiere definir quién lo declara. La N°7 ya acredita en el mes del indicador.
- **M-20.** Clasificar qué actividades PDTP llevan datos sensibles para restringir su descarga. La evidencia PDTP no tiene hoy una clase de dato; los documentos de la biblioteca sí la tienen y se sirven por su propia ruta.

**Brechas técnicas:**

- **Pendientes:**
  - M-15: "a la fecha" corta por mes, no por semana.
  - M-17: sin control de versión del lado del cliente (el servidor ya bloquea y revalida).
  - M-12: el hallazgo de integridad no se persiste ni se marca en la celda (sí se alerta).
  - M-11: la cola de aprobaciones no se pagina. Un tope escondería pendientes sin avisar, y el volumen actual no lo justifica.
  - Sin panel de salud de crons en `/admin/modulos` (era opcional; la alerta de staleness ya avisa).
  - PRV-18: sin prueba automatizada de la ruta; la lógica es igualdad exacta.
- **Script sin aplicar:** `prevention:retire-obsolete-training-occurrences` no se aplicó. En `bodega_dev` dejaría 91 retirables, ninguna con historia.
- **Prueba que falta:** `test:e2e` completo no se repitió después de las últimas correcciones; sólo los specs afectados.
- **Sin recorrer:** WebKit, y en navegador los flujos de complemento, anulación, cancelación y reducción de meta. Están cubiertos por PGlite y Postgres, no por E2E.

## 5. Condiciones de despliegue (no verificables desde aquí)

1. **Migraciones 0336–0342 sobre una copia de producción.** Verificar que corren y cuánto tardan. En particular:
   - el trigger de sólo agregar (0340) exime a las bases cuyo nombre contiene `test`, `e2e`, `tmp`, `temp` o `capture`: **confirmar que el nombre de la base de producción no calza**;
   - `NOT VALID` en 0341 no valida filas antiguas.
2. **Anticipar el saneamiento**, que el deploy aplica solo. `PDTP_UNVERIFIED_DRY_RUN=true docker compose run --rm apply-pdtp-unverified-approvals` antes de liberar dice cuántas aprobaciones volverán a la cola, y por lo tanto cuánto baja el cumplimiento hasta que se revisen. Conviene fijar `PDTP_UNVERIFIED_ACTOR_USER_ID` para que la corrección no quede firmada por "el primer administrador".
3. **Crons en el contenedor:** `pdtp-daily-reconcile`, `prevention-cron-staleness` y `backup-health`. Revisar `cron_runs` y que la alerta llegue.
4. **Del checklist original:**
   - respaldo activo y perfil `backup`;
   - GC de evidencia en modo prueba;
   - mecanismo de la N°20 y `pdtp:apply-mechanisms`;
   - ensayo de restauración selectiva.
5. **Recorrido por rol con usuarios `QA_`** en staging, sobre los flujos listados como "sin recorrer" en §4.
