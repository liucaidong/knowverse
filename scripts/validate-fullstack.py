#!/usr/bin/env python3
from pathlib import Path
import json,re,zipfile
root=Path(__file__).resolve().parents[1]
p=root/'knowledge/monorepo/fullstack'
assert (p/'index.html').exists()
assert (p/'diagram.mmd').read_text().startswith('flowchart LR')
assert (p/'diagram.svg').exists()
q=p/'project'
packages=['packages/contracts','packages/domain','apps/api','apps/web','apps/mobile']
for name in packages:
 package=json.loads((q/name/'package.json').read_text())
 assert package['name'].startswith('@kv/'), name
 assert (q/name/'src').is_dir(),name
for target in p.rglob('*.html'):
 text=target.read_text()
 for link in re.findall(r'(?:href|src)=["\']([^"\']+)',text):
  if link.startswith(('http','#','data:','mailto:','/')):continue
  r=(target.parent/link).resolve()
  assert r.is_relative_to(root),str(r)
  assert r.exists(),str(target)+':'+link
assert zipfile.ZipFile(p/'fullstack-project.zip').testzip() is None
found=json.loads((root/'data/search.json').read_text())
assert sum(x.get('href')=='knowledge/monorepo/fullstack/' for x in found)==1
print('Fullstack course static integrity OK: 5 workspace packages, Mermaid, link paths, source ZIP, search entry')
