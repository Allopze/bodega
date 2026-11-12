# Plan para registrar el cumplimiento de todas las actividades PDTP fuera del programa

**Fecha:** 2 de septiembre de 2026  
**Estado:** diseño y plan de implementación; no implica despliegue ni activación del programa  
**Programa contrastado:** `pdtp-2026-v1`  
**Alcance:** las 82 actividades activas del Programa de Trabajo Preventivo SG-SST 2026

## 1. Resultado que se busca

Toda actividad activa del PDTP debe poder cumplirse sin abrir la ficha ni la planilla del programa preventivo.
El programa debe quedar como fuente de planificación, supervisión, aprobación y reporte; no como el lugar donde
los responsables tienen que descubrir o ejecutar su trabajo cotidiano.

Una actividad se considerará realmente cubierta sólo si cumple las cinco condiciones siguientes:

1. aparece en **Mis pendientes** únicamente para sus responsables y dentro de su alcance de faena;
2. el CTA lleva al registro operacional exacto o a un formulario de constancia válido, nunca a buscar una fila
   dentro de `/prevencion/pdtp/actividades`;
3. el hecho se registra en el módulo donde ocurre y conserva fuente, fecha, autor, faena, cantidad y evidencia;
4. el PDTP recibe una acreditación idempotente, reversible y visible como `submitted` o `approved`;
5. existe una prueba que demuestra el recorrido completo sin visitar la página del programa.

La meta contractual es **82/82 actividades activas con destino externo resoluble y verificable**. Las cinco
actividades retiradas (N°2, 5, 12, 13 y 14) no entran en el denominador.

## 2. Diagnóstico actual

La revisión se hizo contra el árbol de trabajo actual y contra `bodega_dev` en modo de sólo lectura. No es una
confirmación del estado de producción.

- `pdtp-2026-v1` sigue en `draft`: tiene 82 actividades activas, 5 retiradas y cero ejecuciones. Mientras no se
  active, ningún hecho puede incorporarse al cumplimiento formal.
- Las 82 actividades sí pueden marcarse manualmente desde la planilla, pero ése es justamente el flujo que se
  quiere dejar de necesitar.
- **Mis pendientes** dirige las actividades `enganche` de vuelta a
  `/prevencion/pdtp/actividades`; no lleva al módulo que realiza el trabajo.
- Las 16 actividades `constancia` apuntan a `/prevencion/constancias`, pero esa ruta no existe. Hoy esos CTA
  terminan en un 404.
- La base local tiene 60 actividades `enganche`, 16 `constancia` y 6 `compuesta`. No quedan actividades
  `sin_definir`.
- Inspecciones tiene doce mapeos previstos, pero en la base sólo la plantilla N°27 declara su número y está en
  borrador. El resto de las plantillas no acredita.
- Capacitación tiene un solo curso (`B-01`) con `pdtp_activity_numbers = []`; no existen campañas ni planes de
  emergencia configurados en la base local.
- Los conectores de N°1, 9, 11, 62 y 66–78 están cableados. El árbol local además contiene trabajo aún no
  confirmado como desplegado para N°45–50 (Higiene y Vigilancia).
- Faltan conectores para N°7, 19, 35, 36, 43 y 83. La N°21 continúa pendiente de una decisión de catálogo.
- No existe el submódulo de habilitación del trabajador del que dependen N°15–18, 23 y 52.
- Los conectores post-commit toleran el fallo del PDTP registrándolo sólo en logs. Si el programa está en
  borrador o falta configuración, el trabajo fuente puede quedar realizado sin una acreditación recuperable.

Este plan complementa la auditoría `AUDITORIA_PDTP_ACREDITACION_2026-09-01.md` y el backlog
`tasks/TODO_PDTP_ACREDITACION_2026-09-01.md`. Aquellos documentos responden qué acredita hoy y qué conectores
faltan; éste fija la experiencia externa completa, la interfaz común y la condición 82/82.

## 3. Reglas de negocio que no se pueden romper

