import {
  Laptop, Mouse, WifiHigh, DeviceMobile, Car, HardDrives, Cube,
} from "@phosphor-icons/react/dist/ssr"

/** Ícono de la ficha según la categoría del tipo de activo (computación, red, telefonía…). */
export function AssetCategoryIcon({ category, size = 22 }: { category: string; size?: number }) {
  switch (category) {
    case "computacion": return <Laptop size={size} aria-hidden />
    case "periferico": return <Mouse size={size} aria-hidden />
    case "red": return <WifiHigh size={size} aria-hidden />
    case "telefonia": return <DeviceMobile size={size} aria-hidden />
    case "movilidad": return <Car size={size} aria-hidden />
    case "almacenamiento": return <HardDrives size={size} aria-hidden />
    default: return <Cube size={size} aria-hidden />
  }
}
