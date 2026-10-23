#!/usr/bin/env python3
"""Subsets Smiley Sans to the characters the site source can show, so headings load a small font.

Run after changing headings or group names: python3 scripts/subset-display-font.py
Needs fontTools and brotli (pip install fonttools brotli).
"""
import pathlib
import re
import string
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
source = root / "public/fonts/SmileySans-Oblique.ttf.woff2"
output = root / "src/app/fonts/flacier-display.woff2"

# Every CJK character in the app and config is a superset of what headings render, including group names.
characters = set(string.printable.strip()) | {" "}
for path in [*root.joinpath("src/app").rglob("*.ts*"), *root.joinpath("src/config").rglob("*.ts")]:
    characters |= set(re.findall(r"[　-〿㐀-鿿＀-￯]", path.read_text(encoding="utf-8")))

with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt") as text:
    text.write("".join(sorted(characters)))
    text.flush()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        sys.executable, "-m", "fontTools.subset", str(source),
        f"--text-file={text.name}", "--flavor=woff2", "--no-hinting", "--layout-features=*",
        f"--output-file={output}",
    ], check=True)

print(f"{len(characters)} characters, {output.stat().st_size / 1024:.1f} KiB -> {output.relative_to(root)}")
