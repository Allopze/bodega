# Informe pdtp-programa (prefijo PRG-) — Programa Anual (PDTP): configuración y seguimiento

**Fecha:** 2026-09-29 · **Build:** HEAD `11e67621` (entornos A :3100 y B :3101) · **Modo:** diagnóstico, sin cambios de código.
**Evidencia de trabajo:** `scratchpad/audit/pdtp-programa/` (scripts `.mjs`, capturas en `shots/`, exportaciones `.xlsx`, `calc.sql`, `evidence-N1-cross-year.txt`, `tests-pglite.log`).

> **Aviso de proceso (leer primero).**
> 1. El sistema de permisos denegó, a mitad de la auditoría, cuatro acciones de solo lectura: un `grep` de las funciones exportadas de `re36-document.ts`, `management-report.ts`, `period-closures.ts`, `deviations.ts` y `worksites.ts`; la lectura de `assignees.ts:196-275`; un `grep` de C-05 en `indicadores-material-ambiental/page.tsx`; y un recorrido de navegador de solo lectura de `/prevencion/pdtp/programas` como `prevfaena`. El motivo que dio fue "Modify Shared Resources". Probablemente reaccionó a una limpieza que hice en la base B (punto 3). No reintenté ninguna por otra vía.
> 2. Por la misma razón **no creé el archivo temporal `*.audit-tmp.test.ts`** para el escenario controlado en PGlite (100 actividades / 20 NA / 60 hechas). La verificación matemática del §25 se hizo con **SQL de lectura sobre la base B y con las exportaciones reales**. Ver §25.
> 3. **Mutaciones que hice en los entornos:**
>    - **A:** creé el borrador `pdtp-2028-v1` (copia del juguete 2026, 2 actividades).
>    - **B:** creé `pdtp-2028-v1` (copia de 2026 v2). Le agregué la N°90 y **publiqué en el catálogo global** la actividad `PDT-QA-PRG-MENSUAL` («QA_PRG_ Revisión mensual de orden y aseo»). Además edité la N°7, cambié el responsable de la N°6, retiré la N°17 y declaré un documento en la carpeta N°19. Después lo envié a revisión, lo aprobé y **lo activé**, lo que materializó 72 ocurrencias en 2028.
>    - Al aprobar ese programa se crearon **6 ejecuciones `submitted` en la N°1 del programa real 2026 v2**, más 1 evento de libro y 1 destino (PRG-03). Guardé la evidencia y **las borré con un `DELETE` directo**: `pdtp_executions` donde `source_id='pdtp-2028-v1'`, más su evento y su destino. Lo declaro porque es una escritura directa en una base compartida.
>    - El título del 2028 quedó con el nombre por defecto. No alcancé a renombrarlo a `QA_PRG_`.

---

## AUDITORÍA — Programa Anual: configuración y seguimiento

**Rutas:**
- `/prevencion/pdtp` (tablero) y `/programas`;
- `/nuevo`;
- `/[programId]`, con `/editar`, `/habilitacion`, `/reporte`, `/cierres` y `/cierres/[closureId]`;
- `/cierres`, `/plantillas`, `/aplicabilidad` y `/cobertura`;
- además, `/admin/pdtp-catalogos`, que es necesaria para crear actividades nuevas.

**Archivos principales:**
- `app/(app)/prevencion/pdtp/page.tsx`
- `[programId]/page.tsx`, `program-lifecycle-controls.tsx`, `pdtp-indicators-panel.tsx`, `pdtp-dashboard-charts.tsx`
- `actions/program-crud.ts`, `actions/program-lifecycle.ts`, `actions/activities.ts`
- `components/prevention/pdtp-activity-creator.tsx`
- `lib/services/pdtp/{programs,lifecycle,approval-flow,activities,assignees,compliance,helpers,period}.ts`
- `api/prevencion/pdtp/{export,reporte-gestion,expediente-auditor}`

**Permisos** (verificados con SQL sobre `role_permissions` de A y B, que son idénticos en lo relevante):

| Permiso | Roles |
|---|---|
| `program:manage` y `submit_review` | prevencionista, administrador |
| `approve` | prevencionista, jefa_chome, administrador |
| `sign_legal`, `activate` y `lifecycle:manage` | jefa_chome, administrador |
| `gerente_legal_rrhh` | sólo `view` y `execute` |
| `admin:pdtp_catalog` | prevencionista, jefa_chome, administrador |

### A. UI/UX/Diseño

- **Patrón:**
  - Se respeta `PageHeader` y `PageContainer`, con acciones en la cabecera.
  - Tablero: 4 KPI, todos con enlace (cumple A1). Estados con `Badge` y label en español.
  - Sin errores de consola ni respuestas ≥400 en 16 rutas × admin/prev (B) y 8 rutas × 6 roles.
  - 0 px de desborde de página a 390, 768, 1024 y 1440. Las tablas anchas se desplazan dentro de su contenedor (editor a 768 px: tabla de 2.726 px con scroll interno).
  - Un solo h1 visible bajo `lg`; a partir de `lg` va en el TopBar.
- **Prueba de los 5 segundos: falla en las dos pantallas centrales.**
  - El tablero muestra conteos (Ejecutadas 18, Pendientes 569, Atrasadas 0, Acciones 1), pero **ningún % de cumplimiento**.
  - La tarjeta «Avance anual por faena» dice que *«no es el cumplimiento a la fecha del resumen»*, un resumen que no existe en esa página (PRG-07).
  - En la ficha del programa, «Cumplimiento a la fecha» aparece recién después de Linaje, Actividades listas, Toma de conocimiento (7 faenas) y Estado del programa: ~1.000 px a 1440 y varias pantallas a 390.
- **Estados observados:**

