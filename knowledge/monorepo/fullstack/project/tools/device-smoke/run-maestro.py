#!/usr/bin/env python3
"""Bounded, artifact-preserving Maestro invocation for ephemeral macOS CI."""
import os
import signal
import subprocess
import sys
from pathlib import Path


def run(command: list[str], log: Path, seconds: int) -> int:
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('wb') as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            output.write(f'\nERROR: Maestro exceeded {seconds}s; killing process group\n'.encode())
            output.flush()
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = 124
    # Always expose concise failure context in GitHub Actions even on a timeout.
    text = log.read_text(encoding='utf-8', errors='replace')
    print(text[-12000:])
    return code

if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('Usage: run-maestro.py <simulator-uuid> <flow> <evidence-dir>')
    device, flow, dest = sys.argv[1:]
    if flow not in ('refresh', 'unavailable', 'malformed', 'recovered'):
        sys.exit('Unsupported Maestro flow')
    script = Path(__file__).resolve().parent / 'maestro' / f'{flow}.yaml'
    if not script.is_file():
        sys.exit(f'Missing flow: {script}')
    deadline = 240 if flow == 'refresh' else 130
    sys.exit(run(['maestro', '--device', device, 'test', str(script)], Path(dest) / f'maestro-{flow}.log', deadline))
