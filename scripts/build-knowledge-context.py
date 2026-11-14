#!/usr/bin/env python3
"""Build static topic/article context into the knowledge HTML pages."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from knowledge_context_data import build_static_context_pages

ROOT = Path(__file__).resolve().parents[1]
pages = build_static_context_pages(ROOT)
for path, html in pages.items():
    path.write_text(html, encoding="utf-8")
print(f"Generated static knowledge context in {len(pages)} pages")
