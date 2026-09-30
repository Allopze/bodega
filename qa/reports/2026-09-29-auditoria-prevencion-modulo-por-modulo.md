# Auditoría de production readiness de Prevención, submódulo por submódulo

**Fecha:** 2026-09-29.
**Commit auditado:** `11e67621` (`main`, árbol limpio, incluye las correcciones del 29-09).
**Modo:** diagnóstico. No hubo cambios de producto.
**Informes detallados:** 11 anexos en [`2026-09-29-auditoria-prevencion-modulo-por-modulo/anexos/`](2026-09-29-auditoria-prevencion-modulo-por-modulo/anexos/), uno por equipo de revisión, con la evidencia de cada afirmación.

## Método y alcance real

**Entornos** (desechables; producción no se tocó):

- **A. Semilla E2E.** Servidor `:3100` sobre `bodega_audit_e2e`, con los datos de `e2e/setup-db.ts`.
- **B. Copia realista.** Servidor `:3101` sobre `bodega_audit_real_e2e`, una copia de `bodega_dev` migrada de 0335 a **0342**. Trae el **programa 2026 v2 real** (81 actividades vigentes) y 16 faenas reales.
- **Build.** Ambos servidores usan el mismo build de producción del commit auditado.
- **`bodega_dev`.** Sólo se leyó una vez para copiarla.

**Roles reales.**

- Se crearon usuarios `QA_` con los roles reales de `lib/auth/system-rbac.ts`: prevencionista (×2, para probar segregación), prevencionista_faena de dos faenas distintas, jefa_chome, supervisor_terreno, jefe_terreno, cphs, gerente_legal_rrhh, tecnico_ti y administrador.
- La auditoría anterior sólo tenía un usuario con todos los roles. Ésta verificó permisos, segregación e IDOR con roles acotados.

**Equipo.**

- 11 revisiones en paralelo, cada una sobre un grupo de submódulos, con la metodología y los pesos del encargo.
- Cada revisión recorrió sus pantallas en Chromium a 1440, 1024, 768 y 390 px (unas 820 capturas).
- Cada revisión ejecutó los flujos en el entorno B y probó la capa de servicios real en PGlite con sondas temporales. Todas se borraron del repo.
- Cada revisión llamó directamente a endpoints y server actions con roles de otra faena y corrió las suites de su alcance, incluidas las `*-postgres`, de a una contra el contenedor desechable.
- Los hallazgos de mayor peso se re-verificaron contra el código: INS-01, INT-01, INT-09, CPH-04 y CUM-05. Coinciden.

**Puertas deterministas** (§14): typecheck, lint, secretos, `db:verify-migrations`, `test:fast` y `test:pglite` completos. `check:security-audit` **falla**.

**Sin recorrer.**

- **Producción y sus datos:**
  - si el saneamiento del deploy ya corrió allí (ver INT-01);
  - si el respaldo corre;
  - el mecanismo real de la N°20;
  - la configuración de Cloudreve.
- **Suite E2E de Playwright:** el permiso de sesión bloqueó el reseteo de su base (§14), así que no se ejecutó en esta auditoría.
- **Otros navegadores y pruebas de accesibilidad:** WebKit y Firefox, lector de pantalla y teclado en profundidad.
- **Operación real:** crons en el contenedor real, envío real de correo y Cloudreve real.
- **Paso de año:** el cambio 2026 → 2027 de punta a punta.

**Incidentes de proceso.**

1. **Límite de uso.** Dos cortes de la API detuvieron a 8 de las 11 revisiones a mitad de trabajo. Se retomaron sobre sus propios avances y los servidores se volvieron a levantar sobre las mismas bases. Algunas revisiones cerraron con cobertura parcial; cada anexo lo declara.
2. **Permisos denegados.** El sistema de permisos de la sesión bloqueó cuatro lecturas de la revisión del programa (§5) y un cambio de configuración de storage en B. Ninguno se reintentó por otra vía.
3. **Configuración de B.** La copia B trae `storage.cloudreve.backend=cloudreve` apuntando a `https://drive.portalchome.cl`, con credenciales que no se pueden descifrar fuera de producción. Las subidas de la biblioteca documental fallaron en B. La máquina no tiene salida a internet, así que ninguna petición llegó a ese drive. Las demás subidas usan el disco local y funcionaron.
4. **Datos compartidos.** Varias revisiones escribieron en paralelo en B, así que las cifras de ejecución de B se movieron durante la auditoría. Las verificaciones numéricas exactas se hicieron en PGlite, donde el estado lo controla una sola prueba.

---

## 1. Resumen ejecutivo

Prevención **no es un prototipo**:

- Tiene 30 submódulos funcionando sobre una base de datos con reglas duras.
- El núcleo manual del programa anual es sólido y se verificó ejecutándolo:
  - los cuatro estados del cumplimiento están bien diferenciados;
  - «se hizo» exige un archivo real verificado;
  - «no aplica» nace en revisión y lo aprueba otra persona;
  - el indicador cuadra celda por celda con el cálculo a mano.
- Las correcciones del 29-09 que se volvieron a medir (PRV-05, 08, 12, 15, 17, 18, 20, 22, M-02, M-03, M-07, M-09, M-23 y otras) **están bien hechas**.
- No hay IDOR entre faenas en ninguna de las 10 rutas de descarga probadas.
- El código está limpio: 0 `any`, 0 `console.log`, 0 TODO reales.

La auditoría submódulo por submódulo muestra que **la confianza del programa todavía no está cerrada en la frontera con los submódulos**. Hay tres bloqueadores:

1. **El % de las inspecciones está mal calculado (INS-01).** Suma los «Cumple» de secciones que no puntúan. El Reporte de Uso Diario de Equipos da 263 %, la base lo rechaza y la inspección no se puede cerrar. Así, las N°25 y N°26 **no se acreditan por el camino normal**. En otras plantillas el % sale inflado.
2. **Los submódulos pueden acreditar semanas futuras (T-01).** PRV-03 se corrigió sólo en el registro manual. Desde capacitación, alcotest, higiene, CPHS, coordinación y actas de ingreso se crearon ejecuciones **aprobadas en noviembre y diciembre**, que el cumplimiento anual cuenta. Se reprodujo de forma independiente en siete revisiones.
3. **El saneamiento del deploy corre sin storage (INT-01).**
   - El paso que se agregó al deploy el 29-09 (`da539f8b`) corre en un contenedor **sin el volumen de storage**.
   - En cada deploy devolvería a revisión **todas las auto-aprobaciones legítimas**, con motivo `file_missing` y firmadas por «el primer administrador».
   - Ese commit ya está en `main`, y la app de producción se había redesplegado poco antes de empezar esta auditoría. **Revisa la salida del último deploy antes del siguiente.**

A eso se suman 15 críticos consolidados. Los de mayor peso son:

- **Segregación y evidencia en integración:**
  - varias fuentes no guardan a quien originó el hecho, así que esa persona puede aprobar su propio cumplimiento (T-03);
  - las obligaciones cuentan como «evidencia entregada» un texto que genera el propio sistema (T-04);
  - la N°81 del CGRD se auto-aprueba reutilizando el mismo PDF en varias sesiones (RSK-01);
  - la N°18 del RIOHS se cierra sin un solo acuse (DOC-01).
- **Incidentes (RE-20):**
  - los plazos se miden desde la hora de registro, no desde la ocurrencia (INC-03);
  - la declaración, el ONE PAGE y los seguimientos se guardan pero no se ven en ninguna parte (INC-01);
  - un incidente con una CAPA cancelada no se puede cerrar nunca (INC-05).
- **Privacidad:** los datos de salud del RE-28 (por ejemplo, embarazo) los ven supervisor y jefe de terreno, sin registro de acceso (EVA-03).
- **Operación diaria:**
  - no se puede crear la revisión v+1 de un programa activo desde la interfaz (PRG-01);
  - la grilla de capacitación tiene 390 tarjetas sin filtro de mes (CAP-03);
  - el autoguardado del acta SST no se detiene y pierde datos con dos pestañas (EVA-01).

**Nada de esto exige funcionalidad nueva.** Son guardas, cálculos y enlaces que faltan en lo que ya existe. Casi todos los arreglos son de esfuerzo bajo o medio.

**Nota global: 59/100.**

- Se aplica el **tope del §33**: está demostrado que una persona puede **inflar el cumplimiento con hechos que todavía no ocurrieron**, auto-aprobados sin segunda persona (T-01).
- **Sin el tope, la nota sería 64,5.** Es el mismo orden que la auditoría del 28-09 (68), pero sobre un alcance mucho mayor.
- **El núcleo del programa mejoró.** Lo que baja la nota son los submódulos que la auditoría anterior no recorrió.

---

## 2. Inventario de Prevención

Se reconstruyó desde `app/(app)/prevencion/**` (72 páginas), `app/(public)/**`, `app/api/prevencion/**` (57 rutas) y `modules/{prevention,sst,ppa}/manifest.ts`. Son 30 submódulos más el motor transversal de acreditación.

| # | Módulo/Submódulo | Ruta | Propósito aparente | Estado inicial |
|---|---|---|---|---|
| 1 | Programa Anual: configuración y seguimiento | `/prevencion/pdtp`, `/pdtp/programas`, `/pdtp/nuevo`, `/pdtp/[programId]` (+editar, habilitación, reporte, cierres), `/pdtp/plantillas`, `/pdtp/aplicabilidad`, `/pdtp/cobertura`, `/pdtp/cierres` | Definir el programa anual, sus actividades, responsables, metas y firmas; tablero, RE-36 y cierres | En menú; programa 2026 v2 real activo en B |
| 2 | Planilla de actividades y registro de ejecución | `/prevencion/pdtp/actividades`, `/pdtp/[programId]/ejecucion/[executionId]` | Registrar «se hizo / no se hizo / no aplica» con evidencia por celda | En menú |
| 3 | Aprobaciones | `/prevencion/pdtp/aprobaciones` | Revisión por segunda persona de ejecuciones, NA y solicitudes | En menú (sólo `pdtp:approve`) |
| 4 | A demanda y por evento (obligaciones) | `/prevencion/pdtp/obligaciones` | Actividades que abre un hecho (RE-20, trabajador nuevo, etc.) | En menú |
| 5 | Medidas | `/prevencion/pdtp/acciones` | Acciones correctivas del programa (misma tabla que CAPA) | En menú |
| 6 | Constancias | `/prevencion/constancias` | Acreditar a mano las actividades sin submódulo | En menú |
| 7 | Inspecciones | `/prevencion/inspecciones` (+`[runId]`, seguimiento, plantillas, programación) | Programar, ejecutar en terreno, revisar y derivar hallazgos | En menú; 9 runs en A |
| 8 | EPP preventivo | `/prevencion/epp-preventivo` (+`/entregas` de Bodega) | Requisitos de EPP por cargo y brechas; N°62 por entrega | En menú |
| 9 | Campañas y Capacitación | `/prevencion/capacitacion` | Control anual de ocurrencias CAP-*/CAM-* | En menú |
| 10 | Campañas (registro histórico) | `/prevencion/campanas` | Cierre de campañas antiguas | **Fuera del menú**; alcanzable por URL |
| 11 | Alcotest | `/prevencion/alcotest` | Controles DO-48 y envío mensual | En menú (bajo Programa) |
| 12 | Incidentes y accidentes | `/prevencion/incidentes` (+`[id]`, reportar) y público `/reportar-incidente` | Reporte, triage, investigación, RE-20, cierre | En menú; 0 en A |
| 13 | Acciones correctivas (CAPA) | `/prevencion/capa` (+`[id]`) | Ciclo CAPA con verificación segregada | En menú |
| 14 | Daño material y ambiental | `/prevencion/indicadores-material-ambiental` | Tablero agregado de incidentes peligrosos | En menú |
| 15 | Matriz IPER (MIPER) | `/prevencion/miper` (+`controles/[id]`) | Matriz de peligros versionada, importación, publicación | En menú |
| 16 | Requisitos legales | `/prevencion/requisitos-legales` (+`[id]`) | Registro legal, aplicabilidad, evaluación | En menú |
| 17 | CGRD y mapa de riesgos | `/prevencion/cgrd`, `/cgrd/mapa` | Comité de riesgos de desastres, matriz GRD, actas, plano | En menú |
| 18 | Plan de emergencia y simulacros | `/prevencion/emergencias` (+`[planId]`) | Plan por faena, aprobación, simulacros | En menú |
| 19 | Higiene y vigilancia | `/prevencion/higiene` (+grupos, programas) | Agentes, GES, mediciones, protocolos MINSAL, vigilancia | En menú |
| 20 | Permisos de trabajo (PTAR/LOTO) | `/prevencion/permisos` (+`[permitId]`) | Permisos, AST, aislamientos, habilitación | En menú |
| 21 | Comités paritarios (CPHS) | `/prevencion/cphs` (+`[committeeId]`, programa, certificación) | Constitución, sesiones, revisión por la dirección | En menú |
| 22 | Estructura preventiva | `/prevencion/faenas` (+`[worksiteId]`) | Órgano preventivo por dotación | En menú |
| 23 | Visitas y coordinación | `/prevencion/coordinacion` (+`[id]`) | Coordinación con mandante, fiscalizaciones, visitas OAL | En menú |
| 24 | Indicadores SST | `/prevencion/indicadores` | Tasas por período y cierre | En menú |
| 25 | Registro documental y acuse público | `/prevencion/documentacion` (+`[id]`, papelera, regularización) y público `/acuse` | Biblioteca con revisión, distribución y acuse | En menú |
| 26 | Datos personales (privacidad, salud, casos reservados) | `/prevencion/privacidad` (+solicitudes, auditoría); API `salud/**`, `casos-reservados/**`, `archivos-sensibles/[id]` | Derechos del titular, auditoría de accesos, datos sensibles | Privacidad en menú; **salud y casos reservados sólo API** |
| 27 | Ficha preventiva del trabajador | `/prevencion/trabajador/[workerId]` | Vista por persona | Sin entrada de menú (se llega por enlaces) |
| 28 | Evaluaciones SST / habilitación | `/prevencion/evaluaciones`, `/prevencion/nueva`, `/prevencion/[id]` | Acta de trabajador nuevo por secciones y evaluadores | En menú (módulo `sst`) |
| 29 | PPA (Para, Piensa y Actúa) | `/prevencion/ppa` (+`[id]`) y público `/ppa` | Detención preventiva y su corrección | En menú (módulo `ppa`) |
| 30 | Inicio de Prevención y menú | `/prevencion` | Puerta de entrada del área | Sin entrada propia en el menú |
| T | Motor de acreditación, evidencias y operación (transversal) | `lib/services/pdtp/*`, `pdtp-adapters/*`, crons, deploy | Conectores, verificación de evidencia, revocación, GC, integridad, respaldo | — |

---

## 3. Auditoría módulo por módulo

Un bloque por submódulo, con los apartados del encargo. Es una condensación fiel de los anexos. Allí están la matriz funcional completa, cada hallazgo en el formato largo (descripción, evidencia, cómo reproducir, resultado actual y esperado, impacto, causa, solución, esfuerzo y clasificación A–D), los estados de interfaz observados, el responsive y lo que no se pudo verificar. En los bloques, `anexos/…` se refiere a [`2026-09-29-auditoria-prevencion-modulo-por-modulo/anexos/`](2026-09-29-auditoria-prevencion-modulo-por-modulo/anexos/).

**Conteo bruto** (suma de los 11 anexos): 🔴 1 · 🟠 18 · 🟡 134 · 🔵 162 · ⚪ 35. Hay hallazgos que se repiten entre revisiones, porque la misma causa aparece en varios submódulos. Se consolidan en los patrones transversales T-01…T-10 (§8). Las cifras del veredicto son las consolidadas.

**Evidencia cruda.** Las rutas `scratchpad/audit/<revisión>/` que citan los anexos son la carpeta de trabajo de la sesión: scripts, salidas JSON y SQL, y unas 820 capturas, en total unos 175 MB. **No se versionaron**, por tamaño y porque incluyen los `storageState` de las sesiones QA, que son credenciales. Las sondas PGlite temporales se copiaron ahí y se borraron del repo.

### 3.1 Programa Anual: configuración y seguimiento

**Rutas:** `/prevencion/pdtp` (tablero), `/programas`, `/nuevo`, `/[programId]` (con `/editar`, `/habilitacion`, `/reporte`, `/cierres`, `/cierres/[closureId]`), `/cierres`, `/plantillas`, `/aplicabilidad`, `/cobertura` y `/admin/pdtp-catalogos` (necesaria para crear actividades nuevas) · **Informe detallado:** `anexos/pdtp-programa.md`

- **UI/UX/Diseño:** Respeta `PageHeader`/`PageContainer`, 4 KPI con enlace (A1), estados con `Badge`, 0 errores de consola ni respuestas ≥400 en 16 rutas × admin/prev y 8 rutas × 6 roles, 0 px de desborde a 390/768/1024/1440. La prueba de los 5 segundos falla en las dos pantallas centrales: el tablero no muestra ningún % de cumplimiento (PRG-07) y en la ficha el «Cumplimiento a la fecha» queda ~1.000 px abajo. Inconsistencias: `<input type="date">` nativo (`pdtp-assignee-picker.tsx:171-177`), breadcrumb de `/nuevo` sin «Prevención», rótulo «Linaje de revisión» en una copia de año (PRG-16). No se observaron los estados Cargando ni Error.
- **Facilidad de uso:** Crear programa por copia: 3 acciones, ~4 s. Agregar actividad del catálogo: 5 clics, con el selector listando también las ya incorporadas. Crear actividad nueva con recurrencia: imposible desde el editor; 8 clics + 4 campos por Administración → Catálogos PDTP, y el primer intento falló con «Revisa los campos marcados.» sin marcar campo (PRG-12). Cambiar responsable: 4 clics, fuera de «Editar». Exportar RE-36: 3 clics, 0,5 s.
- **Funcionalidad:** 20 funciones: 8 ✅, 9 🟡, 1 🔴, 1 ❌, 1 no verificada. 🔴 Aviso M-14 falso positivo sobre actividad recurrente (PRG-06). ❌ Revisión v+1 de un programa activo sin botón en estados normales (PRG-01). 🟡: edición concurrente con pérdida silenciosa (PRG-05), agregar actividad (PRG-12), asignación nominal retroactiva (PRG-13), evidencia exigida sin declarar (PRG-15), activación automática al firmar Legal (PRG-02), tablero (PRG-07/08/14), reporte de gestión (PRG-09), RE-36 (PRG-10/20), control de cambios (PRG-04). No verificado: borrar borrador / crear-borrar hojas (M-19, sólo código `programs.ts:617-646`).
- **Código y lógica:** La revisión v+1 sólo se ofrece ante anomalías (`[programId]/page.tsx:200-204,229`); aprobar el último paso también activa sin comprobar `prevention:pdtp:activate` (`program-lifecycle.ts:49-57,108-110`); el conector de la N°1 ignora el año del programa aprobado (`pdtp-accreditation-connectors.ts:445-482`; `accreditation.ts:138-149,322-336`); el aviso M-14 mira sólo `pdtp_activity_schedule` (`lifecycle.ts:158-177`); el candado M-17 compara `updatedAt` leído en la misma solicitud (`activities.ts:633-646`). Sin `console.log`, mocks ni TODO en lo revisado.
- **Modelo de datos:** `pdtp_programs` con índice único de un programa activo por año y `pdtp_change_log` con trigger de sólo agregar (0340 exime a A y B por el nombre de la base). `pdtp_activity_worksite_assignees` se borra físicamente en una corrección retroactiva (PRG-13); en el programa 2026 v2, 47 de 81 actividades sin `evidence_requirement` y la N°19 sin `pdtp_activity_document_requirements`.
- **Permisos y seguridad:** Verificado con SQL sobre `role_permissions` (A y B). Exportaciones con alcance de faena correcto (`otrafaena` → 403 en RE-36, reporte y expediente de Horcones; `ti` → 403); segregación JDPR ≠ elaborador/remitente y Legal ≠ JDPR demostrada. Falla: fuga de lectura en control de cambios y RE-36 entre faenas (PRG-10) y la firma «Legal y RRHH» la ejecuta `jefa_chome`, no `gerente_legal_rrhh` (PRG-11); la activación automática no comprueba `activate` (TEÓRICO).
- **Testing:** 19 suites PGlite (`vitest.pglite.config.ts --maxWorkers=1`): 323 PASS, 1 skipped, 0 fallos, en 268 s. Sin cobertura: crear v+1 desde la UI, el % del tablero, la N°1 al año del programa aprobado, recurrente en M-14, edición concurrente y control de cambios por faena en el RE-36. No se ejecutó el escenario controlado 100/20/60 en PGlite (permisos denegados).
- **Integración con Programa Anual:** Este submódulo es el programa; su única acreditación propia es la **N°1** («Aprobar el programa»), generada al firmar Legal como integración `submitted` en cada faena miembro. Observado en B: aprobar `pdtp-2028-v1` acreditó la N°1 del programa **2026 v2** (septiembre, semana 4) en 6 faenas y la 2028 no recibió ninguna (PRG-03). Verificó además que la copia conserva mecanismo y destino, la activación materializa ocurrencias (mensual → 72) y la compuerta de cobertura bloquea. Verificación matemática del §25 (Masisa 77/118/80/76 = 351) cuadra entre indicador, SQL y resumen RE-36; el reporte de gestión da 279 (PRG-09). Segregación y revocación por el ciclo de firmas: no informado más allá de lo anterior.
- **Hallazgos:** 0 🔴 · 1 🟠 · 14 🟡 · 8 🔵 · 2 ⚪ (el informe no trae tabla de resumen; conteo de los ítems listados).
  - PRG-01 (🟠) — No se puede crear una revisión v+1 de un programa activo en condiciones normales — DEMOSTRADO (navegador) — page.tsx:200-204,229; fulfillment-backlog-panel.tsx:19-29
  - PRG-02 (🟡) — Firmar el último paso activa el programa en el mismo clic, sin confirmación ni permiso `activate` — DEMOSTRADO — program-lifecycle.ts:49-57,108-110; program-lifecycle-controls.tsx:204-217
  - PRG-03 (🟡) — La aprobación de un programa acredita la N°1 del programa vigente en la fecha de la firma, no la del programa aprobado — DEMOSTRADO (SQL, base B) — pdtp-accreditation-connectors.ts:445-482; accreditation.ts:138-149,322-336
  - PRG-04 (🟡) — Ni el control de cambios ni la bitácora muestran quién cambió qué — DEMOSTRADO — page.tsx:565-570; activities.ts:718-726 (recordAudit sin userEmail); audit-log.tsx:80,105
  - PRG-05 (🟡) — Dos pestañas editando la misma actividad: el último guardado revierte en silencio el cambio del otro — DEMOSTRADO (B, N°7) — activities.ts:487-494,633-646; actividades-tab.tsx:633-647
  - PRG-06 (🟡) — El aviso «actividad periódica sin ninguna semana planificada» es falso para actividades con programación recurrente — DEMOSTRADO — lib/services/pdtp/lifecycle.ts:158-177
  - PRG-07 (🟡) — El tablero no dice cuánto se ha cumplido; la cifra está enterrada en la ficha — DEMOSTRADO — page.tsx:386-439; pdtp-dashboard-charts.tsx:57
  - PRG-08 (🟡) — «N ejecuciones por aprobar» ignora los envíos de la versión reemplazada que el tablero consolida — DEMOSTRADO (SQL + UI) — page.tsx:149-152; executions.ts:829-842
  - PRG-09 (🟡) — El reporte de gestión marca «En desviación» actividades retiradas o sin plan exigible, y mide la cobertura con otro denominador — DEMOSTRADO (UI + reporte-masisa.xlsx) — reporte/page.tsx:28-43
  - PRG-10 (🟡) — El RE-36 de una faena y el control de cambios de la ficha incluyen los eventos de todas las faenas, sin rótulo — DEMOSTRADO — RE-36 (lib/services/pdtp/re36-document.ts, bloque changeControl); [programId]/page.tsx:553-583
  - PRG-11 (🟡) — La firma «Aprobación Legal y RRHH» la ejecuta el rol Jefatura; la Gerencia Legal no puede firmar — DEMOSTRADO — modules/prevention/manifest.ts:609-613, 625-628 (comentario: «sign_legal/approve siguen en jefa_chome hasta que se pida moverlos»)
  - PRG-12 (🟡) — Crear una actividad nueva exige ir a Administración, y los errores de validación no dicen qué campo falló — DEMOSTRADO — pdtp-activity-creator.tsx:446-449,568-571; pdtp.ts:349-350
  - PRG-13 (🟡) — Una asignación nominal con «Rige desde» anterior a la vigente borra el período del responsable anterior — CÓDIGO — assignees.ts:313,348-371,428-436; pdtp-assignee-picker.tsx:166-178
  - PRG-14 (🟡) — En la misma tarjeta se mezclan «a la fecha» y «anual» sin rótulo, y «a la fecha» incluye el mes en curso completo — DEMOSTRADO (Horcones) — pdtp-indicators-panel.tsx:248-280; compliance.ts:421-430
  - PRG-15 (🟡) — El 58 % de las actividades del programa activo no declara qué evidencia se exige, y el editor contradice al servidor — DEMOSTRADO — lifecycle.ts:138-153; revision-tab.tsx:60-95
- **Readiness individual: 70/100** — desglose `Func 16,5/25 · UI 13,5/20 · Integridad 10,5/15 · Programa 11/15 · Código 8/10 · Permisos 3,5/5 · Testing 3,5/5 · Errores 4/5`

### 3.2 Planilla de actividades y registro de ejecución

**Rutas:** `/prevencion/pdtp/actividades` (vistas semana y anual), `/prevencion/pdtp/[programId]` (misma planilla con gestión), `/prevencion/pdtp/[programId]/ejecucion/[executionId]`, `POST /api/prevencion/pdtp/evidence`, `GET /api/prevencion/pdtp/evidence/[name]` · **Informe detallado:** `anexos/pdtp-cumplimiento.md`

- **UI/UX/Diseño:** Estructura correcta (`PageHeader`, `PageContainer`, un solo `h1`, 0 px de desborde a 1440/1024/768/390). Vista semanal bien pensada para faena; el diálogo «Registrar» es claro y cabe a 390 px (358 px). Defectos: el buscador del TopBar se muestra y no filtra (CUM-07), el diálogo reinicia cantidad y borra observación y archivo tras un error (CUM-03), avisos de complemento contradictorios (CUM-04), el detalle «Verificación» no dice estado actual ni motivo de anulación (CUM-12, CUM-33), pestañas «EN CERO» y «PENDIENTES» solapadas (CUM-35) y «Semana 1–4» sin días (CUM-29).
- **Facilidad de uso:** Registrar con evidencia: 3 clics; aprobar: 1; pedir anulación: 3; declarar «no aplica»: 3. Fricciones: «Declarar desvío» es jerga y esconde No realizada/No aplica/Reprogramada; en `/actividades` sólo se ofrece «No realizada» (CUM-19); la meta por faena no se puede fijar desde ninguna parte (CUM-05); el motivo del rechazo no se ve en la planilla (CUM-38).
- **Funcionalidad:** 13 funciones: 9 ✅ (3 con salvedad: complemento, «no realizada», pedir anulación), 1 🟡, 2 🔴, 1 ❌. 🔴 Meta por faena: el botón no abre diálogo (CUM-05); filtro de texto del TopBar no filtra (CUM-07). ❌ «No aplica» y reprogramar no se ofrecen desde `/actividades` (CUM-19). 🟡 Detalle con historial sin estado ni motivo de anulación (CUM-12).
- **Código y lógica:** Reglas en servicio, dentro de transacción y con *advisory lock* por celda (`executions.ts:143-192`). Defectos: `Tooltip` envuelto por `DialogTrigger asChild` no reenvía props (`pdtp-override-form.tsx:53-64`), `actividades/page.tsx:229` no pasa `canManageProgram`, `partialApprovedCellsFor` suma todo lo aprobado (`pdtp-sheet-table.tsx:131-144`) frente a `max(manual, integración)` (`compliance.ts:247-296`), `recordPdtpDeviationAction` no pasa el actor (`actions/deviations.ts:128-156`). Sin `console.log`, `any` innecesarios ni `catch` vacíos.
- **Modelo de datos:** `pdtp_executions` con índice único parcial por celda y secuencia, CHECK de mes/semana/cantidad/estado/origen/`evidence_status`, FK RESTRICT; **sin CHECK de segregación ni de consistencia** del estado (C15, CUM-24: los tres `UPDATE` de prueba se aceptaron). `pdtp_execution_deviations` bien restringida; `pdtp_evidence_uploads` con `sha256` por CHECK.
- **Permisos y seguridad:** Probado: alcance por faena en servicio y descarga (`otrafaena` → 404, `ti` → `/forbidden`), evidencia (MIME por bytes, tamaño, sha256, traversal, Origin ajeno → 403). Falla: la «no realizada» no respeta la regla de autoridad de registro (CUM-01, demostrado con `sup`); la segregación de la aprobación existe sólo en el servicio (CUM-24).
- **Testing:** 10 suites PGlite (188 PASS) y 15 archivos unitarios/UI (162 PASS); E2E temporal en PGlite 17/17 pasos con 15 casos C01–C15 y 12 casos en navegador (N1–N12). Falta un E2E que abra «Meta por faena», el reinicio del formulario tras error, el mensaje de complemento con integración y el filtro del TopBar.
- **Integración con Programa Anual:** Es el PDTP mismo: acredita la actividad (N°) y la celda (mes/semana) elegidas, por la vía manual; queda `submitted` y otra persona aprueba. Evidencia: archivo verificado por existencia, faena, dueño y sha256. Segregación registrante ≠ aprobador demostrada (C01, C08, C11). Revocación: la anulación revierte con dos personas. El indicador suma sólo `approved`, topado por actividad y mes, y cuadra celda por celda (final 41/18; a la fecha 37/18 = 49 %). Observado: la señal de atraso diverge del % (CUM-01, CUM-02), el diálogo de complemento no dice cómo cuenta (CUM-04) y la vía de integración aprueba celdas futuras (CUM-10).
- **Hallazgos:** informe global: 0 🔴 · 0 🟠 · 11 🟡 · 21 🔵 · 5 ⚪ (CUM-27 y CUM-28 no se usaron). Para este submódulo el informe cita CUM-01 a 05, 07, 10 y 12 (🟡) y 🔵 13, 19, 22-24, 29, 33, 35, 36, 38.
  - CUM-01 (🟡) — "No realizada" se declara sin la regla de autoridad de registro y apaga la señal de atraso — DEMOSTRADO — actions/deviations.ts:128-156 (no pasa actor); deviations.ts:116-124 (sin parámetro de actor); pdtp-sheet-table.tsx:583-592 (el formulario se ofrece sin canRegister); period.ts:246-273 (hasDeclaredNotPerformed)
  - CUM-02 (🟡) — Un envío pendiente parcial o una sola "no realizada" esconden el faltante del resto del mes — DEMOSTRADO (PGlite C06) — lib/services/pdtp/period.ts:263-273 (isUnpaidMonth: submitted === 0 && !hasDeclaredNotPerformed)
  - CUM-03 (🟡) — Tras un error de envío, el formulario "Registrar" vuelve la cantidad a 1 y borra la observación y el archivo — DEMOSTRADO (navegador B) — app/(app)/prevencion/pdtp/pdtp-execution-form.tsx:88-130 (useActionState), 168-171 (<form action>), 224-236 (cantidad no controlada, defaultValue "1"), 255-273 (observación y archivo no controlados)
  - CUM-04 (🟡) — El diálogo de complemento suma lo acreditado por el submódulo con lo manual; el indicador toma el mayor — DEMOSTRADO (navegador B, N°38 semana 4) — pdtp-sheet-table.tsx:131-144 (suma todo lo approved); compliance.ts:247-296 (max(manual, integración)); pdtp-execution-form.tsx:175-179 y 249-253 (dos avisos contradictorios)
  - CUM-05 (🟡) — El botón "Fijar meta por faena" no abre su diálogo: la meta por faena, incluida su reducción con revisión, no es operable desde la UI — DEMOSTRADO (navegador B, prev) — pdtp-override-form.tsx:53-64 (DialogTrigger asChild → <Tooltip>); tooltip.tsx:48-70 (Tooltip no acepta ni reenvía props, ref ni onClick)
  - CUM-07 (🟡) — El buscador del TopBar se muestra en la planilla y en Aprobaciones pero no filtra nada — DEMOSTRADO (navegador B) — top-bar.tsx:33 ("/aprobaciones" no calza con /prevencion/pdtp/aprobaciones), 77; pdtp-sheet-table.tsx (no usa useSafeShellHeader/searchQuery)
  - CUM-10 (🟡) — Las acreditaciones de submódulos se aprueban en semanas futuras — DEMOSTRADO — lib/services/pdtp/accreditation.ts:294-301 (el slot sale de plannedPeriod sin guarda de futuro); compárese con executions.ts:110 y :587
  - CUM-12 (🟡) — El detalle de una ejecución no dice su estado actual, y la anulación queda como "Revertido" sin motivo ni solicitante — DEMOSTRADO — review-requests.ts:230-237 (recordPdtpExecutionHistory sin reason); ejecucion/page.tsx:67-73 (header sin estado); submission-history.tsx:43-48 (motivo sólo desde entry.reason); executions.ts:640-647 (la aprobación con motivo tampoco lo guarda en el historial)
- **Readiness individual: 72/100** — desglose `Func 19/25 · UI 13/20 · Integridad 11/15 · Programa 11/15 · Código 8/10 · Permisos 3,5/5 · Testing 3,5/5 · Errores 3/5`

### 3.3 Aprobaciones

**Rutas:** `/prevencion/pdtp/aprobaciones` (cuatro secciones: ejecuciones; «No aplica» y reprogramaciones más ocurrencias; solicitudes de anulación/cancelación/reducción; programadas de la semana) · **Informe detallado:** `anexos/pdtp-cumplimiento.md`

- **UI/UX/Diseño:** `PageHeader` con descripción según alcance. Las secciones de «no aplica» y solicitudes son claras (rótulo, motivo, «Declarado/Pedido por … · fecha», Aprobar/Rechazar; la propia fila sin botones y con «Retirar»). Defectos: la tabla de ejecuciones no muestra cantidad, quién registró, cuándo, plan de la celda ni si es complemento, y varias ejecuciones de una misma celda son botones idénticos («✓ Sep · sem. 2» siete veces en Biodiversa N°62) (CUM-06); buscador del TopBar visible que no filtra (CUM-07); a 390 px los botones de aprobar quedan fuera de vista (CUM-26); estado vacío propio, no `EmptyState`. Etiquetas de integración ya sin ids (C-03 y C-04 corregidos).
- **Facilidad de uso:** Aprobar: 1 clic; rechazar: 2 más el motivo; revisar un «no aplica» o una solicitud: 1 clic. Fricción principal: el aprobador aprueba sin ver cantidad ni quién registró; para verlo debe ir a la planilla o al detalle y desde la cola no hay enlace al detalle.
- **Funcionalidad:** 8 funciones: 6 ✅, 1 ❌, 1 🔴. ❌ Paginación de la cola (CUM-25, M-11). 🔴 Filtro de texto (CUM-07). ✅: aprobar/rechazar con motivo ≥ 10, segregación, aprobación concurrente, revisar «no aplica» y reprogramación, solicitudes (anulación, cancelación, reducción), retirar la propia solicitud (sólo unitario).
- **Código y lógica:** La reducción aprobada aplica el payload sin comparar el valor vigente con `previousQuantity` (`review-requests.ts:173-199`; CUM-15: se aplicó 6 → 2 aunque decía «de 4 a 2»); el revisor sólo se compara con quien pidió, no con quien ejecutó (`:258-260`; CUM-14); la anulación no pasa el motivo al historial (`:230-237`; CUM-12); `approvePdtpExecution` tampoco pasa el motivo (`executions.ts:640-647`). Helpers `scopeToIds`/`fail` duplicados por archivo.
- **Modelo de datos:** `pdtp_review_requests` bien restringida: `reviewer_check`, `rejected_check` (motivo ≥ 10), `reviewed_check`, `withdrawn_check`, índice único de una solicitud en revisión por objeto, FK RESTRICT.
- **Permisos y seguridad:** Exige `prevention:pdtp:approve` (`prev`, `prev2`, `jefa`, `admin`); `prevfaena`, `sup` y `ti` → `/forbidden` (verificado). Alcance de faena aplicado en cada revisión. El registrante original puede vetar la anulación de su propia ejecución (CUM-14; bajo).
- **Testing:** Unitarios `pdtp-approval-buttons.test.tsx`, `not-applicable-review-section.test.tsx`, `weekly-scheduled-section.test.tsx` y PGlite `pdtp-review-requests.test.ts`: PASS. Falta un E2E de anulación, cancelación y reducción en navegador (recorrido sólo a mano).
- **Integración con Programa Anual:** Es la compuerta del cumplimiento: sólo lo `approved` cuenta. Efecto verificado por decisión: «no aplica» aprobado 44 → 43; anulación abril 2/2 → 2/1; reducción marzo semana 2 de 6 → 2; reprogramación agosto → septiembre. Segregación por CHECK y servicio (C01, C08, C11). Riesgo observado: con la información de la cola no se verifica lo aprobado (CUM-06).
- **Hallazgos:** El informe cita CUM-06, CUM-07 y CUM-12 (🟡) y CUM-14, 15, 18, 20, 25, 26 (🔵); no informa conteo propio del submódulo.
  - CUM-06 (🟡) — La cola de aprobación no muestra qué se aprueba (cantidad, quién, cuándo, plan) y repite botones idénticos — DEMOSTRADO — page.tsx:106-132 (descarta executedQuantity, executedByUserId, executedAt), 183-200 (evidencias en otra columna, sin período); pdtp-approval-buttons.tsx:18-20, 99-127 (rótulo sólo "mes · sem.")
  - CUM-07 (🟡) — El buscador del TopBar se muestra en la planilla y en Aprobaciones pero no filtra nada — DEMOSTRADO (navegador B) — top-bar.tsx:33 ("/aprobaciones" no calza con /prevencion/pdtp/aprobaciones), 77; pdtp-sheet-table.tsx (no usa useSafeShellHeader/searchQuery)
  - CUM-12 (🟡) — El detalle de una ejecución no dice su estado actual, y la anulación queda como "Revertido" sin motivo ni solicitante — DEMOSTRADO — review-requests.ts:230-237 (recordPdtpExecutionHistory sin reason); ejecucion/page.tsx:67-73 (header sin estado); submission-history.tsx:43-48 (motivo sólo desde entry.reason); executions.ts:640-647 (la aprobación con motivo tampoco lo guarda en el historial)
- **Readiness individual: 81/100** — desglose `Func 22,5/25 · UI 12,5/20 · Integridad 12/15 · Programa 12/15 · Código 9/10 · Permisos 4,5/5 · Testing 4/5 · Errores 4,5/5`

### 3.4 A demanda y por evento — obligaciones

**Rutas:** `/prevencion/pdtp/obligaciones` (en `ROUTES_WITH_OWN_SEARCH`, búsqueda propia en la base) · **Informe detallado:** `anexos/pdtp-cumplimiento.md`