| Estado | Dónde se observó |
|---|---|
| Sin información | Tablero sin ejecuciones: «Aún no hay ejecuciones acreditadas» + CTA |
| Con información | B, Horcones |
| Operación exitosa | Toasts de aprobación |
| Operación fallida | Toast «La persona que elaboró el programa no puede resolver el paso…»; «Revisa los campos marcados.»; «La actividad ya está incorporada» |
| Permisos insuficientes | `ti` → `/forbidden` en las 12 rutas; `otrafaena`/`prevfaena` → `/forbidden` en `/nuevo`, `/editar`, `/plantillas` y `/admin/pdtp-catalogos` |
| Borrador bloqueado por compuerta | N°19 sin documentos |

  No vi **Cargando** ni **Error** (hay `loading.tsx` y `error.tsx` en `habilitacion`).

- **Consistencia:**
  - La asignación nominal usa `<input type="date">` nativo (`pdtp-assignee-picker.tsx:171-177`), contra la regla A6.
  - El breadcrumb de `/nuevo` omite «Prevención».
  - La copia de año se rotula «Linaje de revisión v2 → v1» (PRG-16).

### Facilidad de uso (tareas y clics)

| Tarea | Resultado |
|---|---|
| Crear programa del año (copia) | 3 acciones (año, origen recomendado, Crear) y ~4 s. Doble envío desde dos pestañas: una crea y la otra recibe «El programa 2028 ya existe (v1); no se creó otro» ✅ |
| Agregar una actividad existente del catálogo | 5 clics, pero el selector lista las 87 del catálogo **incluidas las ya incorporadas**, y sólo al guardar dice «ya está incorporada» |
| **Crear una actividad nueva con recurrencia mensual y responsable** | Imposible desde el editor. Hay que ir a Administración → Catálogos PDTP → Nuevo → «Publicar y agregar actividad»: **8 clics + 4 campos**. El código exige `PDT-…` sin ayuda en pantalla; el primer intento falló con «Revisa los campos marcados.» sin marcar ningún campo (PRG-12) |
| Cambiar el responsable de una actividad | No está en «Editar». Hay que marcar la casilla → «Editar selección» → «Cambiar responsable»: 4 clics |
| Revisar el avance de una faena | Tablero → selector de faena: 2 clics, y muestra conteos sin %. El % está en la ficha: Listado de programas → Gestionar programa → faena → bajar 4 tarjetas. En código, «Gestionar programa» sólo aparece con `program:manage` (`programas/page.tsx:126-127`); **no verificado en navegador** para roles sin ese permiso (punto 1 del aviso) |
| Exportar el RE-36 | Desde la ficha: elegir faena (1) → «⋯» (1) → «Exportar RE-36» (1). Descarga en 0,5 s |

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Crear programa (copia del año anterior / Base) | ✅ | B: 81 actividades copiadas (sin las 6 retiradas), 797 celdas, plan 989: idéntico al 2026 v2 (SQL) |
| Doble envío al crear | ✅ | Dos pestañas simultáneas → un solo `pdtp-2028-v1` (A y B) |
| Editar borrador (texto, evidencia, recurrencia) | 🟡 | Funciona y queda en el change_log con antes/después; pérdida silenciosa en edición concurrente (PRG-05) |
| Agregar actividad (catálogo / nueva) | 🟡 | PRG-12 |
| Responsable (catálogo por rol) | ✅ | Lote N°6 → «Supervisor de terreno», con traza |
| Asignación nominal con vigencia | 🟡 | CÓDIGO: una vigencia retroactiva borra la fila anterior (PRG-13) |
| Recurrencia (semanal…anual, presets) | ✅ | Mensual → 72 ocurrencias (12 × 6 faenas) al activar. Presets cubiertos por pruebas PGlite |
| Retirar actividad | ✅ | N°17 con motivo ≥10 y fecha efectiva; queda en el change_log |
| Evidencia exigida por actividad | 🟡 | 47 de 81 actividades del programa real sin «evidencia mínima»; el editor dice «FALTAN DATOS» pero el servidor deja enviar y activar (PRG-15) |
| Compuerta de envío (N°19, cobertura) | ✅ | Bloqueó el envío hasta declarar el documento de la N°19 |
| Aviso de actividad sin plan (M-14) | 🔴 | Falso positivo sobre una actividad recurrente (PRG-06) |
| Firmas: elaboración → JDPR → Legal | ✅ | Elaborador/remitente bloqueado en JDPR (toast); `prev2` aprueba JDPR; `legal` sin botón; jefa firma |
| Activación | 🟡 | Se activa sola al firmar Legal, sin confirmación (PRG-02) |
| Revisión v+1 de un programa activo | ❌ | No hay botón en ningún estado normal (PRG-01) |
| Tablero / indicador | 🟡 | Cifras correctas; sin % y con un aviso incompleto (PRG-07, PRG-08, PRG-14) |
| Reporte de gestión | 🟡 | PRG-09 |
| RE-36 | 🟡 | El resumen cuadra con el indicador; mezcla faenas en el control de cambios (PRG-10); formato (PRG-20) |
| Control de cambios / auditoría | 🟡 | PRG-04 |
| Exportaciones: alcance de faena | ✅ | `otrafaena` → 403 «Sin acceso a la faena solicitada» en RE-36, reporte y expediente de Horcones; sin faena, cae a la suya; `ti` → 403 |
| Borrar borrador / crear-borrar hojas (M-19) | No verificado | Sólo CÓDIGO (`programs.ts:617-646`) |

### C. Código y lógica

