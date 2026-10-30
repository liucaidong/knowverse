#!/usr/bin/env python3
"""KNOWVERSE V2 cross-linked static content validation without dependencies."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json
root=Path(__file__).resolve().parents[1]
class Links(HTMLParser):
 def __init__(self):super().__init__();self.refs=[]
 def handle_starttag(self,t,a):
  d=dict(a)
  if t in ('a','link','script','img'):
   u=d.get('href') if t in ('a','link') else d.get('src')
   if u:self.refs.append((t,u))
missing=[];checked=0
for f in root.rglob('*.html'):
 parser=Links();parser.feed(f.read_text(encoding='utf-8'))
 for typ,href in parser.refs:
  if href.startswith(('#','http:','https:','mailto:','tel:','javascript:','data:')):continue
  u=unquote(urlsplit(href).path)
  if not u:continue
  target=(f.parent/u).resolve()
  if not target.is_relative_to(root):missing.append((str(f.relative_to(root)),href,'path traversal'));continue
  if target.is_dir():target=target/'index.html'
  if not target.exists():missing.append((str(f.relative_to(root)),href,'missing'))
  checked+=1
pan=list((root/'assets/panoramas').glob('*.mmd'))
svg=list((root/'assets/panoramas').glob('*.svg'))
assert len(pan)==len(svg)==12,(len(pan),len(svg))
for m in pan:assert m.read_text().startswith('flowchart LR'),m
search=json.loads((root/'data/search.json').read_text())
assert len(search)>=40,len(search)
for item in search:
 target=root/item['href']
 assert (target/'index.html').is_file(),item['href']
print(f'checked {checked} local links, {len(pan)} Mermaid panoramas, {len(search)} search records')
if missing:
 print('BROKEN LINKS:')
 for x in missing:print(*x)
 raise SystemExit(1)