- **UI/UX/Diseño:** `PageHeader` con la acción «Registrar necesidad o evento», tres tiles accionables más un `Select` de estado (la misma dimensión dos veces, CUM-30), lista paginada en el servidor y estado vacío con CTA. Defectos: el origen del caso muestra ids internos («worker:VoRAccr…:alta», CUM-34); tras reportar, «Ir a aprobación» se ofrece a quien tiene `execute` y lleva a `prevfaena` a `/forbidden` (CUM-17); completado o cancelado el caso no puede volver a verse (CUM-08). Sin desborde en las cuatro anchuras.
- **Facilidad de uso:** Abrir un caso: 4 clics más el motivo; reportar: 3 más el archivo; pedir cancelación: 2 más el motivo. Los textos explican que el reporte «aún no contará».
- **Funcionalidad:** 7 funciones: 5 ✅, 1 🟡, 1 ❌. ❌ Consultar casos cerrados (CUM-08: el filtro sólo ofrece abierto, pendiente, vencido y por aprobar). 🟡 Reportar con la cancelación en revisión: la solicitud queda colgada (CUM-16).
- **Código y lógica:** `listPdtpObligationsPage` fija `status IN ('pending','overdue','reported')` (`obligations.ts:566-570`); `reportPdtpObligation` no mira las solicitudes de cancelación pendientes (`:225-260`); `reportedAt` lo fija el servidor, sin antedatar (PREV-I11).
- **Modelo de datos:** CHECK de motivo de cancelación ≥ 10 y de motivo manual ≥ 10; una ejecución por obligación (índice único); idempotencia por clave.
- **Permisos y seguridad:** `view` para ver, `execute` para abrir y reportar, `obligation:cancel` para pedir cancelación, `approve` para aprobar. Alcance por faena en servicio y lista; `otrafaena` no ve los casos de Horcones (verificado).
- **Testing:** `obligaciones/actions.test.ts`, `pdtp-obligations-workbench.test.tsx`, `pdtp-obligations-pagination.test.ts`: PASS. Sin E2E de cancelación.
- **Integración con Programa Anual:** Alimenta el indicador de plazos (`closed_on_time`); la cancelación aprobada saca el caso del denominador y la solicitud pendiente no. La ejecución de la obligación pasa por la misma cola y la misma segregación (reportar con archivo, aprobar otra persona; N9/N10 y C11). En la cola la ejecución de un caso figura como «Sep · sem. 4», sin su plazo.
- **Hallazgos:** El informe cita CUM-08 (🟡) y 🔵 CUM-16, CUM-17, CUM-30, CUM-34; sin conteo propio.
  - CUM-08 (🟡) — Los casos completados y cancelados desaparecen: no hay dónde consultarlos — DEMOSTRADO — obligations.ts:566-570 (baseWhere fija pending/overdue/reported); page.tsx:17 (FILTERS); workbench.tsx:122-129 (opciones del Select)
- **Readiness individual: 86/100** — desglose `Func 21/25 · UI 16,5/20 · Integridad 13,5/15 · Programa 13/15 · Código 9/10 · Permisos 5/5 · Testing 4/5 · Errores 4/5`

### 3.5 Medidas

**Rutas:** `/prevencion/pdtp/acciones` (vista transversal); creación y seguimiento en el detalle de la ejecución (`execution-action-plan-panel.tsx`) · **Informe detallado:** `anexos/pdtp-cumplimiento.md`

- **UI/UX/Diseño:** `DataTable` con el TopBar conectado, 4 filtros (estado, prioridad, faena, vencimiento; dentro de A2), tarjetas en móvil, 0 desbordes. Defectos: «Responsable» es texto libre, sin usuario (CUM-31); el estado vacío del detalle habla de un checklist retirado (⚪); el alta sólo existe desde el detalle y no se descubre desde `/acciones`.
- **Facilidad de uso:** No informado (no se midieron clics propios); se creó una medida desde una ejecución («Agregar acción») y se vio en la vista transversal.
- **Funcionalidad:** 4 funciones: 3 ✅, 1 🟡. ✅ Crear desde una ejecución, verla en la vista transversal con faena y actividad, filtros por URL con `replace` y `scroll:false`. 🟡 Cancelar (baja lógica), verificar eficacia y reabrir no se ejecutaron en esta auditoría (sólo código `action-plan.ts:207-307`).
- **Código y lógica:** `canManage` y `canVerify` llegan a `AccionesTable` y no se usan (⚪). `capaAccess` concede todos los permisos CAPA internamente y depende de que la acción valide antes; la acción sí valida (`action-plan-actions.ts`).
- **Modelo de datos:** CAPA con `version` optimista, transiciones auditadas y cancelación en vez de borrado; responsable sin FK.
- **Permisos y seguridad:** `action:manage` (crear/editar) y `action:verify` (verificar/reabrir); alcance validado en cada acción (`assertPdtpExecutionAccess` / `assertPdtpActionPlanItemAccess`); `prevfaena` sólo ve las de Horcones (verificado en código y flujo 8).
- **Testing:** No se encontraron pruebas específicas de `/acciones`; la CAPA tiene las suyas (no se corrieron aquí).
- **Integración con Programa Anual:** Las medidas pertenecen a una ejecución (`source_type = 'pdtp'`) y alimentan los ejes de verificación y cierre del índice integral. No se verificó ejecutando (lo cubre pdtp-programa).
- **Hallazgos:** El informe no lista hallazgos 🔴/🟠/🟡 propios de este submódulo (cita CUM-31 como 🔵 y ⚪ menores).
- **Readiness individual: 85/100** — desglose `Func 21/25 · UI 17/20 · Integridad 14/15 · Programa 12/15 · Código 9/10 · Permisos 4,5/5 · Testing 3,5/5 · Errores 4/5` (el informe advierte cobertura parcial de la auditoría)

### 3.6 Constancias

**Rutas:** `/prevencion/constancias` · **Informe detallado:** `anexos/pdtp-cumplimiento.md`

- **UI/UX/Diseño:** Descripción clara («se hicieron o no se hicieron…»). Dos tiles más un `Select` de estado: la misma dimensión dos veces (CUM-30). Filas con estado, N°, faena, responsable, evidencia exigida y «Mes que corresponde marcar» (sin la semana), con «Registrar» y «Declarar desvío» (ahí sí se ofrece «No aplica»). Estados vacíos con y sin programa activo; sin desborde.
- **Facilidad de uso:** Registrar: 3 clics; «No aplica»: 3 clics. Fricción: tras declarar «No realizada» la constancia sigue en la lista (CUM-09).
- **Funcionalidad:** 5 funciones: 4 ✅, 1 ❌. ❌ «No realizada» no salda la constancia: sigue «PENDIENTE» en Constancias y en `/pendientes` (N12, CUM-09).
- **Código y lógica:** `paidMonths` sólo cuenta ejecuciones con cantidad > 0 (`constancias.ts:122-128`) e ignora la «no realizada», que la planilla sí trata como explicada (`period.ts:246-273`); regla de deuda duplicada con la planilla y `/pendientes`.
- **Modelo de datos:** Mismos datos que la planilla (`pdtp_executions`, `pdtp_execution_deviations`).
- **Permisos y seguridad:** `prevention:constancias:view` y `constancias:execute`, acotados al mecanismo `constancia` en servidor (`assertPdtpActivityMechanism`); la regla de autoridad (PREV-I03) sólo decide dónde se ofrece «Registrar». Alcance por faena verificado; el acotamiento por mecanismo se prueba sólo en código.
- **Testing:** `pdtp-constancias.test.ts` (PGlite): PASS; no cubre la «no realizada».
- **Integración con Programa Anual:** Acredita por la misma vía manual que la planilla (N° de la constancia, celda elegida, aprobación de otra persona). La regla de deuda difiere de la planilla (CUM-09); deuda del año en cierre verificada sólo en código (`constancias.ts:167-196`, PREV-C03.7).
- **Hallazgos:** El informe cita CUM-09 (🟡); el formulario compartido arrastra además CUM-01 y CUM-03, y CUM-30 (🔵).
  - CUM-09 (🟡) — Declarar "No se hizo" no salda la constancia: sigue pendiente (y vencerá) en Constancias y en /pendientes — DEMOSTRADO (navegador B, flujo 9) — lib/services/pdtp/constancias.ts:122-128 (paidMonths sólo con ejecuciones de cantidad > 0)
- **Readiness individual: 86/100** — desglose `Func 21/25 · UI 16,5/20 · Integridad 13,5/15 · Programa 12,5/15 · Código 9/10 · Permisos 5/5 · Testing 4,5/5 · Errores 4/5`

### 3.7 Inspecciones

**Rutas:** `/prevencion/inspecciones` (bandeja), `/[runId]` (ejecución), `/seguimiento`, `/plantillas`, `/programacion`; APIs `evidence` (+`[name]`), `finding-evidence`, `documento` (+`[name]`), `export`, `seguimiento/export` · **Informe detallado:** `anexos/inspecciones.md`

- **UI/UX/Diseño:** Conforme a AGENTS.md: `PageHeader` (1 `h1` visible), `PageContainer`, búsqueda propia, 4 KPI accionables, 4 filtros + «Más filtros», `DatePicker`, estados con label + `Badge`; sin desborde a 1440/1024/768/390. Ejecución en terreno a 390 px usable (tarjetas por ítem, barra fija «Guardar / Declarar ejecutada», foto por ítem). Defectos: ítems puntuables rotulados «Opcional» (INS-06), plantillas con la columna de acciones fuera de vista a 1440 (INS-15), «Resultado normalizado 263.16 %» (INS-01), PDF de planilla bloqueado por CSP `object-src 'none'` (INS-16), CTA «Revisar» para quien ejecutó (INS-17), sin «todo conforme» (INS-20). No se observaron Cargando ni Error de página.
- **Facilidad de uso:** Programar inspección: 9 clics + 1 «Crear y abrir». Ejecutar extintores (5 ítems, sup, 390 px): 19. Ejecutar EPP JT (20 ítems + foto + acta): 49 toques. Derivar hallazgo a CAPA: 6. Revisar y cerrar (otra persona): 4. Crear ad hoc: 6. Fricciones: «Opcional» engañoso, sin «marcar todo», la lista de asignables incluye personas sin alcance (INS-14).
- **Funcionalidad:** 16 funciones: 7 ✅, 4 🟡, 2 🔴, 3 ❓ no verificadas. 🔴 Declarar ejecutada el reporte de equipos (falla con CHECK) y el cálculo de cumplimiento (263 %, 105 %, 89 % en vez de 84 %) (INS-01). 🟡 Reabrir + re-cerrar duplica hallazgos (INS-03); cierre manual de hallazgo alto sin CAPA (INS-04); evidencia (no se puede quitar una foto, INS-12; archivo escrito antes de autorizar, INS-13); plantillas sin segregación y cableado global por roles de faena (INS-08, INS-09). ❓ Acta PDF (Cloudreve no configurado en B), modo offline (sólo código, INS-07) y digitalización (`ingest`) sin planilla real.
- **Código y lógica:** Lógica crítica en el servidor (`requireAccess`, `assertInspectionRunTransition`, CAS doble). Defecto de cálculo en `summarizeCompliance` (`lib/prevention/inspections.ts:445` suma `conforming` antes del filtro `:458`); `completeInspectionRun` recrea hallazgos sin mirar los que ya tienen CAPA (`runs.ts:527-544`); código muerto `deleteRunDocument`/`deleteAnswerEvidence` (`evidence.ts:95-109, 199-216`); comentario contradictorio `templates.ts:436` vs `:463-469`; `catch {}` sin log en `seguimiento/export/route.ts:23`; componentes de 1.200–1.700 líneas.
- **Modelo de datos:** CHECK en `prevention_inspection_runs` (bps 0–10000, cancelación, revisión, estado, sujeto único): la base impide guardar el % inflado pero lo convierte en error genérico. Los KPI «Con hallazgos abiertos/graves» (`queries.ts:68-69`) cuentan `capa_linked` y runs cancelados (INS-11). Retirar plantilla borra si no tiene uso, si no `superseded`.
- **Permisos y seguridad:** DEMOSTRADO por replay de server actions y HTTP: `otrafaena` rechazado en revisar/reabrir/cancelar/guardar, evidencia y documento → 404; `ti` → 403; `sup`/`jt`/`cphs` sin permiso → «No tienes permisos»; path traversal → 400. Falla: cableado PDTP global editable por roles con alcance de faena (INS-08), aprobación de plantillas sin segregación y paridad autodeclarable (INS-09), archivos escritos antes de autorizar (INS-13, `otrafaena` 94 → 95 archivos), asignación sin validar alcance (INS-14).
- **Testing:** 22 archivos unitarios/UI (221 pruebas ✅), 7 PGlite (59 ✅), `prevention-inspections-postgres` (91 ✅, no skipped). E2E existentes leídos, no corridos. Faltan pruebas de las secciones condicionales del reporte de equipos (`reporte-equipos-definition.test.ts:80-86` sólo responde lo obligatorio; por eso INS-01 pasa verde), de reabrir→re-cerrar con hallazgo CAPA (INS-03) y del cierre manual de un hallazgo alto.
- **Integración con Programa Anual:** 13 plantillas vigentes cableadas (SQL `pdtp_accreditation_bindings`) a N°10, 24, 25+26, 27, 29, 33, 34, 39, 40, 41, 64, 65; N°28 queda como constancia. Vía: conector al declarar ejecutada. Estado resultante: `approved` en el mismo acto (`approvalMode automatic_source_event`, `executed_by = approved_by`), evidencia `not_required` con texto «Inspección completada: insrun-…» (INS-19). Segregación: la revisión independiente no cambia la ejecución PDTP (INS-02). Revocación: reabrir y cancelar revocan (draft + motivo + actor) ✅; re-cerrar vuelve a `approved` sobre la misma fila/celda. Observado: F1 N°24 cae en semana 4 aunque la celda era la semana 2 (cuenta por mes); F4 reporte de equipos N°25/N°26 no cierra con todo el papel transcrito (INS-01); fecha imputada = cierre en servidor, `queuedAt` offline se descarta (INS-07).
- **Hallazgos:** 1 🔴 · 0 🟠 · 9 🟡 (INS-02 a INS-10) · 10 🔵 (INS-11–18, 20, 21) · 1 ⚪ (INS-19), contados de los ítems listados en el informe; INS-01 bloquea producción.
  - INS-01 (🔴) — El % de cumplimiento suma conformes de secciones que no puntúan: el Reporte de Uso Diario de Equipos no se puede cerrar y otros % salen inflados — DEMOSTRADO — inspections.ts:445 (cuenta conforming de toda respuesta) vs :458 (sólo `scored` filtra countsForCompliance); runs.ts:585-591 (escribe el %); CHECK prevention_inspection_run_normalized_bps_valid
  - INS-02 (🟡) — La ejecución PDTP queda aprobada por quien ejecutó, al declarar, antes de la revisión independiente — DEMOSTRADO (SQL) — connectors 128-129 (autoApproveByUserId = completedByUserId); runs.ts:668-675; runs.ts:568-584 (reporte auto-revisado por el transcriptor)
  - INS-03 (🟡) — Reabrir y volver a cerrar duplica los hallazgos que ya tenían CAPA — DEMOSTRADO — runs.ts:527-544; transitions.ts:108-112
  - INS-04 (🟡) — Un hallazgo alto o crítico se puede cerrar a mano sin CAPA y así revisar la inspección — DEMOSTRADO — runs.ts:952-968 (sin restricción de criticidad); detail.tsx:654-663 (botón "Cerrar" para todo abierto sin CAPA); lib/prevention/inspections.ts:747-775 (closed no bloquea)
  - INS-05 (🟡) — "Inspección de Uso y Estado de EPP · 02" sigue vigente, ejecutable y sin actividad; el detector de cableado no la reporta — DEMOSTRADO — lib/prevention/inspection-wiring.ts:206-221 (orphan_approved sólo si hay BORRADORES de otro código)
  - INS-06 (🟡) — Los ítems obligatorios se rotulan "Opcional" — DEMOSTRADO — detail.tsx:907 y :988 (usa item.required); inspections.ts:531-533 (la puerta usa required || puntuable)
  - INS-07 (🟡) — La fecha que acredita es la del cierre en el servidor; la hora offline (`queuedAt`) se descarta — CÓDIGO — runs.ts:376-402 (el zod no declara queuedAt ni fecha de ejecución), :574 (executedAt: now), :671; offline-inspection-queue.ts:44-46
  - INS-08 (🟡) — Roles con alcance de faena pueden cambiar qué actividad del programa acredita una plantilla global — DEMOSTRADO — templates.ts:270-280 (requireAccess manage sin faena; sólo bloquea superseded); actions.ts:109-113; manifest.ts:1089-1090 (prevencionista_faena y admin_contrato con manage)
  - INS-09 (🟡) — Aprobar plantillas no está segregado de incorporarlas, contra lo declarado; la paridad documental se puede autodeclarar al importar — DEMOSTRADO — templates.ts:436 (dice que exige otro aprobador) vs :463-469 (no lo exige); :49-54 y :206-213 (importador fija parityReport "passed" con verifiedByUserId = él mismo); manifest.ts:233 ("de forma segregada de quien las incorpora")
  - INS-10 (🟡) — El reporte de equipos promete una revisión de Prevención que el sistema no hace — DEMOSTRADO — detail.tsx:819; runs.ts:568-584; reporte-equipos.ts:41 (closesOnCompletion: true)
- **Readiness individual: 60/100** (no listo) — desglose `Func 13,5/25 · UI 13,5/20 · Integridad 10/15 · Programa 7/15 · Código 7,5/10 · Permisos 2/5 · Testing 3,5/5 · Errores 3/5`

### 3.8 EPP preventivo

**Rutas:** `/prevencion/epp-preventivo` (pestañas Cobertura / Requisitos), `/api/prevencion/epp/export`; relación con `/entregas`, `lib/services/deliveries-worker-stock.ts:478-498` y `deliveries-void.ts:204-214` · **Informe detallado:** `anexos/inspecciones.md`

- **UI/UX/Diseño:** `PageHeader` con Exportar y Nuevo requisito, aviso de calidad de datos (7 familias sin clasificar), pestañas con contadores, 2 filtros, tabla de brechas con fundamento y badge «BLOQUEANTE»; sin desborde a 1440 y 390. Defectos: estado vacío afirma «sin brechas» cuando no hay requisitos (INS-E2); «Escalar brechas bloqueantes a CAPA» y «Crear solicitud de reposición» viven en el contenido, no en el header; export con `<a download>` en vez de `ExportButton` y `SelectTrigger` sin nombre accesible (INS-E4).
- **Facilidad de uso:** Crear un requisito por faena: 6 clics; desactivar: 3 clics con motivo. El resultado se ve de inmediato en Cobertura.
- **Funcionalidad:** 7 funciones: 6 ✅, 1 ❓. ❓ Escalar a CAPA no ejecutado en B (habría creado 7 CAPA reales); cubierto por `epp-requirement-management` y `prevention-epp-postgres`.
- **Código y lógica:** Servicio pequeño y claro, historial en la misma transacción. `getEppCoverageDataHealth` no filtra por faena (`prevention-epp.ts:436-464`; INS-E3); `preferredFamilyId` no se valida contra el tipo de EPP.
- **Modelo de datos:** Requisitos con borrado lógico (`is_active`), FK a tipos/familias; cobertura calculada en lectura; CAPA idempotente por `workerId:eppTypeId`.
- **Permisos y seguridad:** Demostrados: alcance por faena en creación y exportación (otrafaena no ve Horcones); `sup`, `ti` y `cphs` sin manage rechazados. Sin vulnerabilidades; el defecto es que la salud de datos muestra conteos globales a usuarios de faena (INS-E3, 🔵).
- **Testing:** `prevention-epp-postgres` 10 ✅; unitarias `epp-requirement-management`, `prevention-epp-actions`, `prevention-epp-calc`, `epp-dialogs`, `pdtp-epp-delivery-accreditation` (PGlite), `worker-stock-delivery`, `register-delivery-action` ✅. E2E `prevencion-epp-matriz` e `integration-epp-lifecycle` leídos, no corridos; escalamiento a CAPA sin E2E.
- **Integración con Programa Anual:** Acredita la **N°62** por cada entrega registrada en `/entregas`. Prueba con `ENT-2026-0059` (admin, Biodiversa): ejecución N°62 en 2026-09 sem 4, `submitted`, `executed_by = qa-admin`, `evidence_status provided` (comprobante); aprobada por `prev2` con un clic. Segregación: verificada en datos (otra persona aprobó); no se probó que el mismo admin sea rechazado. Revocación: anular la entrega deja la ejecución en `draft` con motivo y entrada en `pdtp_change_log` (verificado, incluida una aprobada). Observado: cada entrega genera su propia ejecución y la cola muestra botones idénticos sin trabajador ni código ENT (INS-E1); el panel se muestra con `epp:manage` pero el destino exige `deliveries:create` (INS-E5); el botón «Iniciar» no fue verificable en UI (sin instancias programadas en B).
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 (INS-E1) · 4 🔵 (INS-E2 a INS-E5) · 0 ⚪, contados de los ítems listados.
  - INS-E1 (🟡) — Cada entrega crea una ejecución N°62 a aprobar a mano, y la cola no permite distinguir cuál se aprueba — DEMOSTRADO — deliveries-worker-stock.ts:487-498; connectors 242-282 (fuente epp no autoaprueba, una fila por deliveryId)
- **Readiness individual: 87/100** (muy próximo) — desglose `Func 22/25 · UI 16,5/20 · Integridad 14/15 · Programa 12/15 · Código 9,5/10 · Permisos 4,5/5 · Testing 4,5/5 · Errores 4/5`

### 3.9 Campañas y Capacitación

**Rutas:** `/prevencion/capacitacion`; APIs `POST /api/prevencion/capacitacion/evidence`, `GET …/evidence/[name]` y `GET …/export` · **Informe detallado:** `anexos/capacitacion.md`

- **UI/UX/Diseño:** Cumple el andamiaje (`PageHeader` + `PageContainer`, un `h1`, búsqueda del TopBar conectada, pestañas por estado con contadores, `EmptyState` con CTA; 0 errores de consola ni respuestas ≥400). La lista es inmanejable (CAP-03): 390 tarjetas por faena (83.290 px a 1440, 171.390 px a 390), la charla de la semana en curso es la n.º 289; con «Todas las faenas» son 2.731 tarjetas, 93.231 nodos DOM, 578.613 px y un HTML de 20,3 MB (3,0 MB por faena); la búsqueda no reconoce el mes. Otros: «No aplica» se ve igual aprobado, rechazado o retirado (CAP-05), badges en plural (CAP-15), jerga interna (CAP-16). Sin desborde a 1440/1024/768/390; no se observó «Cargando».
- **Facilidad de uso:** Marcar una charla hecha con evidencia: 5 clics más localizar la tarjeta (escribir el código y bajar ~36 tarjetas, o ~289 sin buscar); un rol global suma 2 clics para elegir faena. «Marcar hecha» sobre una ocurrencia «No aplica» siempre falla (CAP-09); la tarjeta dice «Requiere registro del prevencionista de faena» incluso en N°38 y N°53 cuyo responsable es Sup/JT (CAP-06).
- **Funcionalidad:** 13 funciones: 6 ✅, 3 ✅ con salvedad (2 ✅/🟡, 1 ✅/🔵), 2 🟡, 2 🔴. 🔴 Marcar hecha en semana futura queda aprobada en el PDTP (CAP-01); de «No aplica» a hecha siempre falla (CAP-09). 🟡 Listar/filtrar sin filtro de mes (CAP-03); exportar Excel con fechas UTC crudas y sin actor de NA/no hecha (CAP-11). Con salvedad: NA en revisión cuyo rechazo no vuelve a la ocurrencia (CAP-05), corregir hecha → no hecha/NA pierde el NA en mes cerrado (CAP-04), anuales N°57 sin rastro en el PDTP (CAP-14).
- **Código y lógica:** Servicio sólido (bloqueo de fila, versión optimista, `recordAudit`, acreditación y revocación durables). Brechas: ni `recordTrainingOccurrenceStatus` ni `uploadTrainingOccurrenceEvidence` validan la casilla contra el catálogo vigente (`prevention-training-occurrences.ts:327-328`, CAP-07); sin guard de semana futura en el servicio ni en `accreditPdtpFromEvent` (CAP-01); la propagación tras el commit traga el error con `.catch(logger.error)` (`:691-693`, CAP-04); comentario obsoleto en `manifest.ts:999-1003` (CAP-06); extensión tomada del nombre del cliente (`prevention-documents/utils.ts:230-233`, CAP-13).
- **Modelo de datos:** `prevention_training_occurrences` único por (ítem, faena, año, casilla) con `version`; evidencia anulada, no borrada; `source_id` hacia el PDTP es texto sin FK. En B quedan 91 ocurrencias obsoletas `pending` (13 por faena × 7) y el script `retire-obsolete-training-occurrences` no está aplicado (PRV-06). El catálogo coincide celda a celda con el cronograma v2 de B en las 18 actividades programadas.
- **Permisos y seguridad:** IDOR bloqueado en cuatro vías (server action con `occurrenceId` ajeno, subir a otra faena → 400, descargar de otra faena → 404, `ti` → 403); `sup` sin `record` → 403; exportar: prevencionista_faena → 403, la jefa exporta todo. Riesgo potencial de archivos `.html` en el storage (CAP-13), no explotable por la ruta actual.
- **Testing:** 9 archivos non-PGlite 69/69 PASS y 7 archivos PGlite 110/110 PASS. E2E `e2e/prevencion-odi-capacitacion.spec.ts` sólo carga la página y descarga el Excel. Sin cobertura: hecha en semana futura, réplicas N°38, NA rechazado que no vuelve, hecha → NA en mes cerrado, «Marcar hecha» desde NA. Mes cerrado probado sólo en PGlite (P1–P4).
- **Integración con Programa Anual:** Acredita N°16, N°37, N°38, N°53, N°54 y N°63 por acreditación directa y N°57 por obligación (nace sólo si vence o se declara «no hecha»). Es automática, `approved` y `evidenceStatus=provided`, con ejecutor = aprobador = quien marca (sin segunda persona, CAP-08); la celda es la del mes y semana planificados. Revocación: hecha → no hecha/NA deja la ejecución en `draft` con evidencia anulada (PRV-04 corregido). Observado en B: CAP-21 noviembre semana 4 hecha → N°53 2026-11-w4 `approved` (CAP-01); las 5 réplicas N°38 comparten celda y un NA aprobado de 1 de 5 baja el plan de septiembre de 20 a 15 (CAP-02); una obsoleta CAP-02 m03-w2 acredita N°54 2026-3-w2 sin planificado (CAP-07).
- **Hallazgos:** 0 🔴 · 3 🟠 · 6 🟡 · 5 🔵 (CAP-10 a 14) · 3 ⚪ (CAP-15 a 17), contados de los ítems listados. CAP-01, 04, 05 y 08 aplican también a Alcotest.
  - CAP-01 (🟠) — Un hecho registrado hoy para una semana futura crea una ejecución PDTP aprobada (PRV-03 sigue abierto por la vía de integración) — DEMOSTRADO (B) — training-occurrences.ts:500-547 y 620-636 (sin guard de futuro); alcotest-slots.ts:239-293; alcotest.ts:181-185 y 323-327 (plannedPeriod = casilla); el guard sólo existe en executions.ts:110 y 587
  - CAP-02 (🟠) — Las 5 réplicas de la N°38 (CAP-22…26) comparten una celda; un «no aplica» de una charla saca las cinco, y completar otra lo retira en silencio — DEMOSTRADO (B + servicio de hoja) — catálogo :505-571 (5 ítems con allWeeksOfYear → [38]); occurrences.ts:665-680; slot-deviation-connector.ts:262-324 (desvío por celda)
  - CAP-03 (🟠) — La grilla anual es una lista de 390 tarjetas por faena (2.731 y 20 MB para roles globales) sin filtro de período — DEMOSTRADO (navegador y HTTP, B) — list.tsx:140-148 (la búsqueda ignora mes y semana) y 228-232 (render completo); page.tsx:42-47; service :316-322 (orden enero→diciembre)
  - CAP-04 (🟡) — PRV-16 parcial: hay tres caminos en que el «no aplica»/«no hecha» que el PDTP rechaza sigue quedando sólo en el log — DEMOSTRADO — occurrences.ts:678 y 687-693 (después del commit, .catch(logger.error)); connector :185-191 (el guard sólo cubre futuro y mes cerrado) y :309-324 (el resto se traga)
  - CAP-05 (🟡) — El resultado de la revisión del «no aplica» nunca vuelve a la ocurrencia o casilla — DEMOSTRADO (B) — deviations.ts:350-455 (review sin retroalimentación); list.tsx:321-322; program-slot-list.tsx:147-151
  - CAP-06 (🟡) — Las charlas N°38 y N°53, responsabilidad de Supervisor/Jefe de terreno, sólo las puede registrar Prevención — DEMOSTRADO — manifest.ts:998-1004 (Sup/JT sólo training:view; el comentario habla de un `deliver` retirado); list.tsx:328
  - CAP-07 (🟡) — PRV-06 parcial: 91 ocurrencias obsoletas siguen en B y el servicio todavía acepta marcarlas — DEMOSTRADO — occurrences.ts:327-328 (sólo el listado filtra); 500-547 y 715-747 (record/upload sin validar la casilla)
  - CAP-08 (🟡) — El cumplimiento de capacitación se autoaprueba sin segunda persona y con cualquier archivo de un tipo permitido — DEMOSTRADO — accreditation.ts:523-526 (capacitacion_ocurrencia «incondicional») y 619-622; occurrences.ts:422 (autoApproveByUserId = actor)
  - CAP-09 (🟡) — «Marcar hecha» desde «No aplica» es un callejón sin salida — DEMOSTRADO — list.tsx:271-273 y 416-419; service :743-745 (sin evidencia en NA) y :545-547 (hecha exige evidencia)
- **Readiness individual: 61/100** — No listo — desglose `Func 16/25 · UI 12/20 · Integridad 8/15 · Programa 7/15 · Código 7,5/10 · Permisos 4,25/5 · Testing 3/5 · Errores 3,5/5`

### 3.10 Campañas — registro histórico

**Rutas:** `/prevencion/campanas` (no está en el menú; se llega por URL directa y el conector PDTP `campaigns` apunta a ella, `connectors.ts:106`); APIs `POST /api/prevencion/campanas/evidence` y `GET …/[name]` · **Informe detallado:** `anexos/capacitacion.md`

- **UI/UX/Diseño:** Confunde con Capacitación (CAP-30): 35 campañas legado «Pendiente» en B (5 por faena, CAMP-HORCONES-CIEGOS/VIAL/ALCOHOL/ESTRES/VIDA) que son las mismas N°85–89 que viven como CAM-* en Capacitación, cada una con botón primario verde «Marcar como hecha» y selector «Actividad PDTP» sin efecto (un `Callout` advierte que no acredita, PREV-I10). CAP-32: la búsqueda del TopBar no filtra (5→5 filas), el menú marca «Evaluaciones SST» como activo (`nav-items.ts:183-188`), sin breadcrumb, jerga «(R9)», botón con clase local `bg-[var(--color-success-ink)]`, y un rol sin permiso termina en `/prevencion` en vez de `/forbidden`. Sin desborde; no se observaron vacío, error ni cargando.
- **Facilidad de uso:** Cerrar una campaña: 5 clics (Marcar como hecha, abrir fecha, elegir día, elegir archivo, Confirmar cierre). El problema no son los clics sino que la acción no sirve al programa.
- **Funcionalidad:** 4 funciones: 2 ✅, 1 🟡, 1 ❌ (a propósito). ❌ Crear campaña (`createCampaignAction` devuelve error de dominio, `actions.ts:161-173`). 🟡 Cambiar la actividad PDTP persiste sin efecto (CAP-30). ✅ Cerrar con fecha y evidencia (CAMP-HORCONES-VIDA → `done`, 0 ejecuciones PDTP, evento `campaign_closed` `pending`); evidencia (MIME, extensión por MIME, alcance; M-21 y PRV-18 corregidos).
- **Código y lógica:** Quedan `createCampaign` y `setCampaignPdtpActivities`, y `pdtpAccredited`/`pdtpPending` siempre valen `false` (`prevention-campaigns.ts:217-220`); `closeCampaign` no es transaccional y actualiza sin `status` en el `WHERE` (`:164-176`, CAP-31); la subida no pre-chequea `content-length` (`campanas/evidence/route.ts:27-42`).
- **Modelo de datos:** 35 bindings `campana` activos sin consumidor; el evento `campaign_closed` queda `pending` sin consumidor.
- **Permisos y seguridad:** `campaign:view`/`manage` para prevencionista, prevencionista_faena, admin_contrato y administrador; correctos (`ti` → `/forbidden`; jefa → `/prevencion`; evidencia de otra faena → 404, sufijo parcial → 404).
- **Testing:** `prevention-campaigns.test.ts` y `campanas-client.test.tsx` pasan (incluido el caso de no doble conteo, `:422-423`); no hay E2E.
- **Integración con Programa Anual:** No acredita, y no debe: la N°85–89 se acredita por CAM-* en Capacitación, sin doble conteo. Relación indirecta débil: las 35 pendientes duplican trabajo exigido en Capacitación (cerrar la legado no mueve el PDTP), el evento `campaign_closed` queda `pending` y el conector `campaigns` sigue declarado con `moduleHref=/prevencion/campanas`. Segregación y revocación: no aplican (no acredita).
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 · 1 🔵 (CAP-31) · 1 ⚪ (CAP-32), contados de los ítems listados.
  - CAP-30 (🟡) — La pantalla legado ofrece como pendientes 35 campañas que duplican las CAM-* y un selector de actividad PDTP sin efecto — DEMOSTRADO — client.tsx:173-195 (selector y botón primario); service :109-127 (setCampaignPdtpActivities vivo) y 217-220; connectors.ts:105-112
- **Readiness individual: 79/100** — Funcional, requiere correcciones (la integración se puntúa por la calidad de la relación indirecta) — desglose `Func 21/25 · UI 12,5/20 · Integridad 13/15 · Programa 12/15 · Código 8/10 · Permisos 4,5/5 · Testing 4/5 · Errores 4,5/5`

### 3.11 Alcotest

**Rutas:** `/prevencion/alcotest`; APIs `POST /api/prevencion/alcotest/evidence` y `GET …/evidence/[name]` · **Informe detallado:** `anexos/capacitacion.md`

- **UI/UX/Diseño:** Página simple: `PageHeader` con dos acciones, tres secciones (controles recientes, envíos, casillas del programa) y ningún KPI; sin desborde a 1440/1024/768/390 (a 390 el diálogo «Registrar control» tiene scroll interno de 845/760 px y el botón queda bajo el pliegue). CAP-25: casilla por defecto «Ninguna (control extraordinario)», «Controles recientes» mezcla todas las faenas, sin selector de año, `datetime-local` nativo con helper local en vez de `toLocalInputValue`, meses abreviados en el selector. La casilla muestra «1 evidencia adjunta» sin enlace y ninguna pantalla enlaza la descarga (CAP-22). No se observó «Cargando».
- **Facilidad de uso:** Registrar un control con casilla y archivo: 8 clics; envío mensual: 10 clics. El administrador completa todo el formulario y recién al final recibe «Tu rol no está habilitado…» (CAP-21).
- **Funcionalidad:** 12 funciones: 7 ✅, 2 🟡, 2 🔴, 1 ❌. 🔴 Casilla de una semana futura (CAP-01); casilla compartida N°30/N°31 (CAP-20). 🟡 Envío mensual: mes/casilla no se cotejan y un envío con 0 controles acredita (CAP-23); NA / no hecha de casilla (NA de admin sin desvío, NA sólo sobre la actividad del rol, CAP-20). ❌ Anular o corregir un control: no existe (CAP-24).
- **Código y lógica:** `listAlcoholTests` y `listAlcoholTestDispatches` cargan la tabla entera y filtran en JS (`prevention-alcotest.ts:232-236,352-355`, CAP-26); `alcohol_tests.evidence_url` está muerta (zod la descarta, `validation/alcotest.ts:3-32`); `performedAt: z.string().min(1)` acepta cualquier fecha (`:6`); mensajes de alcance engañosos por reutilizar `assertWorksiteAccess` del PDTP. A favor: gate de evidencia en la transacción, historial de módulo, sha calculado en el servidor.
- **Modelo de datos:** `alcohol_tests` sin estado ni anulación; `prevention_alcotest_slots.test_id`/`dispatch_id` son texto sin FK; una sola serie de 12 casillas de control para dos actividades de 12 celdas (CAP-20); queda evidencia huérfana activa en las casillas (m06-w3 por el administrador).
- **Permisos y seguridad:** Alcance por faena correcto en carga, descarga, acción y registro (demostrado; otrafaena reescribiendo `slotId` rechazado). `.exe` → 400, 26 MB → 413, `ti`/`cphs` → 403. Incoherencia: administrador y admin_contrato tienen `register` pero ninguna actividad (CAP-21); jefa_chome sin permisos de alcotest → `/forbidden`.
- **Testing:** `prevention-alcotest.test.ts`, `slot-selection.test.ts`, `validation/alcotest.test.ts` y `pdtp-slot-deviation-propagation.test.ts` pasan (incluidos en los totales de Capacitación: 69/69 y 110/110). No hay E2E de alcotest; sin pruebas de casilla futura, de casilla compartida PRF/Sup ni de cotejo mes/casilla.
- **Integración con Programa Anual:** Acredita N°30 (PRF), N°31 (Sup/JT) según el rol y N°32 con el envío; la celda es la de la casilla. Con archivo verificado se autoaprueba con el mismo registrante como aprobador (abierto por diseño, CAP-08); sin archivo o con archivo inexistente queda `submitted` y otra persona aprueba con motivo (PRV-01 y PRV-02 corregidos; un archivo de otra faena no se puede inyectar). No hay revocación posible porque no hay anulación (CAP-24). Observado: casilla compartida por N°30/N°31 (24 celdas sobre 12 casillas, CAP-20) y celdas futuras aprobadas (CAP-01).
- **Hallazgos:** 0 🔴 · 0 🟠 · 5 🟡 (CAP-20 a 24, más CAP-01, 04, 05 y 08 compartidos con Capacitación) · 3 🔵 (CAP-25, CAP-26, CAP-13), contados de los ítems listados.
  - CAP-20 (🟡) — Una sola serie de 12 casillas para dos actividades (N°30 y N°31, 24 celdas planificadas) — DEMOSTRADO (B) — program-slots-2026.ts:33-56 y 103-112; alcotest-slots.ts:204-223 (declareOn por rol) y 255-257; workbench:262
  - CAP-21 (🟡) — administrador y admin_contrato pueden abrir y completar «Registrar control», pero su rol no mapea a ninguna actividad: falla al final y deja evidencia huérfana — DEMOSTRADO — manifest.ts:694,701; alcotest.ts:117-120; workbench.tsx:304-315 (sube antes de registrar)
  - CAP-22 (🟡) — La evidencia de alcotest no se puede abrir desde ninguna pantalla — DEMOSTRADO — program-slot-list.tsx:138-143 (sólo el conteo); evidence-href.ts:35-39 (sin prevention-alcotest-evidence); thumbs:64-72 (chip «En el módulo de origen» sin enlace)
  - CAP-23 (🟡) — No se cotejan la casilla, el período y la fecha: envío de julio en la casilla de diciembre, control fechado en 2027, envío de 0 controles — DEMOSTRADO (B) — validation :6 (performedAt libre); alcotest.ts:255-347 (sin cotejo mes vs casilla; testCount 0 permitido); slots.ts:239-265
  - CAP-24 (🟡) — Un control o envío registrado no se puede anular ni corregir; la casilla y la acreditación quedan fijas — CÓDIGO (grep sin annul/unlink/revoc) — alcotest-slots.ts:154-164 (una casilla cumplida no se corrige; «deshacerlo es desvincularlo», pero no existe ese desvincular); schema :20-48 (sin estado)
