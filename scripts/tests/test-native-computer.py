"""Run ONLY through isolated-gui: tests real pointer/keyboard/screenshot against a private GTK fixture."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import time
import queue
import threading

if not os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'):
    raise RuntimeError('This test requires the isolated-gui X11 session.')
root = Path(__file__).resolve().parents[2]
window = subprocess.Popen(['/usr/bin/python3', '-u', '-c', '''
import gi
gi.require_version('Gtk','3.0')
from gi.repository import Gtk, GLib
w=Gtk.Window(title='Sele native computer fixture');w.set_default_size(440,200)
box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=16);box.set_border_width(24)
entry=Gtk.Entry();entry.set_placeholder_text('Native input fixture');box.pack_start(entry,False,False,0)
label=Gtk.Label(label='Waiting for input');box.pack_start(label,False,False,0)
entry.connect('changed',lambda item:(label.set_text(item.get_text()),print(item.get_text(),flush=True)))
w.add(box);w.connect('destroy',Gtk.main_quit);w.show_all();entry.grab_focus();Gtk.main()
'''], stdout=subprocess.PIPE, text=True)
changes = queue.Queue()
threading.Thread(target=lambda: [changes.put(line.strip()) for line in window.stdout], daemon=True).start()
helper = subprocess.Popen(['/usr/bin/python3', '-u', str(root / 'resources/computer-helper.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def command(action, **args):
    request_id = time.monotonic_ns()
    helper.stdin.write(json.dumps(dict(id=request_id, action=action, **args)) + '\n'); helper.stdin.flush()
    while True:
        if not select.select([helper.stdout], [], [], 20)[0]:
            raise RuntimeError('Computer helper timed out')
        result = json.loads(helper.stdout.readline())
        if result.get('id') == request_id:
            if 'error' in result:
                raise RuntimeError(result['error'])
            return result['result']

try:
    for _ in range(50):
        found = subprocess.run(['xdotool', 'search', '--name', '^Sele native computer fixture$'], capture_output=True, text=True)
        if found.returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('GTK fixture did not open')
    subprocess.run(['xdotool', 'windowactivate', '--sync', found.stdout.strip().splitlines()[0]], check=True)
    assert command('connect')['backend'] == 'x11'
    shot = command('screenshot')
    png = base64.b64decode(shot['data'])
    assert png.startswith(b'\x89PNG') and shot['width'] > 400 and shot['height'] > 200
    output = root / 'tmp/native-computer-preview.png'; output.parent.mkdir(exist_ok=True)
    command('key', key='ctrl+a'); command('type', text='Sele native input passed')
    last = ''
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            last = changes.get(timeout=.1)
        except queue.Empty:
            continue
        if last == 'Sele native input passed':
            break
    assert last == 'Sele native input passed', last
    output.write_bytes(base64.b64decode(command('screenshot')['data']))
    # Test the portal coordinate mapping and Linux input button codes without touching any real bus.
    spec = importlib.util.spec_from_file_location('computer_helper', root / 'resources/computer-helper.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    portal = module.Portal.__new__(module.Portal)
    portal.width, portal.height, portal.pixel_width, portal.pixel_height, portal.node = 1000, 500, 2000, 1000, 7
    calls = []; portal.notify = lambda *args: calls.append(args)
    portal.move(1000, 500); portal.button(1, True)
    assert calls == [('NotifyPointerMotionAbsolute', 'udd', 7, 500.0, 250.0), ('NotifyPointerButton', 'iu', 272, 1)]
    print('Native computer checks passed: private X11 screenshot, actual GTK typing, portal coordinate mapping and input codes.')
finally:
    helper.stdin.close(); helper.terminate(); window.terminate()
    helper.wait(timeout=5); window.wait(timeout=5)
