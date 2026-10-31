#!/usr/bin/env python3
"""Create a deterministic, self-contained ZIP of the current workspace project."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
project = root / "knowledge/monorepo/fullstack/project"
output = root / "knowledge/monorepo/fullstack/fullstack-project.zip"
excluded = {"node_modules", ".git", ".expo", "android", "ios"}
files = sorted(
    path for path in project.rglob("*")
    if path.is_file() and not any(part in excluded for part in path.relative_to(project).parts)
)
with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        relative = (Path("project") / path.relative_to(project)).as_posix()
        info = ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
print(f"Created {output.relative_to(root)} with {len(files)} source files")
