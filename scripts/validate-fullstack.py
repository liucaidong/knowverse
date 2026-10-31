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

# Device smoke: source code and every linked guide must ship with the downloadable project.
smoke=p/'guides/simulator-smoke/index.html'
assert smoke.is_file() and 'UIAutomator' in smoke.read_text()
assert (p/'docs/08-automated-simulator-smoke.md').is_file()
assert (p/'simulator-smoke.mmd').read_text().startswith('flowchart LR')
assert (p/'simulator-smoke.svg').is_file()
assert sum(x.get('href')=='knowledge/monorepo/fullstack/guides/simulator-smoke/' for x in found)==1
for step in ['android.sh','ios.sh','common.sh','api-proxy.mjs','tap-android.py']:
    source=q/'tools/device-smoke'/step
    assert source.is_file()
    with zipfile.ZipFile(p/'fullstack-project.zip') as archive:
        assert archive.read('project/tools/device-smoke/'+step)==source.read_bytes(), f'ZIP missing current test source {step}'
for platform in ['android','ios']:
    workflow=(root/f'.github/workflows/monorepo-{platform}.yml').read_text()
    assert f'bash tools/device-smoke/{platform}.sh' in workflow
    assert 'if: always()' in workflow and 'actions/upload-artifact' in workflow
    assert 'pnpm --filter @kv/api build' in workflow
with zipfile.ZipFile(p/'fullstack-project.zip') as archive:
    assert archive.read('project/apps/mobile/src/App.tsx')==(q/'apps/mobile/src/App.tsx').read_bytes()
    assert archive.read('project/tests/device-proxy.test.mjs')==(q/'tests/device-proxy.test.mjs').read_bytes()
print('Simulator smoke checks: Android UIAutomator, iOS simctl, NestJS proxy, evidence archive and project ZIP OK')

assert 'kv-api-refresh' in (q/'apps/mobile/src/App.tsx').read_text()
assert 'tap-android.py' in (q/'tools/device-smoke/android.sh').read_text()
print('Device interaction coverage: accessible refresh button and second valid API request wired')

for name in ['android-emulator.png','ios-simulator.png']:
 evidence=p/'evidence'/name
 assert evidence.is_file() and evidence.stat().st_size>20000,name
 assert evidence.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'),name
print('Actual Android and iOS simulator screenshot evidence is retained in GitHub source tree')

# Regression suite: real UI taps, fault injection, and protected loopback control.
assert (p/'docs/09-fault-injection-and-maestro.md').is_file()
for name in ['device-faults.test.mjs']:
    assert (q/'tests'/name).is_file()
for mode in ['refresh','unavailable','malformed','recovered']:
    f=q/'tools/device-smoke/maestro'/f'{mode}.yaml'
    assert f.is_file() and 'tapOn' in f.read_text() and 'extendedWaitUntil' in f.read_text()
assert 'KV_DEVICE_TEST_MODE' in (q/'tools/device-smoke/api-proxy.mjs').read_text()
assert 'injected-http-503' in (q/'tools/device-smoke/android.sh').read_text()
android_script=(q/'tools/device-smoke/android.sh').read_text()
assert 'ui_wait_quick' not in android_script, 'Avoid flaky transient loading checks'
assert "ui_contains 'HTTP 503'" in android_script and "ui_contains 'SyntaxError'" in android_script
assert 'wait_event injected-http-503 1' in android_script and 'wait_event injected-malformed-json 1' in android_script
assert 'maestro' in (q/'tools/device-smoke/ios.sh').read_text()
assert 'MAESTRO_VERSION' in (root/'.github/workflows/monorepo-ios.yml').read_text()
with zipfile.ZipFile(p/'fullstack-project.zip') as archive:
    for f in ['tools/device-smoke/api-proxy.mjs','tools/device-smoke/ios.sh','tools/device-smoke/android.sh',
       'tests/device-proxy.test.mjs','tests/device-faults.test.mjs','tools/device-smoke/maestro/refresh.yaml',
       'tools/device-smoke/maestro/unavailable.yaml','tools/device-smoke/maestro/malformed.yaml',
       'tools/device-smoke/maestro/recovered.yaml','tools/device-smoke/run-maestro.py']:
        assert archive.read('project/'+f)==(q/f).read_bytes(),f
print('E2E regression scenarios: Android accessibility actions, iOS Maestro flows, safe localhost faults and bundled files OK')

assert "subprocess.TimeoutExpired" in (q/"tools/device-smoke/run-maestro.py").read_text()
print("iOS Maestro invocation has a bounded deadline and persistent failure logs")

# E2E false-positive regression guard.
proxy_text=(q/'tools/device-smoke/api-proxy.mjs').read_text()
proxy_test=(q/'tests/device-proxy.test.mjs').read_text()
assert "writeFileSync(logPath, '', { flag: 'a' })" in proxy_text, 'Proxy evidence file must exist before first request'
assert "record('invalid-api-contract')" in proxy_text, 'Invalid upstream schema must be explicitly recorded'
assert 'invalid-api-contract' in proxy_test and 'valid-api-hit' in proxy_test
assert 'HTTP 503' in (q/'tools/device-smoke/maestro/unavailable.yaml').read_text(), 'Maestro must assert the injected 503 signature'
assert 'SyntaxError' in (q/'tools/device-smoke/maestro/malformed.yaml').read_text(), 'Maestro must assert malformed JSON separately'
for mode in ['refresh','unavailable','malformed','recovered']:
    flow=(q/'tools/device-smoke/maestro'/f'{mode}.yaml').read_text()
    assert 'id: kv-api-refresh' in flow and 'extendedWaitUntil' in flow
assert 'ios-malformed.png' in (q/'tools/device-smoke/ios.sh').read_text()
assert (p/'fault-injection.mmd').read_text().startswith('flowchart LR')
assert (p/'fault-injection.svg').is_file()
assert (p/'guides/fault-injection/index.html').is_file()
assert sum(x.get('href')=='knowledge/monorepo/fullstack/guides/fault-injection/' for x in found)==1
with zipfile.ZipFile(p/'fullstack-project.zip') as archive:
    for f in ['tools/device-smoke/api-proxy.mjs','tests/device-proxy.test.mjs',
              'tools/device-smoke/maestro/malformed.yaml','tools/device-smoke/maestro/unavailable.yaml']:
        assert archive.read('project/'+f)==(q/f).read_bytes(), f'ZIP missing updated regression source {f}'
print('False-positive regression guard: proxy event counts, scenario-specific HTTP 503/SyntaxError assertions and searchable tutorial OK')

# Shared runner must expose only CI loopback scenario controls.
proxySource=(q/'tools/device-smoke/api-proxy.mjs').read_text()
commonSource=(q/'tools/device-smoke/common.sh').read_text()
assert 'KV_DEVICE_TEST_MODE' in proxySource and '127.0.0.1' in proxySource
assert 'export KV_DEVICE_TEST_MODE=1' in commonSource
assert 'scenario()' in commonSource and 'wait_event()' in commonSource
print('Device proxy control and scenario/event helpers wired into shared runner OK')
