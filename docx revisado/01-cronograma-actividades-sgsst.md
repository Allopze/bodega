# Módulo 01: Cronograma de Actividades SG-SST

> **Documento fuente:** `1. ACTIVIDADES PROGRAMA SG-SST AÑO 2025.xls` y
> `1. ACTIVIDADES PROGRAMA SG-SST AÑO 2025 REV.xls` **Empresa:**
> Servicios Industriales Chome Ltda. **Tipo:** Planificación y
> seguimiento anual

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona el **cronograma anual de actividades del Sistema de
Gestión de Seguridad y Salud en el Trabajo (SG-SST)**. Permite
planificar, programar y hacer seguimiento mensual de todas las
actividades preventivas, inspecciones, reuniones y gestiones que deben
ejecutar los distintos roles en cada centro de trabajo (faena).

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `Cronograma`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `año` | Integer | Año del cronograma |
| `empresa_id` | FK → Empresa | Empresa asociada |
| `estado` | Enum | `borrador`, `aprobado`, `en_ejecución`, `cerrado` |
| `aprobado_por` | FK → Usuario | Gerente que aprueba |
| `fecha_aprobación` | Date | Fecha de aprobación |
| `created_at` | Timestamp | Fecha de creación |
| `updated_at` | Timestamp | Última modificación |

### 2.2 Entidad: `ActividadProgramada`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `cronograma_id` | FK → Cronograma | Cronograma padre |
| `categoría` | Enum | Ver categorías abajo |
| `nombre` | String(500) | Nombre de la actividad |
| `descripción` | Text | Descripción detallada / observaciones |
| `responsable_rol` | String(100) | Rol(es) responsable(s) |
| `frecuencia` | Enum | `diaria`, `semanal`, `quincenal`, `mensual`, `bimestral`, `trimestral`, `semestral`, `anual`, `cuando_aplique` |
| `meta_anual` | Integer | Cantidad total programada al año |
| `orden` | Integer | Orden de visualización |

### 2.3 Entidad: `ProgramaciónMensual`

| Campo                 | Tipo                     | Descripción              |
|-----------------------|--------------------------|--------------------------|
| `id`                  | UUID                     | Identificador único      |
| `actividad_id`        | FK → ActividadProgramada | Actividad asociada       |
| `mes`                 | Integer (1-12)           | Mes                      |
| `cantidad_programada` | Decimal                  | Cantidad programada (P)  |
| `cantidad_realizada`  | Decimal                  | Cantidad realizada (R)   |
| `centro_trabajo_id`   | FK → CentroTrabajo       | Faena donde se ejecuta   |
| `evidencia_url`       | String                   | Link a evidencia adjunta |
| `observaciones`       | Text                     | Notas adicionales        |

### 2.4 Entidad: `AvanceCronograma` (vista calculada)

| Campo                       | Tipo    | Descripción       |
|-----------------------------|---------|-------------------|
| `avance_mensual_programado` | Decimal | Suma P del mes    |
| `avance_mensual_real`       | Decimal | Suma R del mes    |
| `porcentaje_mensual`        | Decimal | R/P × 100 del mes |
| `avance_anual_programado`   | Decimal | Suma P anual      |
| `avance_anual_real`         | Decimal | Suma R anual      |
| `porcentaje_anual`          | Decimal | R/P × 100 anual   |

------------------------------------------------------------------------

## 3. Categorías de Actividades

Las actividades se organizan en 3 grandes grupos:

### 3.1 Índices Cuantitativos de Accidentabilidad y Siniestralidad

| Actividad | Responsable | Frecuencia | Detalle |
|----|----|----|----|
| Estadísticas | PR | Mensual | Envío los días 06 de cada mes |
| Investigación preliminar del accidente | PR | Cuando aplique | 3 horas de ocurrido el accidente CTP/STP/Trayecto |
| Envío registro difusión medidas correctivas | ADM-PR | Cuando aplique | Cada vez que ocurra accidente CTP/STP |
| Seguimiento incidentes y reportabilidad | PR-C.E | Mensual | Envío los 10 de cada mes + acta comité ejecutivo |
| Investigación definitiva incidente/accidente | ADM-PR | Cuando aplique | Según PR-SGC-14 |

### 3.2 Reunión Línea de Mando Faena - Comité Paritario

