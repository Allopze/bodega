# Módulo 04: Evidencia Objetiva de Inspecciones de Seguridad No Planeadas

> **Documento fuente:**
> `Anexo 08 Evidencia Objetiva Inspecciones de Seguridad.docx`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Registro de
> inspecciones no planeadas con evidencia fotográfica

------------------------------------------------------------------------

## 1. Descripción General

Este módulo permite registrar **inspecciones de seguridad no planeadas**
que se realizan cuando un prevencionista detecta una condición
subestándar en terreno. Incluye captura de evidencia fotográfica,
descripción de hallazgos, evaluación de daño potencial, medidas
preventivas recomendadas y la normativa legal aplicable.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `EvidenciaObjetiva`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `reporte_numero` | String(20) | Número correlativo del reporte |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo/faena |
| `realizada_por` | String(200) | Nombre de quien realiza la inspección |
| `cargo` | String(100) | Cargo del inspector |
| `fecha` | Date | Fecha de la inspección |
| `usuario_id` | FK → Usuario | Usuario que registra |
| `estado` | Enum | `abierta`, `en_gestión`, `cerrada` |
| `created_at` | Timestamp | Fecha de creación |

### 2.2 Entidad: `HallazgoNoPlaneado`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `evidencia_id` | FK → EvidenciaObjetiva | Evidencia padre |
| `número` | Integer | Número correlativo del hallazgo (1-8+) |
| `descripción_hallaz``go` | Text | Descripción detallada del hallazgo |
| `daño_potencial` | Enum | `leve`, `moderado`, `grave`, `fatal` |
| `daño_potencial_detalle` | Text | Descripción del daño potencial |
| `medidas_preventivas` | Text | Recomendaciones de medidas preventivas |
| `normativa_legal` | Text | Normativa legal aplicable |
| `responsable_cierre` | String(200) | Persona responsable del cierre |
| `fecha_cierre_esperada` | Date | Fecha estimada de cierre |
| `fecha_cierre_real` | Date | Fecha real de cierre |
| `estado` | Enum | `abierto`, `en_proceso`, `cerrado`, `rechazado` |

### 2.3 Entidad: `FotoEvidencia`

| Campo             | Tipo                    | Descripción                    |
|-------------------|-------------------------|--------------------------------|
| `id`              | UUID                    | Identificador único            |
| `hallazgo_id`     | FK → HallazgoNoPlaneado | Hallazgo asociado              |
| `foto_url`        | String                  | URL de la foto                 |
| `descripción`     | Text                    | Pie de foto / descripción      |
| `tipo`            | Enum                    | `antes`, `después`, `contexto` |
| `tomada_en`       | Timestamp               | Fecha/hora de captura          |
| `geolocalización` | JSON                    | Coordenadas GPS (lat, lng)     |

------------------------------------------------------------------------

## 3. Clasificación de Daño Potencial

| Nivel | Descripción | Color | Plazo Cierre |
|----|----|----|----|
| **Leve** | Sin lesión o lesión menor sin tiempo perdido | 🟢 Verde | 15 días |
| **Moderado** | Posible lesión con tiempo perdido temporal | 🟡 Amarillo | 7 días |
| **0Grave** | Lesión grave con incapacidad parcial o total | 🟠 Naranja | 48 horas |
| **Fatal** | Riesgo de muerte o incapacidad permanente | 🔴 Rojo | Inmediato |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Registro en Terreno (Mobile-First)

- [ ] Formulario optimizado para dispositivos móviles
- [ ] Captura de fotos directamente desde la cámara del dispositivo
- [ ] Geolocalización automática al tomar la foto
- [ ] Registro offline con sincronización posterior
- [ ] Múltiples hallazgos por reporte
- [ ] Selección de normativa desde catálogo predefinido
- [ ] Asignación de responsable de cierre con notificación inmediata

### 4.2 Gestión de Hallazgos

- [ ] Flujo de trabajo: Abierta → En Gestión → Cerrada
- [ ] Asignación de responsable de cierre
- [ ] Foto “antes” y “después” para verificar cierre
- [ ] Aprobación de cierre por PR
- [ ] Rechazo de cierre con motivo
- [ ] Reapertura de hallazgos

### 4.3 Dashboard y Reportes

- [ ] Mapa de calor de hallazgos por zona/área
- [ ] Clasificación de hallazgos por daño potencial
- [ ] Estadísticas de tiempo promedio de cierre
- [ ] Top 10 tipos de condiciones subestándar
- [ ] Reporte por centro de trabajo
- [ ] Tendencias mensuales de hallazgos
- [ ] Exportación a PDF con fotos incluidas

