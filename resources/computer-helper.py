"""Sele's explicit-consent Linux desktop backend. JSON-lines on stdio; no network listener."""
import base64
import json
import os
import struct
import subprocess
import sys
import threading
import uuid


def run(*args):
    return subprocess.check_output(args, timeout=15, stderr=subprocess.PIPE)


class X11:
    def __init__(self):
        if not os.environ.get('DISPLAY'):
            raise RuntimeError('No X11 display is available.')
        self.width, self.height = map(int, run('xdotool', 'getdisplaygeometry').split())

    def screenshot(self):
        data = run('import', '-window', 'root', 'png:-')
        width, height = struct.unpack('>II', data[16:24])
        return {'data': base64.b64encode(data).decode(), 'width': width, 'height': height}

    def move(self, x, y):
        run('xdotool', 'mousemove', str(int(x)), str(int(y)))

    def button(self, button, state):
        run('xdotool', 'mousedown' if state else 'mouseup', str(button))

    def key(self, value):
        run('xdotool', 'key', '--clearmodifiers', value)

    def text(self, value):
        run('xdotool', 'type', '--clearmodifiers', '--delay', '1', '--', value)

    def scroll(self, dx, dy):
        for value, positive, negative in [(dy, 5, 4), (dx, 7, 6)]:
            count = min(50, max(1, int(abs(value) / 40)))
            if value:
                run('xdotool', 'click', '--repeat', str(count), str(positive if value > 0 else negative))

    def close(self):
        pass


class Portal:
    def __init__(self):
        import gi
        gi.require_version('Gst', '1.0')
        gi.require_version('GstApp', '1.0')
        from gi.repository import Gio, GLib, Gst
        self.Gio, self.GLib, self.Gst = Gio, GLib, Gst
        Gst.init(None)
        if not Gst.ElementFactory.find('pipewiresrc'):
            raise RuntimeError('Native Wayland control requires the GStreamer PipeWire plugin (pipewiresrc).')
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None
        self.pipeline = None
        self.remote_fd = None
        self.closed = False

    def call(self, interface, method, signature, values):
        return self.bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', interface, method,
                                  self.GLib.Variant(signature, values), None, self.Gio.DBusCallFlags.NONE, 15000, None)

    def request(self, interface, method, signature, values, options):
        token = 'sele_' + uuid.uuid4().hex
        options = dict(options, handle_token=self.GLib.Variant('s', token))
        sender = self.bus.get_unique_name()[1:].replace('.', '_')
        request_path = '/org/freedesktop/portal/desktop/request/' + sender + '/' + token
        loop = self.GLib.MainLoop()
        result = []

        def response(_bus, _sender, _path, _interface, _signal, params):
            result.extend(params.unpack())
            loop.quit()

        subscription = self.bus.signal_subscribe(None, 'org.freedesktop.portal.Request', 'Response', request_path, None,
                                                self.Gio.DBusSignalFlags.NONE, response)
        timeout = self.GLib.timeout_add_seconds(120, lambda: (loop.quit(), False)[1])
        try:
            self.call(interface, method, signature, (*values, options))
            if not result:
                loop.run()
            if not result or result[0] != 0:
                raise RuntimeError('Desktop access was canceled or denied.')
            return result[1]
        finally:
            self.bus.signal_unsubscribe(subscription)
            self.GLib.source_remove(timeout)

    def start(self):
        remote = 'org.freedesktop.portal.RemoteDesktop'
        cast = 'org.freedesktop.portal.ScreenCast'
        result = self.request(remote, 'CreateSession', '(a{sv})', (), {'session_handle_token': self.GLib.Variant('s', 'sele_' + uuid.uuid4().hex)})
        self.session = result['session_handle']
        try:
            self.request(remote, 'SelectDevices', '(oa{sv})', (self.session,), {'types': self.GLib.Variant('u', 3)})
            self.request(cast, 'SelectSources', '(oa{sv})', (self.session,), {
                'types': self.GLib.Variant('u', 1), 'multiple': self.GLib.Variant('b', False),
                'cursor_mode': self.GLib.Variant('u', 2)})
            result = self.request(remote, 'Start', '(osa{sv})', (self.session, ''), {})
            if result.get('devices', 0) & 3 != 3 or not result.get('streams'):
                raise RuntimeError('Both screen sharing and pointer/keyboard access must be granted.')
            self.node, props = result['streams'][0]
            self.width, self.height = props.get('logical_size', props.get('size', (0, 0)))
            response, descriptors = self.bus.call_with_unix_fd_list_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', cast,
                'OpenPipeWireRemote', self.GLib.Variant('(oa{sv})', (self.session, {})), None,
                self.Gio.DBusCallFlags.NONE, 15000, None, None)
            self.remote_fd = descriptors.get(response.unpack()[0])
            self.pipeline = self.Gst.parse_launch(f'pipewiresrc fd={self.remote_fd} path={self.node} do-timestamp=true ! videoconvert ! pngenc snapshot=false ! appsink name=shot max-buffers=1 drop=true sync=false')
            self.sink = self.pipeline.get_by_name('shot')
            self.pipeline.set_state(self.Gst.State.PLAYING)
            self.bus.signal_subscribe(None, 'org.freedesktop.portal.Session', 'Closed', self.session, None,
                                      self.Gio.DBusSignalFlags.NONE, lambda *_: self.close())
            shot = self.screenshot()
            if not self.width or not self.height:
                self.width, self.height = shot['width'], shot['height']
        except Exception:
            self.close()
            raise

    def screenshot(self):
        if self.closed:
            raise RuntimeError('Desktop sharing has ended.')
        sample = self.sink.emit('try-pull-sample', 10 * self.Gst.SECOND)
        if sample is None:
            raise RuntimeError('The shared desktop did not provide a frame.')
        buffer = sample.get_buffer()
        data = buffer.extract_dup(0, buffer.get_size())
        self.pixel_width, self.pixel_height = struct.unpack('>II', data[16:24])
        return {'data': base64.b64encode(data).decode(), 'width': self.pixel_width, 'height': self.pixel_height}

    def notify(self, method, signature, *args):
        if self.closed:
            raise RuntimeError('Desktop sharing has ended.')
        self.call('org.freedesktop.portal.RemoteDesktop', method, '(oa{sv}' + signature + ')', (self.session, {}, *args))

    def move(self, x, y):
        self.notify('NotifyPointerMotionAbsolute', 'udd', self.node,
                    float(x) * self.width / self.pixel_width, float(y) * self.height / self.pixel_height)

    def button(self, button, state):
        self.notify('NotifyPointerButton', 'iu', {1: 272, 2: 274, 3: 273}[button], int(state))

    def scroll(self, dx, dy):
        self.notify('NotifyPointerAxis', 'dd', float(dx), float(dy))

    def keysym(self, key, state):
        self.notify('NotifyKeyboardKeysym', 'iu', key, int(state))

    def key(self, value):
        special = {'ctrl': 0xffe3, 'control': 0xffe3, 'alt': 0xffe9, 'shift': 0xffe1, 'super': 0xffeb,
                   'enter': 0xff0d, 'return': 0xff0d, 'tab': 0xff09, 'escape': 0xff1b, 'esc': 0xff1b,
                   'backspace': 0xff08, 'delete': 0xffff, 'home': 0xff50, 'end': 0xff57,
                   'left': 0xff51, 'up': 0xff52, 'right': 0xff53, 'down': 0xff54, 'space': 32}
        keys = []
        for item in value.split('+'):
            code = special.get(item.lower())
            if code is None and len(item) == 1:
                code = ord(item)
            if code is None:
                raise RuntimeError('Unsupported key: ' + item)
            keys.append(code)
        pressed = []
        try:
            for code in keys:
                self.keysym(code, 1)
                pressed.append(code)
        finally:
            for code in reversed(pressed):
                self.keysym(code, 0)

    def text(self, value):
        for char in value:
            code = 0xff0d if char == '\n' else ord(char) if ord(char) <= 255 else 0x01000000 | ord(char)
            self.keysym(code, 1)
            self.keysym(code, 0)

    def close(self):
        if self.closed:
            return
        self.closed = True
        print(json.dumps({'event': 'disconnected'}), flush=True)
        if self.pipeline:
            self.pipeline.set_state(self.Gst.State.NULL)
        if self.session:
            try:
                self.bus.call_sync('org.freedesktop.portal.Desktop', self.session, 'org.freedesktop.portal.Session', 'Close', None,
                                   None, self.Gio.DBusCallFlags.NONE, 3000, None)
            except Exception:
                pass
        if self.remote_fd is not None:
            os.close(self.remote_fd)


