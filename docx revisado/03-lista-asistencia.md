# Módulo 03: Lista de Asistencia (RE-07)

> **Documento fuente:** `RE-07 Lista Asistencia.docx` **Empresa:**
> Servicios Industriales Chome Ltda. **Tipo:** Registro de asistencia y
> actas

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona el **registro de asistencia** para todo tipo de
actividades: reuniones, charlas informativas, capacitaciones y otras.
Funciona como evidencia transversal que se vincula con capacitaciones,
reuniones de CPHS, charlas diarias de 5 minutos, etc. Además, incorpora
un formato de **acta de reunión** con seguimiento de compromisos.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `ListaAsistencia`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `tipo_actividad` | Enum | `reunión`, `charla_informativa`, `capacitación`, `otros` |
| `tema_tratado` | Enum | `operaciones`, `medio_ambiente`, `prevención_riesgos`, `otros` |
| `nombre_actividad` | String(300) | Nombre de la actividad |
| `descripción_actividad` | Text | Descripción detallada |
| `fecha_realización` | Date | Fecha de ejecución |
| `hora_inicio` | Time | Hora de inicio |
| `hora_término` | Time | Hora de término |
| `duración_horas` | Decimal | Duración en horas (calculada o manual) |
| `lugar_ejecución` | String(200) | Lugar donde se realiza |
| `centro_trabajo_id` | FK → CentroTrabajo | Faena asociada |
| `relator_nombre` | String(200) | Nombre del relator/responsable |
| `relator_cargo` | String(100) | Cargo o profesión del relator |
| `relator_rut` | String(12) | RUT del relator |
| `relator_firma_url` | String | Firma digital del relator |
| `created_at` | Timestamp | Fecha de creación |

### 2.2 Entidad: `Asistente`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `lista_id` | FK → ListaAsistencia | Lista de asistencia padre |
| `nombre_apellidos` | String(200) | Nombre completo del asistente |
| `rut` | String(12) | RUT del asistente |
| `cargo` | String(100) | Cargo del asistente |
| `empresa` | String(200) | Empresa del asistente |
| `firma_url` | String | Firma digital o imagen de firma |
| `trabajador_id` | FK → Trabajador (nullable) | Vínculo con registro de trabajador |

### 2.3 Entidad: `Compromiso` (Acta de Reunión)

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `lista_id` | FK → ListaAsistencia | Lista de asistencia padre |
| `tema` | Text | Tema del compromiso |
| `fecha_compromiso` | Date | Fecha límite de cumplimiento |
| `responsable` | String(200) | Nombre del responsable |
| `responsable_id` | FK → Trabajador (nullable) | Vínculo con trabajador |
| `estado` | Enum | `iniciado`, `pendiente`, `terminado` |
| `observación` | Text | Comentarios adicionales |

------------------------------------------------------------------------

## 3. Clasificación de Actividades

### 3.1 Tipo de Actividad

| Tipo | Descripción | Uso típico |
|----|----|----|
| Reunión | Reuniones de trabajo, CPHS, línea de mando | Actas con compromisos |
| Charla Informativa | Charlas de 5 minutos, charlas de seguridad | Registro diario |
| Capacitación | Formación formal con evaluación | Vinculada al plan de capacitaciones |
| Otros | Simulacros, inspecciones participativas, etc. | Flexible |

### 3.2 Tema Tratado

| Tema                  | Descripción                  |
|-----------------------|------------------------------|
| Operaciones           | Temas operativos de la faena |
| Medio Ambiente        | Gestión ambiental            |
| Prevención de Riesgos | Seguridad y salud laboral    |
| Otros                 | Temas diversos               |

------------------------------------------------------------------------

## 4. Estados de Compromisos

| Estado        | Descripción                   | Color       |
|---------------|-------------------------------|-------------|
| **Iniciado**  | Tarea o actividad en curso    | 🟡 Amarillo |
| **Pendiente** | Tarea o actividad no iniciada | 🔴 Rojo     |
| **Terminado** | Tarea o actividad cumplida    | 🟢 Verde    |

------------------------------------------------------------------------

## 5. Funcionalidades del Módulo SaaS

### 5.1 Registro de Asistencia

- [ ] Crear nueva lista de asistencia con todos los campos del
  formulario
- [ ] Seleccionar tipo de actividad y tema tratado
- [ ] Buscar y agregar asistentes del directorio de trabajadores
- [ ] Agregar asistentes externos (de otras empresas)
- [ ] Captura de firma digital en tablet/celular
- [ ] Escanear código QR para registro rápido de asistencia
- [ ] Cálculo automático de duración (hora término - hora inicio)
- [ ] Plantillas de lista de asistencia por tipo de actividad

### 5.2 Acta de Reunión

- [ ] Sección de temas tratados (formato libre con editor de texto)
- [ ] Agregar compromisos con responsable y fecha límite
- [ ] Seguimiento de estado de compromisos
  (iniciado/pendiente/terminado)
