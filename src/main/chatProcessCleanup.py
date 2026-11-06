"""Stop Linux processes owned by exact chat environment markers, including detached helpers."""
import json
import os
import signal
import sys
import time
from pathlib import Path


def cleanup(chat_ids, grace=1.0):
    if not Path('/proc/self/stat').exists():
        return  # Native provider cancellation remains available on other platforms.
    markers = {f'{key}={chat}'.encode() for chat in chat_ids
               for key in ('SELE_CHAT_ID', 'CODEX_THREAD_ID')}
    uid = os.getuid()
    protected = set()

    def info(pid):
        path = Path('/proc') / str(pid)
        try:
            fields = (path / 'stat').read_text().rsplit(') ', 1)[1].split()
            if path.stat().st_uid != uid or fields[0] == 'Z':
                return None
            return (int(fields[1]), fields[19])  # parent and start ticks, never PID alone
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            return None

    pid = os.getpid()
    while pid and pid not in protected:
        protected.add(pid)
        state = info(pid)
        pid = state[0] if state else 0
    owned = {}

    def discover():
        processes = {}
        for path in Path('/proc').iterdir():
            if not path.name.isdigit():
                continue
            pid = int(path.name)
            if pid in protected:
                continue
            state = info(pid)
            if not state:
                continue
            processes[pid] = state
            try:
                env = set((path / 'environ').read_bytes().split(b'\0'))
                if markers & env:
                    owned[pid] = state[1]
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
        # Include children which cleared their own environment. Never follow a reused PID.
        changed = True
        while changed:
            changed = False
            for pid, (parent, start) in processes.items():
                parent_state = processes.get(parent)
                if (pid not in owned and parent_state and
                        owned.get(parent) == parent_state[1]):
                    owned[pid] = start
                    changed = True

    def send(sig):
        for pid, start in list(owned.items()):
            state = info(pid)
            if not state or state[1] != start:
                continue
            try:
                if hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'):
                    # The descriptor pins the process even if its PID is reused after this check.
                    fd = os.pidfd_open(pid)
                    try:
                        state = info(pid)
                        if state and state[1] == start:
                            signal.pidfd_send_signal(fd, sig)
                    finally:
                        os.close(fd)
                else:
                    os.kill(pid, sig)
            except ProcessLookupError:
                pass

    discover()
    if not owned:
        return
    send(signal.SIGTERM)
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        discover()
        if not any((state := info(pid)) and state[1] == start for pid, start in owned.items()):
            return
        time.sleep(0.05)
    # A parent may have spawned another helper during shutdown.
    discover()
    send(signal.SIGKILL)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not any((state := info(pid)) and state[1] == start for pid, start in owned.items()):
            return
        time.sleep(0.05)
    raise RuntimeError('Some chat processes did not stop')


if __name__ == '__main__':
    cleanup(json.loads(sys.argv[1]))