### 3.1 Ejecución no es corrección del hallazgo

El cumplimiento de una inspección se acredita cuando la inspección fue realizada. Un hallazgo, una OT
correctiva o una CAPA abiertos no deben quitar ese cumplimiento. El cierre del hallazgo conserva su indicador y
su ciclo propios.

La misma separación aplica a los demás dominios: realizar una actividad acredita la ejecución; sus acciones de
mejora posteriores no cambian retroactivamente ese hecho, salvo que el propio registro fuente sea anulado o
reabierto.

### 3.2 Registrar no siempre significa aprobar

- El formulario o evento externo debe crear una acreditación aunque todavía requiera validación.
- Sólo ejecuciones `approved` entran al indicador formal.
- Inspecciones mantienen su regla actual: la ejecución formal de la inspección constituye validación suficiente.
- Para los demás módulos se debe declarar por contrato si el cierre del flujo fuente ya es aprobación suficiente
  o si la ejecución queda `submitted` para la bandeja de aprobaciones. No se debe inferir esta decisión desde la UI.

### 3.3 Sin duplicados ni pérdida silenciosa

- Un reintento del mismo hecho no puede crear otra ejecución.
- Una carga manual/Excel y una inspección que describen el mismo trabajo conservan ambas trazas, pero el indicador
  toma la mayor cobertura de las dos, como hace hoy.
- Otras integraciones independientes sí suman cuando representan hechos distintos.
- Si el programa no está activo o falta el mapeo, el evento debe quedar pendiente y ser conciliable; no basta un
  `logger.error`.

### 3.4 Autorización en el módulo fuente

El permiso `prevention:pdtp:execute` no debe abrir por sí solo funciones de Higiene, Incidentes, MIPER,
Documentación o Salud Ocupacional. El usuario ejecuta con el permiso del dominio y dentro de su faena; el motor
PDTP es un consumidor interno del evento.

Las constancias sí tendrán permisos propios y alcance por faena. El servicio vuelve a validar autorización,
estado, período y evidencia antes de persistir.

### 3.5 El programa conserva la verdad de planificación

Calendario, responsables, aplicabilidad, exclusiones, metas y método de medición siguen perteneciendo al PDTP.
Los módulos externos informan hechos; no alteran cuotas ni el contenido firmado del programa.

## 4. Diseño objetivo

### 4.1 Un módulo profundo de cumplimiento

Crear un módulo en `lib/services/pdtp/fulfillment.ts` con una interfaz pequeña y común para todos los dominios:

```ts
resolvePdtpFulfillmentTarget(context): FulfillmentTarget
recordPdtpFulfillmentEvent(event): FulfillmentResult
```

`recordPdtpFulfillmentEvent` recibe una operación `completed` o `revoked`. Por dentro resuelve el programa, la
actividad, el período chileno, la aplicabilidad, la política de validación, la idempotencia, la evidencia, la
ejecución y la eventual reversión. Los módulos fuente no deben conocer las tablas de ejecuciones ni repetir esas
reglas.

`resolvePdtpFulfillmentTarget` concentra el destino que hoy está disperso o ausente: módulo, href con faena y
período, CTA, permiso requerido, evento que acredita y estado de disponibilidad. **Mis pendientes**, el tablero y
la planilla consumen la misma respuesta.

El contrato anual vive en un adapter versionado, por ejemplo
`lib/services/pdtp-adapters/fulfillment-contract-2026.ts`. Se versiona porque el N° y el texto vienen del
documento anual; no se debe asumir que el programa 2027 conservará el mismo mapa.

### 4.2 Libro durable de eventos

Agregar mediante Drizzle una tabla `pdtp_fulfillment_events` (nombre definitivo sujeto al patrón del esquema)
con, al menos:

- `source_type`, `source_id`, `event_type` y `source_version`;
- `worksite_id`, `occurred_at`, cantidad y referencia de evidencia;
- clave idempotente única;
- payload mínimo auditable y enlace de retorno al registro fuente;
- estado `pending`, `accredited`, `rejected`, `revoked` o `error`;
- programa/actividad/ejecución resueltos cuando corresponda;
- intentos, último error y marcas de conciliación.

El evento se escribe en la misma transacción que el hecho operacional cuando ambos usan la misma base. Un
reconciliador procesa los pendientes al activar un programa, corregir un mapeo o reintentar un fallo transitorio.
No se debe hand-editar una migración ni `meta/_journal.json`: se cambia el schema y se genera una migración nueva
con `npm run db:generate`.

### 4.3 Constancias fuera del PDTP

Construir `/prevencion/constancias` como el registro externo común para las 16 actividades cuyo mecanismo es
realmente una constancia. No es una segunda planilla del programa: es una bandeja de trabajo de terreno.

Cada tarjeta debe mostrar actividad, faena, período, responsable, evidencia exigida y estado. El formulario
registra fecha efectiva, cantidad, observación, participantes cuando corresponda y evidencia real. Envía el
resultado a aprobación y conserva un enlace al expediente.

El servicio sólo lista actividades `mechanism = 'constancia'`, activas, aplicables a la faena y asignadas a los
roles del usuario. Debe impedir elegir arbitrariamente otra actividad o una faena fuera de alcance.

### 4.4 Mis pendientes como puerta de entrada

Modificar `lib/services/operational-work-queue.ts` para que ninguna actividad activa tenga como destino de
ejecución `/prevencion/pdtp/actividades`.

- Si existe una instancia operacional (run, sesión, incidente, plan, campaña, trabajador), enlazarla directamente.
- Si todavía hay que crearla, abrir el módulo fuente prefiltrado con `faena`, `actividadPdtp`, mes y semana.
- Las constancias abren `/prevencion/constancias` con la actividad y período preseleccionados.
- Las actividades compuestas abren la habilitación del trabajador o la lista de personas incompletas.
- El ítem desaparece cuando existe una ejecución `submitted` o `approved`; si fue rechazado, vuelve con el motivo.

La planilla puede ofrecer el mismo CTA externo como ayuda, pero deja de alojar `PdtpExecutionForm` como camino
normal. La carga manual dentro del programa queda reservada y rotulada para conciliación histórica o corrección
administrativa.

### 4.5 Compuerta 82/82

Antes de enviar un programa a revisión y otra vez antes de activarlo, ejecutar
`assertPdtpFulfillmentCoverage(programId)`:

- toda actividad activa tiene exactamente un destino externo;
- el destino no es un placeholder ni vuelve a la planilla;
- el evento fuente y su política de aprobación están declarados;
- los responsables mapean a roles reales con permiso para el módulo destino;
- los `enganche` configurables tienen su plantilla, curso, campaña o plan declarado;
- las `compuesta` enumeran sus componentes y regla de cierre;
- las `constancia` declaran evidencia mínima;
- las actividades por cobertura tienen padrón o una caída explícita y visible a cantidad planificada.

La activación falla con un informe accionable por actividad. No debe volver a ser posible activar un programa
que promete trabajo sin ofrecer dónde realizarlo.

## 5. Cobertura explícita de las 82 actividades

