# Decisiones tomadas sobre el PDTP 2026

**Fecha:** 2 de septiembre de 2026

**Alcance:** las 22 decisiones que quedaron abiertas tras la auditoría de mecanismos de acreditación
([AUDITORIA_PDTP_ACREDITACION_2026-09-01.md](AUDITORIA_PDTP_ACREDITACION_2026-09-01.md)) y el trabajo posterior
sobre el padrón de cobertura.

**Estado:** las 22 resueltas. Cinco crean trabajo nuevo que no estaba en ningún plan; dos cambiaron de forma
respecto de las opciones planteadas y exigen código que no estaba previsto.

## 1. Resoluciones

### Jefa de prevención

| # | Decisión | Resolución |
|---|---|---|
| D01 | Desde cuándo arranca el programa | **Desde el mes en curso.** No se arrastra lo vencido de enero a agosto. |
| D02 | N°21 — retirarla o conservarla | **Retirarla.** Mide lo mismo que las N°66–78, que ya se acreditan solas. |
| D03 | Instrumento de la N°40 y la N°41 | **Confirmar lo que el código propone:** N°40 → inspección de área de trabajo, N°41 → caminata de seguridad. |
| D04 | Quién firma el report de uso diario | **El JT sube y firma.** Ver §2.1: cambia respecto de lo planteado. |
| D05 | ¿El ítem de capacitación de EPP del acta cierra la N°63? | **Sí, la cierra.** |
| D06 | ¿La declaración de salud del acta es el RE-28? | **No son lo mismo.** La N°17 no se acredita desde el acta. |
| D07 | ¿Declarar que un protocolo MINSAL no aplica acredita? | **Sí, acredita.** Es el comportamiento ya implementado. |
| D08 | Alcotest — ¿módulo propio? | **Sí, módulo propio.** |
| D09 | CGRD — ¿módulo propio? | **Sí, módulo propio.** |
| D10 | El calendario de la N°50 es un solo mes | **Repartirlo por faena.** |
| D11 | ¿Se escribe el checklist DS 594? | **Sí, escribirlo.** |
| D12 | Documentos de la carpeta de requisitos legales | **Definir la lista por faena.** |
| D13 | El plan de emergencia, ¿por plan o por amenaza? | **Por amenaza.** El denominador son los escenarios. |

### Equipo técnico

| # | Decisión | Resolución |
|---|---|---|
| D14 | ¿Se mantiene el cambio del padrón inferido? | **Mantenerlo.** Ninguna actividad mide contra una población inventada. |
| D15 | Alcance del plan del padrón derivado | **Fases 1 a 3.** `closed_on_time` queda para después. |
| D16 | Padrón de extintores | **Los existentes**, no los puntos exigidos. |
| D17 | ¿Se blinda el escritor de parámetros por faena? | **Blindarla igual.** Deja de ser una primitiva sin política. |
| D18 | ¿Se construye el submódulo Constancias? | **Sí, construirlo.** Ver §2.3: su alcance se redujo a la mitad. |
| D19 | El permiso de higiene del PRF es muy ancho | **Permiso nuevo más fino.** |
| D20 | ¿El número de campaña es editable? | **Sí, editable** después de crearla. |
| D21 | El responsable de la N°25 no existe como rol | **Sigue siendo conductores y operadores.** Ver §2.2: cambia respecto de lo planteado. |
| D22 | G11 parte de una premisa falsa | **Reescribirlo como "cablear el acta".** |

## 2. Las tres que cambiaron el diseño

### 2.1 D04 — el candado de independencia estaba mirando a la persona equivocada

La resolución no es la que se había planteado. El razonamiento de la jefatura es más preciso: **el report lo
hizo el operador, no el jefe de terreno**. El JT sólo transcribe un formulario de papel que ya trae el nombre
de quien lo ejecutó, así que no hay conflicto de independencia en que lo firme.

