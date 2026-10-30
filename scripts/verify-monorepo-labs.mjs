/** Offline widget verification: execute the real browser lab script using a minimal DOM harness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const program = readFileSync(new URL('../assets/js/monorepo-labs.js', import.meta.url), 'utf8');
function makeLab(kind) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', checked: true, disabled: false, textContent: '', innerHTML: '', listeners: new Map(),
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      querySelectorAll() { return []; },
      click() { this.onclick?.(); },
      change() { this.listeners.get('change')?.(); },
      select(v) { this.value = v; this.change(); },
    });
    return elements.get(id);
  };
  node('package').value = 'contracts';
  node('change-kind').value = 'source';
  node('affected-mode').value = 'project';
  node('env-mode').value = 'alpha';
  node('source-ver').value = 'v1';
  const document = { querySelector: sel => sel === '[data-lab]' ? { dataset: { lab: kind } } : null, getElementById: node };
  runInNewContext(program, { document, navigator: {}, console, Map, Set, Math, JSON, String, Number, Array });
  return node;
}
test('graph: reverse dependency closure excludes unrelated mobile when domain changes', () => {
  const e = makeLab('graph');
  e('package').select('domain');
  const result=e('result-projects').textContent;
  assert.match(result,/domain, web, api|domain, api, web/);
  assert.ok(!result.split('受影响项目：')[1].split('\n')[0].includes('mobile'));
});
test('task mode: changing only tests does not require build in the teaching model', () => {
  const e=makeLab('graph');e('package').select('domain');e('change-kind').select('test');e('affected-mode').select('task');
  assert.match(e('result-tasks').textContent,/domain:test/);
  assert.doesNotMatch(e('result-tasks').textContent,/domain:build/);
});
test('cache: missing environment input creates a demonstrable false hit', () => {
  const e=makeLab('cache');e('include-env').checked=false;e('run-cache').click();
  e('env-mode').value='beta';e('run-cache').click();
  assert.match(e('cache-result').textContent,/错误命中/);
  e('include-env').checked=true;e('run-cache').click();
  assert.match(e('cache-result').textContent,/产物与当前输入匹配/);
});
test('build storyboard: terminal step reached and next disabled', () => {
  const e=makeLab('build');for(let i=0;i<6;i++)e('build-next').click();
  assert.equal(e('build-next').disabled, true);
  assert.match(e('build-evidence').textContent,/tsc -b/);
  e('build-reset').click();assert.equal(e('build-next').disabled,false);
});
