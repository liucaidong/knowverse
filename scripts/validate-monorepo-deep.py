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
source_requirements={
 'unit-01':['https://pnpm.io/workspaces','https://nx.dev/docs/features/explore-graph'],
 'unit-02':['https://pnpm.io/workspaces','https://pnpm.io/filtering','https://pnpm.io/blog/releases/12.17.0'],
 'unit-03':['https://www.typescriptlang.org/docs/handbook/project-references.html'],
 'unit-04':['https://nodejs.org/api/packages.html#package-entry-points','https://metrobundler.dev/docs/package-exports/'],
 'unit-05':['https://turborepo.dev/docs/crafting-your-repository/caching','https://nx.dev/docs/reference/inputs'],
 'unit-06':['https://nx.dev/docs/features/ci-features/affected'],
 'unit-07':['https://rushjs.io/pages/commands/rush_change/','https://rushjs.io/pages/maintainer/publishing/'],
 'unit-08':['https://nx.dev/blog/nx-24-release'],
 'unit-09':['https://metrobundler.dev/docs/package-exports/','https://docs.nestjs.com/cli/monorepo'],
 'unit-10':['https://learn.chatgpt.com/docs/agent-configuration/agents-md'],
}
for unit,urls in source_requirements.items():
 md=(base/unit/'index.md').read_text(encoding='utf8')
 html=(base/unit/'index.html').read_text(encoding='utf8')
 if '## 官方资料与规范' not in md or '官方资料与规范' not in html: errors.append(f'{unit}: missing official source section')
 for url in urls:
  if url not in md: errors.append(f'{unit}: Markdown missing official reference {url}')
  if url not in html: errors.append(f'{unit}: HTML missing official reference {url}')
 if '资料复核：2026-11-10' not in md: errors.append(f'{unit}: missing source review date')
unit2=(base/'unit-02/index.md').read_text(encoding='utf8')
if 'pnpm 12.7.0 起' not in unit2 or 'merge-base' not in unit2 or '浅克隆' not in unit2: errors.append('unit-02: missing pnpm 12.7+ merge-base semantics')
project_pkg=json.loads((base/'fullstack/project/package.json').read_text(encoding='utf8'))
if project_pkg.get('packageManager')!='pnpm@12.17.0': errors.append('fullstack sample must pin pnpm 12.17.0')
lock=(base/'fullstack/project/pnpm-lock.yaml').read_text(encoding='utf8')
if 'specifier: 12.17.0' not in lock or 'version: 12.17.0' not in lock: errors.append('fullstack lockfile does not pin pnpm 12.17.0')
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
