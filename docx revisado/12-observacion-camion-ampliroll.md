# Módulo 12: Observación de Seguridad - Camión Ampliroll

> **Documento fuente:**
> `Anexo 4 Observacion de Seguridad Camion Ampliroll PR-SGC-24.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Observación
> conductual de operación de camión ampliroll

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona las **observaciones de seguridad** realizadas a
operadores de **camiones ampliroll**. Es una evaluación conductual que
verifica el cumplimiento de 22 prácticas de seguridad organizadas en 3
fases: ingreso/término de turno, desplazamiento por planta y operación.
Incluye identificación del tipo y motivo de la observación, cálculo de
porcentaje de cumplimiento y reinstrucción cuando sea necesario.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `ObservaciónSeguridad`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `tipo_equipo` | Enum | `camión_ampliroll`, `maquinaria_pesada` |
| `código_procedimiento` | String(20) | Código del procedimiento (ej: PR-SGC-24) |
| `nombre_trabajador` | String(200) | Nombre del trabajador observado |
| `trabajador_id` | FK → Trabajador (nullable) | Vínculo con trabajador |
| `número_equipo` | String(50) | Número del equipo operado |
| `área_trabajo` | String(200) | Área de trabajo |
| `fecha` | Date | Fecha de la observación |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo |

### 2.2 Tipo y Motivo de la Observación

| Campo | Tipo | Descripción |
|----|----|----|
| `tipo_observación` | Enum | `inicial`, `seguimiento_inicial`, `por_incidente`, `seguimiento_incidente` |
| `motivo` | Enum | `accidente_repetido`, `bajo_rendimiento`, `trabajador_nuevo`, `programado`, `problema_capacidad`, `otras` |
| `motivo_detalle` | Text | Detalle del motivo |

### 2.3 Entidad: `ItemObservación`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `observación_id` | FK → ObservaciónSeguridad | Observación padre |
| `fase` | Enum | `ingreso_turno`, `desplazamiento`, `operación` |
| `número` | Integer | Número del ítem |
| `descripción` | String(500) | Acción revisada |
| `cumple` | Enum | `si`, `no`, `no_aplica` |
| `acción_correctiva` | Text | Descripción de acción correctiva (si no cumple) |

### 2.4 Entidad: `ResultadoObservación`

| Campo                  | Tipo    | Descripción                           |
|------------------------|---------|---------------------------------------|
| `total_ítems`          | Integer | Total de ítems evaluados (22)         |
| `total_buenas`         | Integer | Ítems con cumplimiento Si             |
| `porcentaje`           | Decimal | (buenas / total) × 100                |
| `se_reinstruye`        | Boolean | ¿Se reinstruyó al personal?           |
| `actividad_observada`  | Text    | Descripción de la actividad observada |
| `firma_observador_url` | String  | Firma del observador                  |
| `firma_operador_url`   | String  | Firma del operador observado          |
| `huella_url`           | String  | Huella digital (si aplica)            |
| `firma_prevención_url` | String  | Firma de prevención de riesgos        |

------------------------------------------------------------------------

## 3. Checklist de Observación (22 ítems)

### 3.1 INSPECCIÓN AL INGRESO Y TÉRMINO DE TURNO

| N° | Acción Revisada | Cumple |
|----|----|----|
| 1 | Inspecciona su equipo al inicio del turno, de acuerdo a report uso diario de equipo (instructivo) | Si/No/N/A |
| 2 | Verifica que los peldaños estén limpios de grasas, aceites, lodos, etc. para evitar caídas | Si/No/N/A |
| 3 | Hace entrega el camión al colega que ingresa al turno | Si/No/N/A |
| 4 | Revisa el equipo ampliroll (gancho, riel, rodillo de guía, aleta de seguridad) | Si/No/N/A |
| 5 | Revisa equipos de emergencia (extintor, cuñas, conos, alarma retroceso, etc.) | Si/No/N/A |

### 3.2 EN EL DESPLAZAMIENTO POR PLANTA

| N° | Acción Revisada | Cumple |
|----|----|----|
| 6 | Antes de iniciar la marcha mira por los espejos | Si/No/N/A |
| 7 | Respeta velocidades establecidas | Si/No/N/A |
| 8 | Respeta señales de tránsito establecidas | Si/No/N/A |
| 9 | Mantiene distancia prudente al ir detrás de otro equipo móvil | Si/No/N/A |
| 10 | Usa cinturón de seguridad | Si/No/N/A |
| 11 | Como peatón transita por zonas demarcadas y autorizadas | Si/No/N/A |

### 3.3 EN LA OPERACIÓN

| N° | Acción Revisada | Cumple |
|----|----|----|
| 12 | Detiene la maniobra ante la presencia de una persona en el área de trabajo e informa por radio | Si/No/N/A |
| 13 | Toca la bocina al acercarse a un peatón o equipo móvil para advertir su presencia | Si/No/N/A |
| 14 | Observa por los espejos antes de realizar cualquier maniobra | Si/No/N/A |
| 15 | Usa cinturón de seguridad | Si/No/N/A |
| 16 | Respeta no llevar acompañante | Si/No/N/A |
| 17 | Al bajar y subir del camión usa los tres puntos de apoyo | Si/No/N/A |
| 18 | Usa sus elementos de protección personal | Si/No/N/A |
| 19 | Al bajar del camión acciona el freno de mano, detiene el motor y retira las llaves; cuando corresponde corta la corriente según procedimiento de bloqueo | Si/No/N/A |
| 20 | Respeta el no uso de equipos distractorios (celulares, redes sociales) en horas de trabajo | Si/No/N/A |
| 21 | Respeta los procedimientos de trabajo que fue capacitado | Si/No/N/A |
| 22 | Se asegura que el pasador de la muela esté bien acoplado (la palanca queda en posición vertical; para asegurarse debe realizar un pequeño movimiento hacia adelante y atrás) | Si/No/N/A |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Registro de Observación

- [ ] Formulario paso a paso: Identificación → Tipo/Motivo → Checklist →
  Resultado
- [ ] Checklist de 22 ítems organizados por fase
- [ ] Evaluación Si/No/N/A con campo de acción correctiva
- [ ] Cálculo automático de % cumplimiento
- [ ] Indicación de reinstrucción al personal
- [ ] Registro de actividad observada
- [ ] Triple firma (observador, operador, prevención) + huella

### 4.2 Gestión

- [ ] Historial de observaciones por operador
- [ ] Tendencia de cumplimiento por operador
- [ ] Ítems con mayor incumplimiento
- [ ] Programación de seguimiento post-observación
- [ ] Vinculación con capacitaciones realizadas al operador

### 4.3 Dashboard

- [ ] % cumplimiento promedio por faena
- [ ] Ranking de operadores por cumplimiento
- [ ] Ítems críticos con mayor no cumplimiento
- [ ] Comparativo mensual de observaciones
- [ ] Operadores que requieren reinstrucción

### 4.4 Reportes

- [ ] Reporte individual de observación con porcentaje
- [ ] Consolidado por centro de trabajo
- [ ] Exportación a PDF con formato original

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Frecuencia**: Mensual por cada operador del turno.
2.  **Responsable**: Jefe de Terreno (JT); si no existe, Administrador
    de Contrato.
3.  **Reinstrucción**: Si el operador tiene ítems no cumplidos, se debe
    reinstruir y registrar.
4.  **Triple firma**: Observador, operador observado y prevencionista
    deben firmar.
5.  **Huella digital**: En algunos casos se solicita huella digital del
    operador.
6.  **Seguimiento**: Si la observación es por incidente, debe haber
    seguimiento posterior.
7.  **Porcentaje**: Se calcula como (Total Buenas / 22) × 100.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Observación de seguridad equipos” |
| Seguimiento y Control | Ítems no cumplidos se integran al seguimiento |
| Capacitaciones | Reinstrucción genera registro de capacitación |
| Equipos Móviles | Complementa la inspección técnica del equipo |
| Incidentes | Observaciones por incidente se vinculan al evento |
