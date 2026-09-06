"""Vendoriza los componentes pdfcn (base Takumi) bajo ``components/pdf/``.

Ver ``components/pdf/README.md``. Ejecutar desde la raíz del repo:

    python3 scripts/vendor-pdfcn.py

Las URLs y hashes de origen están fijados en ``vendor-pdfcn.lock.json``. El
script descarga todo primero, valida el lock y recién después escribe: una
caída de red o un payload inesperado no deja una vendorización a medias.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Callable, Mapping


ITEMS = [
    "utils",
    "theme-professional",
    "text",
    "heading",
    "stack",
    "section",
    "divider",
    "key-value",
    "table",
    "data-table",
    "pdf-image",
    "list",
    "signature",
]

# El registro manda tres archivos de `utils` a lib/ raíz; van al árbol
# vendorizado. Los targets se conservan en el JSON de origen y se corrigen
# después, antes de validar la ruta final.
TARGET_FIX = {
    "lib/resolve-color.ts": "components/pdf/lib/resolve-color.ts",
    "lib/pdf-primitives.tsx": "components/pdf/lib/pdf-primitives.tsx",
    "lib/pdf-svg.tsx": "components/pdf/lib/pdf-svg.tsx",
}

EXTRA = {
    "registry/types/pdf-components.ts": "components/pdf/types/pdf-components.ts",
    "registry/types/pdf-themes.ts": "components/pdf/types/pdf-themes.ts",
}

REWRITES = [
    (r"@/registry/bases/takumi/lib/", "@/components/pdf/lib/"),
    (r"@/registry/bases/takumi/components/", "@/components/pdf/"),
    (r"@/registry/types/", "@/components/pdf/types/"),
    (r"@/registry/themes/professional", "@/components/pdf/theme-professional"),
    (r"@/registry/themes\b", "@/components/pdf/theme-professional"),
]

PDF_IMAGE_REPAIR = """  // Adaptación local: este repo compila con `noUncheckedIndexedAccess`, así que
  // los accesos por índice de upstream necesitan guarda.
  if (dataMatch?.[1]) {
    return dataMatch[1].toLowerCase();
  }
  return src.split("?")[0]?.split(".").pop()?.toLowerCase() ?? null;"""

PDF_IMAGE_UPSTREAM = """  if (dataMatch) {
    return dataMatch[1].toLowerCase();
  }
  return src.split("?")[0].split(".").pop()?.toLowerCase() ?? null;"""

PDF_PRIMITIVES_UPSTREAM_COMMENT = "eslint-disable-next-line eslint(nextjs/no-img-element) -- PDF primitive, not Next.js page"
PDF_PRIMITIVES_LOCAL_COMMENT = "eslint-disable-next-line @next/next/no-img-element -- primitiva de PDF, no una página Next"

Lock = Mapping[str, Mapping[str, Mapping[str, str]]]
Opener = Callable[[str], object]


def load_lock(path: Path | None = None) -> Lock:
    lock_path = path or Path(__file__).with_name("vendor-pdfcn.lock.json")
    data = json.loads(lock_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("el lock de pdfcn debe ser un objeto")

    for group_name, keys in (("registry", ITEMS), ("extras", list(EXTRA))):
        group = data.get(group_name)
        if not isinstance(group, dict):
            raise ValueError(f"falta el grupo {group_name} en el lock de pdfcn")
        for key in keys:
            entry = group.get(key)
            if not isinstance(entry, dict):
                raise ValueError(f"falta {group_name}.{key} en el lock de pdfcn")
            url = entry.get("url")
            digest = entry.get("sha256")
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError(f"URL inválida en {group_name}.{key}")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError(f"sha256 inválido en {group_name}.{key}")
    return data  # type: ignore[return-value]


def get(url: str, opener: Opener | None = None) -> bytes:
    open_url = opener or urllib.request.urlopen
    with open_url(url) as response:  # type: ignore[union-attr]
        return response.read()  # type: ignore[union-attr]


def rewrite(text: str) -> str:
    for pattern, replacement in REWRITES:
        text = re.sub(pattern, replacement, text)
    return text


def apply_local_repairs(target: str, text: str) -> str:
    """Apply the compatibility repairs documented in components/pdf/README.md."""
    if target == "components/pdf/pdf-image/pdf-image.tsx":
        if PDF_IMAGE_UPSTREAM not in text:
            raise ValueError("no se encontró el ancla de reparación de pdf-image")
        text = text.replace(PDF_IMAGE_UPSTREAM, PDF_IMAGE_REPAIR, 1)

    if target == "components/pdf/lib/pdf-primitives.tsx":
        if PDF_PRIMITIVES_UPSTREAM_COMMENT not in text:
            raise ValueError("no se encontró el ancla ESLint de pdf-primitives")
        text = text.replace(PDF_PRIMITIVES_UPSTREAM_COMMENT, PDF_PRIMITIVES_LOCAL_COMMENT, 1)

    return text


def safe_target(repo_root: Path, raw_target: str) -> Path:
    """Resolve a target and prove that it remains below components/pdf."""
    raw_path = Path(raw_target)
    if raw_path.is_absolute():
        raise ValueError(f"destino absoluto no permitido: {raw_target}")

    vendor_root = (repo_root / "components/pdf").resolve()
    target = (repo_root / raw_path).resolve()
    try:
        target.relative_to(vendor_root)
    except ValueError as error:
        raise ValueError(f"destino fuera de components/pdf: {raw_target}") from error
    if target == vendor_root:
        raise ValueError(f"destino apunta al directorio vendorizado: {raw_target}")
    return target


def verify_source(url: str, payload: bytes, expected_sha256: str) -> None:
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected_sha256:
        raise ValueError(
            f"hash inesperado para {url}: esperaba {expected_sha256}, obtuve {actual}"
        )


def vendor(
    repo_root: Path,
    lock: Lock,
    opener: Opener | None = None,
) -> int:
    """Fetch, validate and write the vendored tree. Return a process code."""
    files: dict[Path, str] = {}
    dependencies: set[str] = set()
    failures: list[str] = []

    def fetch_locked(group_name: str, key: str) -> bytes | None:
        entry = lock[group_name][key]
        url = entry["url"]
        try:
            payload = get(url, opener)
            verify_source(url, payload, entry["sha256"])
            return payload
        except Exception as error:
            failures.append(f"{group_name}.{key}: {error}")
            return None

    for item in ITEMS:
        payload = fetch_locked("registry", item)
        if payload is None:
            continue
        try:
            registry_item = json.loads(payload)
        except Exception as error:
            failures.append(f"registry.{item}: JSON inválido: {error}")
            continue

        dependencies.update(registry_item.get("dependencies") or [])
        for file_entry in registry_item.get("files", []):
            try:
                raw_target = file_entry.get("target") or file_entry["path"]
                target = TARGET_FIX.get(raw_target, raw_target)
                destination = safe_target(repo_root, target)
                if destination in files:
                    raise ValueError(f"destino duplicado: {target}")
                files[destination] = apply_local_repairs(
                    target,
                    rewrite(file_entry["content"]),
                )
            except Exception as error:
                failures.append(f"registry.{item}: archivo inválido: {error}")

    for source, target in EXTRA.items():
        payload = fetch_locked("extras", source)
        if payload is None:
            continue
        try:
            destination = safe_target(repo_root, target)
            if destination in files:
                raise ValueError(f"destino duplicado: {target}")
            files[destination] = rewrite(payload.decode("utf-8"))
        except Exception as error:
            failures.append(f"extras.{source}: archivo inválido: {error}")

    if failures:
        for failure in failures:
            print(f"  !! {failure}", file=sys.stderr)
        print("No se escribió ningún archivo: la vendorización falló cerrada.", file=sys.stderr)
        return 1

    for destination, content in files.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")

    print(f"archivos escritos: {len(files)}")
    print("dependencias npm declaradas:", sorted(dependencies))
    return 0


def main(repo_root: Path | None = None) -> int:
    try:
        lock = load_lock()
        return vendor(repo_root or Path.cwd(), lock)
    except Exception as error:
        print(f"  !! no se pudo cargar el lock de pdfcn: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
