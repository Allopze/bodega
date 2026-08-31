#!/usr/bin/env python3
"""Extrae contenido de .xlsx y .docx usando solo stdlib (zipfile + xml)."""
import sys, zipfile, re
import xml.etree.ElementTree as ET

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NS_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
NS_SS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def col_to_letter(idx):
    s = ""
    while idx >= 0:
        s = chr(idx % 26 + 65) + s
        idx = idx // 26 - 1
    return s

def cell_ref(ref):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col - 1, int(m.group(2)) - 1

def read_xlsx(path):
    out = []
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{NS_MAIN}si"):
                text = "".join(t.text or "" for t in si.iter(f"{NS_MAIN}t"))
                shared.append(text)
        # workbook → sheet names
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = [(s.get("name"), s.get(f"{NS_REL}id")) for s in wb.findall(f"{NS_MAIN}sheets/{NS_MAIN}sheet")]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap = {}
        for r in rels.findall(f"{NS_PKG_REL}Relationship"):
            relmap[r.get("Id")] = r.get("Target")
        for name, rid in sheets:
            target = relmap.get(rid)
            if not target:
                continue
            if not target.startswith("xl/"):
                target = "xl/" + target
            if target not in z.namelist():
                continue
            out.append(f"\n===== HOJA: {name} =====")
            root = ET.fromstring(z.read(target))
            rows = []
            maxc = 0
            for row in root.iter(f"{NS_MAIN}row"):
                cells = {}
                for c in row.findall(f"{NS_MAIN}c"):
                    ref = c.get("r")
                    t = c.get("t")
                    v = c.find(f"{NS_MAIN}v")
                    val = v.text if v is not None else ""
                    if t == "s" and val:
                        val = shared[int(val)]
                    elif t == "inlineStr":
                        isn = c.find(f"{NS_MAIN}is")
                        val = "".join(x.text or "" for x in isn.iter(f"{NS_MAIN}t")) if isn is not None else ""
                    elif t == "b":
                        val = "TRUE" if val == "1" else "FALSE"
                    if ref:
                        _, ci = cell_ref(ref)
                        cells[ci] = val
                        maxc = max(maxc, ci)
                if cells:
                    rows.append([cells.get(i, "") for i in range(maxc + 1)])
            for r in rows:
                out.append(" | ".join(str(x).replace("\n", " ")[:200] for x in r))
    return "\n".join(out)

def read_docx(path):
    out = []
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
        for p in root.iter(f"{NS_W}p"):
            texts = [t.text or "" for t in p.iter(f"{NS_W}t")]
            line = "".join(texts).strip()
            if line:
                out.append(line)
    return "\n".join(out)

if __name__ == "__main__":
    path = sys.argv[1]
    low = path.lower()
    try:
        if low.endswith(".xlsx"):
            print(read_xlsx(path))
        elif low.endswith(".docx"):
            print(read_docx(path))
        else:
            print("UNSUPPORTED:", path)
    except Exception as e:
        print(f"ERROR leyendo {path}: {e}")