- **Readiness individual: 64/100** — No listo — desglose `Func 14/25 · UI 14,5/20 · Integridad 8/15 · Programa 9/15 · Código 8,5/10 · Permisos 4/5 · Testing 3/5 · Errores 3,5/5`

### 3.12 Incidentes y accidentes

**Rutas:** `/prevencion/incidentes` (bandeja + buzón público), `/prevencion/incidentes/[id]`, `/prevencion/incidentes/reportar`, `/reportar-incidente` (público), `GET /api/prevencion/incidentes/export`, `GET /api/prevencion/incidentes/[id]/expediente` · **Informe detallado:** `anexos/incidentes.md`

- **UI/UX/Diseño:** Estructura correcta (`PageHeader` + `PageContainer`, acciones en el header, 4 KPI clicables, 3 filtros + chips, búsqueda del TopBar vía `DataTable`, tarjetas móviles); 0 errores de consola y 0 respuestas ≥400 (10 roles × 4 rutas, 4 anchos). Defectos: el detalle se desborda 83 px a 390 px (INC-10); enums crudos en inglés y jerga («canónicos», «idempotencia», «RE-20 Versión 2») (INC-M01, INC-M03, INC-M20); `<input type="date">` nativo (INC-M02); en «Pendiente verificación» no se dicen los hitos RE-20 faltantes ni el estado de las obligaciones PDTP (INC-04); «Confirmar (Supervisor)» visible a quien marcó la difusión (INC-M04). No se observaron cargando ni sin resultados con filtros.
- **Facilidad de uso:** Reportar un cuasi accidente a 390 px (supervisor, desde /dashboard): 7 toques, con tipo, faena, fecha y hora prellenados («Empresa o empleador» siempre a mano). Canal público a 390 px: faena + fecha + lugar + relato + enviar, con folio `RPT-2026-…`. Flujo completo (triage → cierre): ~15 acciones entre 3–4 personas; una sola prevencionista puede cerrar en 4 minutos gracias a `sign_own_work` (rotulado en el historial).
- **Funcionalidad:** 17 funciones: 8 ✅ (una con «descartar» no ejecutado en UI), 1 ✅/🟡, 6 🟡, 1 🔴, 1 ❌. 🔴 Abrir el reporte sin conexión (INC-19). ❌ Reclasificar tipo o anular un incidente duplicado/erróneo (INC-14). 🟡 Validación de fechas del canal público (INC-12); evidencia sólo texto, sin subida de archivo (INC-15); DIAT/notificaciones con `sentAt` = ahora (INC-13); hitos RE-20 guardados pero invisibles (INC-01); autorización de reinicio segregada que se salta (INC-09); cierre con compuertas que ignora RE-20 (INC-04) y queda bloqueado con una CAPA cancelada (INC-05).
- **Código y lógica:** Conector RE-20 documentado, idempotente y con barrido horario (`incident-accreditation-connector.ts:531-658`). Tres tablas de sólo escritura (`prevention_incident_statements`, `prevention_incident_diffusion`, `prevention_incident_followups`) que fuera del conector nadie lee; los seis hitos RE-20 no escriben `appendHistory` (`prevention-incidents.ts:1807-1946`). `onIncidentReported` fija el origen en `createdAt` (`:693,1214`, INC-03); `onIncidentFollowupRecorded` sin `actorUserId` (`connector:386-395`, INC-07); segregación del reinicio sin `completedByUserId` (`:1636-1639`, INC-09); mensajes fijos «…y acreditado en PDTP» (`actions.ts:184,202,220,237,269`, INC-11); `listPreventionIncidents` corta en 500 sin paginar (`:906`).
- **Modelo de datos:** Estados `reported → … → closed` sin `cancelled`/`voided` y tipo de evento inmutable tras el reporte (`triageSchema` sin tipo, `:167-179`). Personas minimizadas y payload sensible cifrado; entrevistas cifradas, pero la declaración de la persona accidentada (`statement_text`) queda en claro (INC-M09). Expediente cerrado inmutable, por lo que los hitos RE-20 pendientes ya no se pueden registrar (INC-04).
- **Permisos y seguridad:** Probado: IDOR entre faenas bloqueado (detalle «no encontrado», export sólo cabeceras, expediente 404); `prevfaena` sin `view_sensitive` recibe «no encontrado» y 404 en `expediente?includeSensitive=1`; `prev` y `admin` obtienen «Datos reservados» con propósito y auditado; `ti` → /forbidden; `sup`/`cphs` no exportan (403); anónimo → 307; XSS almacenado vía canal público sin ejecución; fórmulas Excel neutralizadas. Falla: la autorización de reinicio puede saltarse la segregación (INC-09) y la cuota por IP en local usa el cubo compartido `unresolved` (en producción rige la IP de Cloudflare, no verificable).
- **Testing:** `vitest.non-pglite` 17 archivos / 80 PASS; `vitest.pglite` 7 archivos / 64 PASS; Postgres `prevention-incidents-postgres` 4 PASS, `prevention-capa-postgres` 4 PASS, `prevention-incidents-concurrency-postgres` 1 PASS. E2E leídos, no corridos: `prevencion-incidentes-re20.spec.ts` sólo reporta, abre y exporta; `prevencion-production-readiness.spec.ts` no envía; ningún E2E cubre el efecto en el PDTP (INC-20).
- **Integración con Programa Anual:** Abre y acredita las obligaciones RE-20 **N°66–78** (verificado en B). Vía: conector de incidentes; obligaciones y ejecuciones `submitted` con `evidence_status=provided` por un texto sintético «Aviso de incidente registrado: inc-…» (INC-02); N°76 acredita por evento directo con `executed_by=NULL`. Segregación: la N°72 (DIAT) rechaza la autoaprobación del registrante, pero prev2 la aprueba con un clic y sin motivo, y la N°76 la aprueba quien registró el seguimiento (INC-07). Plazos contados desde `createdAt`: un aviso 12 h tarde cuenta a tiempo (INC-03). Observado: M-23 corregido (el triage que agrava abre la N°68–71, 73–75, 77 y 78 en la misma petición); cerrar sin hitos deja 6 obligaciones pendientes (68, 69, 70, 71, 75, 78) sin vía desde el incidente (INC-04); bajar la gravedad cancela 9 obligaciones sin segunda persona (INC-M14); N°76 `closed_on_time` (INC-08). Revocación: no informada.
- **Hallazgos:** 0 🔴 · 5 🟠 (INC-01, 02, 03, 05 y 06 —esta última de CAPA) · 15 🟡 · 22 🔵 (INC-M01 a M22, repartidas entre incidentes, CAPA y material/ambiental) · 1 ⚪ (INC-C01), contados de los ítems del informe completo (incidentes, CAPA y daño material).
  - INC-01 (🟠) — La declaración (N°69), el ONE PAGE (N°78) y los seguimientos (N°76) no se pueden consultar: el expediente, el historial y el PDTP sólo guardan que "se hizo" — DEMOSTRADO (flowA2 + probeA5) — prevention-incidents.ts:1848-1946 (insert sin appendHistory); prevention-incident-export.ts:199-235 (hojas del expediente sin esos hitos); [id]/page.tsx:125-132 (sólo pasa preliminar y difusiones)
  - INC-02 (🟠) — Las ejecuciones RE-20 quedan con evidencia "provided" por un texto que genera el sistema, y se aprueban sin motivo (PRV-01 sigue abierto en la vía de obligaciones) — DEMOSTRADO — obligations.ts:271 (hasEvidence = texto) y 326/341 (evidenceStatus "provided"); incident-accreditation-connector.ts:251,334,343,351,360,369,377,410,418 (evidenceText sintético); executions.ts:771-773 (sólo pide motivo si evidenceStatus ≠ provided)
  - INC-03 (🟠) — Los plazos RE-20 se cuentan desde que se registró el incidente en el sistema, no desde que ocurrió: la N°66/67 ("informar inmediatamente") siempre sale a tiempo — DEMOSTRADO — prevention-incidents.ts:690-699 (reportedAt: createdAt) y 1211-1220 (occurredAt: updated.createdAt); incident-accreditation-connector.ts:117-145, 247-252, 612; obligations.ts:114,188 (dueAt = sourceOccurredAt + plazo)
  - INC-05 (🟠) — Un incidente con una CAPA cancelada no puede cerrarse nunca — DEMOSTRADO — prevention-incidents.ts:1262-1266 y 1270 (exige closed/verified; cancelled bloquea); prevention-capa.ts:229 (cancelled: [] sin salida)
  - INC-04 (🟡) — El cierre no exige ni muestra los hitos RE-20 y deja sus obligaciones pendientes sin vía de cumplimiento — DEMOSTRADO — prevention-incidents.ts:1268-1296 (compuertas: investigación, CAPA, carriles); 1794-1804 (tras el cierre no se registran hitos); [id]/page.tsx:129-130 (panel deshabilitado)
  - INC-07 (🟡) — Quien registra el seguimiento quincenal aprueba su propia ejecución N°76 (PRV-02 parcial) — DEMOSTRADO — lib/services/pdtp-adapters/incident-accreditation-connector.ts:386-395 (recordPdtpFulfillmentEvent sin actorUserId)
  - INC-08 (🟡) — La N°76 es closed_on_time pero acredita por ejecución directa: sus seguimientos aprobados no cuentan en el indicador — SQL (B) — connector:20-27, 386-395; compliance.ts:137-200 y 1424-1425 (closed_on_time sólo cuenta obligaciones)
  - INC-09 (🟡) — Quien completó la investigación puede autorizar el reinicio si no figura en el "equipo" (que además llega del cliente) — DEMOSTRADO — lib/services/prevention-incidents.ts:1636-1639 (conflicted = team + actores CAPA); 185 y 1421 (team del input); 1442 (completedByUserId)
  - INC-10 (🟡) — El detalle del incidente se desborda 83 px a 390 px — DEMOSTRADO (check390.mjs) — app/(app)/prevencion/incidentes/[id]/re20-panel.tsx:194-245 (fila de 5 pestañas sin wrap)
  - INC-11 (🟡) — "Registrado y acreditado en PDTP" aunque no se acreditó nada o sólo quedó pendiente de aprobación — DEMOSTRADO — actions.ts:184,202,220,237,269; re20-panel.tsx:175,269,322,364,395
  - INC-12 (🟡) — El canal público acepta fechas futuras o absurdas; el reporte con fecha futura no se puede convertir en incidente — DEMOSTRADO (flowA6) — prevention-incident-reports.ts:50 (sólo regex); report-form.tsx:73 (date nativo sin max)
  - INC-13 (🟡) — La DIAT/DIEP/notificación se registra siempre con la hora actual; no se puede declarar la hora real de envío (y el servicio acepta horas futuras) — CÓDIGO — incident-workflow-panel.tsx:291 (sentAt: new Date().toISOString()); prevention-incidents.ts:207 (sin tope futuro), 1573 (wasLate)
  - INC-14 (🟡) — No existe anulación ni reclasificación de tipo: un reporte duplicado o mal tipificado queda para siempre con sus obligaciones — CÓDIGO — lib/services/prevention-incidents.ts:72-80 (sin estado cancelado), 167-179 (triage sin eventType), 1132 (triage una sola vez), 366-377 (transiciones)
  - INC-15 (🟡) — El incidente no admite archivos: evidencia, DIAT y resolución de reinicio son texto libre (≥3 caracteres) — CÓDIGO — prevention-incidents.ts:297-307, 203-212, 346-359; 1276 (compuerta "requiere evidencia" satisfecha por cualquier texto); incident-workflow-panel.tsx:234, 292, 332
  - INC-19 (🟡) — El formulario de reporte no abre sin conexión: la cola offline sólo sirve si la página ya estaba cargada — DEMOSTRADO (flowA8) — public/sw.js:13-14 (SHELL_URLS ["/ppa"]), 97-110 (sólo navega offline /ppa)
  - INC-20 (🟡) — Los E2E no cubren el flujo RE-20 ni el ciclo CAPA; el de CAPA es condicional y vacío — CÓDIGO (lectura) — re20.spec:21-86 (reporte, detalle y export); capa-lifecycle.spec:30-59 (`if count > 0` y selectores inexistentes: "Seguimiento y avance", input[name=reference]); readiness.spec:50-55 (PRV-15 sólo abre)
- **Readiness individual: 62/100** — No listo para producción: el módulo operativo es sólido y seguro, pero su aporte al programa (N°66–78) no es confiable — desglose `Func 16/25 · UI 12/20 · Integridad 9,5/15 · Programa 5/15 · Código 8/10 · Permisos 4/5 · Testing 3,5/5 · Errores 4/5`

### 3.13 Acciones correctivas CAPA

**Rutas:** `/prevencion/capa`, `/prevencion/capa/[id]`, `GET /api/prevencion/capa/export`, `POST /api/prevencion/capa/evidence` · **Informe detallado:** `anexos/incidentes.md`

- **UI/UX/Diseño:** `PageHeader` con Exportar y «Nueva acción», 4 KPI clicables, 3 filtros más «Más filtros (Por conciliar)» y chips, `EmptyState`. Defectos: a 390 px la tabla no tiene tarjetas y el estado queda fuera de pantalla (INC-M16); detalle con valores crudos («high», «needs_assignment», «pending», «created», actor «qa-prev» y fuente «Incidente · inc-FMwv…») (INC-M01); la evidencia se lista como texto `storage/capa-evidence/xxxx.png` sin enlace (INC-06); «Cancelar CAPA» destructivo sin `ConfirmDialog` y con motivo compartido (INC-M05); las CAPA de incidente nacen «Por conciliar» con jerga de migración (INC-M06). No observados: cargando ni sin resultados.
- **Facilidad de uso:** Cerrar una CAPA exige 3 personas y 10 clics: implementador 5, verificador 3, jefa 2. Es coherente con la segregación; falta que la pantalla diga quién sigue.
- **Funcionalidad:** 12 funciones: 7 ✅, 1 ✅/🔴, 2 🟡, 1 ❌, 1 no ejecutada. ❌ Ver o abrir la evidencia para verificarla: 0 enlaces y sin ruta de descarga para `storage/capa-evidence/` (INC-06). ✅/🔴 Cancelar con motivo, con efecto en el incidente (INC-05). 🟡 Buscar en el TopBar sólo filtra las 50 de la página (INC-18); exportar Excel con hoja duplicada y tope silencioso de 500 (INC-17). No ejecutada en UI: conciliación histórica (PGlite PASS); reabrir y asignar responsable/plazo sólo por código y PGlite.
- **Código y lógica:** Máquina de estados y segregación en el servicio (`assertCapaTransition`, `prevention-capa.ts:258-318`) con versión optimista. Duplicación de filas y encabezados en `buildCapaExport` (`:1203-1244`); `listCapaActions` topa en 500 (`:915`) pero el export marca `rowLimitApplied` sobre 10.000 (`:1161`); `addCapaFollowupWithClient` no valida estado terminal y los envoltorios no llaman `assertNotPpaDriven` (INC-M12).
- **Modelo de datos:** Tablas de acción, transiciones (bitácora), evidencia (con `superseded`) y seguimientos; CHECK de exención de evidencia justificada; vínculo con la fuente por `source_type/source_id` (texto, sin FK). Reabrir una CAPA de un incidente cerrado deja el incidente cerrado sin aviso (INC-M21).
- **Permisos y seguridad:** `capa:view/manage/complete/verify/close/override_segregation/reconcile`; `close` sólo jefa_chome y administrador; sup, jt y cphs → /forbidden (verificado). `otrafaena` → «no encontrado» y export vacío; segregación de verificación por identidad (creador, responsable, quien completa) verificada; subida con MIME por contenido (SVG renombrado a .png rechazado), 25 MB, sha256 recalculado y rechazo de rutas de otra faena. Sin fallas de seguridad.
- **Testing:** `prevention-capa*.test.ts`, `capa-controls.test.tsx`, rutas export/evidencia (PASS); PGlite list/manual/evidencia (PASS); `prevention-capa-postgres` 4 PASS. E2E vacío (INC-20).
- **Integración con Programa Anual:** Relación indirecta, como declara el mapa: cerrar una CAPA no crea ejecuciones ni eventos PDTP (SQL en A: 0 en `pdtp_fulfillment_events`/`pdtp_executions` con fuente CAPA; sin llamada de acreditación en `prevention-capa.ts`). «Medidas» del PDTP (`/prevencion/pdtp/acciones`) es una vista de las mismas filas CAPA `source_type=pdtp` (`capa-view.ts:142-172`; sin doble registro) con dos vocabularios de estado (INC-M22). La CAPA de un incidente condiciona el cierre (N°77), lo que trae INC-05.
- **Hallazgos:** 0 🔴 · 1 🟠 (INC-06) · 2 🟡 (INC-17, INC-18) · 🔵 INC-M05, M06, M12, M16, M21, M22 citadas por el informe; INC-05 (🟠, «Incidentes y accidentes / CAPA») y INC-20 (🟡) se listan en Incidentes.
  - INC-06 (🟠) — La evidencia subida a una CAPA no se puede abrir: quien verifica "evidencia y eficacia" no puede ver el archivo — DEMOSTRADO (flowA3) — [id]/page.tsx:88-95 (texto sin enlace); prevention-capa.ts:1284-1286 ("no hay ruta para descargarlo"); evidence/route.ts (sólo POST)
  - INC-17 (🟡) — El Excel CAPA duplica la hoja principal y trunca en 500 acciones sin avisar — DEMOSTRADO (probeA5) — lib/services/prevention-capa.ts:915 (tope 500), 1159-1161 (rowLimitApplied > 10.000), 1200-1244 (hoja primaria + la misma en sheets)
  - INC-18 (🟡) — La búsqueda del TopBar sólo filtra las 50 CAPA de la página actual — CÓDIGO (no había más de 50 CAPA para demostrarlo) — capa-list.tsx:86-92; page.tsx:22-38 (paginación en servidor de 50)
- **Readiness individual: 75/100** — Funcional, requiere correcciones (INC-06 obligatorio) — desglose `Func 16,5/25 · UI 14/20 · Integridad 11/15 · Programa 13/15 · Código 8/10 · Permisos 5/5 · Testing 3/5 · Errores 4,5/5`

### 3.14 Daño material y ambiental

**Rutas:** `/prevencion/indicadores-material-ambiental`, `GET /api/prevencion/indicadores-material-ambiental/export?year=` · **Informe detallado:** `anexos/incidentes.md`

- **UI/UX/Diseño:** `PageHeader` con exportar, aviso informativo, selector de faena y año (`router.replace` + `scroll:false`), 4 tiles y pestañas Mensual/Gráficos/Resumen por faena. Defectos: los tiles no son accionables ni llevan a los incidentes (A1) y en vacío se muestra una tabla de 12 filas en 0 en vez de `EmptyState` (INC-M07); cuatro gráficos redibujan la misma serie (A5 leve); «Daño material» e «Inc. peligrosos» usan tonos cercanos; `?year=1999` → «Algo salió mal» (INC-M18). A 390 px la tabla se desplaza dentro de su contenedor; sin desborde de página.
- **Facilidad de uso:** Cambiar de faena y año: 2 clics. No hay camino desde una cifra al registro que la produce.
- **Funcionalidad:** 5 funciones: 2 ✅, 1 ✅/🟡, 1 🔴, 1 ❌. 🔴 «Total eventos» suma todas las faenas aunque haya una seleccionada (INC-16). ✅/🟡 Año: uno fuera de rango rompe la página (INC-M18). ❌ Drill-down a incidentes (tiles no clicables, INC-M07). ✅ Conteo por tipo/faena/mes y exportar Excel con alcance (prevfaena sólo su faena, 13 filas; prev 4 faenas, 49).
- **Código y lógica:** Consulta agregada simple y con alcance (`prevention-indicadores.ts:939-1040`). La página usa `codeYear()` (C-05 corregido) pero la ruta de export sigue con `new Date().getFullYear()` (`export/route.ts:28`) y ante un año inválido devuelve en silencio el año actual (INC-M19). Cuenta todo incidente del tipo, incluso sin triar o duplicado (sin anulación, INC-14).
- **Modelo de datos:** Lectura de `prevention_incidents` por `event_type`; no persiste nada.
- **Permisos y seguridad:** `prevention:indicadores:view` (cphs y jefa sí; sup, jt, legal y ti → /forbidden, verificado). Alcance por faena verificado en la página y en el export; cphs puede exportar.
- **Testing:** `prevention-material-environmental.test.ts` PASS; ningún test cubre el tile total ni el año inválido; sin E2E.
- **Integración con Programa Anual:** No acredita nada y no debería (tablero de lectura). Cuenta los mismos incidentes que abren obligaciones RE-20 pero no enlaza a los incidentes ni a esas obligaciones. Actividades, segregación y revocación: no aplican.
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 (INC-16) · 🔵 INC-M07, M18, M19 citadas por el informe.
  - INC-16 (🟡) — "Total eventos" ignora la faena seleccionada (no calza con los otros tres tiles) — DEMOSTRADO (flowA9) — app/(app)/prevencion/indicadores-material-ambiental/material-environmental-dashboard.tsx:52-63 (totals suma todas las faenas), 98-99 (tile)
- **Readiness individual: 80/100** — Muy próximo — desglose `Func 18/25 · UI 16/20 · Integridad 13/15 · Programa 12/15 · Código 9/10 · Permisos 5/5 · Testing 3,5/5 · Errores 3,5/5`

### 3.15 Matriz IPER (MIPER)

**Rutas:** `/prevencion/miper` (pestañas Versiones / Revisiones / Importaciones), `/prevencion/miper/controles/[id]`; APIs `GET /api/prevencion/miper/[id]/export`, `GET /api/prevencion/miper/importaciones/[id]/original` · **Informe detallado:** `anexos/riesgos.md`

- **UI/UX/Diseño:** Cumple el andamiaje (`PageHeader` con «Nueva versión» e «Importar Excel», `PageContainer`, 4 KPI enlazados, pestañas, `EmptyState`, `DatePicker`, `MetaBadge`); 0 `h1` duplicados, 0 desborde a 1440/1024/768/390, 0 errores de consola y 0 respuestas ≥400 en todos los roles. La «matriz» no es una matriz: tarjetas por peligro, sin nivel inherente, factor, daño, expuestos, género ni sensibilidad, y sólo los 8 primeros peligros (`miper-workbench.tsx:191`, `entries.slice(0, 8)`) (RSK-02). Búsqueda del TopBar que no filtra y sin filtro por faena/estado (RSK-08); jerga «Origen risk_matrix · riskmatrix-…» (RSK-30); SHA-256 cortado a 390 px (RSK-31). Éxito sin toast; no se capturó «Cargando».
- **Facilidad de uso:** Publicar una MIPER nueva (2 peligros, 3 personas): ≈15 clics, ~45 campos, 4 sesiones (crear borrador 4 clics + 5 campos; agregar peligro 2–3 clics + 17 campos; revisar/aprobar/publicar 2 clics + motivo cada uno). Copiar la vigente por defecto está bien resuelto. Fricciones: no se puede corregir ni quitar un peligro de un borrador ni descartarlo (RSK-05); el lote importado se corrige editando JSON crudo y un JSON inválido se ignora en silencio (RSK-06); a la jefa se le ofrece «Publicar» que el servidor rechaza (RSK-16).
- **Funcionalidad:** 12 funciones: 6 ✅, 4 🟡, 1 🔴, 1 ❌. 🔴 Consultar la matriz completa: ≤8 peligros en pantalla y export sólo de publicada/reemplazada (RSK-02). ❌ Editar/quitar peligro en borrador (RSK-05). 🟡 Importar Excel (resolución por JSON crudo, RSK-06); controles críticos y verificación segregada (no verificado en navegador); disparadores de revisión, los de la versión reemplazada quedan vivos (RSK-03); bloqueos críticos/KPI de cobertura, un borrador infla el denominador (1/1 → 1/2, RSK-05).
- **Código y lógica:** Reglas en servicio y transacción con control optimista (`version`); errores de dominio separados (`actions.ts:108-111`). `miper-workbench.tsx` con JSX en líneas únicas de 1–3 KB y `catch { return }` que traga el error de JSON (`:280`, RSK-06). `getRiskDashboard` (`prevention-risk-legal.ts:1357-1417`) trae todas las matrices sin paginar y el mapa la reutiliza (`cgrd/mapa/risk-map-data.ts:22`, RSK-18). Export con IDs de usuario y enums crudos (`miper-workbook.ts:61,64`, RSK-17).
- **Modelo de datos:** Versionado por fila (`prevention_risk_matrices` con `matrix_version`, `supersedes_matrix_id`, `published_hash_sha256`), entradas y controles copiados por versión, sin borrado físico. Procesos/tareas/puestos se crean sobre un borrador y cuentan como «activos» aunque nunca se publiquen; la obligación de 30 días y el disparador anual no se cierran al reemplazar (RSK-03).
- **Permisos y seguridad:** Probado: `sup`, `legal`, `ti` → `/forbidden`/403; `otrafaena` 404 al exportar; segregación en navegador (creador ≠ revisor ≠ aprobador ≠ publicador salvo `sign_own_work`); POST con `Origin` ajeno → 403 (M-02); import rechaza `.xls`, cifrados, rutas internas raras y MIME ajeno. Falla: el tope de expansión del Excel se evade con un ZIP de tamaños declarados falsos: 185 KB que declaran 2 KB pasan `validateXlsxEnvelope` y ExcelJS infla 180 MB (pico +129 MB) (RSK-07, validador compartido con PDTP).
- **Testing:** 13 archivos / 65 pruebas unitarias en verde (`prevention-risk-legal.test.ts`, `miper-ui-contract.test.ts`, `prevention-risk-import.test.ts`, `miper/actions.test.ts`, rutas de export e importaciones), PGlite 3 archivos / 43 pruebas, postgres `prevention-risk-legal-postgres.test.ts` 21/21 PASS (no skipped). E2E `prevencion-miper-matriz.spec.ts` sólo carga la página; sin E2E del flujo crear → publicar, importación ni verificación de controles (RSK-26).
- **Integración con Programa Anual:** Acredita la **N°35**, directa al publicar: ejecución `submitted`, `origin=integration`, `executed_by` = quien publicó, `evidence_status=not_required`, texto «MIPER vN publicada: riskmatrix-…» sin enlace ni archivo. Segregación: el publicador no puede aprobar («Quien registró el cumplimiento no puede aprobarlo»); prev2 aprobó con motivo obligatorio (PRV-02 corregido). Revocación: al reemplazar, v1 queda `superseded` pero su N°35 sigue `approved` (decisión PRV-04) y v2 crea otra ejecución en la misma celda (RSK-24), con dos pendientes vivos de v1 que no pueden cerrarse (RSK-03). Observado: la N°35 está planificada mensualmente (12 celdas, semana 3) pero la publicación acredita una sola celda (RSK-04).
- **Hallazgos:** 0 🔴 · 1 🟠 · 6 🟡 (RSK-03 a 08, con RSK-05 y RSK-08 compartidos con Requisitos legales) · 🔵 RSK-16, 17, 18, 24, 26 y ⚪ RSK-30, 31 citados; conteo global del informe de riesgos: 🔴 0 · 🟠 2 · 🟡 13 · 🔵 12 · ⚪ 4.
  - RSK-02 (🟠) — Quien revisa y aprueba una MIPER no puede ver su contenido completo — CÓDIGO (líneas citadas) — miper-workbench.tsx:190-191 (export sólo si published; entries.slice(0, 8)); prevention-risk-legal.ts:1629 (getPublishedRiskMatrix sólo published/superseded)
  - RSK-03 (🟡) — Reemplazar una MIPER deja vivos su disparador anual y una obligación de 30 días imposible de cerrar — DEMOSTRADO — lib/services/prevention-risk-legal.ts:534-561 (supersesión sin tocar disparadores ni obligaciones), 569-587 (se crean por versión), 1238-1240 (sólo se vinculan controles de matriz publicada), 1341-1344 (el cierre exige vínculo a controles de esa matriz)
  - RSK-04 (🟡) — La N°35 está planificada todos los meses, pero una publicación acredita una sola celda — DEMOSTRADO (SQL en B) — pdtp-accreditation-connectors.ts:499-528 (una ejecución por publicación, occurredAt = publishedAt)
  - RSK-05 (🟡) — Los borradores no se pueden corregir ni descartar — CÓDIGO + DEMOSTRADO — prevention-risk-legal.ts:299-380 (sólo addRiskEntry), 382-391, 924 (LEGAL_TRANSITIONS sin retorno ni descarte), 883-922 (sin edición); 1398 y 1411-1414 (cobertura cuenta procesos activos de cualquier matriz)
  - RSK-06 (🟡) — Corregir una fila importada exige editar JSON crudo y un JSON inválido se ignora sin aviso — DEMOSTRADO — app/(app)/prevencion/miper/miper-workbench.tsx:278-282 (textarea con JSON; `catch { return }`)
  - RSK-07 (🟡) — El tope de expansión del Excel confía en los tamaños que declara el propio ZIP — DEMOSTRADO — xlsx-security.ts:60-110 (suma `uncompressed` declarado en el directorio central); prevention-risk-import.ts:295-313 (luego `workbook.xlsx.load`)
  - RSK-08 (🟡) — La búsqueda del TopBar se muestra pero no filtra, y no hay filtro por faena ni estado — DEMOSTRADO — ninguno de los dos usa useSafeShellHeader/searchQuery (miper-workbench.tsx:146-208; legal-requirements-workbench.tsx:44-62)
- **Readiness individual: 66/100** (No listo: el flujo segregado funciona, pero quien revisa y aprueba no puede ver la matriz completa) — desglose `Func 16/25 · UI 11/20 · Integridad 12/15 · Programa 10/15 · Código 7/10 · Permisos 3/5 · Testing 3/5 · Errores 4/5`

### 3.16 Requisitos legales

**Rutas:** `/prevencion/requisitos-legales` (pestañas Registro legal / Aplicabilidad / Brechas), `/prevencion/requisitos-legales/[id]`; API `GET /api/prevencion/requisitos-legales/export` · **Informe detallado:** `anexos/riesgos.md`

- **UI/UX/Diseño:** `PageHeader` con «Exportar Excel» y «Nuevo requisito», 4 KPI enlazados, pestañas con contadores, `EmptyState` en cada pestaña, `DatePicker`, estados en español; 0 errores de consola/red y 0 desborde en los 4 anchos. Defectos: la búsqueda del TopBar no filtra (1 → 1 requisito) y no hay filtro por faena en Aplicabilidad (RSK-08); el código de cada requisito enlaza a su ficha pero un borrador abre «Error 404 · No encontramos este registro» con HTTP 200, y la ficha no muestra las evaluaciones ni los vínculos al PDTP (RSK-11).
- **Facilidad de uso:** Crear requisito: 2 clics + 12 campos. Ciclo completo (enviar → revisar → aprobar → publicar): 4 sesiones, 8 clics, y publica sólo el administrador. Aplicabilidad: 2 clics + 3 campos, aprobar 2 clics. Evaluar cumplimiento: 2 clics + 1 campo. Fricciones: se ofrece «Revisar» al creador y «Publicar» a la aprobadora, ambos rechazados por el servidor (RSK-16); un requisito en revisión con un error no puede devolverse ni editarse (RSK-05).
- **Funcionalidad:** 9 funciones: 6 ✅, 2 🟡, 1 ❌. ❌ Editar / devolver / descartar borrador (`LEGAL_TRANSITIONS` sin retorno, `prevention-risk-legal.ts:924`, RSK-05). 🟡 Evaluación de cumplimiento: «Cumple» con evidencia `"abc"` deja el KPI en 1/1 (RSK-09); ficha del requisito con 404 para no publicados y sin historial (RSK-11). ✅ incluye brecha → CAPA en la misma transacción (código y pruebas; no recorrido en navegador).
- **Código y lógica:** Vigencia centralizada (`isLegalRequirementInForce` y `legalRequirementInForceCondition`, `:835-857`), re-evaluar exige motivo (`:1067-1075`) y una CAPA abierta impide declarar «Cumple» (`:1172-1183`): buena calidad. `assessLegalCompliance` sobrescribe `assessedByUserId` de la aplicabilidad (`:1215`, RSK-25); export con IDs de usuario, `sourceType` y `processId` crudos (`requisitos-legales/export/route.ts:30,33`, RSK-17).
- **Modelo de datos:** Requisito global versionado por `code` + `requirement_version` con índice parcial de un publicado por código; aplicabilidad por faena/proceso con índice único; evaluaciones append-only; sin borrado físico. La evidencia es un campo de texto (`evidence_reference`), no un archivo ni un vínculo verificable (RSK-09).
- **Permisos y seguridad:** Alcance por faena en aplicabilidad y evaluación; `otrafaena` no ve la aplicabilidad de Horcones; export sólo con `legal:export` (403 para prevfaena/otrafaena/cphs; `jt`, `sup`, `legal`, `ti` → `/forbidden`). Falla: `legal:assess` sin faena permite a un prevencionista_faena crear borradores del registro global (`:883-884`), y publicar exige a una segunda persona con `approve_applicability` que en la práctica es el administrador (RSK-10).
- **Testing:** `requisitos-legales/actions.test.ts`, `requisitos-legales/export/route.test.ts`, `prevention-risk-legal.test.ts` en verde; postgres `prevention-risk-legal-postgres.test.ts` 21/21 (incluye bloque legal). E2E `prevencion-cumplimiento-legal.spec.ts` sólo verifica que la página carga (RSK-26).
- **Integración con Programa Anual:** No acredita ninguna actividad (relación indirecta, coincide con el mapa). Al aprobar la aplicabilidad de `QA_RSK_LEG-01` en Horcones nació la obligación de 30 días «Requisito QA_RSK_LEG-01 v1» (vence 29-10-2026); desde `/prevencion/pdtp/cobertura` se vinculó a la N°19 y la obligación se cerró (DEMOSTRADO). Segregación de aplicabilidad ✅. La evaluación «Cumple» y su evidencia no llegan a la carpeta legal ni a ninguna ejecución, y la evidencia es texto libre (RSK-09).
- **Hallazgos:** 0 🔴 · 0 🟠 · 3 🟡 propios (RSK-09, 10, 11; más RSK-05 y RSK-08 compartidos con MIPER) · 🔵 RSK-16, 17, 25, 26 citados.
  - RSK-09 (🟡) — "Cumple" se acepta con un texto de 3 caracteres como evidencia — DEMOSTRADO — risk-legal.ts:181 y 191 (evidenceReference texto, mínimo 3); risk-legal.ts:110 (verificación de control, mínimo 5); prevention-risk-legal.ts:869-881 (brecha sólo si falta el texto)
  - RSK-10 (🟡) — Publicar un requisito exige a una segunda persona con approve_applicability, y sólo la jefa y el administrador lo tienen — DEMOSTRADO — prevention-risk-legal.ts:925 y 941-949; manifest.ts:858-866 (grants legales), 1222 (sign_own_work sólo prevencionista); prevention-risk-legal.ts:883-884 (crear requisito global sin faena)
  - RSK-11 (🟡) — La ficha del requisito responde "no existe" para todo lo no publicado y no muestra evaluaciones ni vínculos — DEMOSTRADO — legal-requirements-workbench.tsx:58 (todos los códigos enlazan); prevention-risk-legal.ts:1676 (sólo published/superseded); [id]/page.tsx:33-35 (no pinta assessments ni links)
- **Readiness individual: 73/100** (Funcional, requiere correcciones) — desglose `Func 17/25 · UI 14/20 · Integridad 10/15 · Programa 12/15 · Código 8/10 · Permisos 4/5 · Testing 3/5 · Errores 5/5`

### 3.17 CGRD y mapa de riesgos

**Rutas:** `/prevencion/cgrd?faena=`, `/prevencion/cgrd/mapa?mapWorksite=`; APIs `POST /api/prevencion/cgrd/evidence`, `GET /api/prevencion/cgrd/evidence/[name]`, `POST /api/prevencion/cgrd/mapa`, `GET /api/prevencion/cgrd/mapa/[name]` · **Informe detallado:** `anexos/riesgos.md`