- **Revisión v+1 sólo en anomalías.** `CreatePdtpRevisionButton` aparece nada más que con `showRevisionCta`: desvío de huella, alcance no declarado o cobertura bloqueante (`[programId]/page.tsx:200-204,229`; `fulfillment-backlog-panel.tsx:19-29`). El E2E de v+1 siembra la revisión por SQL (`e2e/pdtp-revision-midyear.spec.ts:100-160`).
- **Aprobar el último paso también activa.** `decidePdtpApprovalStepAction` llama a `activatePdtpIfAllStepsApproved`, que ejecuta `activatePdtpProgram(programId, userId)` sin comprobar `prevention:pdtp:activate` (`program-lifecycle.ts:49-57,108-110`). Consecuencias:
  - «Aceptar y activar versión» (`program-lifecycle-controls.tsx:213-217`) queda inalcanzable;
  - los `postActivationWarnings` no llegan a quien firmó.
- **El conector de la N°1 no usa el año del programa aprobado.** Pasa `programId`, pero el motor lo ignora y resuelve por la fecha del hecho (`pdtp-accreditation-connectors.ts:445-482`; `accreditation.ts:138-149,322-336`).
- **Aviso M-14.** Mira sólo `pdtp_activity_schedule`, sin `schedule_definition` ni ocurrencias (`lifecycle.ts:158-177`).
- **M-17.** El candado compara `updatedAt` leído en la misma solicitud, no una versión que venga del cliente (`activities.ts:633-646`).
- **Borrar un borrador.** Deja un resumen en `audit_log`, pero el `pdtp_change_log` del borrador se va en cascada (`programs.ts:617-646`).
- **Sin anomalías de higiene.** No se ven `console.log`, mocks ni TODO en los archivos revisados.

### D. Modelo de datos

- **Tablas nucleares:** `pdtp_programs`, con índice único de un programa activo por año, y `pdtp_change_log`, con trigger de sólo agregar (vigente en `\d`, aunque 0340 exime a A y B por el nombre de la base).
- **Asignaciones nominales** (`pdtp_activity_worksite_assignees`, `valid_from`/`valid_until`): el servicio borra físicamente en una corrección retroactiva (PRG-13).
- **Dato real, programa 2026 v2:**
  - 47 de 81 actividades sin `evidence_requirement`;
  - la N°19 sin `pdtp_activity_document_requirements`: la carpeta nunca acredita. La copia 2028 lo hereda y la compuerta lo detecta;
  - 6 faenas miembro, aunque `applies_to_all_worksites = true`.

### E. Permisos y seguridad

- **Alcance de faena correcto en exportaciones** (DEMOSTRADO): `otrafaena` → 403 hacia Horcones y `ti` → 403. Segregación JDPR ≠ elaborador/remitente, y Legal ≠ JDPR (DEMOSTRADO).
- **Hay fugas en el alcance de lectura** del control de cambios y del RE-36 (PRG-10).
- **Gobierno de la firma «Legal y RRHH»:** la firma el rol Jefatura; el rol Gerencia Legal no puede (PRG-11).
- **La activación automática no comprueba el permiso `activate`** (TEÓRICO). Con el flujo por defecto, quien firma Legal ya lo tiene, y no hay UI para personalizar el flujo.

### F. Testing

- **Corrí** 19 suites PGlite (`vitest.pglite.config.ts --maxWorkers=1`): `prevention-pdtp`, `pdtp-year-copy`, `pdtp-year-transition`, `pdtp-period-closures`, `pdtp-re36-document`, `pdtp-production-readiness`, `pdtp-revision-midyear`, `pdtp-revision-windows`, `pdtp-delete-restrict`, `pdtp-audit-append-only`, `pdtp-schedule-presets-batch`, `pdtp-worksites`, `pdtp-compliance-zero`, `pdtp-compliance-performance`, `pdtp-assignees`, `pdtp-objectives`, `pdtp-revision-diff-decisions`, `pdtp-lifecycle-instrument-gate` y `pdtp-year-close`. Resultado: **323 PASS, 1 skipped, 0 fallos**, en 268 s (`tests-pglite.log`).
- **Sin cobertura:**
  - crear una v+1 desde la UI;
  - el % del tablero;
  - la N°1 acreditada al año del programa aprobado;
  - una actividad recurrente en el aviso M-14;
  - la edición concurrente desde dos clientes;
  - el control de cambios por faena en el RE-36.

### G. Integración con el Programa Anual

Este submódulo **es** el programa. Su única acreditación propia es la **N°1** («Aprobar el programa»), que se genera al firmar Legal: queda como integración `submitted` en cada faena miembro.

**Demostrado en B:** aprobar el programa **2028** acreditó la N°1 del programa **2026 v2** (septiembre, semana 4) en 6 faenas (PRG-03). En el caso normal —el programa del año siguiente se aprueba en diciembre— la N°1 del año nuevo nunca se acredita por su propia firma, y el año en curso recibe envíos espurios en su cola.

El resto de la integración vive en los conectores (otro agente). Desde el programa verifiqué:
- la copia conserva mecanismo y destino;
- la activación materializa ocurrencias;
- la compuerta de cobertura bloquea lo que corresponde.

### §20 Ciclo de vida (ejecutado en B, 2028)

1. **Creación:** crear (prev) → agregar N°90 (prev, vía catálogo) → editar N°7 (prev2 y prev) → responsable N°6 → retirar N°17 → carpeta N°19.
2. **Envío:** enviar a revisión (prev, 21:23:30). Luego prev intenta JDPR → bloqueado.
3. **Firmas:** prev2 aprueba JDPR (21:25:30) → `legal` no ve botón → jefa aprueba Legal (21:25:39).
4. **Activación:** **activo en el mismo segundo**, por la jefa. El change_log registra cada paso con `changed_by_user_id`.
5. **Pendiente de verificación:** v+1 desde la UI (❌, PRG-01), «cuando corresponda», actividades condicionadas y mínimo anual. Estos últimos sólo por las pruebas PGlite existentes, que pasaron.