| Actividades | Cant. | Dónde se registra fuera del programa | Evento que acredita | Estado actual / trabajo requerido |
|---|---:|---|---|---|
| N°1 | 1 | **Mis pendientes → Aprobaciones de programa** | firma/aprobación legal del programa | El conector existe, pero hay que ofrecer la decisión en una bandeja independiente de la ficha del programa. |
| N°3, 6, 10, 20, 22, 28, 30, 31, 32, 42, 44, 61, 79, 80, 81, 82 | 16 | **Constancias** (`/prevencion/constancias`) | constancia enviada con evidencia | La cola ya intenta usar esta ruta, pero la ruta no existe. N°10 puede migrar luego a Inspecciones; Alcotest y CGRD pueden madurar a módulos propios sin perder el camino inicial. |
| N°7 | 1 | **Indicadores SST** (`/prevencion/indicadores`) | cierre del período mensual reconciliado | Falta conector. No acreditar al guardar un borrador ni por una edición parcial. |
| N°9, 11 | 2 | **CPHS / Gobernanza** (`/prevencion/cphs`) | cerrar revisión por la dirección / constituir comité | Conectores existentes; agregar destino exacto y pruebas desde la cola. |
| N°15, 16, 17, 18, 23, 52 | 6 | **Habilitación del trabajador** (`/prevencion/trabajador/[workerId]/habilitacion`) | componente confirmado / habilitación completa | El submódulo no existe. N°52 es compuesta y sólo cierra al completar los componentes aplicables. |
| N°19, 36, 43 | 3 | **Documentación SST** (`/prevencion/documentacion`) | expediente legal completo / acuse de difusión MIPER / publicación de PTS | Faltan los tres conectores y los catálogos documentales que distingan cada tipo. |
| N°24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65 | 12 | **Inspecciones** (`/prevencion/inspecciones`) | ejecutar inspección; N°26 acredita al revisar | El motor existe, pero faltan once mapeos activos; N°27 está mapeada en una plantilla borrador. Resolver oficialmente N°40/41 y la segregación N°25/26. |
| N°35 | 1 | **MIPER** (`/prevencion/miper`) | publicar una revisión de la matriz de la faena | Falta conector. Abrir un disparador de revisión no acredita; publicar sí. |
| N°37, 38, 51, 53, 54, 55, 56, 57, 58, 59, 60, 63 | 12 | **Capacitación** (`/prevencion/capacitacion`) | cerrar una sesión con asistencia válida | El conector existe, pero no hay cursos mapeados. N°54 y 56 deben usar cobertura de 90 % con padrón explícito. |
| N°45, 46, 47, 48, 49, 50 | 6 | **Higiene y Vigilancia** (`/prevencion/higiene`) | medición cuantitativa / pronunciamiento de protocolo / control asistido | Hay una implementación local en curso; debe integrarse, revisarse, probarse y desplegarse antes de declararla disponible. N°50 exige padrón de expuestos. |
| N°62 | 1 | **Entregas** (`/entregas`) | entrega de EPP registrada | Conector existente; agregar enlace exacto y verificar reversión/corrección. No confundir con la entrega inicial N°23. |
| N°21, 66–78 | 14 | **Incidentes** (`/prevencion/incidentes/[id]`) | cada hito confirmado del expediente | N°66–78 están cableadas. La jefatura debe retirar N°21 por duplicidad o declarar un evento adicional inequívoco; si sobrevive, necesita conector y prueba propios. |
| N°83, 84 | 2 | **Emergencias** (`/prevencion/emergencias`) | publicar plan por amenaza / completar simulacro | N°83 no tiene conector. N°84 lo tiene, pero falta configurar los planes. Un simulacro nunca debe acreditar N°83. |
| N°85–89 | 5 | **Campañas** (`/prevencion/campanas`) | cerrar campaña con alcance y evidencia | El conector existe, pero la UI fija N°85. Agregar selector/edición y quitar el default engañoso. |
| **Total** | **82** |  |  | **La entrega termina sólo con 82/82 destinos listos.** |

## 6. Fases de implementación

### Fase 0 — Cerrar decisiones que cambian el contrato

- [ ] Decidir si N°21 se retira por duplicar N°66–78 o cuál es su evento exclusivo.
- [ ] Decidir si la activación 2026 reconoce desde enero o desde el mes de activación. No activar todavía.
- [ ] Aprobar el mapeo oficial de N°40 y N°41 a definiciones de inspección.
- [ ] Confirmar quién transcribe N°25 y quién revisa N°26, manteniendo independencia.
- [ ] Confirmar el padrón de N°24, 50, 54 y 56 y el responsable de mantenerlo.
- [ ] Confirmar que Alcotest y CGRD parten como constancia y definir si tendrán módulo propio en una fase posterior.
- [ ] Resolver el actor declarado para N°25, porque `conductores_operadores_choferes` no es hoy un rol RBAC con acceso.