| Actividad | Responsable | Frecuencia | Detalle |
|----|----|----|----|
| Reuniones CPHS | PR/CPHS | Mensual | Envío actas y actividades generadas a Gerencia los 10 de cada mes |
| Reunión línea de mando | PR/ADM/JT | Mensual | Análisis del Programa SG-SST. Envío minuta + asistencia |
| Reunión análisis y seguimiento | PR/JDPR/ADM | Mensual | Revisión y análisis general |
|  |  |  |  |

### 3.3 Actividades Línea de Supervisión

| Actividad | Responsable | Frecuencia | Detalle |
|----|----|----|----|
| Inspección equipos móviles | SUP-JT | Mensual × equipo | Una inspección por cada equipo móvil industrial |
| Report uso diario de equipo | TRAB | Diaria | Operador llena report al ingresar al turno, visado por JT |
| Inspección estado EPP | SUP-JT | Mensual × trabajador | Aviso inmediato si no conformidad |
| Inspección de extintores | SUP-JT | Mensual | Todos los extintores de equipos móviles |
| Observación de seguridad equipos | SUP-JT | Mensual × operador | Por cada operador del turno |
| Inspección contenedores metálicos | SUP-JT | Mensual × contenedor | Estado general, gestión reparación/mantención |
| Inspección de carros | SUP-JT | Mensual × carro | Estado general |
| Revisiones técnicas equipos | SUP-JT | Mensual | Registro actualizado: revisión técnica, permiso circulación, SOAP |
| Charlas diarias 5 minutos | JT-SUP | Diaria | Al comienzo del turno |

### 3.4 Gestión Prevencionista de Riesgos de Faena

| Actividad | Responsable | Frecuencia | Detalle |
|----|----|----|----|
| Inspección contenedores metálicos | PR | Mensual | En visitas a terreno, levantar hallazgos |
| Inspección carros | PR-SUP-JT | Mensual | Mínimo una vez al mes |
| Inspección equipos móviles | PR-ADM | Mensual | Envío al supervisor para gestionar cierres |
| Inspección extintores | PR | Mensual | Inspección de todos los extintores |
| Inspección EPP | PR | Mensual | Uso, cuidados y estado |
| Inspección taller de mantención | PR | Semanal/Mensual | Lista de chequeo por correo a jefe taller y supervisor |
| Evidencia objetiva inspecciones no planeadas | PR | Cuando aplique | Formato de evidencia objetiva ante condiciones subestándar |
| Observaciones de seguridad | PR | Mensual | En visitas a terreno |
| Seguimiento y control cierres | PR | Mensual | Análisis de inspecciones planeadas, no planeadas y observaciones |
| Revisión inventario de peligros | PR/ADM | Semestral | Actualizar según DS 44, cada accidente, o nueva actividad |
| Cumplimiento actividades mandante | PR | Mensual | Todas las actividades de la empresa mandante |
| Lista verificación infraestructura | PR | Semestral | Ambiente de trabajo según normativa 594 |
| Seguimiento protocolos MINSAL | PR | Trimestral | Avance de protocolos |
|  |  |  |  |
| Inspección vehículo traslado personal | PR | Semestral | Documentación y estado del vehículo |

------------------------------------------------------------------------

## 4. Roles del Sistema

| Código | Rol Completo              | Descripción                             |
|--------|---------------------------|-----------------------------------------|
| PR     | Prevencionista de Riesgos | Prevención de riesgos de faena          |
| JDPR   | Jefa Depto. Prevención    | Jefa departamento prevención de riesgos |
| ADM    | Administrador de Contrato | Administrador de contrato de faena      |
| JT     | Jefe de Terreno           | Jefe de terreno en faena                |
| SUP    | Supervisor                | Supervisor de faena                     |
| TRAB   | Trabajador                | Operador / trabajador                   |
| CPHS   | Comité Paritario          | Comité Paritario de Higiene y Seguridad |
| C.E    | Comité Ejecutivo          | Comité ejecutivo del centro de trabajo  |

------------------------------------------------------------------------

## 5. Funcionalidades del Módulo SaaS

### 5.1 Planificación

- [ ] Crear cronograma anual con plantilla predefinida
- [ ] Clonar cronograma del año anterior
- [ ] Asignar actividades a centros de trabajo específicos
- [ ] Definir metas mensuales y anuales por actividad
- [ ] Asignar responsables por actividad y centro de trabajo
- [ ] Gestión de frecuencias (diaria, mensual, cuando aplique, etc.)

### 5.2 Registro y Seguimiento