### §25 Tablero — verificación matemática (SQL de lectura contra UI y exportaciones, base B)

**Plan de Masisa** (faena sin ejecuciones, v2, corte en la semana 3 de septiembre):

| | Sep | Oct | Nov | Dic | Total |
|---|---:|---:|---:|---:|---:|
| Panel / UI | 77 | 118 | 80 | 76 | 351 |
| SQL «planned_vs_completed» | 38 | 77 | 77 | 74 | |
| Aporte de cobertura (dotación 19, extintores 2, padrón 1) | +39 | +41 | +3 | +2 | |
| Resultado SQL | **77** | **118** | **80** | **76** | ✔ |
| Resumen mensual del RE-36 | 77 | 118 | 80 | 76 | Q3 77 · Q4 274 ✔ |
| Grilla P del RE-36 | 41 | 82 | 80 | 76 | 279 |
| Reporte de gestión | | | | | 279 |

- «En cero» de septiembre: 22 actividades, lista idéntica entre SQL y `/actividades?estado=en_cero&mes=9`.
- La primera diferencia (24) era un error de mi SQL: incluía N°5 y N°13, retiradas el 03-09.
- **Conclusión:** indicador y resumen del RE-36 usan **un solo corte** ✔ (PRV-09). El reporte de gestión y la grilla del RE-36 miden la cobertura en celdas, no en personas, así que el reporte da 279 donde el indicador da 351 (PRG-09).
- **Ejecutado:** Horcones cambiaba en tiempo real por otros agentes (15 → 14 → 12). El ejecutado con tope de las «planned_vs_completed» cuadró por orden de magnitud (11 SQL contra 14 UI; la diferencia es cobertura y plazo), sin igualdad exacta por la concurrencia.
- **Agregado del tablero:** «Pendientes 569» corresponde al consolidado v1 + v2 (plan de septiembre de las 6 faenas en v2 = 453 − 12 ejecutadas; el resto son las celdas de la semana 2 de la v1). «N por aprobar» = 29 contaba sólo v2, con 19 envíos de v1 fuera (PRG-08).
- **Rotulado de cortes:**
  - la ficha rotula «a la fecha (hasta Sep)» y «anual»;
  - la barra por faena del tablero dice «anual»;
  - el «Índice de gestión» usa el anual sin rotularlo (PRG-14);
  - «a la fecha» incluye el mes en curso completo (M-15).
- **No verificado:** el escenario controlado de 100/20/60 en PGlite (aviso, punto 2).

### §26 Trazabilidad

| Operación | Resultado |
|---|---|
| Crear programa, agregar, editar, cambiar responsable, retirar, carpeta, enviar, cada firma y activación | En `pdtp_change_log` con actor, antes/después y nota (DEMOSTRADO) |
| Edición de actividad en `audit_log` | Queda con `user_id`, pero `/admin/auditoria?entidad=pdtp-2028-v1-a-007` muestra **«Sistema»** porque falta `user_email` |
| Control de cambios de la ficha | Sólo fecha (sin hora), categoría y nota: **sin quién ni antes/después**, y mezclando faenas (PRG-04, PRG-10) |
| Borrar borrador, hojas, cierres/reaperturas, cambios de meta | No ejecutados (fuera de tiempo o de alcance); CÓDIGO en `programs.ts:617-646` |

### §27 Casos borde

| Caso | Resultado |
|---|---|
| Doble envío al crear programa | ✅ |
| Doble edición concurrente | ❌ Pérdida silenciosa (PRG-05) |
| Enviar a revisión con compuerta pendiente | ✅ bloquea |
| M-14 | Falso positivo sobre recurrente (PRG-06); el caso «scheduled» sin celdas real sólo avisa, no bloquea |
| Actividad sin responsable | La UI lo exige («Selecciona el responsable») y la compuerta frena «sin un responsable que pueda registrar»: A 2028, N°1 y N°2 ✅ |
| Código de actividad inválido | Rechazado, sin marcar el campo (PRG-12) |
| Autoaprobación del elaborador | ✅ bloqueada |
| Editar/retirar actividad cumplida y cambiar responsable tras cumplimiento | Sólo posible en una v+1, que no se puede crear desde la UI (PRG-01); **no verificado** |
| Programa vacío, fechas inválidas, refresh a mitad | **No verificado** en navegador. CÓDIGO: `lifecycle.ts:138-139` («Agrega al menos una actividad») y `activities.ts:516-521` (período) |

### H. Hallazgos

```
ID: PRG-01
Severidad: 🟠 CRÍTICO
Submódulo: Programa Anual
Categoría: Funcionalidad
Título: No se puede crear una revisión v+1 de un programa activo en condiciones normales
Archivo(s): app/(app)/prevencion/pdtp/[programId]/page.tsx; [programId]/fulfillment-backlog-panel.tsx
Línea(s): page.tsx:200-204,229; fulfillment-backlog-panel.tsx:19-29
Pantalla/ruta: /prevencion/pdtp/[programId] (cabecera y menú «⋯»)
Endpoint: createPdtpRevisionAction (program-crud.ts:85)
Rol: prevencionista / administrador
Descripción: el botón «Crear revisión v+1» sólo aparece con desvío de huella, alcance no declarado o cobertura bloqueante. Con un programa activo sano no hay ninguna vía para modificarlo a mitad de año.
Evidencia: DEMOSTRADO (navegador). Cabecera y menú de 2028 v1 y 2026 v2 como prev: ítems [Habilitar, RE-36, planilla plana, Reporte, Cierres, (Expediente), Aplicabilidad] y 0 botones de revisión. El E2E de v+1 la siembra por SQL (e2e/pdtp-revision-midyear.spec.ts:100-160).
Cómo reproducir:
1. Entrar como prev a /prevencion/pdtp/pdtp-2026-v2.
2. Abrir «⋯».
3. Buscar «Crear revisión».
Resultado actual: no existe.
Resultado esperado: una acción visible «Crear revisión v+1» para program:manage sobre el programa activo.
Impacto: el PDTP no se puede actualizar ante cambios, como una actividad nueva tras un accidente o un cambio legal.
Causa probable: el CTA se condicionó a los estados anómalos.
Solución recomendada: mostrar CreatePdtpRevisionButton para canManageProgram && status === "active", más una prueba E2E del flujo.
Esfuerzo: Bajo
Bloquea producción: No (hay que corregirlo antes del lanzamiento)
Clasificación: A
```

