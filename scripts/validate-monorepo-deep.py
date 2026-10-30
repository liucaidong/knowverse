#!/usr/bin/env python3
"""Validate expanded Monorepo course, links, diagrams, search registration and starter code."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json, zipfile
root=Path(__file__).resolve().parents[1]
base=root/'knowledge/monorepo'
class Refs(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if tag in ('a','script','link','img'):
   u=d.get('href') if tag in ('a','link') else d.get('src')
   if u:self.links.append(u)
errors=[];checked=0
for html in base.rglob('index.html'):
 if any(d in html.parts for d in ['node_modules','dist']):continue
 p=Refs();p.feed(html.read_text(encoding='utf-8'))
 for u in p.links:
  if u.startswith(('#','https:','http:','mailto:','data:','javascript:')):continue
  dest=(html.parent/unquote(urlsplit(u).path)).resolve()
  checked+=1
  if not dest.is_relative_to(root):errors.append(f'path traversal: {html} -> {u}');continue
  if dest.is_dir():dest/= 'index.html'
  if not dest.exists():errors.append(f'broken: {html.relative_to(root)} -> {u}')
for i in range(1,11):
 unit=base/f'unit-{i:02}'
 for ext in ('html','md'):
  if not (unit/f'index.{ext}').is_file():errors.append(f'missing lesson {i} .{ext}')
 for ext in ('mmd','svg'):
  if not (root/'assets/panoramas'/f'monorepo-unit-{i:02}.{ext}').is_file():errors.append(f'missing lesson diagram {i} .{ext}')
for guide in ('ghost-deps','nx24-affected','rush-rollout','cross-platform'):
 if not (base/'guides'/guide/'index.html').is_file():errors.append(f'missing practical guide {guide}')
for lab in ('graph','cache','build'):
 if not (base/'labs'/lab/'index.html').is_file():errors.append(f'missing lab {lab}')
search=json.loads((root/'data/search.json').read_text(encoding='utf8'))
for i in range(1,11):
 if not any(x.get('href')==f'knowledge/monorepo/unit-{i:02}/' for x in search):errors.append(f'search missing unit {i}')
assert sum(len(p.read_text(encoding='utf8')) for p in base.glob('unit-*/index.md')) >= 15000
zip_path=base/'starter/starter.zip'
with zipfile.ZipFile(zip_path) as z:
 files=set(z.namelist())
 for path in ('pnpm-workspace.yaml','tsconfig.json','packages/contracts/src/index.ts','packages/domain/tsconfig.json','apps/api/src/index.ts','scripts/graph.mjs','scripts/affected.mjs','tests/graph.test.mjs'):
  if path not in files:errors.append(f'starter ZIP missing {path}')
assert checked>140,checked
print(f'Monorepo course: {checked} local links; 10 chapters; 11 Mermaid diagrams; 3 labs; {len(search)} search entries; ZIP {len(files)} files')
if errors:
 print('\n'.join(errors));raise SystemExit(1)