Eso convierte la decisión en trabajo de código, no en un asunto de comunicación. Hoy
[prevention-inspections.ts:1527](lib/services/prevention-inspections.ts#L1527) graba
`executedByUserId = access.userId` —el usuario de plataforma que completa el run— y el guard de revisión
impide que ese mismo usuario firme. Con la plantilla `reporte_equipos` eso bloquea al JT aunque no haya
ejecutado el acto inspeccionado.

**Lo que hay que resolver al implementar:** cómo declarar que en esta plantilla el ejecutante de registro es la
persona nombrada en el formulario (`operador_entrante`) y no quien lo teclea. La vía más limpia es un campo
declarativo en `prevention_inspection_templates` —del estilo de `pdtp_review_activity_numbers`, que ya existe
para separar ejecutar de revisar— en vez de una excepción codificada por nombre de plantilla.

### 2.2 D21 — el responsable de registro y el operador de plataforma son personas distintas

También se rechazaron las dos opciones planteadas. El responsable declarado de la N°25 **sigue siendo
conductores y operadores**: la responsabilidad es documental, no de cuenta. El JT sube el report y el nombre
del conductor u operador figura en el formulario.

Es coherente con la D04 y con el diseño del propio formulario, que tiene `operador_entrante` como campo
obligatorio precisamente porque esas personas no tienen cuenta.

**Consecuencia a resolver:** la cola de trabajo por responsable
([operational-work-queue.ts](lib/services/operational-work-queue.ts)) deriva el dueño de cada actividad desde
`pdtp_responsible_catalog` hacia un rol RBAC. Un responsable sin rol no genera trabajo para nadie, así que la
N°25 quedaría invisible en `/pendientes`. Hay que decidir si la cola la asigna al JT —que es quien opera— o si
la N°25 se declara deliberadamente sin cola, y dejarlo escrito para que no se lea como un bug.

### 2.3 D18 — sus propias decisiones vecinas le quitaron la mitad del alcance

Construir el submódulo Constancias se aprobó pensando en 15 actividades. Pero la D08, la D09 y la D11 sacan
siete de esa lista:

| Decisión | Salen de constancias |
|---|---|
| D11 — checklist DS 594 | N°10 |
| D08 — módulo de alcotest | N°30, 31, 32 |
| D09 — módulo de CGRD | N°79, 80, 81 |

Quedan **ocho**: N°3, 6, 20, 22, 28, 42, 61 y 82. Sigue siendo un submódulo defendible —reunirlas en un lugar
en vez de buscarlas entre 81 filas— pero conviene decidir su prioridad sabiendo que cubre ocho actividades y no
quince, y que las ocho ya se pueden marcar hoy desde la planilla.

## 3. Trabajo nuevo que crean estas decisiones

Cinco resoluciones abren trabajo que no estaba en ningún plan ni grupo del TODO:

| Decisión | Qué hay que construir | Actividades que cierra |
|---|---|---|
| D08 | Módulo de alcotest: registro por control con trabajador, equipo y resultado | N°30, 31, 32 |
| D09 | Módulo de CGRD (DS 44): comité, matriz GRD, actas y plan de trabajo | N°79, 80, 81 |
| D11 | Definición de checklist de condiciones ambientales DS 594 | N°10 |
| D18 | Submódulo Constancias | ocho, ya marcables hoy |
| D19 | Permiso RBAC nuevo, más fino que `prevention:hygiene:manage` | ninguna, es corrección de alcance |

Los dos módulos nuevos son el trabajo grande. El del CGRD tiene además peso normativo propio: es un comité que
el DS 44 exige, distinto del paritario, y hoy sus tres actividades sólo tienen constancia manual.

**Orden sugerido**, por rendimiento y dependencias:

1. **D01 primero, sola.** Activar el programa desde el mes en curso destraba las otras 21: sin programa activo
   no se puede registrar ni verificar nada.
2. **Lo que ya está listo y sólo espera datos:** D02, D03, D10, D16 y las cargas de catálogo del TODO. Sube la
   acreditación automática sin código nuevo.
3. **El plan del padrón derivado, fases 1 a 3** (D15), que trae consigo la D05, la D06 y la D22.
4. **Las correcciones acotadas:** D17, D19, D20, y el código que exigen la D04 y la D21.
5. **Los módulos nuevos:** D11 (el más chico), luego D09 (peso normativo) y D08.
6. **D18 al final**, cuando ya se sepa cuántas constancias quedan de verdad.

## 4. Referencias

- Registro navegable de las 22 decisiones y su resolución: [PDTP_DECISIONES_TOMADAS_2026-09-02.html](PDTP_DECISIONES_TOMADAS_2026-09-02.html)
- Registro de las 87 actividades: [PDTP_REGISTRO_ACTIVIDADES_2026-09-01.html](PDTP_REGISTRO_ACTIVIDADES_2026-09-01.html)
- Auditoría de origen: [AUDITORIA_PDTP_ACREDITACION_2026-09-01.md](AUDITORIA_PDTP_ACREDITACION_2026-09-01.md)
- Plan de trabajo por grupos: [tasks/TODO_PDTP_ACREDITACION_2026-09-01.md](tasks/TODO_PDTP_ACREDITACION_2026-09-01.md)