**Salida:** acta breve de decisiones incorporada al contrato 2026 y cero ambigüedades que puedan acreditar el
hecho equivocado.

### Fase 1 — Construir la plataforma común y su compuerta

- [ ] Crear el módulo `fulfillment.ts` y el adapter anual 2026.
- [ ] Generar la tabla durable de eventos y el reconciliador idempotente.
- [ ] Migrar `accreditPdtpFromEvent` y las reversiones detrás de la nueva interfaz sin duplicar motores.
- [ ] Añadir `assertPdtpFulfillmentCoverage` a revisión y activación del programa.
- [ ] Crear un diagnóstico que liste `ready`, `config_required`, `code_gap`, `permission_gap` y `decision_required`.
- [ ] Escribir la prueba de contrato que arranca desde el catálogo, aplica los retiros y exige exactamente 82
      actividades cubiertas.

**Archivos principales:** `db/schema/prevention/pdtp.ts`, una migración nueva generada, `lib/services/pdtp/`,
`lib/services/pdtp-adapters/`, `lib/services/pdtp/lifecycle.ts` y pruebas PGlite.

### Fase 2 — Habilitar el camino externo universal

- [ ] Crear `/prevencion/constancias` con `PageHeader`, `PageContainer`, búsqueda del TopBar, filtros
      estructurados y el formulario de evidencia.
- [ ] Agregar permisos de constancias, grants por rol, navegación y pruebas de paridad.
- [ ] Reemplazar los href genéricos de **Mis pendientes** por destinos resueltos por el contrato.
- [ ] Incluir `actividadPdtp`, faena, mes y semana en los enlaces prefiltrados.
- [ ] Mostrar el estado de sincronización: acreditada, pendiente de programa, por aprobar o con error.
- [ ] Dejar la planilla como supervisión y conciliación; retirar el formulario manual como camino normal sólo
      cuando las 82 rutas externas estén verificadas.

**Criterio de salida:** las 16 constancias funcionan fuera del programa y ninguna tarjeta de trabajo termina en
una ruta inexistente o en una planilla para buscar manualmente.

### Fase 3 — Completar los conectores ya diseñados

- [ ] Instalar, validar y activar las doce plantillas de Inspecciones con sus números correctos.
- [ ] Crear/mapear los doce cursos de Capacitación y aplicar cobertura 90 % a N°54/56.
- [ ] Permitir seleccionar y editar N°85–89 en Campañas; eliminar `[85]` como default implícito.
- [ ] Configurar N°84 en los planes de emergencia de cada faena.
- [ ] Conservar enlaces directos al run, sesión, campaña o simulacro que originó la acreditación.
- [ ] Reprobar un mapeo que apunte a una actividad inexistente, retirada o incompatible con el módulo.

**Criterio de salida:** cerrar cada tipo de registro crea un evento durable, una sola ejecución y una tarjeta de
aprobación o un cumplimiento aprobado según su política.

### Fase 4 — Construir los enganches que faltan

- [ ] N°7: emitir el evento al cerrar el período mensual de Indicadores SST.
- [ ] N°19: definir y validar el expediente mínimo de requisitos legales por faena.
- [ ] N°36: acreditar por acuses de difusión de la MIPER, con cobertura por población aplicable.
- [ ] N°43: acreditar al publicar la versión vigente de un PTS/estándar operacional tipificado.
- [ ] N°35: emitir al publicar una nueva revisión MIPER; incluir reversión si la publicación queda supersedida
      por corrección inválida.
- [ ] N°83: acreditar un ítem por amenaza al publicar un plan aprobado con sus escenarios.
- [ ] N°21: implementar sólo si la decisión de Fase 0 la conserva.
- [ ] Integrar y validar el trabajo local de N°45–50 mediante la misma interfaz durable.

