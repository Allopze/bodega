# Módulo 09: Seguimiento y Control de Inspecciones y Observaciones

> **Documento fuente:**
> `Anexo 15 Seguimiento y Control de Observaciones e Inspecciones planeadas y no planeadas.xlsx`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Registro de
> seguimiento y cierre de hallazgos

------------------------------------------------------------------------

## 1. Descripción General

Este módulo es el **centro de control y seguimiento** de todos los
hallazgos detectados en inspecciones (planeadas y no planeadas) y
observaciones de seguridad. Permite rastrear cada desviación desde su
detección hasta su cierre, con responsables, fechas y porcentaje de
cumplimiento.

El documento original tiene **dos hojas de cálculo**: 1. **Seguimiento
de Inspecciones de Seguridad** 2. **Seguimiento de Observaciones de
Seguridad**

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `SeguimientoHallazgo`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `número` | Integer | Número correlativo |
| `tipo` | Enum | `inspección_planeada`, `inspección_no_planeada`, `observación_seguridad` |
| `fecha_detección` | Date | Fecha de detección del hallazgo |
| `área` | String(200) | Área o zona donde se detectó |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo |
| `desviación_detectada` | Text | Descripción de la desviación |
| `medidas_correctivas` | Text | Medidas correctivas definidas |
| `responsable_mejora` | String(200) | Nombre del responsable de implementar la mejora |
| `responsable_id` | FK → Usuario (nullable) | Vínculo con usuario del sistema |
| `fecha_ejecución_mc` | Date | Fecha estimada de ejecución de la medida correctiva |
| `fecha_cierre_real` | Date | Fecha real de cierre |
| `status` | Enum | `abierto`, `en_proceso`, `cerrado`, `vencido` |
| `porcentaje_cumplimiento` | Integer (0-100) | % de avance en la corrección |
| `observaciones` | Text | Observaciones y comentarios |
| `origen_inspección_id` | FK → Inspección (nullable) | Inspección de origen |
| `origen_observación_id` | FK → Observación (nullable) | Observación de origen |
| `origen_evidencia_id` | FK → EvidenciaObjetiva (nullable) | Evidencia objetiva de origen |
| `created_at` | Timestamp | Fecha de creación |

------------------------------------------------------------------------

## 3. Estados del Seguimiento

| Status | Descripción | Color | Condición |
|----|----|----|----|
| **Abierto** | Hallazgo registrado sin acción iniciada | 🔴 Rojo | Recién creado |
| **En Proceso** | Medida correctiva en ejecución | 🟡 Amarillo | 0% \< cumplimiento \< 100% |
| **Cerrado** | Medida correctiva implementada al 100% | 🟢 Verde | cumplimiento = 100% |
| **Vencido** | Fecha de ejecución superada sin cierre | ⚫ Negro | fecha_ejecución \< hoy Y status ≠ cerrado |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Registro y Vinculación

- [ ] Registro manual de hallazgos
- [ ] Ingreso automático desde inspecciones (ítems No Cumple/Malo)
- [ ] Ingreso automático desde observaciones de seguridad
- [ ] Ingreso automático desde evidencias objetivas
- [ ] Vinculación bidireccional con el documento de origen
- [ ] Clasificación por tipo (inspección planeada/no
  planeada/observación)

### 4.2 Gestión de Cierre

- [ ] Asignación de responsable con notificación
- [ ] Definición de fecha límite de ejecución
- [ ] Actualización de % de cumplimiento
- [ ] Adjuntar evidencia de cierre (fotos, documentos)
- [ ] Aprobación de cierre por PR
- [ ] Reapertura de hallazgos si el cierre no es satisfactorio
- [ ] Rechazo con comentario

### 4.3 Dashboard y KPIs

- [ ] Total hallazgos abiertos / en proceso / cerrados / vencidos
- [ ] % cumplimiento general por centro de trabajo
- [ ] Tiempo promedio de cierre
- [ ] Ranking de áreas con más hallazgos
- [ ] Ranking de tipos de desviaciones más frecuentes
- [ ] Tendencia mensual de hallazgos (apertura vs cierre)
- [ ] Semáforo de cumplimiento por responsable

### 4.4 Reportería

- [ ] Reporte de seguimiento por período
- [ ] Reporte de hallazgos vencidos
- [ ] Reporte por responsable
- [ ] Reporte consolidado por faena
- [ ] Exportación a Excel/PDF manteniendo formato tabular

### 4.5 Alertas y Escalamiento

- [ ] Notificación al responsable al asignar hallazgo
- [ ] Recordatorio 3 días antes del vencimiento
- [ ] Alerta automática cuando hallazgo se vence
- [ ] Escalamiento a supervisor si vencido \> 3 días
- [ ] Escalamiento a JDPR si vencido \> 7 días
- [ ] Resumen semanal de hallazgos abiertos/vencidos al PR

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Todo hallazgo tiene dueño**: Siempre debe tener un responsable de
    mejora asignado.
2.  **Fecha obligatoria**: Toda medida correctiva debe tener fecha de
    ejecución estimada.
3.  **Cierre con evidencia**: Para marcar 100% se requiere evidencia de
    la corrección implementada.
4.  **Doble conteo**: Las inspecciones y observaciones se rastrean en
    tablas separadas pero comparten la misma lógica.
5.  **Vencimiento automático**: El status cambia a “vencido”
    automáticamente si se supera la fecha sin cierre.
6.  **Análisis mensual**: El prevencionista debe informar avances a
    jefaturas de faena y departamento de prevención.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Seguimiento y control de cierres” |
| Todas las inspecciones | Recibe hallazgos automáticamente |
| Todas las observaciones | Recibe observaciones automáticamente |
| Evidencia Objetiva | Recibe hallazgos de inspecciones no planeadas |
| Compromisos (Lista Asistencia) | Compromisos de reuniones pueden generar hallazgos |

------------------------------------------------------------------------

## 7. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  📊 SEGUIMIENTO Y CONTROL                              [📥][+]│
    │  ┌─────────────────┬──────────────────┐                         │
    │  │ Inspecciones(42)│ Observaciones(18)│                         │
    │  └─────────────────┴──────────────────┘                         │
    ├─────────────────────────────────────────────────────────────────┤
    │  Filtros: [Centro ▼] [Status ▼] [Responsable ▼] [Periodo ▼]   │
    ├────┬──────┬─────┬──────────────┬──────────┬───────┬──────┬─────┤
    │ #  │Fecha │Área │Desviación    │Respons.  │F.Ejec │Status│ %   │
    ├────┼──────┼─────┼──────────────┼──────────┼───────┼──────┼─────┤
    │ 1  │06/25 │Zona │Extintor      │P. García │06/30  │🟡 EP │ 50% │
    │    │      │A    │vencido       │          │       │      │     │
    │ 2  │06/25 │Tall.│Cable suelto  │M. López  │06/17  │⚫ Ven│  0% │
    │ 3  │05/25 │Zona │Señalización  │J. Muñoz  │06/10  │🟢 Ok │100% │
    │    │      │B    │faltante      │          │       │      │     │
    ├────┴──────┴─────┴──────────────┴──────────┴───────┴──────┴─────┤
    │  Resumen: 🔴 12 Abiertos  🟡 18 En Proceso  🟢 8 Cerrados     │
    │           ⚫ 4 Vencidos   Cumplimiento General: 68%            │
    │  ████████████████░░░░░░░  68%                                   │
    └─────────────────────────────────────────────────────────────────┘