backend = None


def handle(command):
    global backend
    action = command['action']
    if action == 'connect':
        if backend:
            backend.close()
        backend = Portal() if os.environ.get('WAYLAND_DISPLAY') or os.environ.get('XDG_SESSION_TYPE') == 'wayland' else X11()
        if isinstance(backend, Portal):
            backend.start()
        return {'backend': 'portal' if isinstance(backend, Portal) else 'x11'}
    if action == 'disconnect':
        if backend:
            backend.close()
        backend = None
        return {}
    if backend is None:
        raise RuntimeError('Connect the desktop in Sele Settings before using computer tools.')
    if action == 'screenshot':
        return backend.screenshot()
    if action in ('move', 'click', 'drag'):
        x, y = float(command['x']), float(command['y'])
        width = getattr(backend, 'pixel_width', backend.width)
        height = getattr(backend, 'pixel_height', backend.height)
        if not (0 <= x < width and 0 <= y < height):
            raise RuntimeError('Coordinates are outside the shared desktop.')
        backend.move(x, y)
    if action == 'click':
        button = int(command.get('button', 1))
        if button not in (1, 2, 3):
            raise RuntimeError('Unsupported mouse button.')
        for _ in range(min(3, max(1, int(command.get('count', 1))))):
            backend.button(button, True)
            backend.button(button, False)
    elif action == 'drag':
        if not (0 <= float(command['toX']) < width and 0 <= float(command['toY']) < height):
            raise RuntimeError('Drag endpoint is outside the shared desktop.')
        backend.button(1, True)
        try:
            backend.move(float(command['toX']), float(command['toY']))
        finally:
            backend.button(1, False)
    elif action == 'key':
        backend.key(str(command['key']))
    elif action == 'type':
        text = str(command['text'])
        if len(text) > 10000:
            raise RuntimeError('Text exceeds 10000 characters.')
        backend.text(text)
    elif action == 'scroll':
        backend.scroll(max(-2000, min(2000, float(command.get('dx', 0)))), max(-2000, min(2000, float(command.get('dy', 0)))))
    elif action != 'move':
        raise RuntimeError('Unsupported computer action.')
    return {'success': True}


def dispatch(command):
    try:
        result = handle(command)
        print(json.dumps({'id': command['id'], 'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'id': command.get('id'), 'error': str(error)}), flush=True)
    return False


if __name__ == '__main__':
    # The GLib loop dispatches portal signals even while stdin is idle.
    from gi.repository import GLib
    loop = GLib.MainLoop()

    def read():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                GLib.idle_add(dispatch, command)
            except Exception:
                continue
        GLib.idle_add(loop.quit)
    threading.Thread(target=read, daemon=True).start()
    try:
        loop.run()
    finally:
        if backend:
            backend.close()