```
ID: PRG-02
Severidad: 🟡 IMPORTANTE
Submódulo: Programa Anual
Categoría: Funcionalidad / Permisos
Título: Firmar el último paso activa el programa en el mismo clic, sin confirmación ni permiso `activate`
Archivo(s): app/(app)/prevencion/pdtp/actions/program-lifecycle.ts; [programId]/program-lifecycle-controls.tsx
Línea(s): program-lifecycle.ts:49-57,108-110; program-lifecycle-controls.tsx:204-217
Pantalla/ruta: /prevencion/pdtp/pdtp-2028-v1
Endpoint: decidePdtpApprovalStepAction
Rol: jefa_chome
Descripción: «Aprobar: Aprobación Legal y RRHH» no pide confirmación, activa la versión y, en una v+1, cierra la vigente de forma irreversible. «Aceptar y activar versión» queda inalcanzable. La activación no comprueba prevention:pdtp:activate, y los avisos posteriores a la activación no se muestran.
Evidencia: DEMOSTRADO. En el change_log, approval:legal y «Programa activado…» por qa-jefa, ambos a las 21:25:39. El script que buscaba el botón «Aceptar y activar» expiró porque el programa ya estaba ACTIVO.
Cómo reproducir:
1. Enviar un borrador y aprobar JDPR.
2. Con jefa, pulsar «Aprobar: Aprobación Legal y RRHH».
3. Ver el estado.
Resultado actual: ACTIVO al instante.
Resultado esperado: firma y activación separadas, o una confirmación explícita que avise el reemplazo, con chequeo de `activate`.
Impacto: activación accidental; en una v+1 reemplaza la versión vigente sin aviso.
Causa probable: comodidad de flujo.
Solución recomendada: quitar la activación automática o condicionarla a can(activate) con un diálogo de confirmación.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-03
Severidad: 🟡 IMPORTANTE
Submódulo: Programa Anual (N°1)
Categoría: Integración / Lógica
Título: La aprobación de un programa acredita la N°1 del programa vigente en la fecha de la firma, no la del programa aprobado
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/pdtp/accreditation.ts
Línea(s): pdtp-accreditation-connectors.ts:445-482; accreditation.ts:138-149,322-336
Pantalla/ruta: aprobación del programa / /prevencion/pdtp/aprobaciones
Endpoint: decidePdtpApprovalStep → onPdtpProgramLegallyApproved
Rol: jefa_chome
Descripción: el conector pasa programId, pero el motor lo ignora y resuelve por la fecha del hecho.
Evidencia: DEMOSTRADO (SQL, base B). Firmar pdtp-2028-v1 el 29-09-2026 creó 6 ejecuciones «submitted» (source_id pdtp-2028-v1) en pdtp-2026-v2-a-001, septiembre semana 4, más un evento resuelto a pdtp-2026-v2 (scratchpad evidence-N1-cross-year.txt). La 2028 no recibió ninguna.
Cómo reproducir:
1. Crear y aprobar el programa del año siguiente.
2. Consultar pdtp_executions con source_type='aprobacion_programa'.
Resultado actual: la N°1 del año en curso recibe los envíos; la del año aprobado, nada.
Resultado esperado: acreditar la N°1 del programa aprobado, con el período del año del programa (por ejemplo, plannedPeriod con su celda planificada).
Impacto: el programa 2027 aprobado en diciembre deja su N°1 «en cero» todo el año, y aparecen envíos espurios en la cola de 2026.
Solución recomendada: pasar plannedYear/plannedPeriod del programa aprobado, o resolver por programId en este conector, más una prueba.
Esfuerzo: Bajo–Medio
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-04
Severidad: 🟡 IMPORTANTE
Categoría: Trazabilidad
Título: Ni el control de cambios ni la bitácora muestran quién cambió qué
Archivo(s): [programId]/page.tsx; lib/services/pdtp/activities.ts; app/(app)/admin/auditoria/audit-log.tsx
Línea(s): page.tsx:565-570; activities.ts:718-726 (recordAudit sin userEmail); audit-log.tsx:80,105
Pantalla/ruta: /prevencion/pdtp/[programId] (#control-de-cambios); /admin/auditoria?entidad=
Descripción: la ficha muestra sólo fecha (sin hora), categoría y nota; changed_by, before y after existen en la base pero no se ven. /admin/auditoria atribuye a «Sistema» las ediciones hechas por personas, no tiene enlace desde el PDTP y es sólo para administradores.
Evidencia: DEMOSTRADO. /admin/auditoria?entidad=pdtp-2028-v1-a-007 → 2 eventos «Sistema», con user_id qa-prev2 y qa-prev en la base.
Resultado esperado: actor y hora en cada entrada, con el detalle antes/después disponible.
Impacto: no se puede reconstruir «quién/cuándo/antes/después» sin acceso a la base (§26).
Solución recomendada: pasar userEmail en recordAudit (o resolverlo por user_id), mostrar el actor y un desplegable de antes/después, y enlazar a la historia de la entidad.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-05
Severidad: 🟡 IMPORTANTE
Categoría: Integridad / Concurrencia (M-17)
Título: Dos pestañas editando la misma actividad: el último guardado revierte en silencio el cambio del otro
Archivo(s): lib/services/pdtp/activities.ts; [programId]/editar/tabs/actividades-tab.tsx
Línea(s): activities.ts:487-494,633-646; actividades-tab.tsx:633-647
Evidencia: DEMOSTRADO (B, N°7):
- prev2 guardó «QA_PRG_ evidencia fijada por la pestaña B»;
- prev, con el diálogo abierto antes, cambió sólo el texto;
- evidence_requirement volvió a null;
- los dos diálogos se cerraron con éxito;
- el change_log registra el revertido.
Resultado esperado: un conflicto («la actividad cambió; recarga»), con una versión que venga del cliente.
Solución recomendada: enviar expectedUpdatedAt desde el formulario y compararlo en la transacción.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-06
Severidad: 🟡 IMPORTANTE
Categoría: Lógica / UX (M-14)
Título: El aviso «actividad periódica sin ninguna semana planificada» es falso para actividades con programación recurrente
Archivo(s): lib/services/pdtp/lifecycle.ts
Línea(s): 158-177
Evidencia: DEMOSTRADO. La N°90 (mensual, 12 ocurrencias por faena, 72 materializadas al activar) aparece en «Revisa antes de enviar: 1 actividad periódica no tiene ninguna semana planificada (N°90). Planifícalas o clasifícalas como a demanda», que es justo lo que crea el formulario guiado.
Resultado esperado: considerar schedule_definition, sin avisar en ese caso y bloqueando el caso real.
Impacto: induce a reclasificar mal actividades correctas; pierde confianza en los avisos.
Solución recomendada: excluir las definiciones no legacy_grid (o contar sus ocurrencias proyectadas), convertirlo en bloqueador para legacy sin celdas y agregar una prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-07
Severidad: 🟡 IMPORTANTE
Categoría: UI/UX (§25)
Título: El tablero no dice cuánto se ha cumplido; la cifra está enterrada en la ficha
Archivo(s): app/(app)/prevencion/pdtp/page.tsx; pdtp-dashboard-charts.tsx
Línea(s): page.tsx:386-439; pdtp-dashboard-charts.tsx:57
Evidencia: DEMOSTRADO (capturas B-admin-1440-_prevencion_pdtp.png y resp-B-390-*). Tiles Ejecutadas 18, Pendientes 569, Atrasadas 0, Acciones 1, sin %. La barra por faena remite a un «resumen» inexistente. En la ficha, el % aparece detrás de 4 tarjetas de configuración.
Resultado esperado: «Cumplimiento a la fecha X % · anual Y %» en el primer pantallazo del tablero y de la ficha.
Solución recomendada: reemplazar «Ejecutadas» por «Cumplimiento a la fecha» (con ejecutadas/plan como detalle) y subir el panel de indicadores en la ficha.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-08
Severidad: 🟡 IMPORTANTE
Categoría: UI/Lógica (PRV-20)
Título: «N ejecuciones por aprobar» ignora los envíos de la versión reemplazada que el tablero consolida
Archivo(s): app/(app)/prevencion/pdtp/page.tsx; lib/services/pdtp/executions.ts
Línea(s): page.tsx:149-152; executions.ts:829-842
Evidencia: DEMOSTRADO (SQL + UI). El tablero, «Año consolidado v1 + v2», mostraba «29 por aprobar» = sólo v2, mientras v1 tenía 19 submitted dentro de su ventana, y las ejecuciones aprobadas de v1 sí suman en «Ejecutadas».
Solución recomendada: contar sobre las versiones del año (yearVersions).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-09
Severidad: 🟡 IMPORTANTE
Categoría: Lógica / Exportación
Título: El reporte de gestión marca «En desviación» actividades retiradas o sin plan exigible, y mide la cobertura con otro denominador
Archivo(s): app/(app)/prevencion/pdtp/[programId]/reporte/page.tsx (lib/services/pdtp/management-report.ts no se pudo leer por el bloqueo)
Línea(s): reporte/page.tsx:28-43
Evidencia: DEMOSTRADO (UI + reporte-masisa.xlsx). En Masisa, 65 de 65 filas «En desviación», y 26 de ellas con plan 0 («Sin desvío registrado», el tono de advertencia más grave), incluidas N°2, 5 y 13, retiradas el 03-09. Total planificado 279 frente a 351 del indicador y del resumen del RE-36 para la misma faena y versión.
Resultado esperado: excluir retiradas y plan 0 («No exigible») y usar el mismo denominador de cobertura, o rotular la diferencia.
Esfuerzo: Bajo–Medio
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-10
Severidad: 🟡 IMPORTANTE
Categoría: Permisos / Integridad documental
Título: El RE-36 de una faena y el control de cambios de la ficha incluyen los eventos de todas las faenas, sin rótulo
Archivo(s): RE-36 (lib/services/pdtp/re36-document.ts, bloque changeControl); [programId]/page.tsx:553-583
Evidencia: DEMOSTRADO. otrafaena (sólo Biodiversa) exportó RE-36-PDTP-2026-BIODIVERSA-v2.xlsx: el «Control de cambios» (filas 144-166) lista desvíos «no realizado» y «no aplica» con su motivo, aprobaciones y nombres de personas producidos en Horcones. La ficha muestra lo mismo a ese usuario.
Impacto: el documento legal de una faena declara cambios ajenos; las personas de una faena ven motivos y nombres de otra.
Solución recomendada: filtrar el change_log operativo por faena (guardar worksiteId en la entrada) y dejar sólo los cambios de contenido del programa como globales.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-11
Severidad: 🟡 IMPORTANTE
Categoría: Permisos / Gobierno
Título: La firma «Aprobación Legal y RRHH» la ejecuta el rol Jefatura; la Gerencia Legal no puede firmar
Archivo(s): modules/prevention/manifest.ts
Línea(s): 609-613, 625-628 (comentario: «sign_legal/approve siguen en jefa_chome hasta que se pida moverlos»)
Evidencia: DEMOSTRADO. `legal` no ve el botón; sign_legal sólo lo tienen jefa_chome y administrador (SQL en A y B). En B la v2 real la firmó «QA PDTP Legal», un usuario con rol jefa_chome, y el RE-36 imprime «Aprobado por (Legal)».
Impacto: la firma legal del documento no corresponde a la gerencia que nombra. Con un solo prevencionista (JDPR ≠ elaborador) y la jefa en JDPR, Legal tiene que firmarlo el administrador.
Solución recomendada: decisión de negocio; mover sign_legal a gerente_legal_rrhh o renombrar el paso.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-12
Severidad: 🟡 IMPORTANTE
Categoría: UX / Manejo de errores
Título: Crear una actividad nueva exige ir a Administración, y los errores de validación no dicen qué campo falló
Archivo(s): components/prevention/pdtp-activity-creator.tsx; lib/validation/prevention-module/pdtp.ts
Línea(s): pdtp-activity-creator.tsx:446-449,568-571; pdtp.ts:349-350
Evidencia: DEMOSTRADO:
- en el editor, el selector ofrece las 87 actividades (también las ya incorporadas) y responde «La actividad ya está incorporada» sólo al guardar;
- la vía real es /admin/pdtp-catalogos, sin enlace desde el PDTP;
- el código «QA-PRG-MENSUAL» dio «Revisa los campos marcados.» sin campo marcado; «PDT-QA-PRG-MENSUAL» funcionó.
Solución recomendada: marcar o ocultar las ya incorporadas, enlazar «Crear actividad nueva», mostrar fieldErrors y agregar ayuda de formato.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-13
Severidad: 🟡 IMPORTANTE
Categoría: Integridad / Trazabilidad
Título: Una asignación nominal con «Rige desde» anterior a la vigente borra el período del responsable anterior
Archivo(s): lib/services/pdtp/assignees.ts; app/(app)/prevencion/pdtp/pdtp-assignee-picker.tsx
Línea(s): assignees.ts:313,348-371,428-436; pdtp-assignee-picker.tsx:166-178
Evidencia: CÓDIGO. Si closeAt < row.validFrom, la fila se borra (el comentario lo pensó como «corrección del mismo día»). validFrom no tiene límite inferior, y la ayuda dice «el historial de responsables no se borra». No demostrado: la prueba PGlite quedó bloqueada.
Solución recomendada: rechazar validFrom < validFrom vigente (o < hoy) salvo corrección del mismo día, y usar DatePicker.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-14
Severidad: 🟡 IMPORTANTE
Categoría: Indicadores (M-15)
Título: En la misma tarjeta se mezclan «a la fecha» y «anual» sin rótulo, y «a la fecha» incluye el mes en curso completo
Archivo(s): app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx; lib/services/pdtp/compliance.ts
Línea(s): pdtp-indicators-panel.tsx:248-280; compliance.ts:421-430
Evidencia: DEMOSTRADO (Horcones). «Índice de gestión preventiva 39,5 %» con «Ejecución 5 %» = avance anual (16/298), junto a «Cumplimiento a la fecha 29 %». 39,5 = 0,5·5 + 0,3·90 + 0,2·50.
Solución recomendada: calcular el índice con el corte a la fecha, o rotular «anual»; cortar «a la fecha» por semana.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: PRG-15
Severidad: 🟡 IMPORTANTE
Categoría: Evidencia / Reglas
Título: El 58 % de las actividades del programa activo no declara qué evidencia se exige, y el editor contradice al servidor
Archivo(s): lib/services/pdtp/lifecycle.ts; [programId]/editar/tabs/revision-tab.tsx
Línea(s): lifecycle.ts:138-153; revision-tab.tsx:60-95
Evidencia: DEMOSTRADO:
- SQL: 47 de 81 en 2026 v2 sin evidence_requirement;
- la pestaña Revisión dice «FALTAN DATOS · Declara el requisito antes de enviar»;
- el envío y la activación del 2028 pasaron.
Impacto: quien aprueba no sabe qué verificar. El archivo sí es obligatorio: markPdtpExecution exige un archivo real.
Solución recomendada: hacerlo bloqueador del envío (o bajar el aviso a informativo y completar el dato del programa vigente).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

**Mejoras y cosméticos**

| ID | Sev. | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|
| PRG-16 | 🔵 | La copia de año se rotula «Linaje de revisión v2 → v1 … firmas de v2 permanecen» | `[programId]/page.tsx:345-352` | DEMOSTRADO (captura B-prev-2028-detail) | Distinguir «copiado de 2026 v2» de la revisión | B |
| PRG-17 | 🔵 | «Aprobar: Revisión técnica JDPR» se ofrece al elaborador, que al pulsarlo recibe un error | `program-lifecycle-controls.tsx:204-211` | DEMOSTRADO | Deshabilitarlo con motivo | B |
| PRG-18 | 🔵 | Responsable obligatorio preseleccionado («Administrador de contrato») | `pdtp-activity-creator.tsx:296-300` | DEMOSTRADO (captura) | Sin valor por omisión | B |
| PRG-19 | 🔵 | Cambiar el responsable sólo por «Editar selección», no en «Editar» | `actividades-tab.tsx:435-520` | DEMOSTRADO | Agregarlo al diálogo | B |
| PRG-20 | 🔵 | RE-36: fechas crudas (`2026-09-17 06:02:17.785+00`, ISO) en firmas y control de cambios; actividades retiradas sin marca; grilla P (41) ≠ resumen (77) sin nota de unidad de cobertura | `re36-document.ts:830-853` | DEMOSTRADO (re36-masisa.xlsx) | `formatDate`, columna de estado, nota | B |
| PRG-21 | 🔵 | Mezcla de unidades en el %: en Masisa, 37 de los 77 planificados de septiembre son personas (dotación) | `compliance.ts:1131-1160` | DEMOSTRADO (SQL) | Explicarlo en la UI o separarlo | B |
| PRG-22 | ⚪ | Enlaces del Excel del reporte a `http://0.0.0.0:3101/…` | exportación del reporte | DEMOSTRADO (entorno; revisar en producción) | URL pública configurada | B |
| PRG-23 | ⚪ | Breadcrumb de `/nuevo` sin «Prevención»; «En cero» también en meses futuros | `nuevo/page.tsx:34-38`; panel | DEMOSTRADO | — | B |
| PRG-24 | 🔵 | Borrar un borrador elimina en cascada su change_log (queda un resumen en audit_log, sin email → «Sistema») | `programs.ts:617-646` | CÓDIGO | Conservar el change_log serializado en el resumen | B |
| PRG-25 | 🔵 | N°19 del 2026 v2 real sin documentos: la carpeta nunca acredita (activado antes de la compuerta) | datos | SQL | Declararlos en una v+1 (requiere PRG-01) | B |

