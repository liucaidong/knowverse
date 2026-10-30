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

assert (q/'pnpm-lock.yaml').is_file(), 'Lockfile missing'
assert (p/'native-pipeline.mmd').read_text().startswith('flowchart LR')
assert (p/'native-pipeline.svg').is_file()
for name in ['05-dependency-lock-and-cache.md','06-native-build-ci.md','07-device-validation.md']:
 assert (p/'docs'/name).is_file(), name
for name in ['monorepo-fullstack.yml','monorepo-android.yml','monorepo-ios.yml']:
 y=(root/'.github/workflows'/name).read_text()
 assert 'pnpm install --frozen-lockfile' in y,name
 assert 'cache-dependency-path: knowledge/monorepo/fullstack/project/pnpm-lock.yaml' in y,name
print('Native CI configuration, committed lockfile, Mermaid overview and installation cache policy OK')

for slug in ['lockfile','native-build','device-testing']:
 target=p/'guides'/slug/'index.html'
 assert target.is_file(),target
 assert sum(x.get('href')==f'knowledge/monorepo/fullstack/guides/{slug}/' for x in found)==1,slug
with zipfile.ZipFile(p/'fullstack-project.zip') as archive:
 assert archive.read('project/pnpm-lock.yaml')==(q/'pnpm-lock.yaml').read_bytes(), 'ZIP must contain exact committed dependency lockfile'
 assert archive.read('project/apps/mobile/app.json')==(q/'apps/mobile/app.json').read_bytes(), 'ZIP must contain native identifiers'
assert '---' in (q/'pnpm-lock.yaml').read_text(), 'Expected pnpm 12 lockfile'
print('Three searchable tutorials, lockfile content, native IDs and downloadable project ZIP match')

android_workflow=(root/'.github/workflows/monorepo-android.yml').read_text()
assert 'platforms;android-37.0' in android_workflow and '--channel=3' in android_workflow, 'Android 37.0 SDK identifier must match sdkmanager repository'