- **UI/UX/Diseño:** `PageHeader` sin acciones, selector de faena, tarjetas, `ConfirmDialog` con motivo para disolver/terminar/quitar/anular, `EvidenceField` que sube al elegir; 0 errores de consola/red y 0 desborde. Defectos: en una faena sin órgano lo primero por hacer (designar coordinador / constituir comité) queda al final y las casillas no tienen «Registrar acta» (RSK-23); un acta registrada sólo muestra código y fecha, sin acta, quórum ni archivo, y al disolver el comité desaparecen integrantes, actas y acuerdos (RSK-14); fechas ISO crudas (RSK-28), casillas fuera de orden febrero, marzo, mayo, abril (RSK-29); mapa con `?mapWorksite=` distinto de `?faena=` y miga que pierde la faena (RSK-18).
- **Facilidad de uso:** Registrar un acta con evidencia: 7 clics y 3 campos de texto (5 sin casilla); constituir comité: 7 clics; publicar matriz: 3 clics. Fricciones: el calendario abre en el mes actual y no admite escribir la fecha (el script registró el 6-09 contra la casilla de mayo y el sistema lo aceptó, RSK-13); un mandato que termina antes de la constitución da «No se pudo completar la acción. Intenta nuevamente.» (RSK-15).
- **Funcionalidad:** 12 funciones: 8 ✅, 1 🟡, 2 🔴, 1 ❌. 🔴 Acta con el mismo archivo o contenido que otra, aceptada y auto-aprobada (RSK-01); acta sin casilla (extraordinaria) acredita y auto-aprueba la N°81 (RSK-12). ❌ Consultar acta / evidencia / historial (RSK-14). 🟡 Validar mandato posterior a la constitución: sólo CHECK de la base → error genérico (RSK-15). ✅ Designar/constituir/disolver, integrantes, matriz GRD, acta con casilla + archivo real, anular acta, rechazo de URL/ruta inexistente/otro dominio/traversal/archivo ajeno, mapa.
- **Código y lógica:** Reglas en servicio y transacción; acreditación y revocación tras el commit (`prevention-cgrd.ts:172-182, 227, 335, 917`); la N°81 usa la celda de la casilla (`:668`) y se auto-aprueba con quien registra (`pdtp-accreditation-connectors.ts:876`). `requireGrdAccess` lanza `Error` común (`prevention-cgrd-access.ts:30`) y un error de base cae al genérico (`cgrd/actions.ts:54`, RSK-15); `listGrdMeetingSlots` y `listGrdMeetings` sin `ORDER BY` (`prevention-program-slots.ts:502-507`, `prevention-cgrd.ts:945-957`, RSK-29); anulación sin subir `version` (`:878-885`, RSK-20); marcadores del mapa sin bitácora (`prevention-risk-map.ts:145-173`, RSK-19); subidas no reclamadas huérfanas (RSK-21).
- **Modelo de datos:** Comité/coordinador con índices únicos parciales de «uno activo por faena», CHECK de mandato, actas sin borrado (anulación con motivo), acuerdos → CAPA común. `prevention_evidence_uploads` registra dueño, faena y sha256 pero no impide que un mismo archivo o sha256 respalde varios actos (RSK-01).
- **Permisos y seguridad:** PRV-18 verificado (descarga por igualdad exacta: sin extensión o prefijo → 404; archivo de Biodiversa como prevfaena/cphs/jt → 404; `ti` → 403; `..%2F..%2F.env` → 400; `nosniff`); IDOR en la acción bloqueado; extensión por MIME real (M-21); POST con `Origin` ajeno → 403 (M-02); plano PDF renombrado a .png → 400, otra faena 403/404. Falla: el reúso del mismo archivo por otra persona de la faena (RSK-01) y en B existen permisos huérfanos `cgrd:matrix:review/approve` (RSK-22).
- **Testing:** `cgrd/actions.test.ts`, `cgrd/mapa/actions.test.ts`, `cgrd/mapa/route.test.ts`, `risk-map-ui-contract.test.ts` en verde; PGlite `prevention-cgrd.test.ts` y `risk-map-gc.test.ts`; postgres `prevention-cgrd-postgres.test.ts` 2/2 PASS (no skipped). E2E sólo `prevencion-cgrd-risk-map.spec.ts` (plano y marcador); nada de comité, acta ni N°79–81 ni reúso de evidencia (RSK-26).
- **Integración con Programa Anual:** Acredita **N°79** (constituir comité o designar coordinador), **N°80** (publicar matriz GRD) y **N°81** (acta). N°79 y N°80: `submitted` con archivo verificado (`provided`), quedan para otra persona; N°79 revocada (`draft`) al disolver/terminar (verificado); reemplazo de la matriz N°80 sin probar. N°81: **`approved` automático** con `executed_by = approved_by` (por diseño M0.4), evidencia verificada pero reutilizable (RSK-01). Observado: una sesión del 6-09 acreditada en mayo (RSK-13); acta sin casilla acredita (RSK-12); reusar el mismo PDF en la casilla de abril quedó `approved` con sha256 idéntico; anular actas revoca (N°81 → `draft`, casilla → «no hecha»). En el programa 2026 v2 las N°79/80/81 están planificadas antes de la activación (17-09): configuración de B, no defecto del submódulo.
- **Hallazgos:** 0 🔴 · 1 🟠 (RSK-01; el informe global de riesgos cuenta 2 🟠 con RSK-02 de MIPER) · 4 🟡 (RSK-12 a 15) · 🔵 RSK-18 a 23, 26, 27 y ⚪ RSK-28, 29 citados.
  - RSK-01 (🟠) — La N°81 se auto-aprueba con quien registra el acta y el mismo documento puede respaldar cualquier número de sesiones — DEMOSTRADO — pdtp-accreditation-connectors.ts:866-877 (autoApproveByUserId = recordedByUserId); prevention-evidence-upload.ts:126-131 (archivo ya ligado a la faena: se reutiliza sin límite); prevention-cgrd.ts:627 (claim) y 710-716; integration-evidence.ts:103-112
  - RSK-12 (🟡) — Un acta "extraordinaria" sin casilla acredita y auto-aprueba la N°81, aunque la UI dice que no cuenta — DEMOSTRADO — prevention-cgrd.ts:709-716 (acredita con o sin casilla); cgrd-workbench.tsx:619-625 ("no cuenta en el denominador"); cgrd.ts:107-111
  - RSK-13 (🟡) — Una sesión realizada en septiembre llena la casilla de mayo y se acredita como cumplida en mayo — DEMOSTRADO — lib/services/prevention-cgrd.ts:648-669 (no compara heldOn con el mes de la casilla; plannedPeriod = celda de la casilla)
  - RSK-14 (🟡) — No se puede consultar un acta, su archivo ni el historial del comité; al disolverlo, todo desaparece de la pantalla — DEMOSTRADO — cgrd-workbench.tsx:336-365 (acta = código + fecha, sin detalle ni enlace), 190-228 (sólo la última matriz, sin enlace a su evidencia); page.tsx:52 y 61-67 (sólo el comité activo)
  - RSK-15 (🟡) — El mandato que termina antes de la constitución sólo lo frena la base, con un mensaje genérico — DEMOSTRADO — cgrd.ts:20-26 (sin refine de fechas); actions.ts:54 (fallback "No se pudo completar la acción. Intenta nuevamente.")
- **Readiness individual: 62/100** (62,5; No listo: la N°81 se auto-aprueba y admite el mismo documento para varias sesiones) — desglose `Func 17/25 · UI 12/20 · Integridad 7/15 · Programa 9/15 · Código 7/10 · Permisos 4/5 · Testing 3/5 · Errores 3,5/5`

### 3.18 Plan de emergencia y simulacros

**Rutas:** `/prevencion/emergencias` (pestañas Planes/Simulacros), `/prevencion/emergencias/[planId]`; API `simulacros/evidencia` (POST y GET `[name]`) · **Informe detallado:** `anexos/emergencias.md`