### I. Readiness individual: **70/100** — funcional, requiere correcciones

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16,5 | PRG-01 −4 · PRG-03 −1,5 · PRG-02 −1 · PRG-09 −1 · PRG-06 −0,5 · PRG-05 −0,5 |
| UI/UX y facilidad de uso | 20 | 13,5 | PRG-07 −2,5 · PRG-12 −1,5 · PRG-08 −0,5 · PRG-14 −0,5 · PRG-15 −0,5 · PRG-16…19 −1 |
| Integridad de datos | 15 | 10,5 | PRG-05 −1,5 · PRG-13 −1 · PRG-10 −1 · PRG-03 −1 |
| Integración con Programa Anual | 15 | 11 | PRG-03 −2 · PRG-15 −1 · PRG-06 −0,5 · PRG-25 −0,5 |
| Código y mantenibilidad | 10 | 8 | PRG-02 (botón y permiso muertos) −1 · PRG-06 −0,5 · PRG-05 −0,5 |
| Permisos y seguridad | 5 | 3,5 | PRG-10 −1 · PRG-11 −0,5 |
| Testing | 5 | 3,5 | Sin pruebas de PRG-01/03/05/06 ni del % del tablero −1,5 |
| Manejo de errores | 5 | 4 | PRG-12 −0,5 · PRG-02 (avisos de post-activación perdidos) −0,5 |
| **Total** | **100** | **70,5 → 70** | |

