import type { ReactNode } from "react"

/**
 * Íconos de la app del mecánico: un solo trazo (2 px, redondeado) y siempre
 * decorativos (`aria-hidden`): la acción o el estado ya van dichos con texto.
 */
function Icon({ size = 20, stroke = 2, children }: { size?: number; stroke?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const IconBack = () => <Icon size={24} stroke={2.2}><path d="M15 18l-6-6 6-6" /></Icon>
export const IconChevronRight = () => <Icon size={24} stroke={2.2}><path d="M9 6l6 6-6 6" /></Icon>
export const IconChevronLeft = () => <Icon size={16}><path d="M15 18l-6-6 6-6" /></Icon>
export const IconChevronDown = () => <Icon size={18}><path d="M6 9l6 6 6-6" /></Icon>
export const IconChevronUp = () => <Icon size={18}><path d="M6 15l6-6 6 6" /></Icon>
export const IconCheck = ({ size = 16 }: { size?: number }) => <Icon size={size} stroke={3}><path d="M20 6L9 17l-5-5" /></Icon>
export const IconCheckBig = () => <Icon size={44} stroke={3}><path d="M20 6L9 17l-5-5" /></Icon>
export const IconClockBig = () => <Icon size={44} stroke={2.4}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
export const IconWifi = () => <Icon><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M12 20h.01" /></Icon>
export const IconWifiOff = ({ size = 14 }: { size?: number }) => <Icon size={size} stroke={2.2}><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M12 20h.01" /></Icon>
export const IconSearch = () => <Icon><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>
export const IconCamera = () => <Icon size={34} stroke={1.8}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Icon>
export const IconClose = () => <Icon size={18} stroke={2.2}><path d="M6 6l12 12M18 6L6 18" /></Icon>
export const IconAlert = () => <Icon size={18}><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></Icon>
export const IconBackspace = () => <Icon size={26}><path d="M21 5H9l-6 7 6 7h12z" /><path d="M13 9l4 6M17 9l-4 6" /></Icon>
export const IconUser = () => <Icon size={22}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Icon>
export const IconExternal = () => <Icon size={14}><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>
/** «Compartir» de Safari (cuadro con flecha hacia arriba): el mecánico lo busca en su pantalla. */
export const IconShare = () => <Icon size={18}><path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></Icon>
export const IconInstall = () => <Icon size={18}><path d="M12 4v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></Icon>
