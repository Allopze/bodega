# Prompt para implementar el módulo PPA Digital / Para, Piensa y Actúa

Actúa como una IA desarrolladora senior con acceso completo al repositorio de mi webapp. Tu tarea es implementar un nuevo módulo llamado **PPA Digital / Para, Piensa y Actúa**, siguiendo la arquitectura, convenciones, stack, patrones de código, estructura de carpetas, sistema de autenticación, estilos visuales y lógica existente del proyecto.

No quiero una aplicación aparte. No quiero una reescritura completa. No quiero una solución sobredimensionada. Implementa el módulo dentro de la webapp actual de la forma más limpia, mantenible y coherente posible.

## Contexto del módulo

El módulo busca digitalizar el proceso de evaluación preventiva antes del inicio de una tarea. El trabajador debe completar un PPA rápido desde un QR o enlace directo, responder preguntas críticas sobre la tarea, los peligros, los cambios, los controles y la seguridad de inicio.

El sistema debe permitir detectar condiciones inseguras, detener el trabajo, alertar al supervisor, registrar la intervención correctiva y dejar trazabilidad para análisis posterior.

El objetivo no es crear un simple formulario digital. El objetivo es crear un flujo preventivo real que ayude a evitar que un trabajo comience si existe un riesgo no controlado.

## Realidad del repositorio (stack y convenciones verificadas)

Esta sección refleja cómo está construido realmente este proyecto. Respétala; no asumas otra cosa.

- **Framework:** Next.js 16 con App Router y React 19 en TypeScript. OJO: es una versión con cambios respecto a lo habitual; antes de escribir código lee la guía relevante en `node_modules/next/dist/docs/` (lo exige `AGENTS.md`).
- **Patrón de feature:** cada área vive en `app/(app)/<área>/` con su `page.tsx`, componentes co-ubicados y un `actions.ts` con **Server Actions**. La lógica de negocio va en `lib/services/`, la auth en `lib/auth/`, la validación en `lib/validation/`. **La fuente de verdad es `lib/` + `app/`, NO el scaffolding de `modules/`.** En `modules/` solo se tocan los `manifest.ts` para registrar navegación, permisos y defaultGrants (ver `AGENTS.md` y `modules/README.md`).
- **Persistencia:** Drizzle ORM + PostgreSQL. Esquemas en `db/schema/*.ts`, IDs con `nanoid` (`@/lib/id`), migraciones con `drizzle-kit` (`npm run db:generate` / `db:migrate`). Hay seed en `db/seed.ts`.
- **Validación:** Zod 4 (en `lib/validation/` y co-ubicada), aplicada tanto en cliente como dentro de las Server Actions.
- **Autenticación:** next-auth v5 (Auth.js, beta). El gateo de rutas NO está en `middleware.ts` sino en **`proxy.ts`** en la raíz, que **bloquea toda ruta que no esté en `publicPaths`** y la redirige a `/login`. Hoy las únicas rutas públicas son `/login`, `/registro`, `/recuperar`, `/api/auth`, `/api/health`.
- **Permisos (RBAC):** roles y permisos viven en base de datos, derivados de los `modules/*/manifest.ts` (cada manifest declara `permissions` + `defaultGrants` por `roleSlug`). Hay scoping por faena (`worksiteUsers`) para roles `*_faena`. Helpers en `lib/auth/` (`can.ts`, `rbac.ts`, `scope.ts`).
- **Roles existentes (no hay más, NO existe un rol "supervisor"):** `administrador`, `jefa_chome`, `secretaria`, `prevencionista` (oficina), `prevencionista_faena` (scoped a faenas asignadas), `solicitante_faena`, `jefe_mantencion`. Ver `lib/auth/system-rbac.ts`.
- **Trabajadores:** ya existe una **lista controlada** real: tabla `workers` (`db/schema/worksites.ts`) con `rut`, `firstName`, `lastName`, `position` (cargo), `supervisor` (nombre, texto), `prevencionista` (nombre asignado, texto), `worksiteId`, `isActive`. Se administra en `app/(app)/admin/trabajadores/`. Los trabajadores NO son usuarios del sistema.
- **Faenas/worksites:** tabla `worksites`; cada trabajador pertenece a una faena. Útil para contexto del PPA (área/lugar) y para enrutar alertas por faena.
- **Notificaciones:** servicio in-app en `lib/services/notifications.ts` (consumido por `NotificationBell` vía `/api/notifications`, con vista en `app/(app)/notificaciones/`). Email vía **Resend** en `lib/email/smtp.ts` (la fachada se sigue llamando "smtp" pero usa Resend; nodemailer fue eliminado) + plantillas en `lib/services/email-templates.ts`. Usa `notifySafe()` (fire-and-forget).
- **Exportaciones:** SIEMPRE XLSX, NUNCA CSV (regla de `AGENTS.md`). Librería: `exceljs`. Patrones existentes en `lib/reports/export.ts` y `lib/services/trazabilidad-export.ts`.
- **UI:** Radix UI + Tailwind v4, componentes en `components/`, íconos Phosphor. Toasts: importar `toast` desde `@/lib/toast` (NO de `sonner` directamente).
- **QR:** **no hay librería de QR instalada.** El MVP debe entregar un enlace directo funcional; si se agrega QR, instalar algo simple (p. ej. `qrcode`) sin sobredimensionar.
- **Impresión/PDF:** existe el route group `app/(print)/` y `lib/pdf/` por si el PPA o el acta necesitan versión imprimible.
- **Pruebas:** Vitest (unit, `npm test`) y Playwright (e2e, `npm run test:e2e`). El proyecto SÍ tiene pruebas automatizadas extensas; agrega/actualiza pruebas.