**Criterio de salida:** cada enganche tiene evento positivo, reintento idempotente, reversión y enlace al
expediente fuente.

### Fase 5 — Habilitación del trabajador

- [ ] Modelar una instancia de habilitación por trabajador y cambio de cargo/puesto.
- [ ] Registrar componentes: IRL, evaluación, RE-28, RIOHS, EPP inicial, examen preocupacional y documentos/
      procedimientos aplicables.
- [ ] Reutilizar asistencia de Capacitación, distribución documental y Entregas en vez de duplicar registros.
- [ ] Guardar sólo aptitud/estado y referencia autorizada para salud ocupacional; no exponer diagnósticos en PDTP.
- [ ] Acreditar N°15–18 y 23 por componente; acreditar N°52 sólo al completar todos los componentes aplicables.
- [ ] Derivar cobertura desde el padrón real de trabajadores aplicables, no desde un número manual que envejece.
- [ ] Crear la vista bajo el perfil existente de trabajador y una cola agregada de personas incompletas.

**Archivos esperados:** schema nuevo bajo `db/schema/prevention/`, servicio en `lib/services/`, validación en
`lib/validation/` y ruta bajo `app/(app)/prevencion/trabajador/[workerId]/`. No recrear lógica en `modules/`.

### Fase 6 — Permisos, conciliación y datos

- [ ] Cruzar cada `responsible_slug` activo con rol RBAC, permiso del destino y alcance de faena.
- [ ] Ejecutar `db:sync-rbac` en cada ambiente sólo después de revisar el diff de grants.
- [ ] Crear un reconciliador read-only/dry-run para hechos 2026 ya existentes y exportar su resultado en Excel.
- [ ] No acreditar automáticamente hechos anteriores a `activatedAt`; cualquier carga histórica requiere una
      decisión explícita, procedencia y aprobación.
- [ ] Reconciliar eventos pendientes después de activar o corregir configuración, sin duplicar ejecuciones.
- [ ] Agregar alertas operacionales para eventos en `error` o pendientes por falta de programa/mapeo.

### Fase 7 — Activación controlada y retiro del flujo antiguo

- [ ] Ejecutar la compuerta 82/82 en una base QA desechable con el catálogo y la configuración definitivos.
- [ ] Resolver la fecha efectiva y activar primero en QA/staging.
- [ ] Ejecutar UAT por rol y faena; registrar aprobación humana del catálogo y los formularios.
- [ ] Activar producción en una ventana acordada y observar eventos, ejecuciones y errores.
- [ ] Sólo después de la estabilización, ocultar el registro manual normal de la planilla. Mantener una función
      administrativa separada para conciliación histórica, con permiso y motivo auditables.

## 7. Estrategia de pruebas y evidencia

### 7.1 Contrato automatizado

Una prueba PGlite debe construir el programa 2026, aplicar decisiones y mecanismos y comprobar:

- conjunto activo exacto de 82 números;
- un destino externo por cada número y ninguno para los retirados;
- ningún href de ejecución apunta a `/prevencion/pdtp/actividades`;
- todos los responsables tienen un rol resoluble y el permiso del destino;
- las configuraciones exigidas existen;
- la suma de la matriz de este documento es 82.

### 7.2 Integración por adapter

Para cada familia —Constancias, Inspecciones, Capacitación, Documentación, MIPER, Indicadores, Higiene,
Habilitación, Entregas, CPHS, Incidentes, Emergencias y Campañas— cubrir:

1. evento válido → libro durable → ejecución correcta;
2. mismo evento repetido → cero duplicados;
3. evento con programa borrador → queda pendiente, no se pierde;
4. activación/reconciliación → se acredita una sola vez respetando `activatedAt`;
5. fuente anulada/reabierta → reversión trazable;
6. actividad excluida o faena fuera de alcance → no acredita;
7. evidencia y cantidad correctas;
8. hallazgo/CAPA abierto no quita el cumplimiento de la inspección realizada.