- [ ] Registro mensual de actividades realizadas (P vs R)
- [ ] Adjuntar evidencias (fotos, documentos, actas)
- [ ] Cálculo automático de % cumplimiento mensual y anual
- [ ] Semáforo de cumplimiento (verde ≥80%, amarillo 50-79%, rojo \<50%)
- [ ] Notificaciones automáticas de actividades pendientes
- [ ] Recordatorios por fecha de vencimiento

### 5.3 Dashboard y Reportes

- [ ] Vista de cronograma estilo Gantt mensual
- [ ] Dashboard con KPIs: % cumplimiento por categoría
- [ ] Gráfico comparativo P vs R por mes
- [ ] Reporte de avance por responsable
- [ ] Reporte de avance por centro de trabajo
- [ ] Exportación a Excel/PDF manteniendo el formato original
- [ ] Firma digital del Gerente General para aprobación

### 5.4 Alertas y Notificaciones

- [ ] Alerta cuando una actividad no se registra en la fecha esperada
- [ ] Notificación a responsables 3 días antes del vencimiento
- [ ] Escalamiento automático si actividad supera 7 días sin registro
- [ ] Resumen semanal por email al JDPR

------------------------------------------------------------------------

## 6. Reglas de Negocio

1.  **Actividades “cuando aplique”**: No suman al % de cumplimiento si
    no hay eventos que las activen (ej: investigación de accidentes solo
    aplica cuando ocurre un accidente).
2.  **Visto bueno en cadena**: El PR de faena registra → JDPR revisa →
    Gerencia aprueba.
3.  **Actividades dependientes**: Algunas actividades dependen de un
    evento disparador (accidente, condición subestándar).
4.  **Multi-faena**: El mismo cronograma base aplica a todos los centros
    de trabajo, pero cada faena tiene su propio registro de avance.
5.  **Doble registro**: Existe una versión base y una versión REV
    (revisada) que agrega columnas de Avance Mensual detallado con P y R
    separados.

------------------------------------------------------------------------

## 7. Integraciones con Otros Módulos

| Módulo | Relación |
|----|----|
| Inspecciones | Las inspecciones registradas se vinculan como actividades realizadas |
| Observaciones de Seguridad | Las observaciones registradas alimentan el avance |
| Capacitaciones | El cronograma de capacitaciones es complementario |
| Incidentes/Accidentes | Disparan actividades “cuando aplique” |
| Lista de Asistencia | Evidencia de reuniones y charlas |
| Seguimiento y Control | Control de cierres de hallazgos |

------------------------------------------------------------------------

## 8. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  CRONOGRAMA DE ACTIVIDADES SG-SST 2025                    [📥] │
    │  Empresa: Servicios Industriales Chome Ltda.                    │
    ├─────────────────────────────────────────────────────────────────┤
    │  Filtros: [Centro de Trabajo ▼] [Responsable ▼] [Categoría ▼]  │
    ├────┬──────────────────────┬──┬──┬──┬──┬──┬──┬─────┬─────┬──────┤
    │ #  │ Actividad            │E │F │M │A │M │J │Avance│Meta │ %   │
    ├────┼──────────────────────┼──┼──┼──┼──┼──┼──┼─────┼─────┼──────┤
    │    │ ▼ Estadísticas       │  │  │  │  │  │  │     │     │      │
    │ 1  │  Estadísticas        │🟢│🟢│🟢│🟢│🟢│⬜│ 5   │ 12  │ 42% │
    │ 2  │  Inv. preliminar acc.│ -│ -│ -│ -│ -│ -│ 0   │ C/A │ N/A │
    │    │ ▼ Reuniones          │  │  │  │  │  │  │     │     │      │
    │ 3  │  Reuniones CPHS      │🟢│🟢│🟢│🟢│🟢│⬜│ 5   │ 12  │ 42% │
    │    │ ▼ Supervisión        │  │  │  │  │  │  │     │     │      │
    │ 4  │  Insp. equipos       │🟢│🟢│🟢│🟢│🟢│⬜│ 20  │ 48  │ 42% │
    │ 5  │  Charlas 5 min       │🟢│🟢│🟢│🟢│🟢│⬜│ 105 │ 252 │ 42% │
    ├────┴──────────────────────┴──┴──┴──┴──┴──┴──┴─────┴─────┴──────┤
    │  Avance Mensual: 78/60 (77%)  │  Avance Anual: 168/746 (23%)   │
    │  ████████████░░  Mensual      │  ███░░░░░░░░░  Anual            │
    ├─────────────────────────────────────────────────────────────────┤
    │  Aprobado por: Jean Paul Recart Matus - Gerente General   [✍️] │
    └─────────────────────────────────────────────────────────────────┘