### Módulo de prevención ya existente (integrar, no duplicar)

Ya existe un área de **Prevención**: `app/(app)/prevencion/` ("Evaluaciones SST" — checklists de trabajadores nuevos/antiguos post-incidente), con lógica en `lib/sst/` + `lib/services/sst.ts`, esquema `db/schema/sst.ts` y manifest `modules/sst/manifest.ts` (permisos `sst:view|create|close|manage`, área de nav `prevencion`). El PPA Digital debe sumarse como un submódulo coherente dentro de esa misma área de navegación `prevencion`, reutilizando sus convenciones (no crear una sección desconectada).

## Decisión importante sobre usuarios trabajadores

No debes crear cuentas de usuario para cada trabajador.

Los trabajadores no deben iniciar sesión ni tener contraseña. El acceso del trabajador debe ser simple, mediante QR o enlace directo al formulario PPA.

Al inicio del formulario, el trabajador debe identificarse de una forma simple y ordenada. Debe poder buscarse o seleccionarse desde la **lista controlada de trabajadores que ya existe** (tabla `workers`: nombre, RUT, cargo, faena). Reutiliza esa tabla; no inventes otro origen de datos.

Si el trabajador no aparece en la lista, el sistema debe permitir continuar con identificación manual (texto libre: nombre/RUT/empresa), pero ese registro debe quedar **marcado con una bandera de "identificación manual / pendiente de validación"** para revisión posterior por un usuario autorizado.

Los usuarios autenticados del sistema son solo perfiles internos. IMPORTANTE: en este repo **no existe un rol llamado "supervisor"**. Los roles reales son `administrador`, `jefa_chome`, `secretaria`, `prevencionista`, `prevencionista_faena`, `solicitante_faena` y `jefe_mantencion`. El "supervisor responsable" del flujo PPA debe mapearse a roles reales —típicamente `prevencionista_faena` (scoped a la faena del trabajador) y/o `prevencionista` y `jefa_chome`— y/o al campo de texto `worker.supervisor`/`worker.prevencionista` para mostrar el responsable. Si el flujo necesita un permiso/rol nuevo de revisión PPA, decláralo en el manifest del módulo con sus `defaultGrants`, sin crear un sistema de auth paralelo.

No inventes un sistema nuevo de autenticación si ya existe uno. No crees usuarios trabajadores si no son necesarios. Mantén el flujo del trabajador con la menor fricción posible.

## Reglas técnicas generales

La sección "Realidad del repositorio" de arriba ya responde el grueso de la inspección. Antes de implementar, confírmala y profundiza en los puntos concretos del módulo:

- Rutas/feature: replica el patrón `app/(app)/<área>/page.tsx` + `actions.ts` + componentes co-ubicados; mira `app/(app)/prevencion/` como referencia directa.
- Autenticación y rutas públicas: revisa `proxy.ts` (hay que **agregar la ruta pública del formulario PPA** a `publicPaths`, p. ej. `/ppa`, para que el trabajador acceda sin login sin que el proxy lo redirija).
- Permisos: revisa `modules/sst/manifest.ts` y `lib/auth/` para declarar los permisos del PPA y sus `defaultGrants`.
- Persistencia: revisa `db/schema/sst.ts` y `db/schema/worksites.ts` como modelo; agrega el/los esquemas del PPA en `db/schema/` con Drizzle + `nanoid` y genera migración.
- Validación: replica el uso de Zod 4 dentro de las Server Actions (cliente + servidor).
- Notificaciones/alertas/estados: usa `lib/services/notifications.ts` (`notifySafe`) y, para email, `lib/email/smtp.ts` (Resend) + plantillas.
- Tablas/dashboards/reportes: replica los patrones existentes de listas, filtros y export XLSX (`exceljs`).
- UI: Radix + Tailwind v4, componentes de `components/`, toasts vía `@/lib/toast`.

Después de revisar el proyecto, implementa siguiendo los patrones actuales. No impongas una arquitectura externa si el proyecto ya tiene una forma clara de trabajar.

No propongas campos específicos de base de datos en la respuesta final. Si necesitas persistencia, resuélvela internamente usando las convenciones existentes del proyecto y explica la decisión a nivel funcional, no como diseño de tablas.

## Alcance del MVP

Implementa una primera versión funcional del módulo con el siguiente alcance:

1. Acceso al formulario PPA desde la webapp.
2. Acceso al formulario mediante QR o enlace directo.
3. Identificación simple del trabajador sin login.
4. Formulario PPA preventivo antes del inicio del trabajo.
5. Evaluación automática de respuestas críticas.
6. Detención automática del trabajo cuando exista riesgo no controlado.
7. Mensaje claro al trabajador cuando el trabajo debe detenerse.
8. Alerta al supervisor responsable.
9. Vista para que el supervisor revise PPA detenidos o pendientes.
10. Registro de intervención del supervisor.
11. Autorización o rechazo del inicio del trabajo por parte del supervisor.
12. Historial de PPA realizados.
13. Panel básico de análisis e indicadores.
14. Filtros básicos para revisar la información.
15. Exportación simple de datos en formato **XLSX** (la webapp ya exporta con `exceljs`; NUNCA CSV, por regla de `AGENTS.md`).

## Flujo del trabajador

El flujo del trabajador debe ser lo más simple posible:

1. Escanea un QR o abre un enlace directo.
2. Llega al formulario PPA.
3. Se identifica sin iniciar sesión.
4. Selecciona o indica el área, lugar o contexto de trabajo si corresponde.
5. Responde las preguntas del PPA.
6. Envía el formulario.
7. Recibe una respuesta clara del sistema:
   - Puede iniciar el trabajo.
   - Debe detener el trabajo y comunicarse con el supervisor.

El formulario debe estar optimizado para uso en celular. Debe ser rápido, claro y fácil de completar en terreno.

## Preguntas mínimas del formulario PPA

Incluye estas preguntas como base funcional del formulario:

### Pregunta 1

¿Qué trabajo voy a realizar?

Las opciones deben ser los **mismos cargos que ya usa el módulo de evaluación**, reutilizando la lista controlada `CARGO_OPTIONS` de `lib/sst/cargos.ts` (no inventes una lista nueva). Excluye `conductor_general` (Conductor General). Las opciones quedan:

- Conductor Ampliroll (`conductor_ampliroll`).
- Conductor Batea (`conductor_batea`).
- Operador Maquinaria Pesada (`operador_maquinaria_pesada`).

Es una lista cerrada y controlada: no incluyas opción "Otro" ni texto libre aquí.

### Pregunta 2

¿Existe algún cambio respecto a lo planificado?

Opciones:

- No.
- Sí.

Si responde “Sí”, debe aparecer una pregunta adicional:

¿Qué cambió?

### Pregunta 3

¿Existe un peligro que no esté controlado?

Opciones:

- No.
- Sí.

Si responde “Sí”, debe aparecer una pregunta adicional:

¿Cuál es el peligro?

### Pregunta 4

¿Tengo todos los controles implementados?

Controles sugeridos:

- Permiso de trabajo.
- Elementos de protección personal.
- Herramientas adecuadas y en buen estado.
- Energías bloqueadas.
- Señalización.
- Área despejada.
- Comunicación con el equipo.
- Otro control necesario para la tarea.

### Pregunta 5

¿Es seguro comenzar el trabajo?

Opciones:

- Sí.
- No.

