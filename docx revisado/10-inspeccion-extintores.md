# Módulo 10: Inspección Estado de Extintores

> **Documento fuente:** `Anexo 2 Inspeccion Estado extintores.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Registro de
> inspección periódica de extintores

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección del estado de extintores** en todos
los centros de trabajo. Permite registrar el inventario de extintores
con su tipo, peso, empresa de recarga, fechas de recarga, certificación,
estado de componentes (manómetro, manguera, rótulo, sello).

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónExtintores`

| Campo               | Tipo               | Descripción             |
|---------------------|--------------------|-------------------------|
| `id`                | UUID               | Identificador único     |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo       |
| `realizado_por`     | String(200)        | Nombre del inspector    |
| `cargo`             | String(100)        | Cargo del inspector     |
| `firma_url`         | String             | Firma del inspector     |
| `fecha`             | Date               | Fecha de la inspección  |
| `revisado_por`      | String(200)        | Nombre de quien revisa  |
| `revisor_cargo`     | String(100)        | Cargo del revisor       |
| `revisor_fecha`     | Date               | Fecha de revisión       |
| `revisor_firma_url` | String             | Firma del revisor       |
| `observaciones`     | Text               | Observaciones generales |
| `created_at`        | Timestamp          | Fecha de creación       |

### 2.2 Entidad: `ExtintorInspeccionado`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_id` | FK → InspecciónExtintores | Inspección padre |
| `número` | Integer | Número correlativo |
| `equipo_ubicación` | String(200) | Equipo móvil o ubicación del extintor |
| `tipo` | Enum | `PQS`, `CO2`, `agua`, `espuma`, `otro` |
| `peso_kg` | Decimal | Peso en kg |
| `empresa_recarga` | String(200) | Empresa que realiza la recarga |
| `fecha_recarga` | Date | Fecha de la última recarga |
| `certificado_cecmec` | Enum | `bueno`, `malo`, `sin_certificado` |
| `rotulado` | Enum | `bueno`, `malo` |
| `sello` | Enum | `bueno`, `malo` |
| `manómetro_buen_estado` | Enum | `bueno`, `malo` |
| `manguera_buen_estado` | Enum | `bueno`, `malo` |
| `extintor_id` | FK → Extintor (nullable) | Vínculo con inventario permanente |

### 2.3 Entidad: `Extintor` (Inventario permanente)

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `código` | String(50) | Código único del extintor |
| `tipo` | Enum | `PQS`, `CO2`, `agua`, `espuma`, `otro` |
| `peso_kg` | Decimal | Peso nominal en kg |
| `ubicación_actual` | String(200) | Ubicación o equipo asignado |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo |
| `fecha_fabricación` | Date | Fecha de fabricación |
| `vida_útil_años` | Integer | Vida útil (generalmente 20 años) |
| `última_recarga` | Date | Fecha de última recarga |
| `próxima_recarga` | Date | Fecha de próxima recarga |
| `empresa_recarga` | String(200) | Empresa de recarga habitual |
| `estado` | Enum | `operativo`, `vencido`, `en_recarga`, `dado_de_baja` |

------------------------------------------------------------------------

## 3. Campos de Evaluación por Extintor

| Campo | Evaluación | Criterio |
|----|----|----|
| **Tipo** | PQS / CO2 / Agua / Espuma | Según agente extintor |
| **Peso** | En kg | Peso nominal del equipo |
| **Empresa Recarga** | Nombre empresa | Empresa certificada |
| **Fecha Recarga** | Fecha | Fecha de última recarga |
| **Certificado CECMEC** | B / M | Centro de Certificación Metrología y Control |
| **Rotulado** | B / M | Etiqueta legible y en buen estado |
| **Sello** | B / M | Sello de seguridad intacto |
| **Manómetro** | B / M | Aguja en zona verde |
| **Manguera** | B / M | Sin cortes ni obstrucciones |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Inventario de Extintores

- [ ] Registro de cada extintor con código único
- [ ] Asignación a equipo móvil o ubicación fija
- [ ] Tracking de vida útil (fecha fabricación + vida útil)
- [ ] Calendario de recargas (alerta automática)
- [ ] Historial de recargas por extintor
- [ ] Estado operativo en tiempo real

### 4.2 Inspección Periódica

- [ ] Checklist por extintor con campos de evaluación
- [ ] Inspección masiva (múltiples extintores en un formulario)
- [ ] Lectura de código QR/barcode del extintor
- [ ] Captura de foto del manómetro y estado general
- [ ] Doble firma (inspector y revisor)
- [ ] Registro de observaciones por extintor

### 4.3 Alertas y Notificaciones

- [ ] Alerta de extintor con recarga vencida
- [ ] Alerta de extintor sin certificado CECMEC vigente
- [ ] Alerta de sello roto o manómetro fuera de rango
- [ ] Notificación automática a jefe de terreno para extintores en mal
  estado
- [ ] Resumen mensual de estado de extintores

### 4.4 Reportes

- [ ] Reporte de inspección mensual
- [ ] Inventario consolidado de extintores por faena
- [ ] Extintores próximos a vencer recarga
- [ ] Estadísticas de estado (% bueno vs malo)
- [ ] Exportación a PDF/Excel

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Frecuencia**: Inspección mensual de todos los extintores.
2.  **Responsable**: Prevencionista de faena (PR) y Jefe de Terreno
    (JT).
3.  **Peso mínimo**: Todo extintor debe ser PQS de mínimo 4 kg.
4.  **CECMEC**: Todo extintor debe tener certificación vigente del
    Centro de Certificación Metrología y Control.
5.  **Sello intacto**: Si el sello está roto y no se ha usado, se
    considera manipulado.
6.  **Manómetro**: Si la aguja no está en zona verde, el extintor debe
    ser recargado inmediatamente.
7.  **Comunicación inmediata**: Si se encuentra un extintor vencido o en
    mal estado, se debe informar de inmediato a prevención.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Inspección de extintores” |
| Equipos Móviles | Verificación de extintor como parte del checklist de equipo |
| Seguimiento y Control | Extintores en mal estado generan hallazgo |
| Mantención | OT de recarga/reemplazo de extintores |