- **UI/UX/Diseño:** Cumple el patrón (`PageHeader` + `PageContainer`, 1 `h1` en los 10 roles, 4 KPI, pestañas con contador, «Nuevo plan» en el header, `Badge` en español, `DatePicker`/`DateTimePicker`, tokens `-ink`); sin errores de consola ni respuestas ≥400. Detalle del plan bien seccionado, con bloqueadores de aprobación y aviso de contenido congelado. Fricciones: la tabla de simulacros no muestra fecha real, motivo de anulación ni la evidencia (EMG-07, EMG-18); anulado y cancelado se ven igual («Cancelado»), el anulado con «Satisfactorio»; «Nuevo plan» se ofrece aunque todas las faenas tengan plan vigente (EMG-23); botones «No hecha/No aplica» siguen en un plan archivado (EMG-26). Éxito sin toast; no se observó «Cargando». Detalle y diálogo «Completar simulacro» sin desborde a 1024/768/390.
- **Facilidad de uso:** Crear plan 5 clics; agregar escenario 6; agregar rol del organigrama 3; aprobar el plan (otro usuario) 2, sin confirmación; programar simulacro 4; completar simulacro con evidencia (archivo + casilla + resultado) 7; anular simulacro realizado 3.
- **Funcionalidad:** 10 funciones: 8 ✅, 1 🟡, 1 🔴. 🔴 Ver/descargar el acta: la ruta GET existe y respeta alcance pero ninguna pantalla la enlaza (EMG-07). 🟡 Subir evidencia: MIME real, 25 MB y alcance ok, pero la extensión guardada sale del nombre del cliente (EMG-13). ✅ Crear plan (uno vigente por faena), escenarios/roles/contactos, aprobación segregada, archivar (motivo ≥10), programar/completar simulacro, anular completado con revocación, casillas «No hecha/No aplica» (PGlite/postgres), recursos.
- **Código y lógica:** Servicio bien estructurado (`EmergencyDomainError`, CAS por `version`, acreditación tras el commit). Puntos: el gate de cierre cuenta filas de evidencia, no archivos existentes (`prevention-emergency.ts:900-912`, EMG-11); `cancelEmergencyDrill` no toca la CAPA ni la evidencia (`:1026-1083`, EMG-10) y resetea la casilla sin subir `version` (`:1058-1064`, EMG-25); `completeEmergencyDrill` no mira el estado del plan (`:874-882`, EMG-27); `generateStorageName(fileName)` usa la extensión del cliente (`:706`).
- **Modelo de datos:** Tablas `prevention_emergency_{plans,scenarios,roles,contacts,resources,drills,drill_evidence,drill_slots,…}` con `version`, historial propio, borrado lógico e índice parcial de plan vigente por faena; el equipo pertenece a la faena, no al plan. Sin huérfanos salvo la CAPA de un simulacro anulado.
- **Permisos y seguridad:** Alcance por faena en detalle, acciones, subida y descarga (`otrafaena` 404 en plan y evidencia, 400 al subir; `ti` 403; `cphs`/`jt` 200 en su faena; `sup`, `legal`, `ti` → `/forbidden`). Descarga `inline` sólo PDF/imagen, `nosniff`, traversal → 400. Riesgo potencial no explotado: `fileName` original con `../../../evil.html` se persiste tal cual (EMG-13).
- **Testing:** Unitarias (10 archivos / 116 PASS en el lote), PGlite (6 archivos / 77 PASS en el lote), `prevention-emergency-postgres` 23/23 PASS (no skipped). E2E existentes (`prevencion-emergencias-simulacros.spec.ts`, 30 líneas; `emergency-resource-catalog.spec.ts`) son de humo; ningún E2E de aprobar plan, completar simulacro con acta o anular (EMG-19).
- **Integración con Programa Anual:** Acredita **N°83** (plan aprobado) y **N°84** (simulacro). N°83: ejecución `submitted`, cantidad 1 (PRV-19 #16 corregido), `evidence_status = not_required` con texto «Plan de emergencia aprobado: PE-2026-FV1H2R»; autor y aprobador del plan distintos y quien la aprueba en el PDTP es otra persona (autoaprobación rechazada). Quedó en septiembre semana 4 aunque se planifica en marzo semana 1 (EMG-06); archivar el plan no revoca la N°83 (decisión PRV-04, sin aviso, EMG-12). N°84: acta PDF real + casilla m9 w3 → `approved` automático con `evidence_status = provided` y sha256; archivo borrado → `submitted` + `file_missing` (PRV-01 corregido); anular un completado → `draft`, casilla → pendiente y evento `revoked` (PRV-19 #8 corregido), aunque deja la CAPA abierta (EMG-10). Observado: los 7 planes sembrados de `bodega_dev` quedaron con N°83 en v1 y no se trasladaron a v2 (EMG-22).
- **Hallazgos:** 0 🔴 · 0 🟠 · 2 🟡 propios (EMG-06 compartido con Higiene, EMG-07) · 🔵 EMG-10 a 13, 18, 19, 22 y ⚪ EMG-23 a 27 citados; conteo global del informe de emergencias: 🔴 0 · 🟠 1 · 🟡 8 · 🔵 13 · ⚪ 5.
  - EMG-06 (🟡) — La N°83 y las N°46–49 se imputan al mes del acto, no a la celda planificada; un cumplimiento tardío no paga la celda adeudada — DEMOSTRADO (navegador + SQL en B) — pdtp-accreditation-connectors.ts:630-678 (occurredAt = approvedAt, sin plannedPeriod); hygiene-accreditation-connector.ts:213-225 (occurredAt = assessedOn); compliance.ts:1194-1197 (tope por mes)
  - EMG-07 (🟡) — El acta de un simulacro no se puede abrir desde ninguna pantalla — DEMOSTRADO — plan-detail.tsx:322-365 (tabla sin evidencia); evidence-href.ts:36-40 (el directorio prevention-drill-evidence no tiene ruta de descarga declarada); prevention-emergency.ts:1217-1223 (sólo trae el conteo)
- **Readiness individual: 84/100** (Muy próximo) — desglose `Func 21/25 · UI 17/20 · Integridad 13,5/15 · Programa 11,5/15 · Código 9/10 · Permisos 4,5/5 · Testing 3,5/5 · Errores 4/5`

### 3.19 Higiene y vigilancia

**Rutas:** `/prevencion/higiene` (Grupos, Vigilancia, Programa y protocolos, Panel anonimizado), `/prevencion/higiene/grupos/[groupId]`, `/prevencion/higiene/programas/[programId]`; API `higiene/evidence` (POST y GET `[name]`) · **Informe detallado:** `anexos/emergencias.md`

- **UI/UX/Diseño:** Estructura correcta (`PageHeader`, 4 KPI, pestañas, «Nuevo programa de vigilancia» en el header, 1 `h1`), sin errores de consola; diálogo «Nueva medición» usable a 390 px. Defectos: GES vacío «Aún no hay grupos de exposición» sin CTA (EMG-16); mensaje genérico «No se pudo completar la operación.» ante código de agente duplicado o informe reutilizado (EMG-14); el detalle del GES no enlaza el informe de cada medición (EMG-20).
- **Facilidad de uso:** Registrar una medición con informe: 6 clics/campos (valor, método, equipo, archivo que sube al elegirlo, registrar). Crear agente/GES/programa y matricular se hicieron por acción directa (no se contaron clics).
- **Funcionalidad:** 9 funciones: 5 ✅, 2 🟡, 1 🔴, 1 ❌. 🔴 Fecha de medición: acepta `2026-12-15` (EMG-02). ❌ Anular/corregir una medición: no existe servicio ni acción (EMG-08). 🟡 Pronunciamiento MINSAL con versiones: acepta fecha futura (EMG-02); descarga del informe con alcance sin enlace en el módulo (EMG-20). ✅ Catálogo de agentes, GES por faena, medición contra límite (88 dB(A) > 85 → `above_limit`, `surveillance_required = true`), informe obligatorio con ruta validada, programa de vigilancia/matrícula/asistencia/reversión.
- **Código y lógica:** `recordExposureMeasurement` lee el informe del disco y recalcula sha256 pero no liga la subida a la faena (`prevention-hygiene.ts:212-237`; no llama `claimPreventionEvidenceUpload`, `worksite_id` queda NULL); la reutilización entre faenas la impide sólo el índice único `prevention_hygiene_measurement_evidence_storage_path_unique`. El conector N°46–49 y N°50 no pasa `actorUserId` al motor (`hygiene-accreditation-connector.ts:213-225`, `:254-269`, EMG-01) aunque la N°45 sí (`:152`). Sin validación de fecha futura en `measuredOn`, `lastAssessedOn` ni `attendedOn` (`lib/validation/prevention-module/hygiene.ts:22,33`; `prevention-hygiene.ts:777`).
- **Modelo de datos:** Límite y nivel de acción congelados por medición; evidencia 1:N con estado; casillas N°45 con `FOR UPDATE`; matrículas con índice único (programa, persona, vencimiento) y renovación automática. Sin borrado ni anulación de mediciones: un valor erróneo fija `surveillance_required` para siempre (EMG-08).
- **Permisos y seguridad:** `manage` global vs `assess`/`measure` por faena funciona (DEMOSTRADO); alcance en lectura, escritura y descarga correcto (prevfaena/cphs/jt 200, otrafaena 404, ti 403; `sup`, `legal`, `ti` → `/forbidden`). Extensión desde el MIME detectado (M-21 corregido en higiene). `Content-Disposition: inline` para todo tipo servido, mitigado por `nosniff` y tipos acotados. Falla: N°46–50 sin segregación (EMG-01).
- **Testing:** Unitarias `prevention-hygiene-calc`, `hygiene-accreditation-connector.test.ts`, `hygiene-dialogs.test.tsx` (PASS en el lote de 116); PGlite `prevention-hygiene-pdtp-accreditation` (PASS en el lote de 77); `prevention-hygiene-postgres` 15/15 PASS. E2E `prevencion-salud-ocupacional.spec.ts` (29 líneas) sólo carga el panel. Nada prueba fechas futuras ni el actor de N°46–50.
- **Integración con Programa Anual:** Acredita **N°45** (medición), **N°46–49** (pronunciamientos MINSAL) y **N°50** (asistencia a vigilancia); N°44 es constancia manual. N°45 con informe: auto-aprobada con evidencia verificada, pero en `pdtp-2026-v1` (cerrado) porque la celda planificada cae en la ventana de la versión anterior (EMG-09); una medición fechada 2026-12-15 quedó aprobada automáticamente en diciembre semana 3 (EMG-02). N°46–49 y N°50: `submitted` con `executed_by = NULL`; `prev` aprobó su propio pronunciamiento y su propia asistencia (EMG-01). Revocación: retirar un pronunciamiento revoca la versión inmediata anterior; corregir asistencia a ausente revoca (`draft`); la aprobación de celdas futuras queda bloqueada por la guarda de PRV-03. Reutilizar el mismo PDF en otra faena es rechazado (PRV-21).
- **Hallazgos:** 0 🔴 · 1 🟠 · 4 🟡 (EMG-02, 08, 09 y EMG-06 compartido con Plan de emergencia) · 🔵 EMG-14, 16, 20, 22 y ⚪ EMG-24 citados.
  - EMG-01 (🟠) — Las ejecuciones N°46–49 (protocolos MINSAL) y N°50 (vigilancia) no guardan actor: quien hizo el pronunciamiento o registró el control aprueba su propio cumplimiento (PRV-02 sigue abierto aquí) — DEMOSTRADO — hygiene-accreditation-connector.ts:213-225 (safeAccredit sin actorUserId, aunque lo recibe en :190) y :233-269 (onSurveillanceControlAttended sin actor); prevention-hygiene.ts:870-878; executions.ts:579 (compara sólo executedByUserId)
  - EMG-02 (🟡) — Mediciones, pronunciamientos y controles con fecha futura acreditan celdas futuras; la N°45 queda aprobada automáticamente — DEMOSTRADO — hygiene.ts:33 (measuredOn sin cota), :22 (lastAssessedOn); prevention-hygiene.ts:777 (attendedOn); accreditation.ts:567-660 (sin guarda de semana futura para integraciones)
  - EMG-08 (🟡) — Una medición no se puede anular ni corregir, aunque acredita la N°45 y fija la obligación de vigilancia — CÓDIGO (no existe función) — prevention-hygiene.ts:414-540 (sólo alta); actions.ts:1-103 (sin acción de anulación)
  - EMG-09 (🟡) — Una casilla planificada antes de la revisión v2 acredita en la versión v1 cerrada; el programa activo no ve el cumplimiento — DEMOSTRADO — prevention-hygiene.ts:530 (plannedPeriod de la casilla); version-window.ts:240-252 (un programa `closed` por reemplazo acepta su ventana)
- **Readiness individual: 76/100** (Funcional, requiere correcciones) — desglose `Func 21/25 · UI 16,5/20 · Integridad 11/15 · Programa 7/15 · Código 9/10 · Permisos 4,5/5 · Testing 3,5/5 · Errores 3,5/5`

### 3.20 Permisos de trabajo (PTAR/LOTO)

**Rutas:** `/prevencion/permisos`, `/prevencion/permisos/[permitId]`, acuse público de cuadrilla (enlace con token), `app/api/prevencion/permisos/export/route.ts` · **Informe detallado:** `anexos/emergencias.md`

- **UI/UX/Diseño:** Estructura correcta (4 KPI, filtros estado/faena, «Exportar Excel» y «Nuevo permiso» en el header, detalle con bloques AST/Controles/LOTO/Mediciones/Cuadrilla, bloqueadores de habilitación visibles, estados en español). Fricciones: `<input type="datetime-local">` nativo (`permit-dialogs.tsx:252,255`; `permit-detail.tsx:568,861`), «Peligro MIPER de origen» pide pegar un ID interno (`permit-dialogs.tsx:246`) y el supervisor viene preseleccionado (EMG-15); el detalle no muestra quién aprobó ni habilitó; catálogo vacío sin CTA y sin «Nuevo permiso» para roles de faena (EMG-16); a 390 px las tablas LOTO y Mediciones esconden el estado y el botón «Aplicar/Retirar» tras scroll interno (EMG-17).
- **Facilidad de uso:** Solicitar y habilitar un permiso LOTO completo: 52 clics/campos entre 2 personas (crear con cuadrilla de 2 y 2 controles 12; AST 5; enviar a aprobación 3; aprobar 3; verificar 2 controles 7; aislamiento registrar + aplicar 10; medición 7; habilitar 3; más 2 navegaciones). El AST, los controles y el LOTO no se pueden precargar desde el tipo.
- **Funcionalidad:** 11 funciones: 7 ✅, 2 🔴, 2 🟡. 🔴 Control obligatorio «no aplica»: «n/a» (3 caracteres) habilitó P1 (EMG-03); aplicar aislamiento en permiso terminado: P2 cancelado → aplicar → ok (EMG-04). 🟡 Cierre sólo con LOTO retirado: suspendido → cancelado con candado aplicado se permite (EMG-04); extensión: el solicitante con `approve` extiende su propio permiso (EMG-05). ✅ Catálogo de tipos, solicitud + AST + cuadrilla, aprobación segregada, habilitación recalculada en servidor, suspensión, acuse de cuadrilla (enlace no probado), exportación Excel (6 hojas).
- **Código y lógica:** Única puerta de estado (`transitionWorkPermit`), readiness recalculada al habilitar, CAS por `version`. Brechas: el chequeo de LOTO sólo corre para `closed` (`prevention-permits.ts:607-617`) aunque `suspended → cancelled` existe (`lib/prevention/permits.ts:68`); `applyPermitIsolation` no mira el estado del permiso (`:385-407`); `extendWorkPermit` no compara con `requestedByUserId` (`:645-676`); el motivo de «no aplica» sólo exige no vacío (`validation/.../permits.ts:80-84`) y la regla acepta N/A en obligatorios (`lib/prevention/permits.ts:185-191`).
- **Modelo de datos:** `prevention_work_permits` con CHECK de consistencia por estado, controles, aislamientos (aplicado/retirado con actor), mediciones con `within_range` persistido, cuadrilla con sello sha256 del acuse. Estado inconsistente demostrado: permisos `cancelled` con aislamientos `applied_at` no nulo y `removed_at` nulo (P1 y P2).
- **Permisos y seguridad:** Segregación de aprobación y alcance por faena demostrados (prevfaena solicita P2 y no puede aprobarlo; jt sin permiso → «No tienes permisos»; `otrafaena` 404; `supervisor_terreno` sin ningún permiso). Falla: hueco de segregación en extensión (EMG-05), que contradice la descripción del propio permiso (`manifest.ts:226`). Export sólo para roles globales (EMG-21).
- **Testing:** Unitarias `prevention-permits-calc`, `permit-dialogs.test.tsx` (PASS en el lote de 116); PGlite `prevention-permit-crew-ack-blocker`, `prevention-permit-workflow-gates-pglite` (PASS en el lote de 77); `prevention-permits-postgres` 22/22 PASS. E2E `prevencion-ptar-loto.spec.ts` (42 líneas): sólo bandeja y exportación, sin ciclo de vida ni 390 px. No recorridos: acuse público por enlace y suspensión automática por vencimiento.
- **Integración con Programa Anual:** No acredita ninguna actividad y no debería: el programa 2026 v2 real (89 actividades) no tiene actividad de permisos de trabajo, LOTO ni PTAR (las más cercanas, N°43 y N°39–41, no se cumplen con un permiso); coincide con el mapa («Brecha, sin actividad PDTP directa»). Relación indirecta: vínculo opcional al peligro MIPER, validado contra la MIPER vigente de la misma faena pero ingresado como ID crudo (EMG-15). Segregación y revocación: no aplican.
- **Hallazgos:** 0 🔴 · 0 🟠 · 3 🟡 (EMG-03, 04, 05) · 🔵 EMG-15, 16, 17, 21 citados.
  - EMG-03 (🟡) — Un control obligatorio se da por cumplido declarándolo «no aplica» con 3 caracteres, por el mismo verificador y sin revisión; el permiso se habilita — DEMOSTRADO — permits.ts:185-191; validation/permits.ts:80-84 (sólo no vacío); permit-detail.tsx:696 (minLength=3)
  - EMG-04 (🟡) — Un permiso puede terminar (cancelado) con candados aplicados, y se puede aplicar un aislamiento en un permiso ya terminado — DEMOSTRADO — prevention-permits.ts:607-617 (el chequeo de LOTO sólo para closed), :385-407 (applyPermitIsolation sin guarda de estado); permits.ts:68 (suspended → cancelled)
  - EMG-05 (🟡) — El solicitante que tiene permiso de aprobar puede extender su propio permiso — DEMOSTRADO — prevention-permits.ts:645-676; manifest.ts:226 (descripción del permiso: extender de forma segregada)
- **Readiness individual: 79/100** (Funcional, requiere correcciones) — desglose `Func 19/25 · UI 14/20 · Integridad 12/15 · Programa 13/15 · Código 9/10 · Permisos 4/5 · Testing 3,5/5 · Errores 4,5/5`

### 3.21 Comités paritarios (CPHS)

**Rutas:** `/prevencion/cphs`, `/prevencion/cphs/[committeeId]`, `/prevencion/cphs/[committeeId]/programa`, `/prevencion/cphs/[committeeId]/certificacion` · **Informe detallado:** `anexos/comites.md`

- **UI/UX/Diseño:** Estructura correcta (`PageHeader` y `PageContainer`, un solo botón «Nuevo» con elección Comité/Revisión, alerta de faenas sobre 25 trabajadores sin comité con CTA, búsqueda del TopBar, estados con `Badge`, mensajes de quórum y paridad claros). Defectos: los 4 KPI no son accionables (CPH-14); el acta cerrada sólo muestra «ACTA CERRADA · 2 / 2 · 0 acuerdos», sin texto, asistencia nominal, excusas ni acuerdos (CPH-03); diálogos que se cierran sin toast (CPH-15); fechas ISO crudas y texto técnico «Sin trabajo del Programa Preventivo pendiente en cphs.» (CPH-32); «Quórum: 2 de 1 requeridos» (CPH-33); pestaña «Revisión por la dirección (0)» visible sin permiso (CPH-37). Sin desborde a 1440/1024/768/390; no se observó Cargando ni Error.
- **Facilidad de uso:** Constituir comité: 5 clics + texto (el DatePicker de «Mandato hasta» a 2 años exige ~24 clics, CPH-16); agregar 2 integrantes: 14; registrar una sesión con acta: 6 + 2 textos (no se puede registrar una sesión pasada sin convocarla antes); aprobar la N°11: 3 + motivo; revisión por la dirección: 7 + textos («Toda la organización» por defecto no avisa que no acredita la N°9, CPH-05); disolver: 2 + motivo.
- **Funcionalidad:** 12 funciones: 9 ✅, 1 🟡, 2 ❌. ❌ Consultar el acta cerrada (`committee-detail.tsx:75-91`, CPH-03); anular una revisión cerrada (no existe; la N°9 acreditada no tiene revocación). 🟡 Validez de composición (3+3, suplentes, cargos): se informa pero no bloquea sesiones ni actas (CPH-20).
- **Código y lógica:** Buen diseño (`requireCphsAccess`, bloqueo optimista por `version`, estados en el `WHERE`, mensajes de índices únicos mapeados; M-10 corregido en `prevention-cphs-access.ts:48-51`). `constituteCommittee` y `createManagementReview` escriben fila e historial fuera de una transacción (`prevention-cphs.ts:70-80`, `904-914`, CPH-18); el detalle carga todas las sesiones del alcance (máx. 300) y filtra en memoria (`[committeeId]/page.tsx:39-49`, `prevention-cphs.ts:1093`, CPH-17, TEÓRICO); comentario obsoleto «actividad 14» (`:986`, CPH-35).
- **Modelo de datos:** `prevention_committees` con índice único parcial de comité activo por faena, `…_members`, `…_meetings`, `…_attendance`, `…_agreements` (estado en su CAPA), `…_commissions`, `…_programs`/`…_activities`, `prevention_management_reviews`; sin borrado físico, con historial. `constitutedOn` es texto `YYYY-MM-DD` y viaja al PDTP como `occurredAt` sin hora (CPH-02).
- **Permisos y seguridad:** Alcance por faena en cada mutación y en la lectura (`otrafaena` → «No encontramos este registro»; `ti`, `legal`, `sup` → `/forbidden`); sin XSS. Falla: el rol `cphs` (integrante del comité) tiene `cphs:manage` y en A puede constituir, disolver, agregar/reemplazar integrantes y registrar ante la DT (CPH-04); los responsables de la N°9 (`gerente_legal_rrhh`, `jdpr`, `prf`) no tienen `governance:review` (CPH-05).
- **Testing:** Unit 162 PASS (18 archivos), PGlite 69 PASS, `prevention-cphs-postgres` 20 PASS (0 skipped) y sonda PGlite propia de 5 casos. E2E `prevencion-cphs*.spec.ts` leídos (carga, alerta de brecha, ciclo de vida, madurez); sin E2E de constitución, cierre de acta con quórum, revisión por la dirección, integración N°9/N°11 ni segregación (CPH-31).
- **Integración con Programa Anual:** Acredita la **N°11** al constituir y la **N°9** con la revisión por la dirección de una faena; las sesiones no acreditan (la N°13 salió del catálogo). N°11: `submitted`, `origin=integration`, `executed_by=qa-prev`, `evidence_status=pending`; quien constituyó no puede aprobar (PRV-02 corregido) y prev2 aprueba con motivo. Revocación: disolver revoca la N°11 directa (`draft` + evento `revoked`) pero no la obligación `organizacion_preventiva` (queda `reported`; la constitución genera dos ejecuciones N°11, CPH-01). N°9: la revisión corporativa (opción por defecto) no acredita nada (`prevention-cphs.ts:988`, CPH-05). `constitutedOn=2026-09-01` acredita en agosto semana 4 (CPH-02); constitución y revisión con fecha futura acreditan en diciembre `submitted` (CPH-06).
- **Hallazgos:** 0 🔴 · 0 🟠 · 6 🟡 (CPH-01 a 06) · 🔵 CPH-14 a 20 y ⚪ CPH-32, 33, 35, 37 citados; conteo global del informe de comités: 🔴 0 · 🟠 0 · 🟡 13 · 🔵 18 · ⚪ 6.
  - CPH-01 (🟡) — Disolver o vencer el comité (o terminar un delegado) no revoca la N°11 que cuenta; la constitución crea dos ejecuciones para el mismo hecho — DEMOSTRADO (sonda PGlite, probe-result.txt) — prevention-cphs.ts:84-99 (acredita + reporta obligación), 185-195 (revoca sólo sourceType "cphs"), 1045-1052 (vencimiento, ídem); preventive-organization-connector.ts:187-209; prevention-cphs-organization.ts:158-195 (endDelegate sin revocación)
  - CPH-02 (🟡) — Las fechas civiles (constitución, designación) se sellan a medianoche UTC y la N°11 del día 1 se imputa al mes anterior — DEMOSTRADO (sonda PGlite) — pdtp-accreditation-connectors.ts:303,312 (occurredAt: constitutedOn); prevention-cphs.ts:88,97; prevention-cphs-organization.ts:146; accreditation.ts:197-205 (new Date(occurredAt) + formato Chile)
  - CPH-03 (🟡) — El acta cerrada no se puede consultar: texto, asistencia nominal, excusas y acuerdos no se muestran en ninguna pantalla ni exportación — DEMOSTRADO — committee-detail.tsx:75-91 (MeetingInfo sin minutes/asistentes), 237-292 (fila sin enlace); page.tsx:98-113
  - CPH-04 (🟡) — El rol "cphs" (integrante del comité) puede constituir, disolver y recomponer el comité, y designar delegado — DEMOSTRADO (A, cphs-role.mjs) — modules/prevention/manifest.ts:1129-1130 (cphs → cphs:view y cphs:manage); descripción del permiso en 239
  - CPH-05 (🟡) — La revisión corporativa (opción por defecto) no acredita la N°9, y dos de sus tres responsables no tienen el permiso para registrarla — DEMOSTRADO (B) — prevention-cphs.ts:988-995 (sólo si review.worksiteId); cphs-dialogs.tsx:88,115-116 (default "_all" = Toda la organización); manifest.ts:1136,1141,1144 (governance:review sólo prevencionista, jefa_chome, administrador)
  - CPH-06 (🟡) — Se aceptan constitución y revisión por la dirección con fecha futura, y acreditan en celdas futuras — DEMOSTRADO (sonda PGlite) — prevention-cphs.ts:54-64 (constitutedOn sólo regex), 893-898 (heldAt sin cota); accreditation.ts:560-622 (sin guarda de futuro en la vía de integración)
- **Readiness individual: 72/100** (Funcional, requiere correcciones) — desglose `Func 20,5/25 · UI 14,5/20 · Integridad 10/15 · Programa 9/15 · Código 8,5/10 · Permisos 2/5 · Testing 3,5/5 · Errores 4/5`

### 3.22 Estructura preventiva de la faena

**Rutas:** `/prevencion/faenas`, `/prevencion/faenas/[worksiteId]` · **Informe detallado:** `anexos/comites.md`

- **UI/UX/Diseño:** Lista con KPI accionables que filtran la tabla (`worksite-organization-list.tsx:59-64`), nombre de faena y comité enlazados, badge «AL DÍA»/«BRECHA» y detalle en lenguaje de usuario; ficha con dotación activa y declarada, órgano exigible, prevencionista, comité y delegado. Defectos: en una faena que exige comité (26 trabajadores) la acción primaria verde es «Designar delegado» y «Ir a CPHS» es secundaria; designar un delegado allí no cierra la N°11 y no se advierte (CPH-21); `otrafaena` recibe «No encontramos este registro» con HTTP 200 (CPH-36). Sin desborde a 390.
- **Facilidad de uso:** Designar delegado: 4–5 clics (1 clic + persona + fecha + Designar); registrar la DT: 2 clics + fecha + folio. Se entiende qué exige la dotación.
- **Funcionalidad:** 6 funciones: 5 ✅, 1 🟡. 🟡 Terminar período con motivo: no re-evalúa la brecha hasta el barrido diario ni revoca (CPH-01, CPH-22). ✅ Umbrales >25 comité / 10–25 delegado / <10 ninguno, lista y ficha con alcance, designar delegado, registro ante la DT, barrido de la obligación N°11 (PGlite 8 casos PASS).
- **Código y lógica:** Lectura agregada en 4 consultas para toda la lista (`prevention-cphs-organization-read.ts:48-115`), compartida con el barrido, de modo que la brecha de la pantalla y la que abre la obligación son la misma; M-10 corregido en `faenas/[worksiteId]/page.tsx:30`; dotación declarada junto a la del padrón sin elegir en silencio.
- **Modelo de datos:** `prevention_worksite_delegates` con versión y estado `active`/`ended`, motivo, sin borrado físico. Fechas civiles con el mismo defecto de zona horaria que CPHS (CPH-02).
- **Permisos y seguridad:** Alcance en servidor (`requireCphsAccess` con `worksiteId`); `otrafaena` no ve Horcones ni `ws-e2e`; `ti`, `legal`, `sup` → `/forbidden`. Falla: el rol `cphs` puede designar delegado y registrar la DT (CPH-04).
- **Testing:** PGlite de organización PASS; unit `prevention-cphs-organization.test.ts` y `worksite-profile.test.tsx` PASS. Sin E2E de designar ni terminar delegado (CPH-31).
- **Integración con Programa Anual:** Acredita la **N°11** por obligación (sonda PGlite): con 30 trabajadores el barrido abre 1 obligación y la constitución la deja `reported`; con 15, designar delegado la deja `reported`; con 41 + delegado sigue `pending`. Terminar delegado o disolver deja la obligación `reported` y el barrido siguiente abre un episodio nuevo (CPH-01). En B no hay obligaciones N°11 porque el cron no corrió; Cholguan (41 trabajadores) figura con brecha en pantalla. Evidencia y segregación: no informadas para este submódulo.
- **Hallazgos:** 0 🔴 · 0 🟠 · 0 🟡 propios (aplican CPH-01, CPH-02 y CPH-04 detallados en CPHS) · 🔵 propios CPH-21 y CPH-22 y ⚪ CPH-36 citados.
  - CPH-01 (🟡) — Disolver o vencer el comité (o terminar un delegado) no revoca la N°11 que cuenta; la constitución crea dos ejecuciones para el mismo hecho — DEMOSTRADO (sonda PGlite, probe-result.txt) — prevention-cphs.ts:84-99 (acredita + reporta obligación), 185-195 (revoca sólo sourceType "cphs"), 1045-1052 (vencimiento, ídem); preventive-organization-connector.ts:187-209; prevention-cphs-organization.ts:158-195 (endDelegate sin revocación)
  - CPH-02 (🟡) — Las fechas civiles (constitución, designación) se sellan a medianoche UTC y la N°11 del día 1 se imputa al mes anterior — DEMOSTRADO (sonda PGlite) — pdtp-accreditation-connectors.ts:303,312 (occurredAt: constitutedOn); prevention-cphs.ts:88,97; prevention-cphs-organization.ts:146; accreditation.ts:197-205 (new Date(occurredAt) + formato Chile)
  - CPH-04 (🟡) — El rol "cphs" (integrante del comité) puede constituir, disolver y recomponer el comité, y designar delegado — DEMOSTRADO (A, cphs-role.mjs) — modules/prevention/manifest.ts:1129-1130 (cphs → cphs:view y cphs:manage); descripción del permiso en 239
- **Readiness individual: 86/100** (Muy próximo; redondeo de 86,5) — desglose `Func 22,5/25 · UI 17,5/20 · Integridad 12/15 · Programa 12/15 · Código 9,5/10 · Permisos 4/5 · Testing 4/5 · Errores 5/5`

### 3.23 Visitas y coordinación

**Rutas:** `/prevencion/coordinacion`, `/prevencion/coordinacion/[id]` · **Informe detallado:** `anexos/comites.md`

- **UI/UX/Diseño:** Lista con filtros tipo/faena, aviso de reciprocidad del art. 20, badge Abierta/Cerrada y medidas «n/m abiertas». Defectos: «Registrar interacción» es un botón de toolbar dentro del contenido y no una acción del `PageHeader` (regla 5 / A3), `EmptyState` sin CTA (A4) y sin toast (CPH-23); el detalle no muestra documentos, evidencia ni estado de la N°20 (CPH-07/10); el botón de envío «Cerrar» comparte nombre accesible con la X del diálogo (CPH-34); a 390 px la tabla no tiene tarjetas y a 1440 la columna «Acciones» se corta (CPH-25).
- **Facilidad de uso:** Registrar coordinación con mandante: 6 clics + 3 textos; con contratista: 8 (hay que cambiar el tipo de contraparte); cerrar: 2 + resultado, sin indicación de qué pasa con la N°20; adjuntar el acta de la reunión: imposible desde la UI (CPH-07).
- **Funcionalidad:** 8 funciones: 4 ✅, 1 🟡, 3 ❌. ❌ Editar, anular o reabrir una interacción (el mensaje «reábrela para agregar medidas», `:135`, promete una función inexistente, CPH-09); adjuntar acta o correo (el card de vínculos no ofrece `external_engagement`, `documentacion/[id]/document-links-card.tsx:16-25`, CPH-07); exportar (no existe ni se promete). 🟡 Fecha de la interacción: acepta futura (`COORD-YQ4VTBMN` el 2026-12-15, CPH-08).
- **Código y lógica:** Servicio corto con alcance y bloqueo optimista. Si falla la búsqueda del documento vinculado el conector usa la referencia como evidencia y deja log (`external-engagement-accreditation-connector.ts:71-93`). Patrón M-10 sin corregir: `try { … } catch { notFound() }` en `coordinacion/[id]/page.tsx:40-41` (CPH-24); RUT de contraparte sin validar (`external-engagements.ts:19`, CPH-26).
- **Modelo de datos:** `prevention_external_engagements` con `version`, `closedAt`/`closedBy` y CHECK de referencia para fiscalización; medidas en CAPA sin tabla espejo. Sin estado anulado ni fecha de corrección: el cierre es irreversible (CPH-09).
- **Permisos y seguridad:** `engagement:view/manage` para prevencionista, prevencionista_faena, admin_contrato y administrador; `jefa_chome` sólo `view`; `cphs`, `jt`, `ti`, `legal`, `sup` → `/forbidden`. Alcance por faena en servidor (`otrafaena` → 404 en Horcones). Falla: con archivo verificado la N°20 la firma quien cerró la interacción (`autoApproveByUserId = actorUserId = closedByUserId`, `connector:177-178`; decisión M0.4, sin segunda persona, CPH-08).
- **Testing:** PGlite del conector (9 casos) PASS (filtros kind/contraparte, acta vinculada, constancia diferida y replay). No hay unit de UI ni E2E de coordinación (CPH-31).
- **Integración con Programa Anual:** Acredita la **N°20**. En B la N°20 es `mechanism = constancia`: cerrar con mandante deja el evento `rejected` con `deferredReason = mechanism_constancia` (PRV-22 parcial) y sin aviso al usuario; con contratista no genera evento (CPH-10). Sonda PGlite con N°20 = enganche: acta vinculada con archivo real y sha256 → `approved` por quien cerró; misma con fecha 2026-12-15 → `approved` en diciembre; documento `archivado` → `approved`; fila sin archivo → `submitted` con `file_missing`; referencia `https://drive…` → `submitted` y el mismo usuario no puede aprobarla (PRV-02). Replay idempotente por clave del libro (`fulfillment.ts:128-190`). Revocación: no aplica (no hay anulación, CPH-09).
- **Hallazgos:** 0 🔴 · 0 🟠 · 4 🟡 (CPH-07 a 10) · 🔵 CPH-23 a 26 y ⚪ CPH-34 citados.
  - CPH-07 (🟡) — No hay forma, desde la interfaz, de adjuntar el acta o el correo a una coordinación; la N°20 nunca llega con evidencia verificada — CÓDIGO (líneas citadas) — document-links-card.tsx:16-25 (8 tipos, sin external_engagement) y 116-122 (pide "Identificador exacto"); links.ts:39 (el servidor lo acepta); coordinacion/[id]/page.tsx:59-80 (sin sección de documentos)
  - CPH-08 (🟡) — Una coordinación con fecha futura y archivo real se auto-aprueba en el mes futuro; también con documento archivado; la aprobación la firma quien cerró — DEMOSTRADO (sonda PGlite) — external-engagements.ts:20 (occurredOn sólo regex); accreditation.ts:560-622 y 902-930 (inserta approved sin isPdtpCellInFuture); integration-evidence.ts:125-137 (no mira sst_documents.status); connector:177-178
  - CPH-09 (🟡) — Una interacción no se puede editar, anular ni reabrir: un error de registro o de cierre deja la N°20 acreditada sin vía de revocación — CÓDIGO (líneas citadas) — actions.ts:36-52 (sólo crear, medida, cerrar); prevention-external-engagements.ts:135 (mensaje "reábrela"), 170-241
  - CPH-10 (🟡) — Mientras la N°20 sea "constancia" (así está en la copia real), cerrar la coordinación la difiere sin decirle nada al usuario y la N°20 sigue exigiendo el registro en Constancias — DEMOSTRADO (B) — connector:182-197; workbench:401-436 (el diálogo de cierre no informa efecto PDTP)
- **Readiness individual: 70/100** (Funcional, requiere correcciones en el límite; redondeo de 69,5) — desglose `Func 18,5/25 · UI 13,5/20 · Integridad 10/15 · Programa 7/15 · Código 9/10 · Permisos 4,5/5 · Testing 3/5 · Errores 4/5`

### 3.24 Indicadores SST

**Rutas:** `/prevencion/indicadores`, `/api/prevencion/indicadores/export` · **Informe detallado:** `anexos/comites.md`

- **UI/UX/Diseño:** `PageHeader` con «Exportar Excel», 4 KPI accionables que llevan a incidentes filtrados, pestañas Cálculo / Denominadores / Datos del sistema anterior, aviso con CTA «Cargar dotación y HH», fórmulas visibles; sin desborde (la tabla mensual hace scroll interno a 390). Defectos: jerga «Motor canónico · fórmula ds44-art73-2026-v3» y semestre sin nombre de la tasa (CPH-32); KPI «Frecuencia · Octubre» toma un mes futuro (CPH-12); un mes con 0 HH aprobado se muestra como «—» y cuenta en «Faltan denominadores» (CPH-13); `?year=1999` → «Algo salió mal» con HTTP 200 y React #441 en consola (CPH-28). Regla A5b cumplida (eje doble en `dashboard-charts.tsx:291-330`).
- **Facilidad de uso:** Cerrar el mes de una faena sin accidentes: ≈18 clics y 3–4 personas (preparar denominador 5 + 2 clics y 4 textos; aprobar denominador 2 + 2; cerrar período 2 + 2; aprobar la N°7 en Aprobaciones 3, con tercera persona). No hay botón «Reabrir»: se reabre corrigiendo un denominador aprobado o reclasificando un caso (CPH-30).
- **Funcionalidad:** 10 funciones: 5 ✅, 3 🟡, 2 🔴. 🔴 Cerrar un mes futuro (octubre cerrado el 29-09, CPH-12); mes con 0 HH que no cierra nunca (CPH-13). 🟡 Evidencia del denominador como texto libre (CPH-29); cifras del Excel distintas de la pantalla en períodos provisionales (CPH-11); etiquetas del Excel con estados e IDs crudos (CPH-27). El cálculo canónico coincide con el cálculo a mano (p. ej. gravedad S2 confirmada 1.224,49 y provisional 1.428,57): la diferencia es de presentación.
- **Código y lógica:** Motor único y puro (`safety-indicators-calc.ts`), snapshot con hash de fuentes, revocación por la misma clave del cierre (`indicadores:${snapshotId}`), `sanitizeCell` contra inyección de fórmulas. `closeSafetyIndicatorPeriod` no comprueba `indicadores:close` por sí mismo (lo hace la acción, `actions.ts:47`); `new Date().getFullYear()` en `page.tsx:27` y `route.ts:37` (CPH-35).
- **Modelo de datos:** `safety_indicator_denominators` (versión, estado, conciliación, aprobador), `safety_indicator_periods` (`closed`/`reopened` con motivo) y `safety_indicator_snapshots` (`approved`/`superseded`); la tabla legado `safety_indicators` se conserva sólo para comparar; sin borrado físico.
- **Permisos y seguridad:** Alcance por faena en lectura (`listVisibleWorksites`) y mutaciones (`requireIndicatorAccess`); export con 401/403 y alcance demostrados (`otrafaena` sólo «Faena Restringida», `prevfaena` sólo «Faena E2E», `ti` 403); `close` sólo prevencionista, prevencionista_faena y administrador; `ti`, `jt`, `sup`, `legal` → `/forbidden`. Segregación: no puedes aprobar un denominador que preparaste tú. Sin fallas de seguridad.
- **Testing:** Unit (calc, close, dashboard, diálogo, route) PASS; PGlite `pdtp-indicators-reopen-revocation` PASS; `prevention-indicators-postgres` 4 PASS. E2E leídos: carga + export (`prevencion-indicadores-export.spec.ts`) y HH por rol (`indicadores-hh-por-rol.spec.ts`); sin E2E de cierre, reapertura ni N°7 (CPH-31).
- **Integración con Programa Anual:** Acredita la **N°7** al cerrar el período: agosto cerrado el 29-09 → N°7 agosto semana 4 `submitted` (resuelta a la v1, dueña del período), septiembre → septiembre; `prev2` aprueba con motivo porque la evidencia es un texto. Segregación: quien cierra no aprueba la N°7 (PRV-02 corregido). Revocación: reabrir agosto devuelve la N°7 aprobada a `draft` con `revocationReason` (PRV-04 corregido). Observado: octubre cerrado por adelantado deja una N°7 `submitted` que no aparece en Aprobaciones (CPH-12); julio con 0 HH no puede cerrarse (CPH-13).
- **Hallazgos:** 0 🔴 · 0 🟠 · 3 🟡 (CPH-11 a 13) · 🔵 CPH-27 a 30 y ⚪ CPH-32, 35 citados.
  - CPH-11 (🟡) — La pantalla y el Excel muestran cifras distintas para el mismo período provisional, sin rotularlo — DEMOSTRADO (A, ind-A.mjs + openpyxl) — dashboard:44-46 (metricValue usa provisional si status=provisional), 97-100, 143-147; route.ts:59-67, 79-83, 93-97 (siempre confirmed)
  - CPH-12 (🟡) — Se puede aprobar un denominador de un mes futuro y cerrar ese mes: queda un snapshot "cerrado" y una N°7 del futuro — DEMOSTRADO (B) — safety-indicators.ts:34-37, 88-93 (sin cota de fecha); prevention-indicadores.ts:616-714, 835-885; dashboard:61-65 (latestMonth = último con denominador), 144 (botón Cerrar si reconciled)
  - CPH-13 (🟡) — Un mes con 0 horas trabajadas declarado y aprobado no puede cerrarse nunca, y la N°7 de ese mes queda imposible de cumplir — DEMOSTRADO (B, julio Horcones) — safety-indicators-calc.ts:323-329 (workedHours 0 → non_calculable); prevention-indicadores.ts:760-763; dashboard:75-76 y 144 (lo trata como "falta denominador"; no muestra Cerrar)
- **Readiness individual: 79/100** (Funcional, requiere correcciones) — desglose `Func 20,5/25 · UI 16/20 · Integridad 10,5/15 · Programa 10/15 · Código 9/10 · Permisos 5/5 · Testing 4/5 · Errores 4/5`

### 3.25 Registro documental y acuse público

**Rutas:** `/prevencion/documentacion`, `/[id]`, `/papelera`, `/regularizacion`; `/acuse/[kind]/[targetId]/[token]` (pública); API `app/api/prevencion/documentacion/**` · **Informe detallado:** `anexos/documental.md`

- **UI/UX/Diseño:** Cumple el patrón (`PageHeader` y `PageContainer`, acciones «Nueva carpeta», «Subir documento», «Papelera», «Regularización» en el header, búsqueda del TopBar, tabla y grilla); sin desborde a 1440 ni a 390 px, 0 errores de consola y 0 respuestas ≥400. Subida tipada clara (declara tipo y faena, avisa si queda vigente o borrador, muestra el efecto sobre N°19/N°18), acuse público a 390 px mínimo y legible. Fricciones: no hay cola de pendientes de revisar/aprobar/publicar ni filtro por estado ni avisos, y «N por revisar» es texto muerto (DOC-07); botones que el servidor rechaza (DOC-13); errores silenciosos (DOC-08); carpetas ordenadas lexicográficamente («10_Mejora» antes que «4_Contexto», DOC-18); panel «Actividades programadas» dice «Sin trabajo del Programa Preventivo pendiente» en B (DOC-09). No verificado: sin resultados de búsqueda, Cargando, anchos 1024 y 768.
- **Facilidad de uso:** Subir un documento tipado: 4–6 clics. Subir y publicar una versión nueva: ≥7 clics en 3–4 sesiones (4 + diálogo del SO para el autor, 1 para revisar, 1 para aprobar, 1 para publicar), sin que nadie reciba aviso de que le toca su paso (DOC-07).
- **Funcionalidad:** 14 funciones: 6 ✅, 8 🟡. 🟡: carga masiva (para faena falla sin motivo en la raíz, DOC-08); ciclo borrador → revisión → aprobación → publicación con autorrevisión permitida (DOC-02); observar/devolver a borrador (sólo código y tests); distribución/exención/acuse (a quien no puede acusar, DOC-05; exención de 3 caracteres, DOC-01); vínculos a entidades (no ejecutado); archivar/papelera/restaurar (reescribe el historial, DOC-03; re-archivable y huérfanos, DOC-14/17); búsqueda (TopBar filtra sólo la carpeta abierta, `?q=` sensible a mayúsculas, DOC-12); carpetas (duplicado falla en silencio, DOC-08).
- **Código y lógica:** `clientCtx` toma la IP de `x-forwarded-for` (`actions/shared.ts:25`, DOC-06); `archiveDocument` no valida el estado previo y sólo escribe en `sst_document_audit`, no en `audit_log` ni `recordStatusChange` (`crud.ts:363-434`); `setRiohsSectionsAction` lee `sstDocuments` sin alcance antes de delegar (`actions/riohs.ts:382-398`); filtro «clínico» por regex sobre título y nombre de archivo (`utils.ts:259-286`, TEÓRICO); `generateStorageName` conserva la extensión del cliente (`utils.ts:314-318`, DOC-16). Sin TODO/`console.log`.
- **Modelo de datos:** Borrado lógico (`archivado`), sha256 por versión, firma del acuse = sha256(versión, checksum, usuario, fecha, método), distribución con snapshot de cargo. Problema: archivar reescribe `sst_document_versions.status` de las versiones `reemplazado`, `borrador` y `en_revision` a `archivado` y restaurar no lo revierte (DOC-03). No verificado si `sst_document_audit` es append-only en BD.
- **Permisos y seguridad:** DEMOSTRADO: IDOR entre faenas bloqueado (404 en descarga, versión, expediente y ZIP; versión cruzada 400); confidencialidad (`prev` sin `manage_sensitive` y `prevfaena`/`jt` sin `manage_restricted` → 404; `sup` y `ti` → 403); M-03 (SVG/XHTML con `<script>` como `application/xml` + `attachment` + `nosniff`, PDF `inline`, CSP con nonce, 0 diálogos); token de acuse HMAC v2 con vencimiento (vencido → «Enlace vencido», manipulado → 404). Falla: la IP falsificada 6.6.6.6 / 7.7.7.7 quedó en `sst_document_audit.ip` (M-04 parcial, DOC-06); autorrevisión permitida (DOC-02).
- **Testing:** 39 archivos unitarios 209/209 PASS; PGlite 6 suites 68/68 PASS; `prevention-privacy-postgres` 6/6 PASS (base propia). E2E leídos, no ejecutados. Sin cobertura: autorrevisión, historial al archivar, exención masiva de la N°18, distribución a destinatarios sin permiso, aprobar una ejecución PDTP cuya fuente fue archivada. Advertencia de entorno: en B las subidas fallan porque `system_settings` apunta a Cloudreve con credenciales indescifrables; la integración se ejecutó por sonda PGlite con servicios reales.
- **Integración con Programa Anual:** Acredita **N°43** (publicar PTS), **N°36** (acuse MIPER-DIF) y **N°18** (RIOHS de faena); N°19 (carpeta legal) por requisitos documentales. Vía: sonda PGlite con servicios reales. N°43: `submitted`, `origin=integration`, `executedByUserId=prev`, `evidence_status=not_required`, texto «Versión de documento publicada: sdv-…»; el publicador no puede aprobar y otra persona aprueba con motivo ≥10 (PRV-02 corregido); publicar la v2 crea otra ejecución en la misma celda (DOC-15). N°36: cada acuse crea una ejecución `submitted` con `executedBy=destinatario`; sólo acusan usuarios con cuenta y `docs:ack` (DOC-21). N°18: un `prevencionista_faena` exime a todos con motivo «abc», la ejecución queda `provided` («0 acuse(s) y 2 exención(es)») y otra persona la aprueba sin motivo (DOC-01). N°19: en B `pdtp_activity_document_requirements` tiene 0 filas para `pdtp-2026-v2`, la carpeta no puede acreditar (DOC-10). Revocación: lo aprobado sigue aprobado al archivar (decisión PRV-04), pero una ejecución pendiente de un documento archivado se aprueba igual y archivar el RIOHS no cierra su entrega (DOC-04).
- **Hallazgos:** 0 🔴 · 1 🟠 · 11 🟡 propios (DOC-02 a 10 y DOC-21; DOC-22 y DOC-27 en los otros dos submódulos) · 🔵 DOC-11 a 17, 19, 20 y ⚪ DOC-18 citados; conteo global del informe: 🔴 0 · 🟠 1 · 🟡 13 · 🔵 13 · ⚪ 1.
  - DOC-01 (🟠) — La entrega del RIOHS (N°18) se cierra y aprueba sin ningún acuse, eximiendo a toda la dotación con un motivo de 3 caracteres — DEMOSTRADO (sonda PGlite, probe-notes-run4.txt) — distribution.ts:354-362 y 413-470 (motivo ≥3, sin distinguir si el destinatario tiene cuenta); riohs-rollout-connector.ts:305-316 (reporta con texto; queda evidence_status=provided)
  - DOC-02 (🟡) — Quien cargó la versión puede registrar su propia revisión — DEMOSTRADO (UI, A) — lib/services/prevention-documents/workflow.ts:211-218 (markDocumentVersionReviewed sin preventUploader)
  - DOC-03 (🟡) — Archivar reescribe el estado histórico de las versiones y restaurar no lo devuelve — DEMOSTRADO (sonda) — lib/services/prevention-documents/crud.ts:382 (UPDATE a 'archivado' de toda versión ≠ vigente/aprobado, incluido 'reemplazado'); 403-433 (restore sólo toca el documento)
  - DOC-04 (🟡) — Archivar la fuente no afecta a las ejecuciones pendientes: se aprueban sin aviso, y la entrega RIOHS sigue abierta — DEMOSTRADO (sonda) — lib/services/prevention-documents/crud.ts:363-387 (archiveDocument: sin efectos PDTP ni onLegalFolderDocumentChanged)
  - DOC-05 (🟡) — Se asigna la lectura y acuse a personas que nunca podrán acusar (restringido sin permiso, o sin docs:view/ack) — DEMOSTRADO (sonda) — distribution.ts:81-120 (no valida los permisos del destinatario) y 253 (el acuse exige la confidencialidad); distribution.ts:527-531 (las opciones incluyen a todo usuario activo); reminders:76-97
  - DOC-06 (🟡) — La bitácora documental y el acuse registran la IP de X-Forwarded-For (falsificable) — DEMOSTRADO (A) — app/(app)/prevencion/documentacion/actions/shared.ts:25
  - DOC-07 (🟡) — El ciclo de revisión no tiene cola ni avisos: nadie sabe que le toca revisar, aprobar o publicar — CÓDIGO (grep sin notificaciones) — documentacion-view.tsx:87-96 (los "N por revisar" sin enlace); workflow.ts (sin createNotifications en todo el módulo, grep)
  - DOC-08 (🟡) — Fallas silenciosas al crear carpetas y en la carga masiva — DEMOSTRADO (A) — header-actions.tsx:71-80 (si !ok no muestra nada) y 230-236 (sólo "N con error"); documentacion-upload.ts:51-55 (descarta result.message)
  - DOC-09 (🟡) — "Sin trabajo del Programa Preventivo pendiente en documentación" con N°43/N°36/N°19 planificadas y sin ejecutar — DEMOSTRADO (B) — panel-server.tsx:17-19 (sólo lista instancias programadas y obligaciones)
  - DOC-10 (🟡) — El programa 2026 v2 activo no declara la carpeta de requisitos legales: la N°19 no puede acreditarse — DEMOSTRADO (B) — document-requirements.ts:146 (assertPdtpProgramEditableState: sólo en borrador)
  - DOC-21 (🟡) — La difusión N°36 sólo la acreditan usuarios con cuenta: no existe acuse público de documentos — CÓDIGO + DEMOSTRADO — actions.ts:30 y page.tsx:85 (sólo kind "permiso")
- **Readiness individual: 66/100** (No listo: el ciclo segregado, la confidencialidad, el alcance por faena y M-03 funcionan; falla la evidencia hacia el programa) — desglose `Func 18,5/25 · UI 12,5/20 · Integridad 10/15 · Programa 6,5/15 · Código 8,5/10 · Permisos 3,5/5 · Testing 3,5/5 · Errores 3/5`

### 3.26 Datos personales: privacidad, salud y casos reservados

**Rutas:** `/prevencion/privacidad`, `/solicitudes`, `/solicitudes/[id]`, `/auditoria`; API `/api/prevencion/privacidad/solicitudes/**` (crear, transición, ejecutar con `Idempotency-Key`, exportar XLSX con checksum), `/api/prevencion/salud/**`, `/api/prevencion/casos-reservados/**`, `/api/prevencion/archivos-sensibles/[id]` · **Informe detallado:** `anexos/documental.md`

- **UI/UX/Diseño:** Portada con dos tarjetas según permiso, lista de solicitudes con creación en diálogo (`PageHeader.actions`), detalle con inventario por dominio y «Evidencia de ejecución»; sin desborde a 1440 ni a 390 px y 0 errores de consola. La auditoría muestra enums crudos (`reserved_case`, `read_reserved`), ids de usuario (`qa-ti`, `user-admin-e2e`), la hora en UTC («2026-09-30 01:10» cuando en Chile eran las 22:10 del 29-09), sin filtros, paginación ni EmptyState (DOC-23); el breadcrumb «Datos personales» del detalle apunta a `/auditoria` (DOC-24). Estados no observados: Error y Cargando.
- **Facilidad de uso:** Crear una solicitud desde el header: 5 clics. No se recorrió en UI ejecutar el derecho, exportar ni transicionar (sólo API y suites).
- **Funcionalidad:** 9 funciones: 6 ✅, 2 🟡, 1 ❌. ❌ UI de salud y casos reservados: no existe, sólo API JSON (DOC-22). 🟡 Supresión de un documento vinculado: sólo desvincula, el binario queda (DOC-25); auditoría de accesos: registra lo permitido y lo denegado pero la presentación es cruda (DOC-23). ✅ Crear solicitud (plazo legal 30 d), máquina de estados/retención, ejecución por dominio con hashes antes/después e idempotencia, exportación minimizada (no descargada en UI), salud (crear, leer restricciones, leer clínico) y casos reservados (crear, leer).
- **Código y lógica:** Autorización por propósito, alcance y membresía nominativa con respuesta indistinguible (404) para inexistente o fuera de alcance. `transitionPreventionPrivacyRequest` lee y actualiza sin `FOR UPDATE` ni condición de estado (`prevention-privacy.ts:223-260`, DOC-26, TEÓRICO); propósito libre de ≥3 caracteres («curiosidad» se acepta; queda auditado).
- **Modelo de datos:** Payload clínico y del caso cifrados (AES con key version); historial de solicitud, ejecuciones con hashes, restricciones de tratamiento y entregas con sha256; auditoría en `prevention_sensitive_access_audit`.
- **Permisos y seguridad:** M-04 corregido (DEMOSTRADO): con `X-Forwarded-For: 6.6.6.6` las filas de auditoría quedaron con `ip = null`; denegaciones auditadas. API: `jefa` crea solicitud (201), restricciones de salud 200 y clínico 404, POST de casos reservados 403 y GET 404 sin membresía; `prev` → `/forbidden` en privacidad; `prev`/`ti` → 404 en salud; sin propósito → 400. El inventario oculta los casos reservados sin membresía (código). Menores: el POST de salud responde sin `Cache-Control: no-store`.
- **Testing:** Pasaron las suites unitarias de privacidad, salud y casos reservados, las PGlite de redacción y autorización de ejecución y `prevention-privacy-postgres` 6/6 (dentro de los totales del informe: 209/209 unitarias y 68/68 PGlite). Sin E2E de ejecución.
- **Integración con Programa Anual:** No acredita ni debe hacerlo (coincide con el mapa, «Brecha»). Relación indirecta: no expone datos del programa; sus supresiones de vínculos documentales no afectan a las ejecuciones PDTP porque éstas sólo guardan el id de versión. Actividades, segregación y revocación: no aplican.
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 (DOC-22) · 🔵 DOC-23 a 26 citados.
  - DOC-22 (🟡) — Salud ocupacional y casos reservados (Ley Karin) existen sólo como API JSON, sin pantalla — DEMOSTRADO — utils.ts:274-276 ("deben registrarse en su dominio seguro"); document-integrity-workbench.tsx:95 (reubicar exige tipear el id de destino)
- **Readiness individual: 84/100** (Muy próximo) — desglose `Func 18/25 · UI 16/20 · Integridad 14/15 · Programa 14/15 · Código 9/10 · Permisos 4,5/5 · Testing 4,5/5 · Errores 4,5/5`

### 3.27 Ficha preventiva del trabajador

**Rutas:** `/prevencion/trabajador/[workerId]` (en la práctica, el espacio de Evaluaciones SST de una persona con tres tarjetas: prevencionista, administrador de contrato y conductor líder) · **Informe detallado:** `anexos/documental.md`

- **UI/UX/Diseño:** A 1440 y 390 px sin desborde. Aviso «No hay una visita en borrador…» con tokens warning y tinte con texto muted; el breadcrumb «Evaluaciones SST» lleva a `/prevencion` y no a `/prevencion/evaluaciones`; EPP preventivo enlaza aquí (`epp-gap-list.tsx:160`) pero la página no muestra EPP (DOC-28). No es una ficha preventiva sino el espacio de evaluaciones SST.
- **Facilidad de uso:** No informado (no se midieron clics). La ficha ofrece «Iniciar evaluación» incluso a quien ya tiene un acta cerrada.
- **Funcionalidad:** 4 funciones: 3 ✅, 1 🔴. 🔴 Ver historial / evaluaciones cerradas: la ficha dice «Sin evaluación iniciada» a un trabajador con acta cerrada (DOC-27). ✅ Ver evaluaciones de la visita abierta, iniciar evaluación por rol, eliminar un borrador con confirmación (sólo código; los borradores se borran con revocación PDTP, `sst-module/evaluations.ts:345-405`).
- **Código y lógica:** Alcance verificado en el código (`page.tsx:63-66`) y en pruebas; visitas legadas sin `visitId` excluidas sin fallback (`visit-context.ts:142-162`); redirige a `/prevencion` sin mensaje si el trabajador no existe.
- **Modelo de datos:** Consume `listWorkerEvaluations` y `deleteEvaluationAction`; las evaluaciones cerradas no se borran. Ausencia de historial visible.
- **Permisos y seguridad:** Acceso con `sst:view` o `sst:evaluate_acompanamiento` más alcance por faena (redirige a `/forbidden`); sin datos sensibles expuestos (RUT y faena, nada de salud).
- **Testing:** `sst-worker-evaluations-scope.test.ts` y `visit-context.test.ts` PASS. Sin prueba del historial.
- **Integración con Programa Anual:** No acredita por sí misma. Las actas que muestra (trabajador nuevo) acreditan la N°18/23/63; la ficha oculta el acta cerrada que acreditó (DOC-27) y la trazabilidad desde el trabajador se pierde.
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 (DOC-27) · 🔵 DOC-28 citado.
  - DOC-27 (🟡) — La ficha dice "Sin evaluación iniciada" a un trabajador con acta cerrada y ofrece iniciar otra — DEMOSTRADO (A, prevfaena) — page.tsx:72-76; visit-context.ts:142-162 (sólo visitas con alguna evaluación en borrador; las sin visitId o cerradas no se muestran)
- **Readiness individual: 80/100** (Muy próximo) — desglose `Func 19/25 · UI 15/20 · Integridad 14/15 · Programa 12/15 · Código 9/10 · Permisos 5/5 · Testing 3/5 · Errores 3/5`

### 3.28 Evaluaciones SST / habilitación de trabajadores

**Rutas:** `/prevencion/evaluaciones` (lista por trabajador), `/prevencion/nueva`, `/prevencion/trabajador/[workerId]` (ficha con tres participaciones), `/prevencion/[id]` (acta por secciones), `/sst/[id]/print` y `/print/pdf` · **Informe detallado:** `anexos/evaluaciones.md`

- **UI/UX/Diseño:** Nueva evaluación bien resuelta (ficha base, trabajador buscable con RUT, faena derivada, `DatePicker` con `max=hoy`, resumen antes de crear); acta usable a 390 px con avance, % y resultado. Defectos: el tipo «Control de seguimiento» aparece dos veces (RE-28 y seguimiento de trabajador antiguo con el mismo rótulo, `nueva-evaluacion-form.types.ts:45-48`, EVA-11); la ficha con acta cerrada dice «Sin evaluación iniciada · + Iniciar Evaluación» aunque la lista diga «Cerrado · HABILITADO AUTÓNOMO» (EVA-04); toast falso «Esta evaluación está cerrada y no puede ser modificada» junto al de éxito (EVA-01); breadcrumbs «Evaluaciones SST» → Inicio (EVA-34); lista sin filtros y paginación fija a 50 (`evaluations-page.tsx:141`); el acta no muestra quién cerró ni cuándo. 0 desborde a 1440/390, 0 errores de consola y 0 respuestas ≥400.
- **Facilidad de uso:** Crear acta de trabajador nuevo: 7 clics; completar 27 ítems y cerrar: 34 (41 de punta a punta); crear RE-28: 9 (opción ambigua); iniciar la participación del conductor líder: 4; volver a abrir un acta cerrada desde la UI: no hay camino (sólo URL directa). Sin «marcar todo Cumple»; el cierre no informa qué acreditó en el PDTP; la ficha invita a duplicar.
- **Funcionalidad:** 15 funciones: 4 ✅, 1 ✅/🟡 (crear acta; el RE-28 es 🟡), 3 🔴, 3 🟡, 2 ❌, 1 ❌/✅ (filtrar/buscar), 1 ❓. 🔴 Guardar respuestas: autoguardado en bucle infinito y pisado entre pestañas (EVA-01); validación de ítems contra la definición (acepta `no_existe_QA`, EVA-M01); consultar acta cerrada desde la UI (EVA-04). ❌ Anular / reabrir / corregir acta cerrada (EVA-07); exportar Excel. 🟡 Eliminar borrador (deja la visita huérfana y no audita, EVA-08); seguimientos D0/7/15/30 requieren `sst:manage` que `prevencionista_faena` no tiene (EVA-M05); semanas del conductor (EVA-M02). ❓ Copia del acta en biblioteca documental (Cloudreve no configurado en B, EVA-M07).
- **Código y lógica:** `use-checklist-responses.ts:67-74` usa `isDirty: revision > 0` que nunca vuelve a 0 y `use-debounced-autosave.ts:71-75` re-arma el guardado (EVA-01); `saveResponses` (`responses.ts:10-35`) acepta cualquier `seccionId/itemId` (`validation/sst.ts:290-297`, EVA-M01); `fechaEvaluacion: z.string().min(1)` sin formato ni tope (`validation/sst.ts:269`, EVA-06); ciclo de vida de visita muerto (`db/schema/sst.ts:9-24` con `estado`, `closedAt`, `closedByUserId`, `reopened*` que nadie escribe, EVA-08); comentario de manifiesto desactualizado (`modules/sst/manifest.ts:41-45`); `EvaluationList` ignora `canDelete`. Sin `console.log`, `any` ni TODO.
- **Modelo de datos:** `sst_evaluations` sin `closed_at`/`closed_by`, sin CHECK de `estado` ni trigger de inmutabilidad (vive sólo en `assertEditable`, `helpers.ts:11-16`); `fecha_evaluacion` es `text`; borrar un borrador elimina respuestas, seguimientos y semanas en cascada pero deja la visita, y el borrado físico no deja `audit_log`.
- **Permisos y seguridad:** Alcance por faena demostrado (`otrafaena` redirige, print y PDF 404; `cphs`/`ti` → `/forbidden` y PDF 403; anónimo 307) y guard de sección por rol (conductor: «No tienes permisos para editar esta sección.»). Falla: los datos de salud del RE-28 los ven `supervisor_terreno` y `jefe_terreno` en pantalla, impresión y PDF, sin registro en `prevention_sensitive_access_audit` (EVA-03); segregación PDTP incompleta para N°17/18/23/63 (EVA-02); en B `admin_contrato` no tiene `sst:close` (deriva BD/manifiesto, EVA-M08).
- **Testing:** 43 archivos / 493 pruebas unitarias (SST, PPA, atención, paridad menú↔página, navegación) ✅ y 10 archivos / 91 pruebas PGlite ✅ (cifras compartidas con PPA e Inicio). Sin E2E del flujo crear → cerrar → PDTP (sólo `e2e/sst-pdf.spec.ts`, que acepta 200 sin sesión), sin pruebas del autoguardado concurrente, de fecha futura ni de la visibilidad del RE-28 por rol.
- **Integración con Programa Anual:** Acredita **N°15 y N°52** (por obligación, al dar de alta el trabajador), **N°18, N°23 y N°63** (directas, acta de trabajador nuevo) y **N°17** (RE-28), todas `submitted` en septiembre semana 4. N°15/52: `executed_by=qa-prev`, `evidence_status=provided` sólo con texto; quien cerró no puede aprobar la N°15, pero `prev2` aprobó la N°52 sin motivo (EVA-10). N°18/23/63/17: `executed_by=null` y quien cerró el acta puede aprobarlas (`prev` aprobó la N°18 con un motivo, EVA-02). Revocación: no hay anulación ni reapertura y el acta cerrada no se puede borrar; la única corrección es rechazar cada ejecución (EVA-07). Observado: una segunda acta del mismo trabajador duplica la tanda N°18/23/63 (EVA-05); fecha futura (15-12-2026) deja cinco ejecuciones en diciembre semana 3 y obligaciones N°15/52 `reported` a esa fecha (EVA-06); N°52 cumplida sin el acompañamiento del conductor líder (EVA-09).
- **Hallazgos:** 0 🔴 · 3 🟠 (EVA-01 a 03) · 8 🟡 (EVA-04 a 11) · 🔵 EVA-M01 a M08 y ⚪ EVA-M09, M10 citados; conteo global del informe de evaluaciones: 🔴 0 · 🟠 4 · 🟡 13 · 🔵 15 · ⚪ 4.
  - EVA-01 (🟠) — El autoguardado del acta nunca se detiene y reescribe el acta completa: dos pestañas se pisan y se pierden respuestas — DEMOSTRADO — use-checklist-responses.ts:41-57 (lote con todos los ítems, incluidos los null), 67-74 (isDirty: revision > 0); use-debounced-autosave.ts:71-75
  - EVA-02 (🟠) — N°18, 23, 63 y 17 llegan al PDTP sin actor: quien cerró el acta aprueba su propio cumplimiento — DEMOSTRADO (B) — worker-onboarding-connector.ts:196-213 (safeAccredit sin actorUserId); worker-sensitivity-connector.ts:43-58 (ídem); executions.ts:579 (sólo compara executedByUserId)
  - EVA-03 (🟠) — Los datos de salud del RE-28 los ven supervisores y jefes de terreno, en pantalla, impresión y PDF, sin auditoría de acceso — DEMOSTRADO (idor.mjs, B) — identificacion-sensibles-sections.ts:36-42 ("No lleva requiresPermission… la protección efectiva está en el archivo"); manifest.ts:52-53 (sst:view a jefe_terreno y supervisor_terreno); print/page.tsx:14 y pdf/route.ts:27 (sólo sst:view)
  - EVA-04 (🟡) — Las actas cerradas no se pueden abrir desde la interfaz; la ficha dice "Sin evaluación iniciada" — DEMOSTRADO — visit-context.ts:14-36 (sólo visitas con borrador); page.tsx (currentVisitEvaluations); evaluation-list.tsx:63 (la fila lleva a la ficha)
  - EVA-05 (🟡) — Una segunda acta para el mismo trabajador duplica la acreditación de N°18, 23 y 63 — DEMOSTRADO (B) — worker-onboarding-connector.ts:196-213 (sourceId por acta, no por persona); compliance.ts:1149-1178 (cobertura suma cantidades aprobadas contra el padrón)
  - EVA-06 (🟡) — El servidor acepta actas con fecha futura y deja ejecuciones PDTP y obligaciones "reportadas" en semanas que no ocurrieron — DEMOSTRADO (g7-future.mjs, B) — validation/sst.ts:269; actions/evaluations.ts:29-84 (sin tope); nueva-evaluacion-form.tsx (sólo `max={today}` en el cliente)
  - EVA-07 (🟡) — Un acta cerrada no se puede anular ni corregir, y sus acreditaciones no tienen revocación — CÓDIGO (líneas citadas) — lib/services/sst-module/evaluations.ts:364-366 ("Usa un flujo de anulación auditada", que no existe); 341-352 (revocación sólo al borrar un borrador)
  - EVA-08 (🟡) — El cierre del acta no registra quién ni cuándo; el borrado de borradores no se audita y deja visitas huérfanas — DEMOSTRADO — sst.ts:37-66 (sin closed_at/closed_by); sst.ts:9-24 (visitas con closed/reopened que nadie escribe); evaluations.ts:285 (sólo updatedAt); 397-399 (delete sin audit)
  - EVA-09 (🟡) — La N°52 se da por cumplida sin el acompañamiento del conductor líder ni la firma del supervisor — DEMOSTRADO (B) — evaluations.ts:289-318 (acredita con el acta del prevencionista); trabajador-nuevo.ts:23-31 (firmas supervisor y prevencionista, sólo impresas)
  - EVA-10 (🟡) — Un rótulo de texto cuenta como "evidencia entregada" en N°15/52, y el aprobador no puede abrir el acta — DEMOSTRADO — obligations.ts:271 y 326 (hasEvidence = evidenceText no vacío → "provided"); worker-onboarding-connector.ts:222 (evidenceText "Acta de trabajador nuevo cerrada: <id>"); evidence-href.ts:1-14 (chip sin enlace)
  - EVA-11 (🟡) — El RE-28 aparece como un segundo "Control de seguimiento", pide un motivo de seguimiento y sólo admite cargos de conductor — DEMOSTRADO — types.ts:45-48; identificacion-sensibles.ts:33 (tipo 'seguimiento'); cargos.ts:1-5
- **Readiness individual: 61/100** — No listo (60–69) — desglose `Func 16/25 · UI 14/20 · Integridad 8/15 · Programa 8/15 · Código 6/10 · Permisos 2,5/5 · Testing 2,5/5 · Errores 4/5`

### 3.29 PPA — Para, Piensa y Actúa

**Rutas:** `/ppa` (público, sin sesión, PWA offline), `/ppa/result/[token]`, `/prevencion/ppa` (bandeja con búsqueda propia), `/prevencion/ppa/[id]`, `GET /api/prevencion/ppa/export` · **Informe detallado:** `anexos/evaluaciones.md`

- **UI/UX/Diseño:** Público a 390 px: tres pasos con barra de progreso, botones Sí/No grandes, confirmación explícita cuando el PPA detendrá el trabajo y resultado «DETENGA EL TRABAJO» muy claro; 0 desborde, 0 errores de consola; la página de resultado no tiene `h1`. Al pasar del paso 2 al 3 aparece siempre un toast rojo «Faltan respuestas obligatorias.» que llega hasta el resultado (EVA-24); tras sincronizar offline la pantalla sigue diciendo «Se enviará ahora automáticamente» (EVA-20). Bandeja: acciones en el header (QR/Enlace, Exportar Excel), 3 KPI no accionables, pestañas por estado con contadores, 4 filtros. Detalle legible; la evidencia de la corrección dice «Este formulario todavía no sube archivos…» (EVA-23).
- **Facilidad de uso:** Enviar PPA detenido desde el teléfono (RUT): 12 clics + escribir RUT y peligro (con toast falso); PPA sin detención: 11; revisar → corregir → verificar → autorizar → cerrar: 5 pantallas, hecho por una sola persona (EVA-22); exportar con rango de fechas: 4 clics, descarga `export.json` (EVA-21).
- **Funcionalidad:** 12 funciones: 7 ✅, 1 ✅/🟡, 2 🟡, 2 🔴. 🔴 Offline con enlace general: el PPA guardado se rechaza al sincronizar (EVA-20); exportar con fechas (EVA-21). 🟡 Enlace general + identificación manual, rechazado por diseño («QUEDA POR DECIDIR», `evaluaciones.ts:107-120`); evidencia de la corrección sólo URL (EVA-23); revisión/CAPA/declarar/verificar/autorizar/cerrar funciona pero sin segregación (EVA-22).
- **Código y lógica:** `ppa-form.tsx:187`: el mismo botón cambia de `type="button"` a `type="submit"` al avanzar al paso 3 (EVA-24); `offline-saved.tsx` sólo cuenta `pending` (`offline-queue.ts:197-206`) y no muestra los `failed`; `ppaExportFiltersSchema` exige `YYYY-MM-DD` (`validation/ppa.ts:196-202`) mientras `ppa-export-button.tsx:39` activa `isoDateISOFormat` (EVA-21), y con fecha simple `lte(created_at,'YYYY-MM-DD')` excluye el día final (`calculos.ts:34`); exportación con «Fecha» = llegada al servidor y estados CAPA crudos (`reportes.ts:463-486`, EVA-M24). Sin `dangerouslySetInnerHTML`.
- **Modelo de datos:** `ppa_submissions` con CHECK de estado y de pares actor/fecha, `version`, `client_submission_id` único (idempotencia offline) e historial `ppa_status_history` con actor; sólido. Dato legado en B con nombre enmascarado y sin `worker_id` (EVA-M22); la CAPA del PPA queda `verified` cuando el PPA pasa a `cerrado`.
- **Permisos y seguridad:** XSS almacenado no ejecuta (`window.__xss` = null); IDOR: `otrafaena` → 404; exportación: prevfaena/jefa/ti 403, anónimo 307, fórmulas neutralizadas; `sup`/`jt`/`cphs`/`legal`/`ti` → `/forbidden`. Falla: segregación ausente en el flujo de corrección (EVA-22); TEÓRICO: el enlace firmado por faena es un HMAC perpetuo y `findWorkerByRutAction` devuelve el `workerId` a quien conozca un RUT (EVA-M23). Cuotas por IP (30/5 min) no probadas bajo carga.
- **Testing:** `ppa-actions`, `ppa-service`, `ppa-stats`, `ppa-public-token`, `ppa-token-revocation`, `ppa-list-filters`, `prevencion-ppa-admin`, `lib/ppa/**`, `ppa-workflow-panel.test.tsx` y PGlite `prevention-ppa-workflow-persistence` verdes (dentro de las 493 y 91 pruebas del informe). Sin prueba de la ruta de exportación ni del contrato con `ExportDialog`; `ppa-offline.spec.ts` no cubre el rechazo permanente ni su visibilidad; ninguna prueba detecta el toast del paso 3.
- **Integración con Programa Anual:** El programa 2026 v2 real de B no tiene ninguna actividad sobre PPA («Piensa y Actúa»: 0 filas); coincide con el mapa, por lo que no debe acreditar. Relación indirecta: un PPA detenido genera una CAPA `sourceType='ppa'` (`CAPA-2026-LOCBIGJUPZ`), pero no llega a «Medidas» del PDTP ni como acción cerrable, y el ítem «Programa Piensa y Actúa» del acta de trabajador nuevo no acredita nada. Segregación y revocación: no aplican.
- **Hallazgos:** 0 🔴 · 1 🟠 (EVA-20) · 4 🟡 (EVA-21 a 24) · 🔵 EVA-M21 a M24 y ⚪ EVA-M25 citados.
  - EVA-20 (🟠) — Un PPA guardado sin conexión desde el enlace general se rechaza al sincronizar y se pierde en silencio — DEMOSTRADO — evaluaciones.ts:115-120 (rechazo sin enlace acreditado ni workerId); hooks.ts:97-101 (failed permanente); offline-queue.ts:197-206 (la UI sólo cuenta pending)
  - EVA-21 (🟡) — Exportar PPA con rango de fechas descarga un "export.json" con error 400; con fechas simples se pierde el último día — DEMOSTRADO — ppa-export-button.tsx:39 (isoDateISOFormat); export-dialog.tsx:89-95; validation/ppa.ts:199-200; calculos.ts:33-34
  - EVA-22 (🟡) — Una misma prevencionista revisa, declara la corrección, la verifica, autoriza el reinicio y cierra el caso — DEMOSTRADO (ppa-step.mjs, B, PPA C8Z8…) — prevention-capa.ts:293-313 (la SoD de CAPA se exime a sourceType 'ppa'); manifest.ts:112-119 (prevencionista tiene todos los permisos); ppa-workflow-panel.tsx (texto "El reinicio requiere evidencia, verificación independiente y autorización expresa")
  - EVA-23 (🟡) — La evidencia de la corrección sólo admite una URL; "Documento" y "Fotografía" se rechazan con un mensaje de rutas internas — DEMOSTRADO — ppa-workflow-panel.tsx:196-205 ("Este formulario todavía no sube archivos…"); prevention-capa.ts:782-811
  - EVA-24 (🟡) — En cada envío aparece "Faltan respuestas obligatorias" al llegar al último paso — DEMOSTRADO — ppa-form.tsx:187 (Continuar → Enviar en el mismo nodo); ppa-form.hooks.ts:219-224
- **Readiness individual: 69/100** — No listo (límite superior) — desglose `Func 16/25 · UI 15/20 · Integridad 9,5/15 · Programa 11/15 · Código 8/10 · Permisos 3/5 · Testing 3/5 · Errores 3,5/5`

### 3.30 Inicio de Prevención y menú

**Rutas:** `/prevencion` (`page.tsx`, `prevention-home.tsx`, `lib/services/prevention-attention.ts`); menú de `modules/prevention/manifest.ts`, `sst`, `ppa`; `components/layout/nav-items.ts` · **Informe detallado:** `anexos/evaluaciones.md`

- **UI/UX/Diseño:** `DashboardGrid` con «Atención requerida» y «Módulos disponibles» (que repite el menú, 22 enlaces, EVA-36). No pasa el test de los 5 segundos para el programa: en B, para `prev`, Inicio muestra 5 avisos (PPA detenido, evaluación pendiente, una medida, dos inspecciones) mientras el tablero PDTP muestra 38 ejecuciones por aprobar y 576 programadas sin ejecutar este mes · 28 actividades en cero, y Obligaciones 13 pendientes / 15 por aprobar (EVA-30); para `prevfaena`, `sup`, `jt`, `cphs`, `legal` dice «No hay pendientes…». «Evaluación SST pendiente · Conductor líder» no dice de qué trabajador (EVA-35). Durante el streaming el `h1` es «Evaluaciones SST» (EVA-33, causa demostrada: `app/(app)/prevencion/loading.tsx:7-19`; nunca hay dos `h1` a la vez). Sin desborde a 1440/1024/768/390, un `h1`, 0 errores.
- **Facilidad de uso:** Inicio no tiene entrada en el menú (se llega desde el acceso rápido del dashboard, `dashboard/quick-actions.tsx:50`, o por breadcrumbs); estando en `/prevencion` el área Prevención aparece colapsada y sin ítem activo (EVA-34). Clics: no informado.
- **Funcionalidad:** 5 funciones: 3 ✅, 2 ❌. ❌ Estado del programa (atrasadas, por aprobar, obligaciones, próximas) y coincidencia de cifras con el tablero PDTP (no hay cifras que comparar; EVA-30). ✅ Avisos por permiso y alcance (10 roles), reparto por tipo (round-robin), sin permisos → `/forbidden`.
- **Código y lógica:** `prevention-attention.ts:95-140` sólo lee CAPA PDTP, borradores SST, PPA detenido/en corrección, inspecciones, CPHS, protocolos y equipos de emergencia; no consulta `pdtp_executions` submitted, `pdtp_obligations` ni la planilla. PPA `pendiente_verificacion` no entra en Atención (`:121`) aunque el lateral «PPA por revisar» sí lo incluye (`prevention-home.tsx:21-22`, `calculos.ts:24-25`, EVA-35).
- **Modelo de datos:** No informado (el informe agrupa código y modelo y no reporta tablas propias).
- **Permisos y seguridad:** Menú observado por rol: admin 40 enlaces, prev 37, prevfaena 35, jefa 36, sup 19, jt 29, cphs 27, legal 10 y ti sin área Prevención; la prueba `nav-page-permission-parity` pasa y el recorrido lo confirma (lo que aparece abre y lo que no aparece da `/forbidden`). Excepción: `/prevencion/nueva` redirige a Inicio en vez de `/forbidden` (EVA-M04); `/prevencion/campanas` sigue accesible por URL y deja activo «Evaluaciones SST» (EVA-34); en B `admin_contrato` difiere por grants de `bodega_dev` (EVA-M08).
- **Testing:** `prevention-attention-calc`, `nav-page-permission-parity`, `admin-nav` verdes. Sin prueba de que Inicio muestre el estado del programa ni de la ausencia de ítem activo.
- **Integración con Programa Anual:** Inicio no acredita nada (correcto); su rol es llevar a lo que el programa pide y hoy sólo lleva a las medidas (CAPA) del PDTP, omitiendo ejecuciones por aprobar, obligaciones vencidas/por vencer y actividades atrasadas o próximas (EVA-30). Segregación y revocación: no aplican.
- **Hallazgos:** 0 🔴 · 0 🟠 · 1 🟡 (EVA-30) · 🔵 EVA-33, 34, 35 y ⚪ EVA-36 citados.
  - EVA-30 (🟡) — Inicio no muestra lo que el Programa Anual pide: ni ejecuciones por aprobar, ni obligaciones, ni actividades atrasadas o próximas — DEMOSTRADO (B, prev) — prevention-attention.ts:95-140; prevention-home.tsx:41-55
- **Readiness individual: 76/100** — Funcional, requiere correcciones — desglose `Func 19/25 · UI 13/20 · Integridad 14/15 · Programa 8/15 · Código 9/10 · Permisos 5/5 · Testing 3,5/5 · Errores 4,5/5`


### 3.31 Índice de hallazgos 🔴/🟠/🟡 (bruto, por anexo)

| ID | Sev | Submódulo | Título | Evidencia | Archivo:línea |
|---|---|---|---|---|---|
| PRG-01 | 🟠 | Programa Anual | No se puede crear una revisión v+1 de un programa activo en condiciones normales | DEMOSTRADO (navegador) | page.tsx:200-204,229; fulfillment-backlog-panel.tsx:19-29 |
| PRG-02 | 🟡 | Programa Anual | Firmar el último paso activa el programa en el mismo clic, sin confirmación ni permiso `activate` | DEMOSTRADO | program-lifecycle.ts:49-57,108-110; program-lifecycle-controls.tsx:204-217 |
| PRG-03 | 🟡 | Programa Anual (N°1) | La aprobación de un programa acredita la N°1 del programa vigente en la fecha de la firma, no la del programa aprobado | DEMOSTRADO (SQL, base B) | pdtp-accreditation-connectors.ts:445-482; accreditation.ts:138-149,322-336 |
| PRG-04 | 🟡 | Programa Anual | Ni el control de cambios ni la bitácora muestran quién cambió qué | DEMOSTRADO | page.tsx:565-570; activities.ts:718-726 (recordAudit sin userEmail); audit-log.tsx:80,105 |
| PRG-05 | 🟡 | Programa Anual | Dos pestañas editando la misma actividad: el último guardado revierte en silencio el cambio del otro | DEMOSTRADO (B, N°7) | activities.ts:487-494,633-646; actividades-tab.tsx:633-647 |
| PRG-06 | 🟡 | Programa Anual | El aviso «actividad periódica sin ninguna semana planificada» es falso para actividades con programación recurrente | DEMOSTRADO | lib/services/pdtp/lifecycle.ts:158-177 |
| PRG-07 | 🟡 | Programa Anual | El tablero no dice cuánto se ha cumplido; la cifra está enterrada en la ficha | DEMOSTRADO | page.tsx:386-439; pdtp-dashboard-charts.tsx:57 |
| PRG-08 | 🟡 | Programa Anual | «N ejecuciones por aprobar» ignora los envíos de la versión reemplazada que el tablero consolida | DEMOSTRADO (SQL + UI) | page.tsx:149-152; executions.ts:829-842 |
| PRG-09 | 🟡 | Programa Anual | El reporte de gestión marca «En desviación» actividades retiradas o sin plan exigible, y mide la cobertura con otro denominador | DEMOSTRADO (UI + reporte-masisa.xlsx) | reporte/page.tsx:28-43 |
| PRG-10 | 🟡 | Programa Anual | El RE-36 de una faena y el control de cambios de la ficha incluyen los eventos de todas las faenas, sin rótulo | DEMOSTRADO | RE-36 (lib/services/pdtp/re36-document.ts, bloque changeControl); [programId]/page.tsx:553-583 |
| PRG-11 | 🟡 | Programa Anual | La firma «Aprobación Legal y RRHH» la ejecuta el rol Jefatura; la Gerencia Legal no puede firmar | DEMOSTRADO | modules/prevention/manifest.ts:609-613, 625-628 (comentario: «sign_legal/approve siguen en jefa_chome hasta que se pida moverlos») |
| PRG-12 | 🟡 | Programa Anual | Crear una actividad nueva exige ir a Administración, y los errores de validación no dicen qué campo falló | DEMOSTRADO | pdtp-activity-creator.tsx:446-449,568-571; pdtp.ts:349-350 |
| PRG-13 | 🟡 | Programa Anual | Una asignación nominal con «Rige desde» anterior a la vigente borra el período del responsable anterior | CÓDIGO | assignees.ts:313,348-371,428-436; pdtp-assignee-picker.tsx:166-178 |
| PRG-14 | 🟡 | Programa Anual | En la misma tarjeta se mezclan «a la fecha» y «anual» sin rótulo, y «a la fecha» incluye el mes en curso completo | DEMOSTRADO (Horcones) | pdtp-indicators-panel.tsx:248-280; compliance.ts:421-430 |
| PRG-15 | 🟡 | Programa Anual | El 58 % de las actividades del programa activo no declara qué evidencia se exige, y el editor contradice al servidor | DEMOSTRADO | lifecycle.ts:138-153; revision-tab.tsx:60-95 |
| CUM-01 | 🟡 | Planilla / Constancias | "No realizada" se declara sin la regla de autoridad de registro y apaga la señal de atraso | DEMOSTRADO | actions/deviations.ts:128-156 (no pasa actor); deviations.ts:116-124 (sin parámetro de actor); pdtp-sheet-table.tsx:583-592 (el formulario se ofrece sin canRegister); period.ts:246-273 (hasDeclaredNotPerformed) |
| CUM-02 | 🟡 | Planilla | Un envío pendiente parcial o una sola "no realizada" esconden el faltante del resto del mes | DEMOSTRADO (PGlite C06) | lib/services/pdtp/period.ts:263-273 (isUnpaidMonth: submitted === 0 && !hasDeclaredNotPerformed) |
| CUM-03 | 🟡 | Planilla / Constancias (formulario compartido) | Tras un error de envío, el formulario "Registrar" vuelve la cantidad a 1 y borra la observación y el archivo | DEMOSTRADO (navegador B) | app/(app)/prevencion/pdtp/pdtp-execution-form.tsx:88-130 (useActionState), 168-171 (<form action>), 224-236 (cantidad no controlada, defaultValue "1"), 255-273 (observación y archivo no controlados) |
| CUM-04 | 🟡 | Planilla (registro de complemento) | El diálogo de complemento suma lo acreditado por el submódulo con lo manual; el indicador toma el mayor | DEMOSTRADO (navegador B, N°38 semana 4) | pdtp-sheet-table.tsx:131-144 (suma todo lo approved); compliance.ts:247-296 (max(manual, integración)); pdtp-execution-form.tsx:175-179 y 249-253 (dos avisos contradictorios) |
| CUM-05 | 🟡 | Planilla (meta por faena, M-06) | El botón "Fijar meta por faena" no abre su diálogo: la meta por faena, incluida su reducción con revisión, no es operable desde la UI | DEMOSTRADO (navegador B, prev) | pdtp-override-form.tsx:53-64 (DialogTrigger asChild → <Tooltip>); tooltip.tsx:48-70 (Tooltip no acepta ni reenvía props, ref ni onClick) |
| CUM-06 | 🟡 | Aprobaciones | La cola de aprobación no muestra qué se aprueba (cantidad, quién, cuándo, plan) y repite botones idénticos | DEMOSTRADO | page.tsx:106-132 (descarta executedQuantity, executedByUserId, executedAt), 183-200 (evidencias en otra columna, sin período); pdtp-approval-buttons.tsx:18-20, 99-127 (rótulo sólo "mes · sem.") |
| CUM-07 | 🟡 | Planilla / Aprobaciones | El buscador del TopBar se muestra en la planilla y en Aprobaciones pero no filtra nada | DEMOSTRADO (navegador B) | top-bar.tsx:33 ("/aprobaciones" no calza con /prevencion/pdtp/aprobaciones), 77; pdtp-sheet-table.tsx (no usa useSafeShellHeader/searchQuery) |
| CUM-08 | 🟡 | A demanda y por evento | Los casos completados y cancelados desaparecen: no hay dónde consultarlos | DEMOSTRADO | obligations.ts:566-570 (baseWhere fija pending/overdue/reported); page.tsx:17 (FILTERS); workbench.tsx:122-129 (opciones del Select) |
| CUM-09 | 🟡 | Constancias | Declarar "No se hizo" no salda la constancia: sigue pendiente (y vencerá) en Constancias y en /pendientes | DEMOSTRADO (navegador B, flujo 9) | lib/services/pdtp/constancias.ts:122-128 (paidMonths sólo con ejecuciones de cantidad > 0) |
| CUM-10 | 🟡 | Registro de ejecución (vía de integración; referencia cruzada con el agente integracion) | Las acreditaciones de submódulos se aprueban en semanas futuras | DEMOSTRADO | lib/services/pdtp/accreditation.ts:294-301 (el slot sale de plannedPeriod sin guarda de futuro); compárese con executions.ts:110 y :587 |
| CUM-12 | 🟡 | Planilla (detalle de ejecución) / Aprobaciones (anulación) | El detalle de una ejecución no dice su estado actual, y la anulación queda como "Revertido" sin motivo ni solicitante | DEMOSTRADO | review-requests.ts:230-237 (recordPdtpExecutionHistory sin reason); ejecucion/page.tsx:67-73 (header sin estado); submission-history.tsx:43-48 (motivo sólo desde entry.reason); executions.ts:640-647 (la aprobación con motivo tampoco lo guarda en el historial) |
| INT-01 | 🟠 | Motor transversal / despliegue | El saneamiento y la conciliación del deploy corren sin el volumen de storage y devuelven a revisión todas las auto-aprobaciones legítimas en cada deploy | DEMOSTRADO | docker-compose.yml:809-822 y 831-846 (sin STORAGE_PATH ni volumes; comparar con 127 y 151-152 del app); report-…ts:104-113; deploy-prod.sh:636 y 643; integration-evidence.ts:161-166; config.ts:39-44 |
| INT-02 | 🟡 | Higiene (N°45) / motor de evidencia | La medición de higiene usa un informe subido por otra persona o para otra faena sin reclamarlo, y la N°45 se auto-aprueba | DEMOSTRADO | prevention-hygiene.ts:421 (lee la ruta del cliente), 466-476 (escribe la fila de evidencia sin claimPreventionEvidenceUpload); integration-evidence.ts:113-124 (el dueño es esa misma fila); prevention-evidence-upload.ts:115-138 (el reclamo, que higiene no usa) |
| INT-03 | 🟡 | Visitas y coordinación (N°20) | La N°20 se auto-aprueba con cualquier documento corporativo de la biblioteca vinculado a la coordinación | DEMOSTRADO | integration-evidence.ts:125-136, 158 (allowCorporate); links.ts:219 (sin guarda si el documento no tiene faena); external-engagement…:70-92 (toma el último documento vinculado) |
| INT-04 | 🟡 | Higiene (N°46–49, N°50), Evaluaciones SST (N°17, 18, 23, 63), Incidentes (N°76) | Cinco conectores no guardan a quien originó el hecho: esa persona aprueba su propio cumplimiento | DEMOSTRADO | hygiene…:213-226 (recibe actorUserId y no lo reenvía), 254-269; worker-onboarding…:197-213; worker-sensitivity…:43-58; incident…:386-395 |
| INT-05 | 🟡 | Obligaciones integradas (RE-20 N°66–78, alta de trabajador N°15/52, organización preventiva N°11, ocurrencias N°16/57, RIOHS N°18) | Una obligación integrada reportada sólo con texto queda como «evidencia entregada» y se aprueba sin motivo | DEMOSTRADO | obligations.ts:271 (hasEvidence incluye texto), 326 y 341 (evidenceStatus provided); executions.ts:490-495 y 771-773 (sin motivo si es provided) |
| INT-06 | 🟡 | Motor / casillas (CGRD, capacitación, alcotest, simulacros, higiene) | La acreditación por integración acepta y auto-aprueba celdas futuras (PRV-03 no aplica a integración) y el deploy la revierte después | DEMOSTRADO | accreditation.ts:299-303 (el slot sale de plannedPeriod, sin guarda de futuro) y 619-622; prevention-cgrd.ts:645-667 (cualquier casilla no cumplida, incluso futura); report-…ts:95-98 |
| INT-07 | 🟡 | Motor / alcotest, higiene N°45, coordinación N°20, CPHS N°9, CGRD N°80, MIPER, documentación, plan de emergencia, actas de ingreso y RE-28, hitos RE-20 | Una ejecución de integración aprobada por error no tiene vía de corrección | DEMOSTRADO | review-requests.ts:157-159 (rechaza anular integraciones: «se corrige anulando el registro de origen»); prevention-external-engagements.ts:81-230 (sólo crear, agregar medida y cerrar); prevention-emergency.ts:538-571 (archivar no revoca) |
| INT-08 | 🟡 | Motor (desvíos) | Un hecho de integración sin verificar retira un «no aplica» ya aprobado por otra persona, se lo atribuye al autor del NA y afirma que hubo «evidencia real» | DEMOSTRADO | lib/services/pdtp/accreditation.ts:765-816 (withdrawDeviationForAccreditedCell), 788 (motivo), 793 (withdrawnByUserId), 832 (se llama siempre, antes de saber si se aprueba) |
| INT-09 | 🟡 | Trazabilidad (audit_log, pdtp_change_log) | La bitácora «de sólo agregar» se elude con un GUC que cualquier rol puede fijar, con TRUNCATE o deshabilitando el trigger | DEMOSTRADO | db/migrations/0340_audit_append_only.sql:17-28 (la condición del GUC y del nombre de la base), 25-28 (trigger BEFORE UPDATE OR DELETE FOR EACH ROW, sin TRUNCATE) |
| INT-10 | 🟡 | Motor / fuentes sin casilla (plan N°83, MIPER N°35, documentos N°36/43, CPHS N°9, EPP N°62, actas) | Un hecho tardío de integración nunca salda la celda que estaba planificada; sólo el registro manual la recupera | DEMOSTRADO (sonda `integracion-tardio`) | accreditation.ts:299-303 (sin plannedPeriod se imputa la semana del hecho); compliance.ts:370-372 (min(ejecutado, planificado) por mes: un mes sin plan cuenta 0) |
| INT-11 | 🟡 | Aprobaciones PDTP | La cola de aprobaciones no identifica ni enlaza el registro de origen, pero exige escribir «qué revisaste» | DEMOSTRADO (aprobaciones-1440.png, B) | pdtp-evidence-thumbs.tsx:62-72 (chip sin enlace) y 93-94; evidence-href.ts:78-90 (recorta el id) |
| INT-12 | 🟡 | Evidencia a largo plazo (M-12) | Una aprobada cuyo archivo desapareció sigue contando; sin sha registrado no se detecta la alteración, y la evidencia no referenciada por el PDTP no se escanea | DEMOSTRADO (sonda `integridad`) | evidence-integrity.ts:54 (sólo referencias del PDTP), 93-95 (sin sha se salta la comparación), 117-129 (sólo registra en el log); accreditation.ts:858-862 (el sha sólo se guarda si la evidencia se verificó) |
| INT-13 | 🟡 | Casillas (PRV-16) | El «no aplica» de una casilla sobre una celda sin plan (o excluida) cambia la casilla sin desvío ni aviso | DEMOSTRADO (sonda `prv16`) | slot-deviation-connector.ts:183-195 (sólo futuro y mes cerrado son visibles), 311-324 (lo demás se traga); prevention-training-occurrences.ts:691 (`.catch(logger.error)` después del commit) |
| INS-01 | 🔴 | Inspecciones | El % de cumplimiento suma conformes de secciones que no puntúan: el Reporte de Uso Diario de Equipos no se puede cerrar y otros % salen inflados | DEMOSTRADO | inspections.ts:445 (cuenta conforming de toda respuesta) vs :458 (sólo `scored` filtra countsForCompliance); runs.ts:585-591 (escribe el %); CHECK prevention_inspection_run_normalized_bps_valid |
| INS-02 | 🟡 | Inspecciones | La ejecución PDTP queda aprobada por quien ejecutó, al declarar, antes de la revisión independiente | DEMOSTRADO (SQL) | connectors 128-129 (autoApproveByUserId = completedByUserId); runs.ts:668-675; runs.ts:568-584 (reporte auto-revisado por el transcriptor) |
| INS-03 | 🟡 | Inspecciones | Reabrir y volver a cerrar duplica los hallazgos que ya tenían CAPA | DEMOSTRADO | runs.ts:527-544; transitions.ts:108-112 |
| INS-04 | 🟡 | Inspecciones | Un hallazgo alto o crítico se puede cerrar a mano sin CAPA y así revisar la inspección | DEMOSTRADO | runs.ts:952-968 (sin restricción de criticidad); detail.tsx:654-663 (botón "Cerrar" para todo abierto sin CAPA); lib/prevention/inspections.ts:747-775 (closed no bloquea) |
| INS-05 | 🟡 | Inspecciones | "Inspección de Uso y Estado de EPP · 02" sigue vigente, ejecutable y sin actividad; el detector de cableado no la reporta | DEMOSTRADO | lib/prevention/inspection-wiring.ts:206-221 (orphan_approved sólo si hay BORRADORES de otro código) |
| INS-06 | 🟡 | Inspecciones | Los ítems obligatorios se rotulan "Opcional" | DEMOSTRADO | detail.tsx:907 y :988 (usa item.required); inspections.ts:531-533 (la puerta usa required \|\| puntuable) |
| INS-07 | 🟡 | Inspecciones | La fecha que acredita es la del cierre en el servidor; la hora offline (`queuedAt`) se descarta | CÓDIGO | runs.ts:376-402 (el zod no declara queuedAt ni fecha de ejecución), :574 (executedAt: now), :671; offline-inspection-queue.ts:44-46 |
| INS-08 | 🟡 | Inspecciones | Roles con alcance de faena pueden cambiar qué actividad del programa acredita una plantilla global | DEMOSTRADO | templates.ts:270-280 (requireAccess manage sin faena; sólo bloquea superseded); actions.ts:109-113; manifest.ts:1089-1090 (prevencionista_faena y admin_contrato con manage) |
| INS-09 | 🟡 | Inspecciones | Aprobar plantillas no está segregado de incorporarlas, contra lo declarado; la paridad documental se puede autodeclarar al importar | DEMOSTRADO | templates.ts:436 (dice que exige otro aprobador) vs :463-469 (no lo exige); :49-54 y :206-213 (importador fija parityReport "passed" con verifiedByUserId = él mismo); manifest.ts:233 ("de forma segregada de quien las incorpora") |
| INS-10 | 🟡 | Inspecciones | El reporte de equipos promete una revisión de Prevención que el sistema no hace | DEMOSTRADO | detail.tsx:819; runs.ts:568-584; reporte-equipos.ts:41 (closesOnCompletion: true) |
| INS-E1 | 🟡 | EPP preventivo / N°62 | Cada entrega crea una ejecución N°62 a aprobar a mano, y la cola no permite distinguir cuál se aprueba | DEMOSTRADO | deliveries-worker-stock.ts:487-498; connectors 242-282 (fuente epp no autoaprueba, una fila por deliveryId) |
| CAP-01 | 🟠 | Capacitación y Alcotest (transversal a la acreditación por integración) | Un hecho registrado hoy para una semana futura crea una ejecución PDTP aprobada (PRV-03 sigue abierto por la vía de integración) | DEMOSTRADO (B) | training-occurrences.ts:500-547 y 620-636 (sin guard de futuro); alcotest-slots.ts:239-293; alcotest.ts:181-185 y 323-327 (plannedPeriod = casilla); el guard sólo existe en executions.ts:110 y 587 |
| CAP-02 | 🟠 | Capacitación | Las 5 réplicas de la N°38 (CAP-22…26) comparten una celda; un «no aplica» de una charla saca las cinco, y completar otra lo retira en silencio | DEMOSTRADO (B + servicio de hoja) | catálogo :505-571 (5 ítems con allWeeksOfYear → [38]); occurrences.ts:665-680; slot-deviation-connector.ts:262-324 (desvío por celda) |
| CAP-03 | 🟠 | Capacitación | La grilla anual es una lista de 390 tarjetas por faena (2.731 y 20 MB para roles globales) sin filtro de período | DEMOSTRADO (navegador y HTTP, B) | list.tsx:140-148 (la búsqueda ignora mes y semana) y 228-232 (render completo); page.tsx:42-47; service :316-322 (orden enero→diciembre) |
| CAP-04 | 🟡 | Capacitación (y Alcotest) | PRV-16 parcial: hay tres caminos en que el «no aplica»/«no hecha» que el PDTP rechaza sigue quedando sólo en el log | DEMOSTRADO | occurrences.ts:678 y 687-693 (después del commit, .catch(logger.error)); connector :185-191 (el guard sólo cubre futuro y mes cerrado) y :309-324 (el resto se traga) |
| CAP-05 | 🟡 | Capacitación y Alcotest | El resultado de la revisión del «no aplica» nunca vuelve a la ocurrencia o casilla | DEMOSTRADO (B) | deviations.ts:350-455 (review sin retroalimentación); list.tsx:321-322; program-slot-list.tsx:147-151 |
| CAP-06 | 🟡 | Capacitación | Las charlas N°38 y N°53, responsabilidad de Supervisor/Jefe de terreno, sólo las puede registrar Prevención | DEMOSTRADO | manifest.ts:998-1004 (Sup/JT sólo training:view; el comentario habla de un `deliver` retirado); list.tsx:328 |
| CAP-07 | 🟡 | Capacitación | PRV-06 parcial: 91 ocurrencias obsoletas siguen en B y el servicio todavía acepta marcarlas | DEMOSTRADO | occurrences.ts:327-328 (sólo el listado filtra); 500-547 y 715-747 (record/upload sin validar la casilla) |
| CAP-08 | 🟡 | Capacitación (y Alcotest con archivo) | El cumplimiento de capacitación se autoaprueba sin segunda persona y con cualquier archivo de un tipo permitido | DEMOSTRADO | accreditation.ts:523-526 (capacitacion_ocurrencia «incondicional») y 619-622; occurrences.ts:422 (autoApproveByUserId = actor) |
| CAP-09 | 🟡 | Capacitación | «Marcar hecha» desde «No aplica» es un callejón sin salida | DEMOSTRADO | list.tsx:271-273 y 416-419; service :743-745 (sin evidencia en NA) y :545-547 (hecha exige evidencia) |
| CAP-20 | 🟡 | Alcotest | Una sola serie de 12 casillas para dos actividades (N°30 y N°31, 24 celdas planificadas) | DEMOSTRADO (B) | program-slots-2026.ts:33-56 y 103-112; alcotest-slots.ts:204-223 (declareOn por rol) y 255-257; workbench:262 |
| CAP-21 | 🟡 | Alcotest | administrador y admin_contrato pueden abrir y completar «Registrar control», pero su rol no mapea a ninguna actividad: falla al final y deja evidencia huérfana | DEMOSTRADO | manifest.ts:694,701; alcotest.ts:117-120; workbench.tsx:304-315 (sube antes de registrar) |
| CAP-22 | 🟡 | Alcotest | La evidencia de alcotest no se puede abrir desde ninguna pantalla | DEMOSTRADO | program-slot-list.tsx:138-143 (sólo el conteo); evidence-href.ts:35-39 (sin prevention-alcotest-evidence); thumbs:64-72 (chip «En el módulo de origen» sin enlace) |
| CAP-23 | 🟡 | Alcotest | No se cotejan la casilla, el período y la fecha: envío de julio en la casilla de diciembre, control fechado en 2027, envío de 0 controles | DEMOSTRADO (B) | validation :6 (performedAt libre); alcotest.ts:255-347 (sin cotejo mes vs casilla; testCount 0 permitido); slots.ts:239-265 |
| CAP-24 | 🟡 | Alcotest | Un control o envío registrado no se puede anular ni corregir; la casilla y la acreditación quedan fijas | CÓDIGO (grep sin annul/unlink/revoc) | alcotest-slots.ts:154-164 (una casilla cumplida no se corrige; «deshacerlo es desvincularlo», pero no existe ese desvincular); schema :20-48 (sin estado) |
| CAP-30 | 🟡 | Campañas (registro histórico) | La pantalla legado ofrece como pendientes 35 campañas que duplican las CAM-* y un selector de actividad PDTP sin efecto | DEMOSTRADO | client.tsx:173-195 (selector y botón primario); service :109-127 (setCampaignPdtpActivities vivo) y 217-220; connectors.ts:105-112 |
| INC-01 | 🟠 | Incidentes y accidentes | La declaración (N°69), el ONE PAGE (N°78) y los seguimientos (N°76) no se pueden consultar: el expediente, el historial y el PDTP sólo guardan que "se hizo" | DEMOSTRADO (flowA2 + probeA5) | prevention-incidents.ts:1848-1946 (insert sin appendHistory); prevention-incident-export.ts:199-235 (hojas del expediente sin esos hitos); [id]/page.tsx:125-132 (sólo pasa preliminar y difusiones) |
| INC-02 | 🟠 | Incidentes y accidentes (integración RE-20) | Las ejecuciones RE-20 quedan con evidencia "provided" por un texto que genera el sistema, y se aprueban sin motivo (PRV-01 sigue abierto en la vía de obligaciones) | DEMOSTRADO | obligations.ts:271 (hasEvidence = texto) y 326/341 (evidenceStatus "provided"); incident-accreditation-connector.ts:251,334,343,351,360,369,377,410,418 (evidenceText sintético); executions.ts:771-773 (sólo pide motivo si evidenceStatus ≠ provided) |
| INC-03 | 🟠 | Incidentes y accidentes (integración RE-20) | Los plazos RE-20 se cuentan desde que se registró el incidente en el sistema, no desde que ocurrió: la N°66/67 ("informar inmediatamente") siempre sale a tiempo | DEMOSTRADO | prevention-incidents.ts:690-699 (reportedAt: createdAt) y 1211-1220 (occurredAt: updated.createdAt); incident-accreditation-connector.ts:117-145, 247-252, 612; obligations.ts:114,188 (dueAt = sourceOccurredAt + plazo) |
| INC-05 | 🟠 | Incidentes y accidentes / CAPA | Un incidente con una CAPA cancelada no puede cerrarse nunca | DEMOSTRADO | prevention-incidents.ts:1262-1266 y 1270 (exige closed/verified; cancelled bloquea); prevention-capa.ts:229 (cancelled: [] sin salida) |
| INC-04 | 🟡 | Incidentes y accidentes | El cierre no exige ni muestra los hitos RE-20 y deja sus obligaciones pendientes sin vía de cumplimiento | DEMOSTRADO | prevention-incidents.ts:1268-1296 (compuertas: investigación, CAPA, carriles); 1794-1804 (tras el cierre no se registran hitos); [id]/page.tsx:129-130 (panel deshabilitado) |
| INC-07 | 🟡 | Incidentes (N°76) | Quien registra el seguimiento quincenal aprueba su propia ejecución N°76 (PRV-02 parcial) | DEMOSTRADO | lib/services/pdtp-adapters/incident-accreditation-connector.ts:386-395 (recordPdtpFulfillmentEvent sin actorUserId) |
| INC-08 | 🟡 | Incidentes (N°76) | La N°76 es closed_on_time pero acredita por ejecución directa: sus seguimientos aprobados no cuentan en el indicador | SQL (B) | connector:20-27, 386-395; compliance.ts:137-200 y 1424-1425 (closed_on_time sólo cuenta obligaciones) |
| INC-09 | 🟡 | Incidentes (reinicio) | Quien completó la investigación puede autorizar el reinicio si no figura en el "equipo" (que además llega del cliente) | DEMOSTRADO | lib/services/prevention-incidents.ts:1636-1639 (conflicted = team + actores CAPA); 185 y 1421 (team del input); 1442 (completedByUserId) |
| INC-10 | 🟡 | Incidentes | El detalle del incidente se desborda 83 px a 390 px | DEMOSTRADO (check390.mjs) | app/(app)/prevencion/incidentes/[id]/re20-panel.tsx:194-245 (fila de 5 pestañas sin wrap) |
| INC-11 | 🟡 | Incidentes | "Registrado y acreditado en PDTP" aunque no se acreditó nada o sólo quedó pendiente de aprobación | DEMOSTRADO | actions.ts:184,202,220,237,269; re20-panel.tsx:175,269,322,364,395 |
| INC-12 | 🟡 | Incidentes (canal público) | El canal público acepta fechas futuras o absurdas; el reporte con fecha futura no se puede convertir en incidente | DEMOSTRADO (flowA6) | prevention-incident-reports.ts:50 (sólo regex); report-form.tsx:73 (date nativo sin max) |
| INC-13 | 🟡 | Incidentes (denuncias) | La DIAT/DIEP/notificación se registra siempre con la hora actual; no se puede declarar la hora real de envío (y el servicio acepta horas futuras) | CÓDIGO | incident-workflow-panel.tsx:291 (sentAt: new Date().toISOString()); prevention-incidents.ts:207 (sin tope futuro), 1573 (wasLate) |
| INC-14 | 🟡 | Incidentes | No existe anulación ni reclasificación de tipo: un reporte duplicado o mal tipificado queda para siempre con sus obligaciones | CÓDIGO | lib/services/prevention-incidents.ts:72-80 (sin estado cancelado), 167-179 (triage sin eventType), 1132 (triage una sola vez), 366-377 (transiciones) |
| INC-15 | 🟡 | Incidentes | El incidente no admite archivos: evidencia, DIAT y resolución de reinicio son texto libre (≥3 caracteres) | CÓDIGO | prevention-incidents.ts:297-307, 203-212, 346-359; 1276 (compuerta "requiere evidencia" satisfecha por cualquier texto); incident-workflow-panel.tsx:234, 292, 332 |
| INC-19 | 🟡 | Incidentes (reporte offline) | El formulario de reporte no abre sin conexión: la cola offline sólo sirve si la página ya estaba cargada | DEMOSTRADO (flowA8) | public/sw.js:13-14 (SHELL_URLS ["/ppa"]), 97-110 (sólo navega offline /ppa) |
| INC-20 | 🟡 | Incidentes / CAPA | Los E2E no cubren el flujo RE-20 ni el ciclo CAPA; el de CAPA es condicional y vacío | CÓDIGO (lectura) | re20.spec:21-86 (reporte, detalle y export); capa-lifecycle.spec:30-59 (`if count > 0` y selectores inexistentes: "Seguimiento y avance", input[name=reference]); readiness.spec:50-55 (PRV-15 sólo abre) |
| INC-06 | 🟠 | Acciones correctivas (CAPA) | La evidencia subida a una CAPA no se puede abrir: quien verifica "evidencia y eficacia" no puede ver el archivo | DEMOSTRADO (flowA3) | [id]/page.tsx:88-95 (texto sin enlace); prevention-capa.ts:1284-1286 ("no hay ruta para descargarlo"); evidence/route.ts (sólo POST) |
| INC-17 | 🟡 | CAPA | El Excel CAPA duplica la hoja principal y trunca en 500 acciones sin avisar | DEMOSTRADO (probeA5) | lib/services/prevention-capa.ts:915 (tope 500), 1159-1161 (rowLimitApplied > 10.000), 1200-1244 (hoja primaria + la misma en sheets) |
| INC-18 | 🟡 | CAPA | La búsqueda del TopBar sólo filtra las 50 CAPA de la página actual | CÓDIGO (no había más de 50 CAPA para demostrarlo) | capa-list.tsx:86-92; page.tsx:22-38 (paginación en servidor de 50) |
| INC-16 | 🟡 | Daño material y ambiental | "Total eventos" ignora la faena seleccionada (no calza con los otros tres tiles) | DEMOSTRADO (flowA9) | app/(app)/prevencion/indicadores-material-ambiental/material-environmental-dashboard.tsx:52-63 (totals suma todas las faenas), 98-99 (tile) |
| RSK-01 | 🟠 | CGRD | La N°81 se auto-aprueba con quien registra el acta y el mismo documento puede respaldar cualquier número de sesiones | DEMOSTRADO | pdtp-accreditation-connectors.ts:866-877 (autoApproveByUserId = recordedByUserId); prevention-evidence-upload.ts:126-131 (archivo ya ligado a la faena: se reutiliza sin límite); prevention-cgrd.ts:627 (claim) y 710-716; integration-evidence.ts:103-112 |
| RSK-02 | 🟠 | MIPER | Quien revisa y aprueba una MIPER no puede ver su contenido completo | CÓDIGO (líneas citadas) | miper-workbench.tsx:190-191 (export sólo si published; entries.slice(0, 8)); prevention-risk-legal.ts:1629 (getPublishedRiskMatrix sólo published/superseded) |
| RSK-03 | 🟡 | MIPER | Reemplazar una MIPER deja vivos su disparador anual y una obligación de 30 días imposible de cerrar | DEMOSTRADO | lib/services/prevention-risk-legal.ts:534-561 (supersesión sin tocar disparadores ni obligaciones), 569-587 (se crean por versión), 1238-1240 (sólo se vinculan controles de matriz publicada), 1341-1344 (el cierre exige vínculo a controles de esa matriz) |
| RSK-04 | 🟡 | MIPER | La N°35 está planificada todos los meses, pero una publicación acredita una sola celda | DEMOSTRADO (SQL en B) | pdtp-accreditation-connectors.ts:499-528 (una ejecución por publicación, occurredAt = publishedAt) |
| RSK-05 | 🟡 | MIPER y Requisitos legales | Los borradores no se pueden corregir ni descartar | CÓDIGO + DEMOSTRADO | prevention-risk-legal.ts:299-380 (sólo addRiskEntry), 382-391, 924 (LEGAL_TRANSITIONS sin retorno ni descarte), 883-922 (sin edición); 1398 y 1411-1414 (cobertura cuenta procesos activos de cualquier matriz) |
| RSK-06 | 🟡 | MIPER (importación) | Corregir una fila importada exige editar JSON crudo y un JSON inválido se ignora sin aviso | DEMOSTRADO | app/(app)/prevencion/miper/miper-workbench.tsx:278-282 (textarea con JSON; `catch { return }`) |
| RSK-07 | 🟡 | MIPER (importación) — validador compartido con PDTP | El tope de expansión del Excel confía en los tamaños que declara el propio ZIP | DEMOSTRADO | xlsx-security.ts:60-110 (suma `uncompressed` declarado en el directorio central); prevention-risk-import.ts:295-313 (luego `workbook.xlsx.load`) |
| RSK-08 | 🟡 | MIPER y Requisitos legales | La búsqueda del TopBar se muestra pero no filtra, y no hay filtro por faena ni estado | DEMOSTRADO | ninguno de los dos usa useSafeShellHeader/searchQuery (miper-workbench.tsx:146-208; legal-requirements-workbench.tsx:44-62) |
| RSK-09 | 🟡 | Requisitos legales (también la verificación de controles MIPER) | "Cumple" se acepta con un texto de 3 caracteres como evidencia | DEMOSTRADO | risk-legal.ts:181 y 191 (evidenceReference texto, mínimo 3); risk-legal.ts:110 (verificación de control, mínimo 5); prevention-risk-legal.ts:869-881 (brecha sólo si falta el texto) |
| RSK-10 | 🟡 | Requisitos legales | Publicar un requisito exige a una segunda persona con approve_applicability, y sólo la jefa y el administrador lo tienen | DEMOSTRADO | prevention-risk-legal.ts:925 y 941-949; manifest.ts:858-866 (grants legales), 1222 (sign_own_work sólo prevencionista); prevention-risk-legal.ts:883-884 (crear requisito global sin faena) |
| RSK-11 | 🟡 | Requisitos legales | La ficha del requisito responde "no existe" para todo lo no publicado y no muestra evaluaciones ni vínculos | DEMOSTRADO | legal-requirements-workbench.tsx:58 (todos los códigos enlazan); prevention-risk-legal.ts:1676 (sólo published/superseded); [id]/page.tsx:33-35 (no pinta assessments ni links) |
| RSK-12 | 🟡 | CGRD | Un acta "extraordinaria" sin casilla acredita y auto-aprueba la N°81, aunque la UI dice que no cuenta | DEMOSTRADO | prevention-cgrd.ts:709-716 (acredita con o sin casilla); cgrd-workbench.tsx:619-625 ("no cuenta en el denominador"); cgrd.ts:107-111 |
| RSK-13 | 🟡 | CGRD | Una sesión realizada en septiembre llena la casilla de mayo y se acredita como cumplida en mayo | DEMOSTRADO | lib/services/prevention-cgrd.ts:648-669 (no compara heldOn con el mes de la casilla; plannedPeriod = celda de la casilla) |
| RSK-14 | 🟡 | CGRD | No se puede consultar un acta, su archivo ni el historial del comité; al disolverlo, todo desaparece de la pantalla | DEMOSTRADO | cgrd-workbench.tsx:336-365 (acta = código + fecha, sin detalle ni enlace), 190-228 (sólo la última matriz, sin enlace a su evidencia); page.tsx:52 y 61-67 (sólo el comité activo) |
| RSK-15 | 🟡 | CGRD | El mandato que termina antes de la constitución sólo lo frena la base, con un mensaje genérico | DEMOSTRADO | cgrd.ts:20-26 (sin refine de fechas); actions.ts:54 (fallback "No se pudo completar la acción. Intenta nuevamente.") |
| EMG-06 | 🟡 | Plan de emergencia (N°83) · Higiene (N°46–49) | La N°83 y las N°46–49 se imputan al mes del acto, no a la celda planificada; un cumplimiento tardío no paga la celda adeudada | DEMOSTRADO (navegador + SQL en B) | pdtp-accreditation-connectors.ts:630-678 (occurredAt = approvedAt, sin plannedPeriod); hygiene-accreditation-connector.ts:213-225 (occurredAt = assessedOn); compliance.ts:1194-1197 (tope por mes) |
| EMG-07 | 🟡 | Simulacros | El acta de un simulacro no se puede abrir desde ninguna pantalla | DEMOSTRADO | plan-detail.tsx:322-365 (tabla sin evidencia); evidence-href.ts:36-40 (el directorio prevention-drill-evidence no tiene ruta de descarga declarada); prevention-emergency.ts:1217-1223 (sólo trae el conteo) |
| EMG-01 | 🟠 | Higiene y vigilancia | Las ejecuciones N°46–49 (protocolos MINSAL) y N°50 (vigilancia) no guardan actor: quien hizo el pronunciamiento o registró el control aprueba su propio cumplimiento (PRV-02 sigue abierto aquí) | DEMOSTRADO | hygiene-accreditation-connector.ts:213-225 (safeAccredit sin actorUserId, aunque lo recibe en :190) y :233-269 (onSurveillanceControlAttended sin actor); prevention-hygiene.ts:870-878; executions.ts:579 (compara sólo executedByUserId) |
| EMG-02 | 🟡 | Higiene y vigilancia | Mediciones, pronunciamientos y controles con fecha futura acreditan celdas futuras; la N°45 queda aprobada automáticamente | DEMOSTRADO | hygiene.ts:33 (measuredOn sin cota), :22 (lastAssessedOn); prevention-hygiene.ts:777 (attendedOn); accreditation.ts:567-660 (sin guarda de semana futura para integraciones) |
| EMG-08 | 🟡 | Higiene y vigilancia | Una medición no se puede anular ni corregir, aunque acredita la N°45 y fija la obligación de vigilancia | CÓDIGO (no existe función) | prevention-hygiene.ts:414-540 (sólo alta); actions.ts:1-103 (sin acción de anulación) |
| EMG-09 | 🟡 | Higiene (N°45) — aplica a toda casilla con plannedPeriod anterior a una revisión del programa | Una casilla planificada antes de la revisión v2 acredita en la versión v1 cerrada; el programa activo no ve el cumplimiento | DEMOSTRADO | prevention-hygiene.ts:530 (plannedPeriod de la casilla); version-window.ts:240-252 (un programa `closed` por reemplazo acepta su ventana) |
| EMG-03 | 🟡 | Permisos de trabajo | Un control obligatorio se da por cumplido declarándolo «no aplica» con 3 caracteres, por el mismo verificador y sin revisión; el permiso se habilita | DEMOSTRADO | permits.ts:185-191; validation/permits.ts:80-84 (sólo no vacío); permit-detail.tsx:696 (minLength=3) |
| EMG-04 | 🟡 | Permisos de trabajo | Un permiso puede terminar (cancelado) con candados aplicados, y se puede aplicar un aislamiento en un permiso ya terminado | DEMOSTRADO | prevention-permits.ts:607-617 (el chequeo de LOTO sólo para closed), :385-407 (applyPermitIsolation sin guarda de estado); permits.ts:68 (suspended → cancelled) |
| EMG-05 | 🟡 | Permisos de trabajo | El solicitante que tiene permiso de aprobar puede extender su propio permiso | DEMOSTRADO | prevention-permits.ts:645-676; manifest.ts:226 (descripción del permiso: extender de forma segregada) |
| CPH-01 | 🟡 | CPHS / Estructura preventiva | Disolver o vencer el comité (o terminar un delegado) no revoca la N°11 que cuenta; la constitución crea dos ejecuciones para el mismo hecho | DEMOSTRADO (sonda PGlite, probe-result.txt) | prevention-cphs.ts:84-99 (acredita + reporta obligación), 185-195 (revoca sólo sourceType "cphs"), 1045-1052 (vencimiento, ídem); preventive-organization-connector.ts:187-209; prevention-cphs-organization.ts:158-195 (endDelegate sin revocación) |
| CPH-02 | 🟡 | CPHS / Estructura preventiva | Las fechas civiles (constitución, designación) se sellan a medianoche UTC y la N°11 del día 1 se imputa al mes anterior | DEMOSTRADO (sonda PGlite) | pdtp-accreditation-connectors.ts:303,312 (occurredAt: constitutedOn); prevention-cphs.ts:88,97; prevention-cphs-organization.ts:146; accreditation.ts:197-205 (new Date(occurredAt) + formato Chile) |
| CPH-03 | 🟡 | CPHS | El acta cerrada no se puede consultar: texto, asistencia nominal, excusas y acuerdos no se muestran en ninguna pantalla ni exportación | DEMOSTRADO | committee-detail.tsx:75-91 (MeetingInfo sin minutes/asistentes), 237-292 (fila sin enlace); page.tsx:98-113 |
| CPH-04 | 🟡 | CPHS / Estructura preventiva | El rol "cphs" (integrante del comité) puede constituir, disolver y recomponer el comité, y designar delegado | DEMOSTRADO (A, cphs-role.mjs) | modules/prevention/manifest.ts:1129-1130 (cphs → cphs:view y cphs:manage); descripción del permiso en 239 |
| CPH-05 | 🟡 | CPHS (revisión por la dirección) | La revisión corporativa (opción por defecto) no acredita la N°9, y dos de sus tres responsables no tienen el permiso para registrarla | DEMOSTRADO (B) | prevention-cphs.ts:988-995 (sólo si review.worksiteId); cphs-dialogs.tsx:88,115-116 (default "_all" = Toda la organización); manifest.ts:1136,1141,1144 (governance:review sólo prevencionista, jefa_chome, administrador) |
| CPH-06 | 🟡 | CPHS | Se aceptan constitución y revisión por la dirección con fecha futura, y acreditan en celdas futuras | DEMOSTRADO (sonda PGlite) | prevention-cphs.ts:54-64 (constitutedOn sólo regex), 893-898 (heldAt sin cota); accreditation.ts:560-622 (sin guarda de futuro en la vía de integración) |
| CPH-07 | 🟡 | Visitas y coordinación | No hay forma, desde la interfaz, de adjuntar el acta o el correo a una coordinación; la N°20 nunca llega con evidencia verificada | CÓDIGO (líneas citadas) | document-links-card.tsx:16-25 (8 tipos, sin external_engagement) y 116-122 (pide "Identificador exacto"); links.ts:39 (el servidor lo acepta); coordinacion/[id]/page.tsx:59-80 (sin sección de documentos) |
| CPH-08 | 🟡 | Visitas y coordinación (y motor de integración) | Una coordinación con fecha futura y archivo real se auto-aprueba en el mes futuro; también con documento archivado; la aprobación la firma quien cerró | DEMOSTRADO (sonda PGlite) | external-engagements.ts:20 (occurredOn sólo regex); accreditation.ts:560-622 y 902-930 (inserta approved sin isPdtpCellInFuture); integration-evidence.ts:125-137 (no mira sst_documents.status); connector:177-178 |
| CPH-09 | 🟡 | Visitas y coordinación | Una interacción no se puede editar, anular ni reabrir: un error de registro o de cierre deja la N°20 acreditada sin vía de revocación | CÓDIGO (líneas citadas) | actions.ts:36-52 (sólo crear, medida, cerrar); prevention-external-engagements.ts:135 (mensaje "reábrela"), 170-241 |
| CPH-10 | 🟡 | Visitas y coordinación | Mientras la N°20 sea "constancia" (así está en la copia real), cerrar la coordinación la difiere sin decirle nada al usuario y la N°20 sigue exigiendo el registro en Constancias | DEMOSTRADO (B) | connector:182-197; workbench:401-436 (el diálogo de cierre no informa efecto PDTP) |
| CPH-11 | 🟡 | Indicadores SST | La pantalla y el Excel muestran cifras distintas para el mismo período provisional, sin rotularlo | DEMOSTRADO (A, ind-A.mjs + openpyxl) | dashboard:44-46 (metricValue usa provisional si status=provisional), 97-100, 143-147; route.ts:59-67, 79-83, 93-97 (siempre confirmed) |
| CPH-12 | 🟡 | Indicadores SST | Se puede aprobar un denominador de un mes futuro y cerrar ese mes: queda un snapshot "cerrado" y una N°7 del futuro | DEMOSTRADO (B) | safety-indicators.ts:34-37, 88-93 (sin cota de fecha); prevention-indicadores.ts:616-714, 835-885; dashboard:61-65 (latestMonth = último con denominador), 144 (botón Cerrar si reconciled) |
| CPH-13 | 🟡 | Indicadores SST | Un mes con 0 horas trabajadas declarado y aprobado no puede cerrarse nunca, y la N°7 de ese mes queda imposible de cumplir | DEMOSTRADO (B, julio Horcones) | safety-indicators-calc.ts:323-329 (workedHours 0 → non_calculable); prevention-indicadores.ts:760-763; dashboard:75-76 y 144 (lo trata como "falta denominador"; no muestra Cerrar) |
| DOC-01 | 🟠 | Registro documental (RIOHS → N°18) | La entrega del RIOHS (N°18) se cierra y aprueba sin ningún acuse, eximiendo a toda la dotación con un motivo de 3 caracteres | DEMOSTRADO (sonda PGlite, probe-notes-run4.txt) | distribution.ts:354-362 y 413-470 (motivo ≥3, sin distinguir si el destinatario tiene cuenta); riohs-rollout-connector.ts:305-316 (reporta con texto; queda evidence_status=provided) |
| DOC-02 | 🟡 | Registro documental | Quien cargó la versión puede registrar su propia revisión | DEMOSTRADO (UI, A) | lib/services/prevention-documents/workflow.ts:211-218 (markDocumentVersionReviewed sin preventUploader) |
| DOC-03 | 🟡 | Registro documental | Archivar reescribe el estado histórico de las versiones y restaurar no lo devuelve | DEMOSTRADO (sonda) | lib/services/prevention-documents/crud.ts:382 (UPDATE a 'archivado' de toda versión ≠ vigente/aprobado, incluido 'reemplazado'); 403-433 (restore sólo toca el documento) |
| DOC-04 | 🟡 | Registro documental | Archivar la fuente no afecta a las ejecuciones pendientes: se aprueban sin aviso, y la entrega RIOHS sigue abierta | DEMOSTRADO (sonda) | lib/services/prevention-documents/crud.ts:363-387 (archiveDocument: sin efectos PDTP ni onLegalFolderDocumentChanged) |
| DOC-05 | 🟡 | Registro documental | Se asigna la lectura y acuse a personas que nunca podrán acusar (restringido sin permiso, o sin docs:view/ack) | DEMOSTRADO (sonda) | distribution.ts:81-120 (no valida los permisos del destinatario) y 253 (el acuse exige la confidencialidad); distribution.ts:527-531 (las opciones incluyen a todo usuario activo); reminders:76-97 |
| DOC-06 | 🟡 | Registro documental | La bitácora documental y el acuse registran la IP de X-Forwarded-For (falsificable) | DEMOSTRADO (A) | app/(app)/prevencion/documentacion/actions/shared.ts:25 |
| DOC-07 | 🟡 | Registro documental | El ciclo de revisión no tiene cola ni avisos: nadie sabe que le toca revisar, aprobar o publicar | CÓDIGO (grep sin notificaciones) | documentacion-view.tsx:87-96 (los "N por revisar" sin enlace); workflow.ts (sin createNotifications en todo el módulo, grep) |
| DOC-08 | 🟡 | Registro documental | Fallas silenciosas al crear carpetas y en la carga masiva | DEMOSTRADO (A) | header-actions.tsx:71-80 (si !ok no muestra nada) y 230-236 (sólo "N con error"); documentacion-upload.ts:51-55 (descarta result.message) |
| DOC-09 | 🟡 | Registro documental | "Sin trabajo del Programa Preventivo pendiente en documentación" con N°43/N°36/N°19 planificadas y sin ejecutar | DEMOSTRADO (B) | panel-server.tsx:17-19 (sólo lista instancias programadas y obligaciones) |
| DOC-10 | 🟡 | Registro documental (N°19) | El programa 2026 v2 activo no declara la carpeta de requisitos legales: la N°19 no puede acreditarse | DEMOSTRADO (B) | document-requirements.ts:146 (assertPdtpProgramEditableState: sólo en borrador) |
| DOC-21 | 🟡 | Registro documental (N°36) | La difusión N°36 sólo la acreditan usuarios con cuenta: no existe acuse público de documentos | CÓDIGO + DEMOSTRADO | actions.ts:30 y page.tsx:85 (sólo kind "permiso") |
| DOC-22 | 🟡 | Datos personales (salud / casos reservados) | Salud ocupacional y casos reservados (Ley Karin) existen sólo como API JSON, sin pantalla | DEMOSTRADO | utils.ts:274-276 ("deben registrarse en su dominio seguro"); document-integrity-workbench.tsx:95 (reubicar exige tipear el id de destino) |
| DOC-27 | 🟡 | Ficha del trabajador | La ficha dice "Sin evaluación iniciada" a un trabajador con acta cerrada y ofrece iniciar otra | DEMOSTRADO (A, prevfaena) | page.tsx:72-76; visit-context.ts:142-162 (sólo visitas con alguna evaluación en borrador; las sin visitId o cerradas no se muestran) |
| EVA-01 | 🟠 | Evaluaciones SST | El autoguardado del acta nunca se detiene y reescribe el acta completa: dos pestañas se pisan y se pierden respuestas | DEMOSTRADO | use-checklist-responses.ts:41-57 (lote con todos los ítems, incluidos los null), 67-74 (isDirty: revision > 0); use-debounced-autosave.ts:71-75 |
| EVA-02 | 🟠 | Evaluaciones SST | N°18, 23, 63 y 17 llegan al PDTP sin actor: quien cerró el acta aprueba su propio cumplimiento | DEMOSTRADO (B) | worker-onboarding-connector.ts:196-213 (safeAccredit sin actorUserId); worker-sensitivity-connector.ts:43-58 (ídem); executions.ts:579 (sólo compara executedByUserId) |
| EVA-03 | 🟠 | Evaluaciones SST (RE-28) | Los datos de salud del RE-28 los ven supervisores y jefes de terreno, en pantalla, impresión y PDF, sin auditoría de acceso | DEMOSTRADO (idor.mjs, B) | identificacion-sensibles-sections.ts:36-42 ("No lleva requiresPermission… la protección efectiva está en el archivo"); manifest.ts:52-53 (sst:view a jefe_terreno y supervisor_terreno); print/page.tsx:14 y pdf/route.ts:27 (sólo sst:view) |
| EVA-04 | 🟡 | Evaluaciones SST | Las actas cerradas no se pueden abrir desde la interfaz; la ficha dice "Sin evaluación iniciada" | DEMOSTRADO | visit-context.ts:14-36 (sólo visitas con borrador); page.tsx (currentVisitEvaluations); evaluation-list.tsx:63 (la fila lleva a la ficha) |
| EVA-05 | 🟡 | Evaluaciones SST | Una segunda acta para el mismo trabajador duplica la acreditación de N°18, 23 y 63 | DEMOSTRADO (B) | worker-onboarding-connector.ts:196-213 (sourceId por acta, no por persona); compliance.ts:1149-1178 (cobertura suma cantidades aprobadas contra el padrón) |
| EVA-06 | 🟡 | Evaluaciones SST | El servidor acepta actas con fecha futura y deja ejecuciones PDTP y obligaciones "reportadas" en semanas que no ocurrieron | DEMOSTRADO (g7-future.mjs, B) | validation/sst.ts:269; actions/evaluations.ts:29-84 (sin tope); nueva-evaluacion-form.tsx (sólo `max={today}` en el cliente) |
| EVA-07 | 🟡 | Evaluaciones SST | Un acta cerrada no se puede anular ni corregir, y sus acreditaciones no tienen revocación | CÓDIGO (líneas citadas) | lib/services/sst-module/evaluations.ts:364-366 ("Usa un flujo de anulación auditada", que no existe); 341-352 (revocación sólo al borrar un borrador) |
| EVA-08 | 🟡 | Evaluaciones SST | El cierre del acta no registra quién ni cuándo; el borrado de borradores no se audita y deja visitas huérfanas | DEMOSTRADO | sst.ts:37-66 (sin closed_at/closed_by); sst.ts:9-24 (visitas con closed/reopened que nadie escribe); evaluations.ts:285 (sólo updatedAt); 397-399 (delete sin audit) |
| EVA-09 | 🟡 | Evaluaciones SST | La N°52 se da por cumplida sin el acompañamiento del conductor líder ni la firma del supervisor | DEMOSTRADO (B) | evaluations.ts:289-318 (acredita con el acta del prevencionista); trabajador-nuevo.ts:23-31 (firmas supervisor y prevencionista, sólo impresas) |
| EVA-10 | 🟡 | Evaluaciones SST | Un rótulo de texto cuenta como "evidencia entregada" en N°15/52, y el aprobador no puede abrir el acta | DEMOSTRADO | obligations.ts:271 y 326 (hasEvidence = evidenceText no vacío → "provided"); worker-onboarding-connector.ts:222 (evidenceText "Acta de trabajador nuevo cerrada: <id>"); evidence-href.ts:1-14 (chip sin enlace) |
| EVA-11 | 🟡 | Evaluaciones SST (RE-28, N°17) | El RE-28 aparece como un segundo "Control de seguimiento", pide un motivo de seguimiento y sólo admite cargos de conductor | DEMOSTRADO | types.ts:45-48; identificacion-sensibles.ts:33 (tipo 'seguimiento'); cargos.ts:1-5 |
| EVA-20 | 🟠 | PPA público | Un PPA guardado sin conexión desde el enlace general se rechaza al sincronizar y se pierde en silencio | DEMOSTRADO | evaluaciones.ts:115-120 (rechazo sin enlace acreditado ni workerId); hooks.ts:97-101 (failed permanente); offline-queue.ts:197-206 (la UI sólo cuenta pending) |
| EVA-21 | 🟡 | PPA interno | Exportar PPA con rango de fechas descarga un "export.json" con error 400; con fechas simples se pierde el último día | DEMOSTRADO | ppa-export-button.tsx:39 (isoDateISOFormat); export-dialog.tsx:89-95; validation/ppa.ts:199-200; calculos.ts:33-34 |
| EVA-22 | 🟡 | PPA interno | Una misma prevencionista revisa, declara la corrección, la verifica, autoriza el reinicio y cierra el caso | DEMOSTRADO (ppa-step.mjs, B, PPA C8Z8…) | prevention-capa.ts:293-313 (la SoD de CAPA se exime a sourceType 'ppa'); manifest.ts:112-119 (prevencionista tiene todos los permisos); ppa-workflow-panel.tsx (texto "El reinicio requiere evidencia, verificación independiente y autorización expresa") |
| EVA-23 | 🟡 | PPA interno | La evidencia de la corrección sólo admite una URL; "Documento" y "Fotografía" se rechazan con un mensaje de rutas internas | DEMOSTRADO | ppa-workflow-panel.tsx:196-205 ("Este formulario todavía no sube archivos…"); prevention-capa.ts:782-811 |
| EVA-24 | 🟡 | PPA público | En cada envío aparece "Faltan respuestas obligatorias" al llegar al último paso | DEMOSTRADO | ppa-form.tsx:187 (Continuar → Enviar en el mismo nodo); ppa-form.hooks.ts:219-224 |
| EVA-30 | 🟡 | Inicio de Prevención | Inicio no muestra lo que el Programa Anual pide: ni ejecuciones por aprobar, ni obligaciones, ni actividades atrasadas o próximas | DEMOSTRADO (B, prev) | prevention-attention.ts:95-140; prevention-home.tsx:41-55 |

Total de filas: 152 (🔴 1 · 🟠 18 · 🟡 133).

Nota: `Submódulo` se copia del campo homónimo de cada hallazgo; PRG-04 a PRG-15 no traen ese campo en el informe (todos pertenecen a la auditoría «Programa Anual») y se rotulan «Programa Anual». `Archivo:línea` toma el campo `Línea(s)` cuando trae el archivo y, si no, `Archivo(s)` (más las líneas cuando éstas vienen sueltas).


### 3.32 Conteo por anexo

| Informe | 🔴 | 🟠 | 🟡 | 🔵 | ⚪ |
|---|---:|---:|---:|---:|---:|
| pdtp-programa.md * | 0 | 1 | 14 | 8 | 2 |
| pdtp-cumplimiento.md | 0 | 0 | 11 | 21 | 5 |
| integracion.md | 0 | 1 | 12 | 18 | 2 |
| inspecciones.md * | 1 | 0 | 10 | 14 | 1 |
| capacitacion.md * | 0 | 3 | 12 | 8 | 4 |
| incidentes.md * | 0 | 5 | 15 | 22 | 1 |
| riesgos.md | 0 | 2 | 13 | 12 | 4 |
| emergencias.md | 0 | 1 | 8 | 13 | 5 |
| comites.md | 0 | 0 | 13 | 18 | 6 |
| documental.md ** | 0 | 1 | 13 | 13 | 1 |
| evaluaciones.md | 0 | 4 | 13 | 15 | 4 |
| **Total** | 1 | 18 | 134 | 162 | 35 |

\* El informe no trae una tabla de resumen: el conteo se derivó de los ítems listados (bloques de hallazgos 🔴/🟠/🟡 y tablas 🔵/⚪). En `pdtp-programa.md` los ítems son PRG-01 (🟠), PRG-02 a 15 (🟡), 8 🔵 y 2 ⚪; en `inspecciones.md` los 🔵 incluyen INS-E2 a INS-E5 del submódulo EPP preventivo; en `capacitacion.md` CAP-13 se cuenta una vez (aparece en dos tablas); en `incidentes.md` los 🔵 son INC-M01 a M22 y el ⚪ es INC-C01.

\*\* `documental.md` declara en su resumen 🟠 1 · 🟡 13 · 🔵 13 · ⚪ 1, pero sus ítems listados suman 12 🟡 (DOC-02 a 10, 21, 22, 27) y 14 🔵 (DOC-11 a 17, 19, 20, 23 a 26 y DOC-28, que en la tabla condensada no trae emoji de severidad): la diferencia de una unidad entre 🟡 y 🔵 no se puede resolver con lo que dice el informe. En el índice de arriba figuran los 13 hallazgos con bloque detallado (1 🟠 y 12 🟡).

---

## 4. Ranking técnico por madurez

Orden por puntuación, sólo como vista de los resultados. «Bloq.» y «Crít.» cuentan los 🔴/🟠 propios del submódulo. Los transversales (T-01…T-10, INT-01) se listan aparte, en §18.

| Módulo | Readiness | Bloq. | Crít. |
|---|---:|---:|---:|
| EPP preventivo | 87 | 0 | 0 |
| A demanda y por evento (obligaciones) | 86 | 0 | 0 |
| Constancias | 86 | 0 | 0 |
| Estructura preventiva | 86 | 0 | 0 |
| Medidas | 85 | 0 | 0 |
| Plan de emergencia y simulacros | 84 | 0 | 0 |
| Datos personales | 84 | 0 | 0 |
| Aprobaciones | 81 | 0 | 0 |
| Daño material y ambiental | 80 | 0 | 0 |
| Ficha del trabajador | 80 | 0 | 0 |
| Campañas (registro histórico) | 79 | 0 | 0 |
| Permisos de trabajo | 79 | 0 | 0 |
| Indicadores SST | 79 | 0 | 0 |
| Higiene y vigilancia | 76 | 0 | 1 (EMG-01) |
| Inicio de Prevención y menú | 76 | 0 | 0 |
| Acciones correctivas (CAPA) | 75 | 0 | 1 (INC-06) |
| Requisitos legales | 73 | 0 | 0 |
| Planilla y registro de ejecución | 72 | 0 | 0 |
| Comités paritarios (CPHS) | 72 | 0 | 0 |
| Programa Anual: configuración y seguimiento | 70 | 0 | 1 (PRG-01) |
| Visitas y coordinación | 70 | 0 | 0 |
| PPA | 69 | 0 | 1 (EVA-20) |
| MIPER | 66 | 0 | 1 (RSK-02) |
| Registro documental | 66 | 0 | 1 (DOC-01) |
| Alcotest | 64 | 0 | 1 (CAP-01, compartido) |
| Incidentes y accidentes | 62 | 0 | 4 (INC-01, 02, 03, 05) |
| CGRD y mapa | 62 | 0 | 1 (RSK-01) |
| Campañas y Capacitación | 61 | 0 | 3 (CAP-01, 02, 03) |
| Evaluaciones SST | 61 | 0 | 3 (EVA-01, 02, 03) |
| **Inspecciones** | **60** | **1 (INS-01)** | 0 |
| *Motor de integración (transversal)* | *70* | — | *1 (INT-01)* |
| *Evidencias y trazabilidad (transversal)* | *70* | — | — |

**Lectura:**

- **Los más maduros** son los submódulos de alcance acotado y bien cerrados: EPP, obligaciones, constancias, estructura preventiva, emergencias y privacidad.
- **Los más inmaduros** son los que llevan más peso operativo y los que más acreditan: Inspecciones, Evaluaciones SST, Capacitación, Incidentes y CGRD.
- El promedio simple de los 30 es 74,4. **No es la nota global** (§17).

---

## 5. Auditoría del Programa Anual

Fuente: anexos `pdtp-programa.md` (configuración, 70) y `pdtp-cumplimiento.md` (registro, 72–86). Todo se ejecutó en B con un programa 2028 propio y con el 2026 v2 real, y en PGlite.

| Aspecto (§20) | Estado | Evidencia |
|---|---|---|
| Crear programa, copiar al año siguiente | ✅ | 2028 v1 creado y copiado fielmente: 81 actividades, 797 celdas (M-13 parcial por PRG-03) |
| Modificar (borrador) | ✅ | Edición, retiro con motivo, control de cambios |
| Modificar (activo → revisión v+1) | 🔴 | **PRG-01**: no hay botón para crearla en un programa sano; el E2E la crea por SQL |
| Período / año | 🟡 | **PRG-03**: aprobar el 2028 acreditó la N°1 del 2026 v2 vigente (6 ejecuciones espurias) |
| Firmas y activación | 🟡 | Segregación entre personas ✅. **PRG-02**: la firma Legal activa en el mismo clic, sin confirmación ni permiso `activate`. **PRG-11**: el rol Gerencia Legal no puede firmar; lo hace Jefatura |
| Responsables | 🟡 | Catálogo y asignación nominal ✅. **PRG-13**: una asignación con fecha anterior borra el período del responsable previo (código) |
| Actividades y fechas, recurrencia | ✅ / 🟡 | Mensual y personalizada ✅. **PRG-06**: el aviso M-14 es un falso positivo en recurrentes |
| Condicionadas y «cuando corresponda» | ✅ | Obligaciones y disparadores; no inflan el % |
| Mínimo de ejecuciones | ✅ | Tope por actividad y mes, verificado en PGlite |
| Relación con submódulo | 🟡 | Ver §8 |
| Evidencia exigida | 🟡 | **PRG-15**: 47 de 81 actividades reales no declaran qué evidencia exigen, y el servidor deja activar igual |
| Cumplimiento (tablero) | 🟡 | Plan verificado a mano en Masisa: SQL = UI = RE-36 (351). **PRG-07**: el tablero no muestra un % de cumplimiento. **PRG-14**: la tarjeta mezcla «anual» y «a la fecha». **PRG-09**: el reporte de gestión usa otro denominador (279 frente a 351) y marca como desviación lo no exigido |
| Historial | 🟡 | Control de cambios paginado ✅. **PRG-04**: no muestra a la persona, y `/admin/auditoria` atribuye cambios humanos a «Sistema» |
| Concurrencia | 🟡 | **PRG-05**: dos pestañas pierden cambios sin aviso (M-17 sigue abierto) |
| Alcance por faena | 🟡 | **PRG-10**: el RE-36 y el control de cambios de una faena muestran desvíos y nombres de otras |
| Versión y ventana | 🟡 | **EMG-09**: una casilla planificada antes de la revisión acredita en la v1 cerrada, y la v2 activa sigue sin cumplir |

**Pendientes de verificación.** El sistema de permisos denegó cuatro lecturas de esta revisión. Por eso quedaron sin ejecutar:

- el escenario controlado 100/20/60 (§25) en PGlite (sí se hizo el cálculo de §6);
- el programa vacío;
- borrar un borrador;
- crear y borrar hojas;
- editar o retirar una actividad ya cumplida. Este último requiere además la v+1 de PRG-01.

---

## 6. Auditoría de estados y cumplimiento

Fuente: `pdtp-cumplimiento.md`, con 15 casos en PGlite y 12 flujos en navegador en B. Registraron `prevfaena` y `sup`; aprobaron `prev`, `prev2` y `jefa`.

| Estado | ¿Coherente? | Verificado | Defecto |
|---|---|---|---|
| **Pendiente** | ✅ | Septiembre de una mensual queda «Pendiente», no atrasada; una celda futura no se puede declarar | CUM-02 / PRV-07 parcial: un envío pendiente o una «no realizada» en una sola semana esconden el faltante del mes |
| **Se hizo** | ✅ en el camino manual | Exige archivo real (.exe, 0 B, 26,5 MB → 400; `../` se renombra; otra faena → 404). La autoaprobación se rechaza. Una doble aprobación concurrente deja una sola ganadora. El complemento (PRV-08) y la anulación con dos personas (PRV-12) funcionan | **T-01**: por integración sí nace aprobada en semanas futuras. CUM-13: se acepta cantidad 0 |
| **No se hizo** | 🟡 | Motivo de 10 caracteres o más, autor y fecha; no se acepta a futuro | **CUM-01**: se declara sin la regla de quién puede registrar, y **borra el atraso**. Un supervisor sin botón «Registrar» la declaró en N°17. CUM-09: en Constancias no salda la deuda |
| **No aplica** | ✅ en la celda | En revisión; la autorrevisión se rechaza; CHECK revisor ≠ declarante; al aprobarse sale del denominador (44 → 43) | **CAP-02**: con varias charlas por semana, un NA sobre una sacó las 5 del denominador, y completar otra charla retiró el NA aprobado. INT-08: un hecho sin verificar retira un NA aprobado |

**Cifras del indicador en PGlite**, verificadas a mano celda por celda:

- inicial 44/0;
- con el NA, 43/9;
- con el complemento, 43/16;
- con la anulación, 43/17 → 43/16;
- con la reducción de meta, 41/16;
- **final 41/18, y a la fecha 37/18 (49 %)**.

**Aritmética del §25.**

- La regla del código es: universo evaluable = planificado − NA aprobados; cumplido = mín(ejecutado aprobado, planificado) por actividad y mes; % = cumplido / universo.
- En el escenario del encargo (100 actividades, 20 NA, 60 hechas) da **75 %**. El caso 44 → 43 muestra que el NA aprobado sale del denominador exactamente así.

**Suficiencia del modelo.** Los cuatro estados alcanzan y son coherentes. Lo que falla es **quién puede escribirlos y desde dónde**:

- «no realizada» sin autoridad (CUM-01);
- «se hizo» futuro desde integración (T-01);
- NA por celda en actividades de varias ejecuciones por semana (CAP-02).

---

## 7. Auditoría de evidencias

**Evidencia directa (archivo).**

- En el PDTP es sólida: MIME por bytes mágicos, 25 MB, nombre `nanoid`, sha256, fila de dueño y faena, y descarga por igualdad exacta.
- **PRV-01 está corregido en el motor.** 40 de 40 casos en PGlite para las 5 fuentes que se auto-aprueban: ruta inexistente, archivo de otra faena u otro dominio, URL, texto libre y sha alterado se rechazan; el archivo válido se acepta.
- Brechas:
  - **INT-02 / PRV-21:** higiene acepta un informe subido por otra persona, sin reclamarlo, y la N°45 se auto-aprueba;
  - **RSK-01:** el mismo PDF (mismo sha256) sostiene la N°81 de varias sesiones;
  - **EMG-13 / M-21:** en simulacros, la extensión sigue saliendo del nombre del cliente (un PNG guardado como `.html`).

**Evidencia interna (el registro del otro submódulo).**

- Es la vía correcta según el §22. Evita subir un PDF artificial y funciona en inspecciones, capacitación, EPP, indicadores, CPHS, MIPER y documentación.
- Brechas:
  - **T-04:** en las obligaciones, un **rótulo que genera el sistema** («0 acuse(s) y 2 exención(es)», el folio escrito a mano) cuenta como `provided` y se aprueba sin motivo (INT-05, INC-02, EVA-10, DOC-01);
  - **T-07:** en 9 submódulos la evidencia existe pero **no se puede abrir** desde ninguna pantalla:
    - declaración RE-20, ONE PAGE y seguimientos (INC-01);
    - evidencia CAPA (INC-06);
    - alcotest (CAP-22);
    - acta del simulacro (EMG-07);
    - acta CPHS (CPH-03);
    - acta CGRD (RSK-14);
    - chip de Aprobaciones sin origen (INT-11, CUM-06);
    - acta SST cerrada (EVA-04, DOC-27).

  Quien aprueba no ve lo que aprueba.

**Evidencia a largo plazo.**

- El GC ve las solicitudes de resultado (PRV-17 ✓) y sigue en modo de prueba.
- El escaneo diario recorre todos los dominios que el PDTP referencia. Pero una ejecución aprobada cuyo archivo desapareció **sigue contando**, y sin sha guardado (capacitación, inspección) no se detecta una alteración (INT-12).
- Si los documentos SST están en Cloudreve, el escaneo lee el disco local y da falsos «faltantes» (INT-14).

---

## 8. Integración entre submódulos

Mapa consolidado contra el programa 2026 v2 real de B. Detalle en el anexo `integracion.md` §10.

```text
Programa Anual 2026 v2 (81 actividades vigentes)
│
├── ✅ Inspecciones ........... 10, 24–27, 29, 33, 34, 39–41, 64, 65  (🔴 INS-01 bloquea 25/26)
├── ✅ EPP (Bodega) ........... 62
├── ✅ Estructura preventiva .. 11 (obligación)
├── ✅ Indicadores SST ........ 7   (mes con 0 HH imposible, CPH-13)
├── ✅ Constancias (manual) ... 3, 6, 20, 22, 28, 42, 44, 61, 82
├── ✅ Programa (firma) ....... 1   (🟡 PRG-03 acredita el año vigente)
├── 🟡 Capacitación ........... 16, 37, 38, 51, 53–60, 63, 85–89 (T-01, CAP-02, CAP-06)
├── 🟡 Alcotest ............... 30/31 (según rol), 32 (T-01, CAP-20/21/24)
├── 🟡 Emergencias ............ 83 (plan), 84 (simulacro) (EMG-06, INT-07)
├── 🟡 CGRD ................... 79, 80, 81 (RSK-01, RSK-12, RSK-13)
├── 🟡 CPHS ................... 9, 11 (CPH-01, CPH-05, CPH-06)
├── 🟡 Higiene ................ 45, 46–49, 50 (EMG-01, INT-02, EMG-02)
├── 🟡 Incidentes RE-20 ....... 66–78 (INC-02, INC-03, INC-07, INC-08)
├── 🟡 Evaluaciones SST ....... 15, 17, 18, 23, 52, 63 (EVA-02, EVA-05, EVA-09)
├── 🟡 MIPER .................. 35 (RSK-03, RSK-04)
├── 🟡 Documentación .......... 18, 19, 36, 43 (DOC-01, DOC-10, DOC-21)
├── 🟡 Coordinación ........... 20 (CPH-07, CPH-08; constancia en B)
├── 🟡 Requisitos legales ..... indirecta vía 19 (RSK-09)
├── ❌ correcto: Campañas (legado), CAPA, Permisos de trabajo, PPA, Privacidad, Daño material
└── 🔴 integrada incorrectamente: ninguna en su diseño; T-01 afecta a 7 fuentes
```

**Huérfanas y rotas.**

- **Actividades huérfanas: ninguna.** Toda actividad con mecanismo de enganche tiene conector vivo, y ningún conector apunta a una N° retirada.
- **Evidencias huérfanas:** una subida CGRD sin reclamar en B, más archivos que las rutas `inspecciones/evidence` y `documento` escriben antes de autorizar (INS, 🔵).
- **Asociaciones rotas:** 13 bindings a cursos `trc-*` inexistentes y 35 de campañas que ya no acreditan (M-22 parcial).
- **Doble camino:** N°63 y N°18 llegan por dos vías; el tope mensual lo contiene. La N°20 como `constancia` en B provoca doble registro hasta aplicar mecanismos (PRV-22 parcial).

**Patrones transversales de integración** (consolidan hallazgos repetidos en varias revisiones):

| ID | Sev. | Patrón | Fuentes |
|---|---|---|---|
| **T-01** | 🔴 | La acreditación por integración no tiene la guarda de semana futura (`accreditation.ts:294-303`; la guarda sólo vive en `executions.ts:110,587`). El hecho puede venir fechado en el futuro, o quedar ligado a una casilla futura, y nace aprobado | CAP-01 🟠, INT-06, CUM-10, CPH-06, CPH-08, EMG-02, EVA-06 |
| **T-03** | 🟠 | Conectores que no guardan a quien originó el hecho: N°17, 18, 23, 63, 46–50 y 76. Además, auto-aprobaciones en que registrante = aprobador por diseño: capacitación, inspección N°26 y CGRD N°81 | INT-04, EVA-02 🟠, EMG-01 🟠, INC-07, CAP-08, INS-02, RSK-01 |
| **T-04** | 🟠 | En las obligaciones integradas, un texto cuenta como evidencia `provided` y se aprueba sin motivo (`obligations.ts:271,326`) | INT-05, INC-02 🟠, EVA-10, DOC-01 |
| **T-05** | 🟡 | Un hecho tardío no salda la celda planificada, sino el mes del acto. Al revés, un hecho de septiembre llena la casilla de mayo sin marca de atraso | INT-10, EMG-06, RSK-04, RSK-13, CPH-02 (UTC) |
| **T-06** | 🟡 | Registros que acreditan y no se pueden anular ni corregir, así que un error aprobado no tiene salida trazada | INT-07, CAP-24, CPH-09, EMG-08, EVA-07, INC-14 |
| **T-07** | 🟡 | La evidencia existe pero no se puede abrir desde ninguna pantalla, así que quien aprueba ve un rótulo sin enlace (§7) | INT-11, CAP-22, EMG-07, CPH-03, RSK-14, EVA-04, DOC-27 (INC-01 e INC-06 quedan como críticos propios) |
| **T-08** | 🟡 | El buscador del TopBar aparece pero no filtra (§13) | CUM-07, RSK-08, CAP-30 |
| **T-09** | 🟡 | La trazabilidad no muestra a la persona: el control de cambios, la anulación y el cierre del acta no dicen quién | PRG-04, CUM-12, EVA-08 (y CAP-12, INT-20 🔵) |
| **T-10** | 🟡 | La bitácora append-only se elude desde la sesión (`SET LOCAL`), con `TRUNCATE` o con `DISABLE TRIGGER` | INT-09 |

**Nota:** INT-01 (saneamiento del deploy sin storage) es transversal pero conserva su ID; se eleva a 🔴 en §18.

---

## 9. Pruebas end-to-end

**Camino manual, por servicio y en navegador** (`pdtp-cumplimiento.md`):

| Variante | Resultado | ¿Correcto? |
|---|---|---|
| Realizada (PDF, aprobación por otro, doble aprobación concurrente) | Autoaprobación rechazada; una gana y la otra recibe «ya fue aprobada» | ✅ |
| No realizada | Motivo, autor y fecha; no se acepta a futuro; un supervisor sin autoridad sí puede declararla | ✅ / 🟡 CUM-01 |
| No aplica (declarar, autorrevisión, revisión por otro) | En revisión; bloquea ejecutar; al aprobarse sale del denominador (44 → 43) | ✅ |
| Vencida / parcial | 1/4 queda «Atrasada»; 1/4 más un envío queda «No programada» | ✅ / 🟡 CUM-02 |
| Futura | Manual rechazada (oct/nov); por integración, aprobada | ✅ manual / 🔴 T-01 |
| Recurrente (mensual) | Ene–ago 8/8; septiembre «Pendiente» | ✅ |
| Cuando corresponda | No infla el %; obligaciones abiertas por el hecho | ✅ |
| Múltiples ejecuciones (complemento) | Secuencia 2 en revisión; tope en el plan (feb 5/5) | ✅ / 🟡 CUM-04 (el diálogo suma lo que el indicador no suma) |
| Anulación | Dos personas; abril 2/2 → 2/1; se puede reenviar | ✅ / 🟡 CUM-12 (queda «Revertido» sin motivo visible) |
| Mes cerrado | Siete escrituras rechazadas; el cierre se niega con pendientes | ✅ |
| Doble envío, recarga, sin conexión, sesión vencida | Una sola fila; se pierden datos del formulario | ✅ / 🟡 CUM-03 |

**Desde cada submódulo (en B, programa real).** Cada anexo trae su tabla. Resumen:

- **Acreditan de punta a punta y revocan:**
  - inspecciones N°10, 24 y 64 (sin las 25/26, INS-01);
  - EPP N°62, cuya anulación revierte;
  - capacitación, donde «hecha → no hecha» revoca;
  - simulacro N°84, cuya anulación revierte (PRV-19 #8 ✓);
  - CGRD N°79/81;
  - CPHS N°11;
  - indicadores N°7, cuya reapertura revoca;
  - documentación N°43/36 (por sonda);
  - RE-20 N°66, 72 y 76.
- **Con defecto observado:**
  - T-01 en capacitación (N°53 de noviembre), alcotest (N°30 y 32 de diciembre), higiene (N°45 de diciembre) y coordinación (N°20 de diciembre);
  - T-03 en N°18 (aprobada por quien cerró el acta), N°46–50 y N°76;
  - DOC-01: N°18 cerrada con 0 acuses;
  - INC-03: N°66/67 «a tiempo» 12 h después del hecho;
  - EMG-06: N°83 aprobada en septiembre no salda marzo.

**Suite de Playwright.**

- **No se ejecutó en esta auditoría:** el permiso de sesión bloqueó el reseteo de su base (§14).
- La lectura de los specs muestra que la mayoría de los de MIPER, legal, CGRD, capacitación, emergencias y CAPA sólo comprueban que la página carga. Los flujos RE-20, el ciclo CAPA, coordinación, constitución y actas CPHS, y el cierre de indicadores no tienen E2E (RSK-26, INC-20, CPH, EMG-19).

---

## 10. Arquitectura y calidad de código transversal

**Escaneo del alcance:** 692 archivos, ~138 mil líneas. Resultado:

- 0 `any` explícitos;
- 0 `console.log`;
- 0 TODO/FIXME reales: las coincidencias son la palabra «todo»;
- 2 `catch {}` justificados, sobre localStorage;
- 3 `removeFile().catch(() => {})` de limpieza, aceptables.

**Concentración de la lógica legal:**

| Archivo | Líneas |
|---|---:|
| `prevention-incidents.ts` | 2.052 |
| `pdtp/compliance.ts` | 1.762 |
| `inspection-catalog.tsx` | 1.690 |
| `prevention-risk-legal.ts` | 1.685 |
| `pdtp/fulfillment.ts` | 1.655 |

**Debilidades de diseño que explican varios hallazgos a la vez:**

1. **Cada conector arma a mano su llamada a `accreditPdtpFromEvent`.**
   - Las guardas comunes se aplican o se omiten conector por conector: semana futura (T-01), actor de origen (T-03), evidencia verificada frente a rótulo (T-04) y celda planificada frente a mes del acto (T-05).
   - Una sola función de admisión en el motor, obligatoria para toda fuente, habría evitado la mayoría.
2. **La identidad de la fuente es texto sin FK.**
   - La consistencia entre fuente y cumplimiento depende de que cada submódulo llame a la revocación.
   - Donde no hay anulación en el origen (T-06), no hay revocación posible.
3. **Dos vocabularios de estado para la misma fila:** Medidas del PDTP frente a CAPA (INC-M22).
4. **Componente compartido roto:** `Tooltip` no reenvía props al hijo. Eso rompe `DialogTrigger asChild` en «Fijar meta por faena» (CUM-05), y **puede estar afectando a otros disparadores** envueltos igual. Conviene arreglarlo en `components/ui/tooltip.tsx`, no pantalla por pantalla.

No hay mocks ni datos simulados en producto.

---

## 11. Seguridad y permisos

**Demostrado que funciona:**

- Alcance por faena en páginas, acciones, subidas, descargas y exportaciones: `otrafaena` recibe 404 o datos vacíos en todos los submódulos.
- `ti` recibe 403 o `/forbidden` en todo.
- **Sin IDOR** en las 10 rutas de descarga, incluso con `../`, nombres codificados y subcadenas (PRV-18 ✓).
- Confidencialidad documental sensible/restringida: 404 sin el permiso.
- Salud y casos reservados: exigen propósito y membresía, y las denegaciones quedan auditadas.
- Tokens de acuse: vencidos, alterados o basura se rechazan.
- `Origin` ajeno → 403 (M-02 ✓).
- XML/SVG con script → `attachment` + `nosniff` (M-03 ✓).
- Sin XSS almacenado desde los canales públicos (incidentes y PPA).
- Fórmulas de Excel neutralizadas.
- Cuota del canal público: bloquea el envío 21.º.
- Paridad menú ↔ página ↔ permiso en los 10 roles.

**Defectos:**

| ID | Sev. | Hallazgo | Tipo |
|---|---|---|---|
| EVA-03 | 🟠 | Datos de salud del RE-28 (embarazo) visibles para `sup` y `jt` en pantalla, impresión y PDF, **sin registro** en `prevention_sensitive_access_audit` | DEMOSTRADO |
| T-03 | 🟠 | Segregación incompleta en integración (§8) | DEMOSTRADO |
| PRG-10 | 🟡 | El RE-36 y el control de cambios de una faena incluyen desvíos, motivos y nombres de otras faenas | DEMOSTRADO |
| CPH-04 | 🟡 | El rol `cphs` (integrante del comité) tiene `cphs:manage`: constituye, disuelve y recompone. `manifest.ts:1129-1130` dice que es deliberado; conviene revisarlo | DEMOSTRADO |
| INS-08 / INS-09 | 🟡 | `prevencionista_faena` y `admin_contrato` pueden recablear plantillas globales vigentes. La aprobación de plantillas no está segregada, al revés de lo que dice el manifiesto | DEMOSTRADO |
| EMG-05 | 🟡 | El solicitante con permiso de aprobar extiende su propio permiso de trabajo | DEMOSTRADO |
| DOC-02 | 🟡 | Autorrevisión documental: el ciclo se reduce a dos personas | DEMOSTRADO |
| EVA-22 | 🟡 | Una sola persona revisa, declara, verifica, autoriza el reinicio y cierra un PPA | DEMOSTRADO |
| INC-09 | 🟡 | Quien completó la investigación autoriza el reinicio si no figura en el equipo | DEMOSTRADO (PGlite) |
| INT-09 | 🟡 | La bitácora se elude con `SET LOCAL app.audit_maintenance='on'`, con `TRUNCATE` o con `DISABLE TRIGGER` (re-verificado en `0340_audit_append_only.sql`) | DEMOSTRADO |
| RSK-07 | 🟡 | Un ZIP con tamaños falsos se salta el límite de expansión de Excel: 185 KB → 180 MB. El validador es el mismo de la importación PDTP | DEMOSTRADO aislado; caída del servidor TEÓRICA |
| DOC-06 | 🟡 | La bitácora documental y el acuse guardan la IP de `X-Forwarded-For` (M-04 parcial) | DEMOSTRADO |
| — | 🟡 | `npm audit`: `undici@7.29.0` (dependencia directa y vía `jsdom`) con 10 avisos altos/críticos fuera del allowlist. En runtime sólo lo usa `lib/services/dte-portal/client.ts`, fuera de Prevención, pero **la puerta de CI falla** | DEMOSTRADO |

**Sin demostrar:**

- escalamiento de privilegios;
- inyección SQL: no hay `sql.raw` con entrada de usuario en el alcance;
- acceso anónimo a datos internos.

---

## 12. Integridad de datos

**Lo sólido:**

- CHECK de motivo, de revisor distinto y de rango de %;
- índice de un solo desvío abierto por celda;
- `RESTRICT` en ejecuciones, cierres, desvíos, subidas y metas (M-07 ✓);
- lock e id determinista por celda;
- cierres mensual y anual que congelan con digest.

**Defectos:**

- **INT-01 🔴 (§18): corrupción masiva del estado de cumplimiento en cada deploy.** Es reversible y queda trazada, pero afecta a todas las auto-aprobaciones.
- **INS-01 🔴:** el CHECK de 0–10000 impide guardar el % erróneo, lo que protege la base pero bloquea el flujo. Donde no revienta, se guarda un % inflado (89 % en vez de 84 %).
- **Duplicados:**
  - constituir un CPHS crea dos ejecuciones N°11 por el mismo hecho, y disolverlo revoca sólo una (CPH-01);
  - una segunda acta del mismo trabajador duplica las N°18/23/63 (EVA-05);
  - reabrir y cerrar una inspección duplica el hallazgo con CAPA (INS-03).
- **Estados imposibles:**
  - un permiso cancelado con candados LOTO aplicados (EMG-04);
  - un incidente que no se puede cerrar por tener una CAPA cancelada (INC-05);
  - un plazo MIPER de 30 días que no se puede cerrar nunca tras un reemplazo (RSK-03).
- **Historia reescrita:** archivar un documento convierte una versión `reemplazado` en `archivado`, y restaurar no lo revierte (DOC-03).
- **Fechas en UTC** en la constitución y designación CPHS: un comité del 01-09 acredita en agosto (CPH-02). El export de daño material usa `getFullYear()` (C-05 parcial).

---

## 13. UX/UI transversal

**Lo que es consistente:**

- `PageHeader` y `PageContainer` en todas las páginas;
- ningún h1 duplicado. La rareza del h1 en `/prevencion` era el esqueleto `loading.tsx` rotulado «Evaluaciones SST» (EVA-33);
- sin desborde de página a 1024, 768 y 390 px en la gran mayoría;
- `EmptyState` con CTA en los tableros;
- `DatePicker` en los formularios revisados.

**Inconsistencias entre módulos:**

1. **Buscador del TopBar que no filtra** en la planilla, Aprobaciones, MIPER, requisitos legales y Campañas: 13 → 13 filas (T-08: CUM-07, RSK-08, CAP-30). Contradice la regla de búsqueda de `AGENTS.md`.
2. **Evidencia que no se puede abrir** en 9 submódulos (T-07, §7). En la mayoría, quien aprueba ve un chip sin enlace.
3. **Éxito y error silenciosos:**
   - sin aviso tras constituir, disolver o cerrar actas en CPHS;
   - una carpeta duplicada deja el diálogo abierto sin mensaje (DOC-08);
   - «No se pudo completar la operación» en INS-01, en RSK-15 y en la carga masiva documental;
   - los mensajes «…acreditado en PDTP» aparecen sin haber acreditado (INC-11).
4. **Cantidad de información sin filtro:**
   - la grilla de capacitación tiene 390 tarjetas por faena y 2.731 para roles globales (20 MB de HTML, CAP-03);
   - la cola de Aprobaciones muestra botones idénticos («✓ Sep · sem. 2» ×7) sin quién, cuánto ni qué (CUM-06, INS-E1).
5. **Formularios que pierden lo escrito:**
   - el registro de ejecución vuelve la cantidad a 1 y borra observación y archivo al fallar (CUM-03);
   - el autoguardado infinito del acta SST (EVA-01);
   - la importación MIPER se corrige editando JSON a mano (RSK-06).
6. **Inicio no refleja el programa.** En B el tablero PDTP marca 38 por aprobar y 13 obligaciones, e Inicio no muestra ninguna (EVA-30).
7. **Vocabulario:** jerga interna en capacitación (CAP-16), estados crudos e ids en Excel (CPH), RE-28 presentado como un segundo «Control de seguimiento» (EVA-11).
8. **Clics medidos:**

   | Tarea | Clics |
   |---|---:|
   | Registrar con evidencia | 3 |
   | Aprobar | 1 |
   | Aprobar un plan de emergencia | 2 |
   | Completar un simulacro | 7 |
   | Reportar un cuasi accidente a 390 px | 7 toques |
   | Cerrar una CAPA (entre 3 personas) | 10 |
   | Solicitar y habilitar un permiso LOTO (2 personas) | 52 |

   Salvo el permiso de trabajo, los flujos son razonables.

---

## 14. Testing

**Puertas deterministas**, ejecutadas sobre `11e67621`:

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | ✅ PASS (50 s) |
| `npm run lint` | ✅ PASS (56 s) |
| `npm run check:secrets` | ✅ PASS |
| `npm run check:security-audit` | 🔴 **FALLA**: `undici` 7.0.0–7.29.0, 10 avisos altos/críticos fuera del allowlist |
| `npm run db:verify-migrations` | ✅ PASS: 343 entradas hasta 0342, checksums verificados |
| Migraciones 0336–0342 sobre la copia de `bodega_dev` | ✅ aplicadas en menos de 1 s (condición de despliegue n.º 1 del informe de fixes, verificada sobre datos de desarrollo, no de producción) |
| `npm run test:fast` | ✅ **10.331 PASS**, 0 fallos (283 omitidos: las `*-postgres` sin variables, a propósito) |
| `npm run test:pglite` | ✅ **2.808 PASS**, 1 omitido, 0 fallos (229 archivos, 9 min 19 s) |
| Suites `*-postgres` del alcance (de a una, contenedor desechable) | ✅ todas PASS, ninguna omitida: inspecciones 91, emergencias 23, permisos 22, riesgo-legal 21, CPHS 20, higiene 15, EPP 10, privacidad 6, incidentes 4 + concurrencia 1, CAPA 4, indicadores 4, CGRD 2 |
| Suites puntuales de las 11 revisiones | ✅ ~2.200 unitarias y ~1.100 PGlite, todas PASS |
| `npm run test:e2e` / Playwright | ⚠️ **no ejecutado**: el permiso de sesión denegó el reseteo destructivo de su base |

**Brechas de cobertura en caminos críticos**, sin prueba que los cubra:

- INS-01 (% de inspecciones) e INS-03;
- T-01 (semana futura por integración);
- T-03 por conector;
- el ciclo RE-20 completo;
- el ciclo CAPA en E2E: el spec es condicional y queda vacío;
- coordinación;
- constitución y actas CPHS;
- cierre de indicadores;
- el autoguardado del acta (EVA-01);
- el saneamiento del deploy con el storage montado (INT-01).

Cada defecto demostrado debería nacer como prueba en rojo junto con su corrección.

---

## 15. Performance

Problemas verificables:

- **CAP-03:** la vista inicial de capacitación carga 2.731 tarjetas y 20,3 MB de HTML para roles globales.
- **EVA-01:** el autoguardado del acta manda 14 solicitudes en 12 s, cada una reescribiendo el acta entera.
- **CAP-26:** alcotest carga tablas completas y filtra en memoria.
- **INC-17 / INC-18:** el Excel CAPA se corta en 500 sin avisar, y la búsqueda sólo filtra la página cargada.
- **M-11 parcial:** la cola de Aprobaciones no pagina. El volumen actual no lo justifica.

El tablero PDTP ya se optimizó en T7b y no mostró problemas en B. No se proponen optimizaciones fuera de éstas.

---

## 16. Observabilidad

Fuente: `integracion.md` §9.

**Crons:**

| Job | Hora |
|---|---|
| `pdtp-daily-reconcile` | 05:45, pasos independientes y aviso si falla uno |
| `prevention-cron-staleness` | cada hora; cubre 13 jobs |
| `backup-health` | 08:40 |
| `pdtp-evidence-integrity` | 05:15 |
| `pdtp-evidence-gc` | 04:30, en modo de prueba |

**Faltantes:**

- **INT-01:** los one-shot del deploy corren sin storage.
- `backup-health` no deja fila en `cron_runs`, así que la vigilancia de staleness no lo cubre.
- Nadie detecta la caída del contenedor `cron`.
- `backup-scheduler` vive bajo `profiles: ["backup"]` y el deploy no lo levanta.
- En producción el log está en nivel `warn`, sin captura externa, y se pierde al recrear el contenedor (INT-25).

**«Si mañana desaparecen evidencias, ¿podemos saber qué ocurrió y recuperarlas?»**

- **Detectarlo:** sí, al día siguiente, para lo que el PDTP referencia.
- **Saber qué ocurrió:** sólo si lo hizo la aplicación.
- **Recuperarlas:** sí, del respaldo nocturno cifrado, con el procedimiento selectivo documentado. Pero:
  - el RPO es de 24 h;
  - depende de un `backup-scheduler` que nadie levanta en el deploy;
  - la ejecución afectada sigue contando mientras tanto.

---

## 17. Production Readiness Global

```text
PRODUCTION READINESS — PREVENCIÓN

59 / 100   (tope §33 aplicado; sin tope: 64,5)

Estado:
Desarrollo significativo pendiente (40–59), por el tope.
Sin el tope: No listo para producción (60–69).
```

| Área | Puntos | Nota | Descuentos principales |
|---|---:|---:|---|
| Calidad funcional de los submódulos | 15 | **10,5** | Media funcional de los 30 submódulos 18,6/25 (74 %) → 11,1. INS-01 bloqueador (−0,6) |
| UI/UX y facilidad de uso global | 15 | **10** | Media UI 14,4/20 (72 %) → 10,8. T-07, T-08, éxito/error silenciosos, CAP-03, CUM-06 (−0,8) |
| Programa Anual y cumplimiento | 20 | **14** | Núcleo y cálculo verificados (+). PRG-01 (−1,5), CUM-01 (−1), EMG-09 (−0,5), PRG-03 (−0,5), PRG-15 (−0,5), PRG-04/05 (−0,5), PRV-07 parcial (−0,5), CAP-02 (−0,5), PRG-07/14 (−0,5) |
| Integración Programa ↔ Submódulos | 15 | **8,5** | Nota transversal 70 → 10,5. INS-01 bloquea N°25/26 (−0,5), DOC-10 N°19 no configurable (−0,5), INC-03 plazos RE-20 (−0,5), T-05 (−0,5) |
| Evidencias y trazabilidad | 10 | **5,5** | Nota transversal 70 → 7. T-07 (−0,5), RSK-01 (−0,5), PRG-04 / T-09 (−0,5) |
| Integridad de datos | 8 | **5** | Media 11,3/15 (75 %) → 6. INT-01 (−1) |
| Código y arquitectura | 5 | **4** | Código limpio. Admisión duplicada por conector (§10 punto 1) |
| Roles y seguridad | 5 | **3** | EVA-03 (−0,75), T-03 (−0,5), PRG-10 (−0,25), `npm audit` (−0,25), resto (−0,25) |
| Testing y estabilidad | 4 | **2,5** | Puertas en verde salvo `npm audit`; E2E no ejecutado; flujos críticos sin prueba |
| Operación y observabilidad | 3 | **1,5** | INT-01, respaldo fuera del deploy, logs efímeros |
| **Total** | **100** | **64,5** | **→ 59 por el tope** |

**Topes del §33.**

- **Tope 59: aplica.** Hay tres problemas demostrados que caen en sus supuestos:
  1. **Manipulación arbitraria del cumplimiento (T-01).** Una sola persona registra hoy un hecho con fecha futura o lo liga a una casilla futura, y el programa cuenta como **cumplida y aprobada** una actividad que no pudo ocurrir. Se demostró en capacitación, alcotest, higiene, CPHS, coordinación y actas SST. A diferencia de PRV-01/02 del 28-09, aquí no hay un hecho real que sostenga el cumplimiento.
  2. **Corrupción del estado de cumplimiento (INT-01).** Cada deploy devuelve a revisión, por la razón equivocada, todas las auto-aprobaciones verificadas. Es reversible y queda trazada, pero es masiva y automática.
  3. **Acceso no autorizado a datos de salud (EVA-03).** Datos sensibles del RE-28 visibles para supervisión, sin registro de acceso.

  Basta cualquiera de los tres. Corregir T-01 y INT-01 es de esfuerzo bajo; EVA-03, medio.
- **Tope 69 (flujo principal):** no se usa, porque el 59 es más estricto. El flujo funciona para la mayoría de las actividades y está roto para N°25/26 (INS-01), N°19 (DOC-10) y N°18 sin acuses (DOC-01).
- **Tope 69 (mocks):** no aplica.

**Comparación con el 28-09 (68).** No es la misma medición.

- La anterior auditó el núcleo PDTP con un solo usuario con todos los roles.
- Ésta auditó los 30 submódulos con 10 roles reales, sobre el programa real, y encontró defectos en superficies que la otra no recorrió.
- **El núcleo mejoró:** PRV-01, PRV-02 manual, PRV-03 manual, 05, 08, 12, 15, 17, 18 y 20 están verificados.
- **La autoevaluación de ~92 del informe de fixes no se sostiene** en el alcance completo.

---

## 18. Bloqueadores de producción

| ID | Qué | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|
| **INS-01** | El % de cumplimiento de inspecciones suma los «Cumple» de secciones que no puntúan. El Reporte Diario de Equipos da 263 %, viola el CHECK y no cierra: **N°25 y N°26 no se acreditan**. En otras plantillas el % sale inflado | DEMOSTRADO en navegador, HTTP, log y vitest. Código re-verificado: `lib/prevention/inspections.ts:445-458` (numerador sin filtro, denominador con `countsForCompliance`) | Contar conformes y parciales sólo si el ítem puntúa, más una prueba de regresión con la plantilla real | Bajo |
| **T-01** | La acreditación por integración acepta y **auto-aprueba** semanas futuras (PRV-03 sólo cubre el camino manual) | DEMOSTRADO en 7 revisiones: B N°53 nov, N°30/32 dic, N°45 dic, N°20 dic; PGlite CPHS y SST | Aplicar `isPdtpCellInFuture` dentro de `accreditPdtpFromEvent`, en la transacción. Validar fecha ≤ hoy (Chile) en los esquemas de cada submódulo. Sanear lo ya aprobado (el script existe) | Bajo |
| **INT-01** | Los one-shot `apply-pdtp-unverified-approvals` y `reconcile-pdtp-fulfillment-events` corren **sin el volumen de storage** (`docker-compose.yml:809-846`, sin `STORAGE_PATH` ni `volumes`). Cada deploy (`scripts/deploy-prod.sh:643`) devuelve a revisión todas las auto-aprobaciones legítimas | DEMOSTRADO en una base propia (0 hallazgos con storage, reversión sin él). Compose re-verificado | Montar `bodega-storage:/data/storage:ro` con `STORAGE_PATH=/data/storage` en ambos servicios. **Revisar la salida del último deploy** de `da539f8b`; si revirtió, revertir con `pdtp:revert-revoked-approvals` o re-aprobar | Bajo |

---

## 19. Qué falta obligatoriamente

**Bloqueadores**

- [ ] INS-01: corregir `summarizeCompliance` y agregar su prueba.
- [ ] T-01: guarda de semana futura en el motor de integración y validación de fecha en los submódulos; sanear las aprobaciones futuras existentes.
- [ ] INT-01: storage en los one-shot del deploy, y verificar qué hizo el último deploy en producción.

**Críticos**

- [ ] **T-03:** guardar el actor de origen en N°17, 18, 23, 63, 46–50 y 76. Decidir expresamente si capacitación, inspección N°26 y CGRD N°81 pueden auto-aprobarse con el mismo registrante; hoy es implícito.
- [ ] **T-04:** en las obligaciones integradas, un rótulo no es `provided`. Exigir motivo al aprobar, como en PRV-02.
- [ ] **DOC-01:** la N°18 no se cierra sin acuses. La exención exige motivo real y no cuenta como entrega.
- [ ] **RSK-01:** impedir reutilizar el mismo archivo (sha) en varias sesiones CGRD, y decidir la auto-aprobación de la N°81.
- [ ] **INC-03:** los plazos RE-20 se cuentan desde la hora de ocurrencia.
- [ ] **INC-01 / INC-06:** mostrar y descargar la declaración, el ONE PAGE, los seguimientos y la evidencia CAPA.
- [ ] **INC-05:** una CAPA cancelada no impide cerrar el incidente.
- [ ] **EVA-03:** restringir los datos de salud del RE-28 y auditar el acceso.
- [ ] **EVA-01:** detener el autoguardado cuando no hay cambios y proteger la edición concurrente del acta.
- [ ] **EVA-20:** el PPA sin conexión desde el QR general no puede prometer un envío que fallará.
- [ ] **PRG-01:** botón para crear la revisión v+1 de un programa activo.
- [ ] **CAP-02:** el NA de una charla no saca las demás de la semana, y completar otra no retira un NA aprobado.
- [ ] **CAP-03:** filtro por mes y semana en curso en la grilla de capacitación.
- [ ] **RSK-02:** quien revisa o aprueba una MIPER ve la matriz completa, o puede exportarla, antes de publicar.

**Verificaciones del ambiente de destino**

- [ ] Mecanismo real de la N°20 (`pdtp:apply-mechanisms`) y requisitos documentales de la N°19 en el programa activo (DOC-10: hoy son 0 y sólo se editan en borrador).
- [ ] `backup-scheduler` activo. `PDTP_EVIDENCE_GC_DELETE` vacío. Nombre de la base de producción fuera de la exención del trigger 0340.
- [ ] Puerta `check:security-audit` en verde: actualizar `undici` o justificar con fecha.
- [ ] `npm run test:e2e` completo en verde sobre el commit a liberar.
- [ ] Recorrido por rol con usuarios `QA_` en staging, repitiendo los flujos de §9.

---

## 20. Qué puede esperar

Todo esto es **recomendable antes del lanzamiento o inmediatamente después** (clasificación B):

- **Los 🟡 transversales:**
  - T-05: celda planificada frente a mes del acto;
  - T-06: anulación en los orígenes que acreditan;
  - T-07: enlaces a la evidencia;
  - T-08: el buscador del TopBar;
  - T-09: la persona en el control de cambios;
  - T-10 / INT-09: bitácora con `REVOKE` al rol de la aplicación.
- **Programa:** PRG-02 a 15, CUM-01 a 12.
- **Permisos de trabajo:** EMG-03 a 05.
- **Higiene e inspecciones:** INT-02 y EMG-02; INS-02 a 10.
- **CPHS:** CPH-01 a 13.
- **Documentación:** DOC-02 a 27.
- **Seguridad:** RSK-07 (zip-bomb), DOC-06 (IP).

**Mejoras post-producción** (clasificación C): los 162 🔵 y 35 ⚪ de los anexos. Entre ellos:

- KPI sin acción;
- avisos de éxito;
- estados crudos en Excel;
- jerga;
- bindings muertos;
- rendimiento de alcotest;
- UTC en exportaciones;
- el esqueleto `loading.tsx` de `/prevencion`.

**Fuera de alcance** (clasificación D; convertirían el módulo en un ERP preventivo):

- flujos de aprobación configurables por actividad;
- firma electrónica avanzada de cada evidencia;
- versionado documental propio de las evidencias;
- BI adicional sobre el tablero;
- app móvil nativa;
- una pantalla propia para salud ocupacional y casos reservados. Hoy son API, y basta con que la biblioteca no remita a un «dominio seguro» inexistente (DOC-22).

---

## 21. Roadmap de estabilización

```text
FASE 1 — Bloqueadores por submódulo
  INS-01 · T-01 (+ saneamiento de futuras) · INT-01 (+ revisar el último deploy)

FASE 2 — Lógica funcional
  CAP-02 · INC-03 · INC-05 · CUM-01 · CUM-02 · PRG-01 · PRG-03 · CPH-01 · EVA-01 · RSK-03 · EMG-04

FASE 3 — Integración de los submódulos con el Programa Anual
  Función única de admisión en el motor, obligatoria para toda fuente, con semana futura,
  actor, evidencia verificada frente a rótulo y celda planificada (T-01, T-03, T-04, T-05) ·
  DOC-01 · DOC-10 · RSK-01 · EMG-09 · anulación trazada en los orígenes (T-06)

FASE 4 — UX/UI transversal
  Arreglar Tooltip (CUM-05) · T-07 enlaces a evidencia · T-08 buscador · CAP-03 · CUM-03 ·
  CUM-06 · EVA-30 Inicio con el programa · avisos de éxito y error

FASE 5 — Permisos, seguridad e integridad
  EVA-03 · PRG-10 · CPH-04 (decisión) · INS-08/09 · EMG-05 · DOC-02 · INT-09 (REVOKE) ·
  RSK-07 · DOC-06 · undici

FASE 6 — Testing y estabilización
  Prueba en rojo → verde por cada defecto demostrado · E2E de RE-20, CAPA, CPHS,
  coordinación, cierre de indicadores y acta SST · test:e2e completo · storage montado en el
  deploy probado

FASE 7 — Validación final de producción
  Verificaciones de ambiente (§19) · recorrido por rol con usuarios QA_ en staging ·
  ensayo de restauración selectiva de evidencia · nueva medición contra esta matriz
```

---

## Veredicto final

```text
PRODUCTION READINESS: 59/100

Estado:
Desarrollo significativo pendiente (40–59), por el tope del §33.
Sin el tope: 64,5, No listo para producción.

Submódulos auditados: 30 (más el motor de integración transversal)

Submódulo con menor readiness:
Inspecciones (60/100). El % de cumplimiento está mal calculado y bloquea N°25/26.

Bloqueadores: 3
Críticos: 15
Importantes: 104
Mejoras: 162 (más 35 cosméticos)

Principal riesgo:
El programa puede afirmar cumplimiento que no existe. Un submódulo registra hoy un hecho
con fecha o casilla futura y la actividad queda aprobada, sin segunda persona. En varias
fuentes, además, quien originó el hecho aprueba su propio cumplimiento o la «evidencia»
es un texto del sistema. A eso se suma el saneamiento del deploy, que corre sin storage y
revertiría en cada despliegue las auto-aprobaciones legítimas.

Principal problema funcional:
El cálculo de % de inspecciones (INS-01): el Reporte Diario de Equipos no se puede cerrar,
las N°25/26 no se acreditan y los demás porcentajes salen inflados.

Principal problema de UI/UX:
La evidencia existe pero no se puede abrir. En 9 submódulos quien revisa o aprueba ve un
rótulo sin enlace, y la cola de Aprobaciones no dice quién, cuánto ni de qué registro viene
cada envío.

Principal problema técnico:
Cada conector arma a mano su acreditación, así que las guardas comunes (semana futura,
actor de origen, evidencia verificada, celda planificada) se aplican o se omiten fuente
por fuente. Falta una función única de admisión en el motor.

Principal fortaleza:
Un núcleo manual riguroso y verificado. Cuatro estados bien diferenciados; evidencia real
con sha256, dueño y faena; segregación y «no aplica» con revisión reforzados por CHECK;
indicador exacto celda por celda; cierres que congelan; alcance por faena sin IDOR en
todas las descargas; código limpio.

Condición mínima para producción:
Corregir INS-01, T-01 e INT-01 con sus pruebas. Revisar qué hizo el último deploy. Guardar
el actor de origen en todos los conectores (T-03) y dejar de contar rótulos como evidencia
(T-04). Corregir DOC-01, RSK-01, INC-03 y EVA-03. Configurar N°19 y N°20 en el programa
activo. Dejar en verde `check:security-audit` y `test:e2e`. Repetir el recorrido por rol.

Qué NO necesita implementarse antes de producción:
Nuevos submódulos o conectores, más KPI o vistas, pantallas propias de salud y casos
reservados, flujos de aprobación configurables, firma electrónica avanzada, BI adicional,
app móvil, rediseño visual. El producto tiene más superficie de la que necesita. Lo que
falta es cerrar la confianza en lo que ya acredita.
```
