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
    'assets/js/challenge-engine.mjs',
    'assets/js/promise-quest.mjs',
    'assets/js/promise-quest-world.mjs',
    'assets/css/promise-quest.css',
    'puzzles/worlds/promise-mechanism-quest/index.html',
    'scripts/verify-promise-quest.mjs',
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

challenge_registry = json.loads((root / 'content/challenges.json').read_text(encoding='utf-8'))
promise_quest = next(
    (item for item in challenge_registry['challenges'] if item.get('id') == 'promise-mechanism-quest'),
    None
)
assert promise_quest is not None, 'Promise mechanism quest is missing from challenge registry'
assert len(promise_quest['steps']) == 5, 'Promise quest must contain five mechanism stages'
for step in promise_quest['steps']:
    assert len(step.get('hints', [])) >= 3, f"Progressive hints are missing: {step['id']}"
    assert sum(option.get('id') == step.get('answer') for option in step['options']) == 1, (
        f"Promise quest must have exactly one answer: {step['id']}"
    )
    assert step['lessonHref'].startswith('../../../knowledge/promise/'), step['id']
    assert step['labHref'].startswith('../../../lab/'), step['id']

promise_works = [
    item for item in works
    if item.get('id') == 'promise-mechanism-quest'
    and item.get('href') == './puzzles/worlds/promise-mechanism-quest/'
]
assert len(promise_works) == 1, 'Promise mechanism quest must be registered exactly once'

quest_html = (root / 'puzzles/worlds/promise-mechanism-quest/index.html').read_text(encoding='utf-8')
assert 'promise-quest.mjs' in quest_html, 'Promise challenge page must mount its interaction module'
assert '../../puzzles/worlds/promise-mechanism-quest/' in (root / 'knowledge/promise/index.html').read_text(encoding='utf-8'), (
    'Promise course must link to its mechanism challenge'
)

print('PASS: 20 Promise lessons / panorama / searchable observatory / runtime workbench / 5-stage Promise challenge')
