#!/usr/bin/env python3
"""Validate the Promise deep-dive and the instrumented Promise workbench."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
course = root / 'knowledge/promise'
for i in range(20):
    lesson = course / f'lesson-{i:02d}'
    assert (lesson / 'index.html').is_file(), lesson
    assert (lesson / 'index.md').is_file(), lesson
    assert len((lesson / 'index.md').read_text()) > 600, lesson
assert sum(len(path.read_text()) for path in course.glob('lesson-*/index.md')) >= 30000

required = [
    'assets/css/promise-course.css',
    'assets/js/promise-course.js',
    'assets/panoramas/promise.mmd',
    'assets/panoramas/promise.svg',
    'knowledge/promise/observatory/index.html',
    'lab/experiments/promise-debugger/index.html',
    'lab/experiments/promise-debugger/debugger.css',
    'lab/experiments/promise-debugger/debugger.js',
    'lab/experiments/promise-debugger/workbench.bundle.part-01.b64',
    'lab/experiments/promise-debugger/workbench.bundle.part-02.b64',
    'lab/experiments/promise-debugger/workbench.bundle.part-03.b64',
    'lab/experiments/promise-debugger/workbench.bundle.part-04.b64',
    'scripts/verify-promise-debugger.mjs',
]
for rel in required:
    assert (root / rel).is_file(), rel

search = json.loads((root / 'data/search.json').read_text())
urls = {item['href'] for item in search}
assert len(urls) == len(search), 'duplicate search entries'
assert all(f'knowledge/promise/lesson-{i:02d}/' in urls for i in range(20))
assert 'knowledge/promise/observatory/' in urls
works = json.loads((root / 'content/works.json').read_text())['works']
assert any(
    item['id'] == 'promise-mechanism-debugger'
    and item['href'] == './lab/experiments/promise-debugger/'
    and '工作台' in item['title']
    for item in works
)
print('PASS: 20 Promise lessons / panorama / searchable observatory / compressed runtime Promise workbench')
