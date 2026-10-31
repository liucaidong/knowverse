#!/usr/bin/env python3
"""V3: Ensure the Promise deep-dive is complete and connected."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
course=root/'knowledge/promise'
for i in range(20):
 d=course/f'lesson-{i:02d}'
 assert (d/'index.html').is_file(),d
 assert (d/'index.md').is_file(),d
 assert len((d/'index.md').read_text())>600,d
assert sum(len(x.read_text()) for x in course.glob('lesson-*/index.md'))>=30000
for rel in ['assets/css/promise-course.css','assets/js/promise-course.js','assets/panoramas/promise.mmd','assets/panoramas/promise.svg','knowledge/promise/observatory/index.html','lab/experiments/promise-debugger/index.html','lab/experiments/promise-debugger/scenario.json','lab/experiments/promise-debugger/debugger.css','lab/experiments/promise-debugger/debugger.js','scripts/verify-promise-debugger.mjs']:
 assert (root/rel).is_file(),rel
search=json.loads((root/'data/search.json').read_text())
urls={x['href'] for x in search}
assert len(urls)==len(search),'duplicate search entries'
assert all(f'knowledge/promise/lesson-{i:02d}/' in urls for i in range(20))
assert 'knowledge/promise/observatory/' in urls
assert any(x['id']=='promise-mechanism-debugger' and x['href']=='./lab/experiments/promise-debugger/' for x in json.loads((root/'content/works.json').read_text())['works'])\nprint('PASS: 20 lessons / 30k+ prose / Mermaid panorama / Promise debugger / search')
