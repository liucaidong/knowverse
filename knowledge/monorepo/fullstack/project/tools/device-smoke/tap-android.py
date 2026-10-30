#!/usr/bin/env python3
"""Print center coordinates of a native Android accessibility node by visible label."""
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

if len(sys.argv) != 3:
    sys.exit('usage: tap-android.py UI.xml visible-label')
tree = ET.fromstring(Path(sys.argv[1]).read_bytes())
for node in tree.iter('node'):
    attrs = node.attrib
    if any(sys.argv[2] in attrs.get(field, '') for field in ('text', 'content-desc')):
        box = attrs.get('bounds', '')
        match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', box)
        if not match:
            continue
        x1, y1, x2, y2 = map(int, match.groups())
        if x2 <= x1 or y2 <= y1:
            continue
        print((x1 + x2) // 2, (y1 + y2) // 2)
        sys.exit(0)
sys.exit(f'No UIAutomator node labeled {sys.argv[2]}')
