#!/usr/bin/env python3
"""Compile the compact browser-facing knowledge context registry."""
from pathlib import Path
import json
from knowledge_context_data import build_knowledge_context

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "content/knowledge-context.json"
payload = json.dumps(
    build_knowledge_context(ROOT),
    ensure_ascii=False,
    separators=(",", ":"),
) + "\n"
TARGET.write_text(payload, encoding="utf-8")
print(f"Built {TARGET.relative_to(ROOT)} ({len(payload.encode('utf-8')):,} bytes)")
