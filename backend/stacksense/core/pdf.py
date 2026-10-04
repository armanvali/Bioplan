"""A tiny dependency-free PDF writer for text documents (doctor note, privacy export).

Supports headings, paragraphs with word wrap, bullet lists and page breaks using the
standard Helvetica fonts. Characters outside Latin-1 are transliterated.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass, field

_TRANSLIT = {
    "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...",
    "•": "*", "µ": "u", "≥": ">=", "≤": "<=", "→": "->", "×": "x", "★": "*",
}

PAGE_W, PAGE_H = 612, 792  # US Letter, points
MARGIN = 54


def _latin1(text: str) -> str:
    out = []
    for ch in text:
        ch = _TRANSLIT.get(ch, ch)
        try:
            ch.encode("latin-1")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)


def _esc(text: str) -> str:
    return _latin1(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


@dataclass
class PdfDoc:
    title: str
    pages: list[list[str]] = field(default_factory=lambda: [[]])
    y: float = PAGE_H - MARGIN

    def _line(self, text: str, size: float = 10.5, bold: bool = False, indent: float = 0, gap: float = 1.35) -> None:
        if self.y - size * gap < MARGIN:
            self.pages.append([])
            self.y = PAGE_H - MARGIN
        self.y -= size * gap
        font = "F2" if bold else "F1"
        self.pages[-1].append(f"BT /{font} {size} Tf {MARGIN + indent:.1f} {self.y:.1f} Td ({_esc(text)}) Tj ET")

    def heading(self, text: str, size: float = 15) -> None:
        self.y -= 6
        self._line(text, size=size, bold=True)
        self.y -= 2

    def paragraph(self, text: str, size: float = 10.5, bold: bool = False) -> None:
        width = int((PAGE_W - 2 * MARGIN) / (size * 0.5))
        for line in textwrap.wrap(_latin1(text), width) or [""]:
            self._line(line, size=size, bold=bold)
        self.y -= 4

    def bullets(self, items: list[str], size: float = 10.5) -> None:
        width = int((PAGE_W - 2 * MARGIN - 14) / (size * 0.5))
        for item in items:
            lines = textwrap.wrap(_latin1(item), width) or [""]
            for i, line in enumerate(lines):
                self._line(("- " if i == 0 else "  ") + line, size=size, indent=4)
        self.y -= 4

    def spacer(self, h: float = 8) -> None:
        self.y -= h

    def render(self) -> bytes:
        objs: list[bytes] = []

        def add(body: str | bytes) -> int:
            objs.append(body.encode("latin-1") if isinstance(body, str) else body)
            return len(objs)

        catalog = add("")  # placeholder 1
        pages_id = add("")  # placeholder 2
        f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        info = add(f"<< /Title ({_esc(self.title)}) /Producer (StackSense) >>")
        kids = []
        for n, ops in enumerate(self.pages, start=1):
            footer = f"BT /F1 8 Tf {MARGIN} 30 Td ({_esc(self.title)} - page {n} of {len(self.pages)}) Tj ET"
            stream = "\n".join([*ops, footer]).encode("latin-1")
            content = add(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
            kids.append(add(f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R >> >> /Contents {content} 0 R >>"))
        objs[catalog - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()
        objs[pages_id - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)