### 4.4 Alertas

- [ ] Notificación inmediata al responsable de cierre
- [ ] Escalamiento automático si hallazgo grave/fatal no se cierra en
  plazo
- [ ] Resumen semanal de hallazgos abiertos
- [ ] Alerta a JDPR cuando hay hallazgos fatales

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Registro obligatorio**: Toda condición subestándar observada debe
    ser documentada con evidencia fotográfica.
2.  **Envío inmediato**: El reporte debe ser enviado al responsable de
    cierre el mismo día.
3.  **Foto obligatoria**: Mínimo una foto por hallazgo.
4.  **Normativa requerida**: Se debe indicar la normativa legal
    aplicable al hallazgo.
5.  **Cierre con evidencia**: Para cerrar un hallazgo se requiere foto
    “después” que demuestre la corrección.
6.  **Escalamiento automático**: Hallazgos graves/fatales sin cierre en
    plazo se escalan automáticamente.

------------------------------------------------------------------------

## 6. Normativa Legal de Referencia

| Código | Normativa |
|----|----|
| DS 594 | Condiciones sanitarias y ambientales básicas en los lugares de trabajo |
| DS 40 | Reglamento sobre prevención de riesgos profesionales |
| Ley 16.744 | Seguro contra accidentes del trabajo y enfermedades profesionales |
| NCh 382 | Sustancias peligrosas – Clasificación general |
| DS 44 | Reglamento de seguridad y salud en el trabajo |

------------------------------------------------------------------------

## 7. Integraciones con Otros Módulos

| Módulo | Relación |
|----|----|
| Cronograma Actividades SG-SST | Alimenta avance de “Evidencia objetiva inspecciones no planeadas” |
| Seguimiento y Control | Hallazgos se integran al seguimiento general |
| Inspecciones Planeadas | Diferenciación entre inspecciones planeadas vs no planeadas |
| Incidentes | Hallazgos graves pueden generar registro de cuasi-accidente |

------------------------------------------------------------------------

## 8. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  📋 EVIDENCIA OBJETIVA - INSPECCIÓN NO PLANEADA        [📤][📄]│
    ├─────────────────────────────────────────────────────────────────┤
    │  Reporte N°: [AUTO-2025-042]  Centro: [Faena Mininco ▼]        │
    │  Realizada por: [Carlos Soto]  Cargo: [PR Faena]                │
    │  Fecha: [15/06/2025]                                            │
    ├─────────────────────────────────────────────────────────────────┤
    │  HALLAZGOS                                         [+ Agregar]  │
    │  ┌───┬───────────────┬────────┬───────────────┬────────────────┐│
    │  │ # │ Hallazgo      │ Daño   │ Medida        │ Normativa      ││
    │  ├───┼───────────────┼────────┼───────────────┼────────────────┤│
    │  │ 1 │ Extintor      │🟠Grave │ Reemplazar    │ DS 594 Art.44  ││
    │  │   │ vencido zona  │        │ inmediato     │                ││
    │  │   │ de acopio     │        │               │                ││
    │  │   │ 📷 [2 fotos]  │        │               │                ││
    │  ├───┼───────────────┼────────┼───────────────┼────────────────┤│
    │  │ 2 │ Cable eléct.  │🔴Fatal │ Cortar sumini.│ DS 594 Art.39  ││
    │  │   │ expuesto      │        │ y aislar      │                ││
    │  │   │ 📷 [3 fotos]  │        │               │                ││
    │  └───┴───────────────┴────────┴───────────────┴────────────────┘│
    ├─────────────────────────────────────────────────────────────────┤
    │  📸 EVIDENCIA FOTOGRÁFICA                                       │
    │  ┌──────┐ ┌──────┐ ┌──────┐                                    │
    │  │ 📷 1 │ │ 📷 2 │ │ 📷 3 │  [+ Tomar foto]                   │
    │  │Antes │ │Antes │ │Ctx.  │                                    │
    │  └──────┘ └──────┘ └──────┘                                    │
    ├─────────────────────────────────────────────────────────────────┤
    │  Responsable cierre: [Nombre ▼]  Fecha límite: [17/06/2025]    │
    │  [Enviar Reporte]  [Guardar Borrador]                           │
    └─────────────────────────────────────────────────────────────────┘