Si responde “No”, el sistema debe detener el flujo y mostrar un mensaje claro de detención.

## Preguntas complementarias Para, Piensa y Actúa

Incluye también preguntas orientadas a verificar si el trabajador realmente observó, pensó y evaluó el riesgo antes de comenzar:

1. ¿Cuál es el peligro más crítico de la tarea que realizarás?
2. ¿Qué cambió hoy en el área de trabajo que podría aumentar el riesgo?
3. ¿Qué revisión realizaste al equipo o herramienta antes de comenzar?
4. ¿Qué condición del clima, ambiente o entorno podría hacerte detener el trabajo?

Estas preguntas deben ser obligatorias cuando la tarea sea crítica o cuando el flujo lo requiera. Si no existe configuración previa de tareas críticas, implementa una solución simple y fácil de extender, sin sobredimensionar.

## Reglas para detener el trabajo

El sistema debe detener el trabajo si ocurre cualquiera de estas situaciones:

- El trabajador responde que no es seguro comenzar.
- El trabajador declara que existe un peligro no controlado.
- El trabajador informa un cambio respecto a lo planificado y no describe el cambio.
- El trabajador deja sin responder una pregunta crítica.
- El trabajador responde de forma vacía, genérica o insuficiente en preguntas obligatorias.
- El trabajador indica que no identifica peligros en una tarea donde debería existir evaluación de riesgo.
- Faltan controles relevantes para la tarea seleccionada.

Cuando el trabajo se detenga, el trabajador debe ver un mensaje claro, visible y difícil de ignorar:

> DETENGA EL TRABAJO. Comuníquese con su supervisor.

El mensaje debe explicar que el trabajo no debe comenzar hasta que el supervisor revise la situación y autorice el inicio.

## Resultado cuando todo está correcto

Si las respuestas no activan ninguna condición crítica, el sistema debe permitir finalizar el PPA con un mensaje claro:

> Puede iniciar el trabajo de forma segura.

Ese resultado debe quedar registrado para trazabilidad y análisis posterior.

## Flujo del supervisor

> Nota de alineación: en este documento "supervisor" se usa en sentido funcional (quien revisa y autoriza). En el repo NO existe un rol `supervisor`; este rol funcional se mapea a `prevencionista_faena` (para su faena) y/o `prevencionista`/`jefa_chome`. Ver la sección "Realidad del repositorio".

Cuando el sistema detecte una condición insegura, debe generarse una alerta para el responsable de revisión correspondiente o para el panel de supervisión disponible.

La alerta debe mostrar de forma clara:

- Trabajador identificado.
- Hora del registro.
- Lugar, área o contexto del trabajo.
- Tipo de tarea.
- Motivo de la alerta.
- Respuesta crítica que activó la detención.
- Estado actual del PPA.

El supervisor debe poder abrir el detalle del PPA y responder al menos estas preguntas:

1. ¿Fui al lugar?
2. ¿Qué acción correctiva implementé?
3. ¿Autorizo iniciar el trabajo?

El supervisor no debe poder autorizar el inicio si no registra una acción correctiva cuando el trabajo fue detenido por riesgo o condición insegura.

La autorización o rechazo del supervisor debe quedar registrada dentro del historial del PPA.

## Estados funcionales del PPA

El módulo debe manejar estados funcionales claros para que el trabajador, el supervisor y los administradores entiendan en qué situación está cada PPA.

Estados mínimos esperados:

- Enviado.
- Aprobado automáticamente.
- Trabajo detenido.
- Pendiente de revisión del supervisor.
- En corrección.
- Autorizado por supervisor.
- Rechazado por supervisor.
- Cerrado.

Usa los nombres y estructura que mejor calcen con el proyecto, pero asegúrate de que estos estados funcionales existan o puedan representarse claramente en la interfaz.

## Panel del supervisor

Implementa una vista donde el supervisor pueda revisar:

- PPA pendientes de revisión.
- PPA con trabajo detenido.
- PPA ya autorizados.
- PPA rechazados.
- Historial de intervenciones.

Debe poder filtrar o buscar registros de forma simple, especialmente por fecha, estado, área, trabajador o tipo de tarea, si esos datos están disponibles en el flujo.

## Panel de administración y análisis

Implementa una vista básica de análisis para perfiles autorizados.

Debe permitir revisar indicadores como:

- Cantidad total de PPA realizados.
- Cantidad de trabajos detenidos.
- Porcentaje de PPA con desviaciones.
- Riesgos o motivos de alerta más frecuentes.
- Áreas con mayor cantidad de desviaciones.
- Tipos de trabajo con más alertas.
- Tiempo promedio de respuesta del supervisor, si la información está disponible.
- Cantidad de PPA aprobados automáticamente.
- Cantidad de PPA autorizados o rechazados por supervisor.

No es necesario construir un sistema avanzado de inteligencia de negocios. Implementa un dashboard útil, simple y coherente con la webapp actual.

## Trazabilidad

Cada PPA debe dejar trazabilidad suficiente para auditoría y análisis.

Debe poder saberse:

- Quién realizó el PPA o cómo se identificó el trabajador.
- Cuándo se realizó.
- Qué tarea declaró.
- Qué respuestas entregó.
- Qué condición activó una alerta, si aplica.
- Qué supervisor intervino, si aplica.
- Qué acción correctiva se registró.
- Qué decisión final tomó el supervisor.
- Cuándo se cerró o autorizó el caso.

No conviertas esto en una explicación de campos de base de datos. Resuelve la persistencia siguiendo el patrón del proyecto y entrega la trazabilidad funcional esperada.

## Notificaciones

Usa la infraestructura de notificaciones que YA existe en la webapp.

Prioridad de canales:

1. **Notificación interna in-app** vía `lib/services/notifications.ts` (helper `notifySafe()`, fire-and-forget; se muestra en `NotificationBell` y en `app/(app)/notificaciones/`). Este es el canal principal del MVP.
2. **Correo electrónico** vía la fachada `lib/email/smtp.ts` (powered by **Resend**) + plantillas en `lib/services/email-templates.ts`. Ya está soportado, úsalo cuando aplique.
3. No agregues integraciones externas nuevas (Teams, Slack, WhatsApp). El proyecto no las tiene y quedan fuera del MVP.

Como no hay rol "supervisor", enruta las notificaciones por **permiso de revisión PPA y/o por faena** (p. ej. a los `prevencionista_faena` de la faena del trabajador y a `prevencionista`/`jefa_chome`), reutilizando el patrón de destinatarios por permiso/rol que ya usa `notifications.ts`.

Las notificaciones mínimas son:

- Al responsable de revisión (prevencionista/faena) cuando un trabajo es detenido.
- Al responsable de revisión cuando un PPA queda pendiente de revisión.
- A la vista pública del trabajador cuando el trabajo queda autorizado.
- A la vista pública del trabajador cuando el trabajo queda rechazado o requiere corrección.

## Experiencia de usuario

El módulo debe ser extremadamente claro.

Prioridades de UX:

- Mobile first.
- Formulario breve.
- Lenguaje simple.
- Botones grandes y comprensibles.
- Estados visuales claros.
- Mensajes de riesgo visibles.
- Confirmaciones antes de enviar respuestas críticas.
- Evitar pantallas innecesarias.
- Evitar que el trabajador tenga que iniciar sesión.
- Evitar campos largos cuando se pueda seleccionar desde opciones.

El trabajador debe entender rápidamente si puede iniciar o debe detener el trabajo.

El supervisor debe entender rápidamente qué ocurrió, qué debe revisar y qué decisión debe registrar.

## Permisos

Respeta el sistema de permisos existente (RBAC por base de datos, derivado de `modules/*/manifest.ts` con `defaultGrants` por `roleSlug` y scoping por faena vía `worksiteUsers`).

Los trabajadores sin login solo deben poder acceder al formulario público (ruta agregada a `publicPaths` en `proxy.ts`) y ver el resultado asociado al envío actual. No deben poder navegar al resto de la app.

El responsable de revisión (mapeado a `prevencionista_faena` para su faena, y/o `prevencionista`/`jefa_chome`) debe poder ver y gestionar los PPA que le correspondan. Recuerda: **no existe rol "supervisor"**.

Los `administrador` y `prevencionista` deben poder revisar el conjunto de registros e indicadores.

Declara los permisos del PPA (p. ej. `ppa:view`, `ppa:review`, `ppa:manage`) en el manifest del módulo con sus `defaultGrants`, siguiendo el patrón de `modules/sst/manifest.ts`. No crees una arquitectura de permisos paralela.

## Validaciones

El formulario debe validar:

- Identificación del trabajador.
- Tipo de trabajo.
- Preguntas críticas obligatorias.
- Descripciones requeridas cuando se responde “Sí” a cambios o peligros.
- Selección de controles.
- Confirmación de seguridad para iniciar.

Las validaciones deben ocurrir tanto en el frontend como en el backend si el proyecto tiene esa separación.

## QR o enlace directo

Implementa o deja preparado el acceso mediante QR o enlace directo.

**La webapp hoy NO tiene librería de generación de QR.** Por lo tanto, el MVP debe entregar un **enlace directo** funcional al formulario PPA (ruta pública agregada a `proxy.ts`). Si se quiere mostrar un QR, agrega una librería simple (p. ej. `qrcode`) sin sobredimensionar; no es bloqueante para el MVP.

El enlace debe llevar al formulario PPA correspondiente, idealmente con contexto de **faena/worksite** (que sí existe en el proyecto) como parámetro, para precargar el contexto de trabajo.

No bloquees el MVP por una generación avanzada de QR. El acceso directo al formulario es suficiente si queda bien preparado.

## Funcionalidades fuera del MVP

No implementes en esta primera versión, salvo que ya existan en la webapp y sea trivial integrarlas:

- Cuentas de usuario para trabajadores.
- Aplicación móvil nativa.
- Inteligencia artificial para evaluar respuestas abiertas.
- Integraciones complejas con ERP.
- Integración avanzada con Teams, Slack o WhatsApp.
- Firma electrónica avanzada.
- Modo offline.
- Geolocalización obligatoria.
- Reportes predictivos.
- Matriz de riesgos completa.
- Gestión documental HSE completa.
- Capacitaciones dentro del módulo.
- Auditorías completas de seguridad.

Mantén el MVP enfocado en el flujo crítico: responder, evaluar, detener, alertar, corregir, autorizar y analizar.

## Criterios de aceptación

La implementación se considerará correcta si cumple con lo siguiente:

1. Un trabajador puede acceder al formulario sin iniciar sesión.
2. Un trabajador puede identificarse de forma simple y ordenada.
3. Un trabajador puede completar el PPA desde celular.
4. El sistema detecta respuestas críticas.
5. El sistema detiene automáticamente el trabajo cuando corresponde.
6. El sistema muestra un mensaje claro de detención.
7. El supervisor recibe o visualiza una alerta del PPA detenido.
8. El supervisor puede revisar el detalle del PPA.
9. El supervisor puede registrar una acción correctiva.
10. El supervisor puede autorizar o rechazar el inicio del trabajo.
11. Los PPA quedan disponibles en un historial.
12. Los usuarios autorizados pueden revisar indicadores básicos.
13. La solución respeta la arquitectura y estilos de la webapp actual.
14. La solución no crea cuentas innecesarias para trabajadores.
15. La solución no rompe funcionalidades existentes.

## Pruebas esperadas

El proyecto SÍ tiene pruebas automatizadas extensas: **Vitest** para unit (`npm test`) y **Playwright** para e2e (`npm run test:e2e`). Agrega o actualiza pruebas para los flujos principales:

- Envío de PPA seguro (aprobado automáticamente).
- Envío de PPA con trabajo detenido.
- Validación de preguntas críticas (lógica de evaluación/detención en `lib/services`, testeable con Vitest).
- Revisión por el responsable (prevencionista/faena).
- Autorización por el responsable.
- Rechazo por el responsable.
- Acceso y permisos básicos (incluyendo que la ruta pública del PPA funcione sin login y el resto siga protegido por `proxy.ts`).

Prioriza tests unitarios de la lógica de evaluación/estados en `lib/`, y al menos un e2e del flujo crítico del trabajador.

## Entrega esperada

Al finalizar, entrega:

1. Resumen de lo implementado.
2. Archivos modificados o creados.
3. Decisiones técnicas importantes.
4. Cómo probar el flujo del trabajador.
5. Cómo probar el flujo del supervisor.
6. Cómo revisar los indicadores.
7. Limitaciones conocidas.
8. Próximos pasos recomendados.

No entregues una propuesta genérica. Implementa el módulo dentro del código existente.

No inventes requisitos que no fueron solicitados.

No crees un sistema de usuarios trabajadores.

No entregues diseño de base de datos como respuesta principal.

No conviertas el MVP en una plataforma HSE completa.

Prioriza una implementación funcional, clara, segura, mantenible y fácil de extender.