### 7.3 E2E por recorrido de usuario

Crear pruebas Playwright deterministas que parten siempre en `/pendientes`:

- responsable ve sólo sus actividades y faenas;
- el CTA abre el módulo fuente prefiltrado;
- completa el registro sin visitar el programa;
- ve confirmación y enlace al expediente;
- la tarea desaparece o pasa a “Por aprobar”;
- el aprobador valida y el indicador formal cambia;
- no aparecen errores de consola ni red.

No hace falta una prueba browser distinta para cada número cuando comparten exactamente el mismo adapter, pero
la prueba de contrato sí debe enumerar los 82. Se exige al menos un E2E por adapter y casos adicionales para
N°25/26, N°50, N°52, N°83/84 y N°21 si se conserva.

### 7.4 Verificación de entrega

En cada fase ejecutar, según corresponda:

- pruebas focalizadas unitarias y PGlite;
- `npm run typecheck`;
- `npm run lint`;
- `npm run test:fast` y los archivos PGlite afectados;
- E2E focalizados con la aplicación local;
- `npm run build` al cerrar cambios de schema, rutas o servicios compartidos.

El repositorio no expone actualmente `npm run audit`; no se debe afirmar una auditoría MonkeyTest inexistente.
Para cambios de UI se conserva evidencia Playwright focalizada y UAT humano.

## 8. Definition of Done

El objetivo se considera terminado únicamente cuando:

- [ ] la compuerta reporta **82/82 ready** y cero `config_required`, `code_gap`, `permission_gap` o
      `decision_required`;
- [ ] ninguna actividad de **Mis pendientes** lleva a la planilla o a una ruta inexistente;
- [ ] las 16 constancias tienen formulario externo y evidencia auditable;
- [ ] los 60 enganches generan eventos desde sus módulos fuente;
- [ ] las 6 actividades compuestas se resuelven desde Habilitación del trabajador;
- [ ] los reintentos y reversiones no duplican ni dejan cumplimiento fantasma;
- [ ] el programa borrador no pierde hechos y el programa activo respeta `activatedAt`;
- [ ] ejecución de inspecciones y cierre de hallazgos/CAPA siguen siendo métricas independientes;
- [ ] RBAC, navegación, manifest, alcance de faena y servidor están en paridad;
- [ ] pruebas focalizadas, typecheck, lint, build y E2E aplicables están verdes;
- [ ] la jefatura de Prevención completa UAT por rol/faena y aprueba los mapeos;
- [ ] el reporte final distingue código validado, datos configurados, UAT y despliegue efectivo.

## 9. Riesgos y límites

- Activar el programa sin decidir el inicio temporal puede crear una deuda masiva retroactiva. La activación no
  forma parte automática de la implementación.
- Un destino visible no reemplaza autorización. Todos los servicios deben fallar cerrado por permiso y faena.
- Los datos clínicos y de personas sensibles requieren controles más estrictos que el PDTP agregado.
- Las configuraciones de plantillas/cursos/campañas/planes son datos operacionales: desplegar código no las crea
  ni las valida por sí solo.
- La conciliación histórica puede cambiar indicadores; debe ejecutarse primero en dry-run y producir Excel, sin
  tocar producción hasta contar con autorización.
- El trabajo local actual de Higiene, Docker, despliegue y captura pertenece a cambios preexistentes. Este plan no
  los modifica ni los declara listos para producción.

## 10. Orden de commits sugerido al ejecutar el plan

1. contrato 82/82, libro de eventos y compuerta de activación;
2. Constancias + destinos de Mis pendientes;
3. configuración y conectores existentes;
4. Documentación, MIPER, Indicadores, Emergencias e Incidentes;
5. Habilitación del trabajador;
6. RBAC, conciliación y observabilidad;
7. E2E, retiro del formulario normal de la planilla y documentación final.

Cada commit debe dejar sus pruebas focalizadas verdes y no mezclar decisiones de catálogo con cambios
mecánicos o infraestructura ajena.