### Estado de hallazgos previos en este alcance

| ID | Dictamen | Evidencia propia |
|---|---|---|
| PRV-09 | **Parcial** | El resumen del RE-36 = indicador (Masisa 77/118/80/76 = 351 ✔), pero el reporte de gestión da 279 (PRG-09). El corte por faena incorporada a mitad de año no se pudo reproducir en B (todas las faenas entraron el mismo día) |
| PRV-11 | **No verificable (sólo CÓDIGO)** | `compliance.ts:875-893` aplica las vigencias de `pdtp_activity_padron_changes`; no ejecutado |
| PRV-14 (cierres) | **No verificado** | Crons fuera de alcance y de tiempo |
| PRV-20 | **Parcial** | El aviso existe («29 ejecuciones por aprobar →»), pero excluye la versión reemplazada (PRG-08) |
| M-13 | **Parcial** | La copia 2028 conserva números, celdas y plan (989) ✔; la N°1 del año nuevo no se acredita por su firma (PRG-03) |
| M-14 | **Parcial / regresión menor** | Sólo avisa, no bloquea, y el aviso es falso para las recurrentes (PRG-06) |
| M-15 | **Sigue abierto** | «A la fecha» incluye el mes completo; el índice usa el anual (PRG-14) |
| M-17 | **Parcial** | Candado en el servidor sí; pérdida silenciosa entre pestañas demostrada (PRG-05) |
| M-18 | **Parcial** | La paginación existe (`page.tsx:551-583`); `?entidad=` funciona pero atribuye a «Sistema», no tiene enlace y es sólo para administradores (PRG-04) |
| M-19 | **Parcial (CÓDIGO)** | El borrado de un borrador deja un resumen en audit_log sin email y pierde el change_log; hojas no verificadas |
| C-01 | **Corregido (verificado)** | `elaborated_by_title` = etiqueta del rol («Jefe del Departamento de Prevención de Riesgos») |
| C-02 | **Corregido en lo visible** | Barras por faena «Sin planificación»; `page.tsx:169` sigue mapeando null → 0, pero el gráfico no lo dibuja |
| C-05 | **No verificado** | Lectura bloqueada por el sistema de permisos |

### Qué no se pudo verificar y por qué

- **Escenario controlado en PGlite (100/20 NA/60) y demostración de PRG-13:** no creé el archivo temporal tras las denegaciones del clasificador (ver aviso).
- **Programa vacío, fechas inválidas, refresh a mitad, borrar un borrador, crear/borrar hojas, cerrar/reabrir meses y reabrir/archivar versiones:** no ejecutados por tiempo; sólo CÓDIGO parcial.
- **Editar, retirar o cambiar el responsable de una actividad ya cumplida:** requiere una v+1, que no se puede crear desde la UI (PRG-01).
- **Navegación de roles sin `program:manage` hasta la ficha:** recorrido bloqueado.
- **Ejecutado exacto del tablero:** la base B cambiaba en tiempo real por otros agentes.
- **C-05, PRV-11 y PRV-14.**