- [ ] Notificación automática a responsables de compromisos
- [ ] Alerta cuando un compromiso supera su fecha límite
- [ ] Historial de cambios de estado

### 5.3 Gestión de Evidencias

- [ ] Adjuntar fotos de la actividad
- [ ] Adjuntar material utilizado (presentaciones, documentos)
- [ ] Vincular con capacitación del plan anual
- [ ] Vincular con actividad del cronograma SG-SST
- [ ] Generar PDF de lista de asistencia con firmas

### 5.4 Reportería

- [ ] Reporte de asistencia por trabajador
- [ ] Reporte de actividades por centro de trabajo
- [ ] Reporte de horas hombre de capacitación
- [ ] Reporte de compromisos pendientes/vencidos
- [ ] Dashboard de cumplimiento de compromisos
- [ ] Exportación en formato similar al original (.docx/.pdf)

### 5.5 Alertas

- [ ] Recordatorio de compromisos próximos a vencer
- [ ] Alerta de compromisos vencidos
- [ ] Notificación al relator cuando la lista es completada

------------------------------------------------------------------------

## 6. Reglas de Negocio

1.  **Firma obligatoria**: Todo asistente debe firmar (digital o
    manuscrita escaneada).
2.  **Relator identificado**: Siempre debe registrarse el relator con
    nombre, cargo, RUT y firma.
3.  **Vinculación automática**: Al registrar una capacitación, se genera
    automáticamente una lista de asistencia.
4.  **Compromisos**: Solo aplican cuando la actividad es tipo “Reunión”.
    Para otros tipos son opcionales.
5.  **RUT validación**: El RUT debe ser validado (formato chileno
    xx.xxx.xxx-x con dígito verificador).
6.  **Duración**: Se calcula automáticamente pero puede editarse
    manualmente.
7.  **Multi-empresa**: Los asistentes pueden ser de empresas diferentes
    (contratistas, mandante, etc.).

------------------------------------------------------------------------

## 7. Integraciones con Otros Módulos

| Módulo | Relación |
|----|----|
| Capacitaciones y Campañas | Evidencia de ejecución de capacitaciones |
| Cronograma Actividades SG-SST | Evidencia de charlas, reuniones, etc. |
| Gestión de Trabajadores | Directorio para búsqueda rápida de asistentes |
| CPHS | Actas de reuniones del comité paritario |
| Seguimiento y Control | Compromisos se reflejan en seguimiento general |

------------------------------------------------------------------------

## 8. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  LISTA DE ASISTENCIA                                   [💾][📄]│
    ├─────────────────────────────────────────────────────────────────┤
    │  Tipo: (●) Reunión (○) Charla (○) Capacitación (○) Otros      │
    │  Tema: (○) Operaciones (○) Medio Amb. (●) Prevención (○) Otros│
    ├─────────────────────────────────────────────────────────────────┤
    │  Nombre: [Reunión mensual CPHS - Junio 2025           ]        │
    │  Descripción: [Revisión de actividades e incidentes    ]        │
    │  Fecha: [15/06/2025]  Inicio: [09:00]  Término: [10:30]        │
    │  Lugar: [Oficina administrativa Faena Mininco  ]               │
    │  Duración: 1.5 hrs                                             │
    │  Relator: [Juan Pérez]  Cargo: [PR]  RUT: [12.345.678-9]      │
    ├─────────────────────────────────────────────────────────────────┤
    │  ASISTENTES                                        [+ Agregar] │
    │  ┌────┬──────────────┬────────────┬──────────┬─────────┬──────┐│
    │  │ #  │ Nombre       │ RUT        │ Cargo    │ Empresa │Firma ││
    │  ├────┼──────────────┼────────────┼──────────┼─────────┼──────┤│
    │  │ 1  │ María López  │ 11.111.111 │ Superv.  │ Chome   │ ✅  ││
    │  │ 2  │ Pedro García │ 22.222.222 │ Operador │ Chome   │ ✅  ││
    │  │ 3  │ Ana Muñoz    │ 33.333.333 │ JT       │ Chome   │ ⬜  ││
    │  └────┴──────────────┴────────────┴──────────┴─────────┴──────┘│
    ├─────────────────────────────────────────────────────────────────┤
    │  COMPROMISOS (Acta)                                [+ Agregar] │
    │  ┌──────────────────┬───────────┬───────────┬────────┬────────┐│
    │  │ Tema             │ F. Límite │ Resp.     │ Estado │ Obs.   ││
    │  ├──────────────────┼───────────┼───────────┼────────┼────────┤│
    │  │ Reparar extintor │ 20/06/25  │ P. García │ 🟡 Ini │        ││
    │  │ Actualizar IPER  │ 30/06/25  │ M. López  │ 🔴 Pen │        ││
    │  └──────────────────┴───────────┴───────────┴────────┴────────┘│
    └─────────────────────────────────────────────────────────────────┘
