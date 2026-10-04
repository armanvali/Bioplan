#!/usr/bin/env python3
"""Inline css/ and js/ into one self-contained HTML file.

    python3 tools/bundle.py                  -> dist/stacksense-prototype.html (full document)
    python3 tools/bundle.py --fragment OUT   -> page body only, for hosts that add their own <html>/<head>
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def bundle(fragment: bool) -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    def inline_css(m):
        return "<style>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</style>"

    def inline_js(m):
        code = (ROOT / m.group(1)).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return "<script>\n" + code + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, html)
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline_js, html)
    if fragment:
        html = re.sub(r"<!doctype html>\s*", "", html, flags=re.I)
        html = re.sub(r"</?(html|head|body)[^>]*>\s*", "", html, flags=re.I)
        html = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", html)
    return html


def main():
    fragment = "--fragment" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = pathlib.Path(args[0]) if args else ROOT / "dist" / "stacksense-prototype.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(bundle(fragment), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
