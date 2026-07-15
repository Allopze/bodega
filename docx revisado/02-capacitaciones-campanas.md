# Módulo 02: Cronograma de Capacitaciones y Campañas Preventivas

> **Documento fuente:**
> `2. Anexo 10 CRONOGRAMA CAPACITACIONES Y CAMPAÑAS AÑO 2025.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:**
> Planificación y seguimiento de capacitaciones

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona el **cronograma anual de capacitaciones y campañas
preventivas** del SG-SST. Incluye dos planes paralelos: 1.
**Capacitaciones generales de Prevención de Riesgos**: Formación en
temas de seguridad, procedimientos y normativa. 2. **Capacitaciones de
Salud Ocupacional (Protocolos MINSAL)**: Difusión de protocolos
ministeriales obligatorios. 3. **Campañas de seguridad**: Con apoyo del
Organismo Administrador de la Ley 16.744 (Mutual de Seguridad).

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `PlanCapacitación`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `año` | Integer | Año del plan |
| `empresa_id` | FK → Empresa | Empresa asociada |
| `tipo` | Enum | `capacitación_prevención`, `salud_ocupacional`, `campaña_seguridad` |
| `estado` | Enum | `borrador`, `aprobado`, `en_ejecución`, `cerrado` |
| `aprobado_por` | FK → Usuario | Gerente que aprueba |
| `created_at` | Timestamp | Fecha de creación |

### 2.2 Entidad: `Capacitación`

| Campo              | Tipo                  | Descripción                       |
|--------------------|-----------------------|-----------------------------------|
| `id`               | UUID                  | Identificador único               |
| `plan_id`          | FK → PlanCapacitación | Plan padre                        |
| `número`           | Integer               | Número correlativo                |
| `nombre`           | String(500)           | Nombre de la capacitación         |
| `público_objetivo` | Text                  | A quién va dirigida               |
| `responsable_rol`  | String(100)           | Rol(es) responsable(s)            |
| `proveedor`        | Enum                  | `interno_pr`, `mutual`, `externo` |
| `orden`            | Integer               | Orden de visualización            |

### 2.3 Entidad: `ProgramaciónCapacitación`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `capacitación_id` | FK → Capacitación | Capacitación asociada |
| `mes` | Integer (1-12) | Mes |
| `programada` | Decimal | Cantidad programada (P) |
| `realizada` | Decimal | Cantidad realizada (R) |
| `centro_trabajo_id` | FK → CentroTrabajo | Faena donde se ejecuta |
| `lista_asistencia_id` | FK → ListaAsistencia | Evidencia de asistencia |
| `material_url` | String | Material de capacitación adjunto |
| `evaluación_url` | String | Evaluación aplicada |

### 2.4 Entidad: `AvanceCapacitación` (vista calculada)

| Campo                       | Tipo    | Descripción            |
|-----------------------------|---------|------------------------|
| `avance_mensual_programado` | Decimal | Total P del mes        |
| `avance_mensual_real`       | Decimal | Total R del mes        |
| `porcentaje_mensual`        | Decimal | % cumplimiento mensual |
| `avance_anual_programado`   | Decimal | Total P anual          |
| `avance_anual_real`         | Decimal | Total R anual          |
| `porcentaje_anual`          | Decimal | % cumplimiento anual   |

------------------------------------------------------------------------

## 3. Catálogo de Capacitaciones

### 3.1 Capacitaciones de Prevención de Riesgos

| N° | Capacitación | Responsable | Público Objetivo |
|----|----|----|----|
| 1 | Plan de Emergencia y Evacuación | PR | Todo el personal de faena |
| 2 | Uso de Elementos de Protección Personal | PR | Todo el personal de faena |
| 3 | Matriz de Identificación de Peligros y Evaluación de Riesgos | PR | Todo el personal de faena |
| 4 | Identificación de Peligros y Riesgos | Mutual | Todo el personal de faena |
| 5 | Orientación en Prevención de Riesgos | Mutual | CPHyS y supervisores |
| 6 | Conducción a la Defensiva | Mutual | Chóferes y línea de mando |
| 7 | Somnolencia y Fatiga en la Conducción | Mutual | Chóferes y línea de mando |
| 8 | Investigación de Incidentes y Accidentes | Mutual | CPHyS y línea de mando |
| 9 | Procedimientos de Trabajo Seguro | SUP-PR | Todo el personal de faena |
| 10 | Responsabilidad Legal Ley 16.744 | Mutual | Alta gerencia y línea de mando |
| 11 | Taller Cuidado de Manos | Mutual | Todo el personal de faena |
| 12 | Uso de Extintores | Mutual | Todo el personal de faena |
| 13 | Gestión del Riesgo de Desastres en el Centro de Trabajo | Mutual | Prevencionistas de faena |
| 14 | Prevención de Consumo de Alcohol y Drogas | PR | Todo el personal de faena |
| 15 | DS 148 Manejo de Sustancias Peligrosas | PR-Mutual | Personal de manejo y transporte |
| 16 | Primeros Auxilios | Mutual | Todo el personal de faena |

### 3.2 Salud Ocupacional Protocolos MINSAL

| N° | Protocolo | Responsable | Público Objetivo |
|----|----|----|----|
| 1 | Difusión Guía Radiación Ultravioleta de Origen Solar | PR | Todo el personal de faena |
| 2 | Difusión Protocolo PREXOR (Ruido) | PR | Todo el personal de faena |
| 3 | Difusión Protocolo TMERT (Trastornos Musculoesqueléticos) | PR | Todo el personal de faena |
| 4 | Difusión Protocolo MMC (Manejo Manual de Carga) | Mutual | Todo el personal de faena |
| 5 | Difusión Protocolo Psicosocial | Mutual | Todo el personal de faena |

### 3.3 Campañas de Seguridad

| N° | Campaña | Responsable | Público Objetivo |
|----|----|----|----|
| 1 | Ojo con los Puntos Ciegos de los Equipos | PR-SUP | Todo el personal que interactúa con equipos móviles |
| 2 | Promoción de Vida Sana y Prevención de Enfermedades Crónicas | PR-MUTUAL | Todo el personal de faena |

------------------------------------------------------------------------

## 4. Proveedores de Capacitación

| Proveedor | Descripción |
|----|----|
| **PR** | Prevencionista de Riesgos de la empresa (interno) |
| **Mutual** | Mutual de Seguridad - Organismo Administrador de la Ley 16.744 |
| **SUP-PR** | Conjunto entre supervisor y prevención |
| **Externo** | Otros proveedores externos (cuando aplique) |

------------------------------------------------------------------------

## 5. Funcionalidades del Módulo SaaS

### 5.1 Planificación

- [ ] Crear plan anual de capacitaciones con catálogo predefinido
- [ ] Seleccionar capacitaciones del catálogo o crear personalizadas
- [ ] Asignar meses de ejecución por capacitación
- [ ] Definir público objetivo y centro de trabajo
- [ ] Asignar responsable y proveedor (PR, Mutual, externo)
- [ ] Clonar plan del año anterior

### 5.2 Ejecución y Registro

- [ ] Registrar ejecución de capacitación con fecha y hora
- [ ] Vincular lista de asistencia digital (Módulo RE-07)
- [ ] Adjuntar material de capacitación (PPT, PDF, video)
- [ ] Adjuntar evaluación (pre/post test)
- [ ] Registrar calificación de participantes
- [ ] Registro de horas hombre de capacitación
- [ ] Firma digital del relator y participantes

### 5.3 Dashboard y KPIs

- [ ] % cumplimiento por tipo (prevención, salud ocupacional, campañas)
- [ ] % cumplimiento por centro de trabajo
- [ ] Horas hombre de capacitación acumuladas
- [ ] Cobertura de capacitación por trabajador
- [ ] Capacitaciones pendientes por mes
- [ ] Vista calendario con próximas capacitaciones

### 5.4 Reportería

- [ ] Reporte mensual de avance (formato P vs R)
- [ ] Reporte anual consolidado
- [ ] Certificado de capacitación por trabajador
- [ ] Historial de capacitaciones por trabajador
- [ ] Exportación a Excel/PDF

### 5.5 Alertas

- [ ] Recordatorio de capacitaciones programadas (7 días antes)
- [ ] Alerta de capacitaciones vencidas no realizadas
- [ ] Alerta de trabajadores sin capacitación obligatoria
- [ ] Notificación a Mutual para coordinar capacitaciones externas

------------------------------------------------------------------------

## 6. Reglas de Negocio

1.  **Capacitaciones obligatorias**: Las del catálogo base deben
    realizarse al menos una vez al año (normativa chilena).
2.  **Protocolos MINSAL**: Son de cumplimiento obligatorio y se deben
    difundir a todo el personal.
3.  **Campañas con Mutual**: Requieren coordinación con el organismo
    administrador (Mutual de Seguridad).
4.  **Evidencia obligatoria**: Toda capacitación debe tener lista de
    asistencia firmada como evidencia.
5.  **Público segmentado**: Cada capacitación tiene un público objetivo
    específico; el sistema debe validar que se capacite al grupo
    correcto.
6.  **Doble conteo**: Existe avance mensual (mes actual) y avance anual
    (acumulado).

------------------------------------------------------------------------

## 7. Normativa Legal Aplicable

| Normativa | Descripción |
|----|----|
| Ley 16.744 | Seguro social contra riesgos de accidentes del trabajo y enfermedades profesionales |
| DS 148 | Reglamento sanitario sobre manejo de sustancias peligrosas |
| DS 44 | Reglamento de seguridad y salud en el trabajo |
| Protocolos MINSAL | PREXOR, TMERT, MMC, Psicosocial, UV Solar |

------------------------------------------------------------------------

## 8. Integraciones con Otros Módulos

| Módulo | Relación |
|----|----|
| Lista de Asistencia (RE-07) | Evidencia de participación en capacitaciones |
| Cronograma Actividades SG-SST | Las capacitaciones son parte del programa anual |
| Gestión de Trabajadores | Tracking de capacitaciones por persona |
| Inspecciones | Capacitaciones derivadas de hallazgos |
| Incidentes/Accidentes | Capacitaciones reactivas post-accidente |

------------------------------------------------------------------------

## 9. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  PLAN DE CAPACITACIONES Y CAMPAÑAS 2025               [+ Nueva]│
    │  ┌─────────────────┬──────────────┬──────────────────┐          │
    │  │ Prevención (16) │ Salud Oc.(5) │ Campañas (2)     │          │
    │  └─────────────────┴──────────────┴──────────────────┘          │
    ├─────────────────────────────────────────────────────────────────┤
    │ N° │ Capacitación           │ E│F│M│A│M│J│J│A│S│O│N│D│ Av. │%  │
    ├────┼────────────────────────┼──┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─────┼───┤
    │ 1  │ Plan Emergencia y Evac.│🟢│ │ │ │ │ │ │ │ │ │ │🔵│ 1/2 │50%│
    │ 2  │ Uso EPP                │🟢│ │ │ │ │ │ │ │ │ │ │🔵│ 1/2 │50%│
    │ 3  │ Matriz IPER            │🟢│ │ │ │ │ │ │ │ │ │ │🔵│ 1/2 │50%│
    │ ...│ ...                    │  │ │ │ │ │ │ │ │ │ │ │  │     │   │
    ├────┴────────────────────────┴──┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─────┴───┤
    │  Total Mensual: P=16 R=0 (0%)  │  Total Anual: P=32 R=0 (0%)   │
    ├─────────────────────────────────────────────────────────────────┤
    │  📊 Cobertura: 0/45 trabajadores capacitados este mes           │
    │  ⚠️ 3 capacitaciones vencidas sin registro                      │
    └─────────────────────────────────────────────────────────────────┘
