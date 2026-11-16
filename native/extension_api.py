"""Bounded, loopback-only toolbar requests; success means ready, not queued."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import hashlib
import math
import re
import threading
import time
from urllib.parse import urlsplit

EXTENSION_ID = 'bbobdmpbadoijfffgfeefcenegbbjddd'
EXTENSION_ORIGIN = f'chrome-extension://{EXTENSION_ID}'
EXTENSION_ORIGINS = frozenset((EXTENSION_ORIGIN, 'chrome-extension://hgkfghgifkifgmklfgglilnmjglojonm'))
PORT = 43187
MAX_BODY = 12288
MESSAGES = {
    'ready': 'Vorleseleiste bereit',
    'applied': 'Einstellung übernommen',
    'invalid_request': 'Die Anfrage entspricht nicht dem lokalen Reader-Protokoll.',
    'save_failed': 'Die Einstellungen konnten nicht dauerhaft gespeichert werden.',
    'timeout': 'Das Dokument wurde nicht rechtzeitig bereit. Bitte erneut versuchen.',
    'busy': 'Ein Dokument wird bereits vorbereitet. Bitte kurz warten.',
    'request_conflict': 'Ungültige wiederholte Anfrage.',
    'unsupported': 'Dieses Dokument wird noch nicht unterstützt.',
    'ambiguous': 'Mehrere gleiche Tabs gefunden. Bitte das gewünschte Dokument allein aktivieren.',
    'tab_changed': 'Der angeklickte Tab wurde inzwischen geändert oder geschlossen.',
    'browser_unavailable': 'Die lokale Browserverbindung antwortet nicht.',
    'bridge_failed': 'Die Vorleseleiste konnte im Dokument nicht bereitgestellt werden.',
    'prepare_failed': 'Die Textstellen des Dokuments konnten nicht vorbereitet werden.',
    'document_changed':'Das gebundene Dokument wurde geändert. Bitte erneut öffnen.',
    'closed': 'Der Hintergrundleser wurde beendet.',
    'premium_locked': 'Für Downloads ist Reader Premium erforderlich.',
    'activation_failed': 'Die Premium-Aktivierung konnte nicht bestätigt werden.',
    'premium_unavailable': 'Der Premiumdienst ist momentan nicht erreichbar.',
    'export_failed': 'Der Audioexport konnte nicht gestartet werden.',
}

class BoundedServer(ThreadingHTTPServer):
    """A stalled local client cannot create arbitrarily many handler threads."""
    def __init__(self, *args):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args)
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

class ExtensionControl:
    def __init__(self, events, port=PORT, request_timeout=100, status_provider=None, document_provider=None):
        owner = self
        self.events, self.port = events, port
        self.request_timeout = min(100, max(.05, request_timeout))
        self.requests = {}
        self.lock = threading.Lock()
        self.closed = False
        self.status_provider = status_provider
        self.document_provider = document_provider

        class Handler(BaseHTTPRequestHandler):
            server_version = 'BraveReader'
            sys_version = ''
            def setup(self):
                super().setup()
                self.connection.settimeout(5)
            def log_message(self, *_args):
                return
            def allowed(self):
                origins = self.headers.get_all('Origin')
                return (origins is not None and len(origins) == 1 and origins[0] in EXTENSION_ORIGINS and
                        self.headers.get_all('Host') == [f'127.0.0.1:{owner.port}'])
            def reply(self, status, value, cors=False):
                payload = json.dumps(value, separators=(',', ':')).encode('utf-8')
                try:
                    self.send_response(status)
                    if cors:
                        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin'))
                        self.send_header('Vary', 'Origin')
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except (OSError, TimeoutError):
                    pass
            def do_OPTIONS(self):
                if not self.allowed() or self.path not in ('/v1/show', '/v1/hide', '/v1/status', '/v1/settings', '/v1/control', '/v1/document'):
                    self.reply(403, {'ok': False})
                    return
                self.send_response(204)
                self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin'))
                self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'content-type')
                self.send_header('Access-Control-Max-Age', '60')
                self.send_header('Vary', 'Origin')
                self.end_headers()
            def do_POST(self):
                if not self.allowed():
                    self.reply(403, {'ok': False})
                    return
                raw_length = self.headers.get('Content-Length', '')
                limit = MAX_BODY if self.path in ('/v1/show', '/v1/hide') else (64 if self.path in ('/v1/status','/v1/document') else 2048)
                if (self.path not in ('/v1/show', '/v1/hide', '/v1/status', '/v1/settings', '/v1/control', '/v1/document') or not raw_length.isdecimal() or
                    len(raw_length) > 6 or not 0 < int(raw_length) <= limit or
                    self.headers.get('Transfer-Encoding') is not None or
                    self.headers.get_all('Content-Length') != [raw_length] or
                    self.headers.get('Content-Type', '').split(';', 1)[0] != 'application/json'):
                    self.reply(400, {'ok': False, 'version': 1, 'code': 'invalid_request',
                                     'message': MESSAGES['invalid_request']}, True)
                    return
                try:
                    data = json.loads(self.rfile.read(int(raw_length)),
                                      object_pairs_hook=owner.strict_object, parse_constant=owner.reject_constant)
                    request = owner.validate_route(self.path, data)
                except (ValueError, UnicodeError, OSError, TypeError):
                    self.reply(400, {'ok': False, 'version': 1, 'code': 'invalid_request',
                                     'message': MESSAGES['invalid_request']}, True)
                    return
                if self.path == '/v1/document':
                    status,payload=(owner.document_provider(refresh=True)if request.get('refresh')else owner.document_provider())if owner.document_provider else(503,{'ok':False,'version':1,'code':'unavailable','errorKey':'document_unavailable'})
                    self.reply(status,payload,True);return
                if self.path == '/v1/status':
                    self.reply(200, {'ok': True, 'version': 1, 'code': 'status', **owner.status()}, True)
                    return
                operation = {'/v1/show':'show', '/v1/hide':'hide', '/v1/settings':'settings', '/v1/control':'control'}[self.path]
                wire_id = request['requestId']
                # Identity is injected only after validating the HTTP origin.
                request['_extensionOrigin'] = self.headers.get('Origin')
                request['_wireRequestId'] = wire_id
                request['requestId'] = hashlib.sha256((request['_extensionOrigin'] + ':' + wire_id).encode()).hexdigest()[:32]
                entry, code = owner.submit(request, operation)
                if code:
                    self.reply(409, owner.result(wire_id, False, code), True)
                    return
                entry['event'].wait(min(2, max(0, entry['deadline'] - time.monotonic())))
                if not entry['event'].is_set():
                    if time.monotonic() < entry['deadline']:
                        self.reply(202, {'ok': False, 'version': 1,
                            'requestId': wire_id, 'code': 'pending'}, True)
                        return
                    owner.complete(request['requestId'], False, 'timeout')
                result = entry['result']
                status = 200 if result['ok'] else (504 if result['code'] == 'timeout' else 422)
                self.reply(status, result, True)

        self.httpd = BoundedServer(('127.0.0.1', port), Handler)
        self.port = self.httpd.server_address[1]
        self.httpd.daemon_threads = True
        self.httpd.block_on_close = False
        self.thread = threading.Thread(target=self.httpd.serve_forever, name='reader-extension-api', daemon=True)
        self.thread.start()

    @staticmethod
    def strict_object(pairs):
        data = {}
        for key, value in pairs:
            if key in data:
                raise ValueError('Duplicate JSON key')
            data[key] = value
        return data

    @staticmethod
    def reject_constant(_value):
        raise ValueError('Non-finite JSON constant')

    @staticmethod
    def validate(data):
        if (not isinstance(data, dict) or set(data) != {'version', 'requestId', 'tab'} or
            type(data['version']) is not int or data['version'] != 1 or
            not isinstance(data['requestId'], str) or not re.fullmatch('[a-f0-9]{32}', data['requestId'])):
            raise ValueError('Invalid request')
        tab = data['tab']
        if not isinstance(tab, dict) or set(tab) != {'url', 'title'}:
            raise ValueError('Invalid selector')
        url, title = tab['url'], tab['title']
        if (not isinstance(url, str) or not 1 <= len(url) <= 8192 or
            not isinstance(title, str) or len(title) > 512 or
            any(ord(c) < 32 or ord(c) == 127 for c in url + title)):
            raise ValueError('Invalid selector')
        parsed = urlsplit(url)
        if (parsed.scheme not in ('http', 'https', 'file') or parsed.username or parsed.password or
            (parsed.scheme in ('http', 'https') and not parsed.hostname) or
            (parsed.scheme == 'file' and parsed.netloc not in ('', 'localhost'))):
            raise ValueError('Unsupported URL')
        return {'version': 1, 'requestId': data['requestId'], 'tab': dict(tab)}

    @staticmethod
    def validate_route(path, data):
        if path in ('/v1/show', '/v1/hide'):
            return ExtensionControl.validate(data)
        if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1:
            raise ValueError('Invalid version')
        if path == '/v1/document':
            if not set(data)<={'version','refresh'}or 'refresh'in data and type(data['refresh'])is not bool:raise ValueError('Invalid document request')
            return dict(data)
        if path == '/v1/status':
            if set(data) != {'version'}:
                raise ValueError('Invalid status request')
            return {'version': 1}
        field = 'settings' if path == '/v1/settings' else 'command'
        allowed = {'version', 'requestId', field}
        if field == 'command' and 'value' in data: allowed.add('value')
        if field == 'command' and 'sourceGeneration' in data:
            if type(data['sourceGeneration'])is not str or not re.fullmatch(r'[a-f0-9-]{16,64}',data['sourceGeneration']):
                raise ValueError('Invalid source generation')
            allowed.add('sourceGeneration')
        if (set(data) != allowed or
            not isinstance(data.get('requestId'), str) or
            not re.fullmatch('[a-f0-9]{32}', data['requestId'])):
            raise ValueError('Invalid request')
        if field == 'command':
            command = data['command']
            if type(command) is not str or command not in ('stop', 'toggle', 'restart', 'seekSection', 'seekChapter', 'resetBar', 'previousSection', 'nextSection', 'seekProgress', 'export', 'cancelExport', 'activatePremium', 'toggleTheme', 'openFocus', 'exportDocument','setOverlayVisible','authorizeExport'):
                raise ValueError('Invalid command')
            if command=='setOverlayVisible':
                if type(data.get('value'))is not bool:raise ValueError('Invalid visibility')
            elif command in ('seekSection','seekChapter'):
                if type(data.get('value')) is not int or data['value']<0:raise ValueError('Invalid navigation index')
            elif command == 'seekProgress':
                value = data.get('value')
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1: raise ValueError('Invalid progress')
            elif command == 'exportDocument':
                value=data.get('value')
                if type(value)is dict:
                    if set(value)!={'format','view'}or type(value['format'])is not str or value['format']not in('pdf','html')or type(value['view'])is not str or value['view']not in('focus','source'):raise ValueError('Invalid document format')
                elif type(value)is not str or value not in('pdf','html'):raise ValueError('Invalid document format')
            elif command == 'export':
                if data.get('value') not in ('mp3', 'wav'): raise ValueError('Invalid format')
            elif command == 'activatePremium':
                if type(data.get('value')) is not str or not re.fullmatch(r'[A-Za-z0-9._-]{8,1800}', data['value']): raise ValueError('Invalid activation')
            elif 'value' in data: raise ValueError('Unexpected value')
            return dict(data)
        values = data['settings']
        if (not isinstance(values, dict) or not values or
            not set(values) <= {'speed', 'follow', 'clickSeek', 'autoShow', 'language', 'uiLanguage', 'playerTheme', 'formatLocale', 'timeFormat', 'voice', 'volume', 'muted', 'appearance'}):
            raise ValueError('Invalid settings')
        for key, value in values.items():
            if key == 'speed':
                if (type(value) not in (int, float) or not .8 <= value <= 4 or
                    not math.isfinite(value) or abs(value * 20 - round(value * 20)) > 1e-8):
                    raise ValueError('Invalid speed')
            elif key == 'volume':
                if (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 150 or
                    abs(value / 5 - round(value / 5)) > 1e-8):
                    raise ValueError('Invalid volume')
            elif key == 'language':
                # 'auto' or an ISO-style code; the player checks it against its catalog.
                if type(value) is not str or not re.fullmatch(r'auto|[a-z]{2}(-[a-z]{2})?', value):
                    raise ValueError('Invalid language')
            elif key == 'uiLanguage':
                from preferences import ui_language_value
                ui_language_value(value)
            elif key == 'playerTheme':
                from preferences import player_theme_value
                player_theme_value(value)
            elif key == 'formatLocale':
                from preferences import format_locale_value
                format_locale_value(value)
            elif key == 'timeFormat':
                from preferences import time_format_value
                time_format_value(value)
            elif key == 'appearance':
                from reading_view import appearance_value
                appearance_value(value)
            elif key == 'voice':
                if (type(value) is not dict or set(value) != {'language', 'id'} or
                    type(value['language']) is not str or not re.fullmatch(r'[a-z]{2}(-[a-z]{2})?', value['language']) or
                    type(value['id']) is not str or not re.fullmatch(r'[a-z0-9_:.-]{1,64}', value['id'])):
                    raise ValueError('Invalid voice')
            elif type(value) is not bool:
                raise ValueError('Invalid boolean')
        return {'version': 1, 'requestId': data['requestId'], 'settings': dict(values)}

    def status(self):
        # This provider reads a plain-data snapshot and SynthService.stats(),
        # never tkinter or document state from an HTTP handler thread.
        if self.status_provider is not None:
            return self.status_provider()
        return {'engine': {'ready': False, 'voice': 'Bella', 'language': 'en', 'providers': []},
                'settings': {'speed': 1, 'follow': True, 'clickSeek': True, 'autoShow': False, 'bar': {'x': .5, 'y': 1}, 'volume': 100, 'muted': False},
                'playback': {'playing': False, 'paused': False},
                'components': {'extensionApi': self.thread.is_alive(), 'bridge': False, 'watcher': False}}

    @staticmethod
    def result(request_id, ok, code):
        value = {'ok': bool(ok), 'version': 1, 'requestId': request_id, 'code': code}
        if not ok:
            value['message'] = MESSAGES[code]
        return value

    def submit(self, request, operation='show'):
        now = time.monotonic()
        fingerprint = hashlib.sha256(json.dumps([operation, request], sort_keys=True).encode()).digest()
        with self.lock:
            for key, entry in self.requests.items():
                if not entry['event'].is_set() and now >= entry['deadline']:
                    entry['result'] = self.result(entry.get('wireId', key), False, 'timeout')
                    entry['finished'] = now
                    entry['event'].set()
            self.requests = {key: value for key, value in self.requests.items()
                             if not value['event'].is_set() or now - value['finished'] < 30}
            old = self.requests.get(request['requestId'])
            if old:
                return (old, None) if old['fingerprint'] == fingerprint else (None, 'request_conflict')
            if self.closed:
                return None, 'closed'
            pending = [value for value in self.requests.values() if not value['event'].is_set()]
            if ((operation == 'show' and any(value['operation'] == 'show' for value in pending)) or
                (operation != 'show' and sum(value['operation'] != 'show' for value in pending) >= 8)):
                return None, 'busy'
            if len(self.requests) >= 32:
                finished = [key for key, value in self.requests.items() if value['event'].is_set()]
                oldest = min(finished, key=lambda key: self.requests[key]['finished'])
                del self.requests[oldest]
            timeout = self.request_timeout if operation == 'show' else (15 if request.get('command') == 'activatePremium' else 5)
            entry = {'wireId': request.get('_wireRequestId', request['requestId']), 'fingerprint': fingerprint, 'event': threading.Event(), 'result': None,
                     'operation': operation,
                     'deadline': now + timeout, 'finished': now}
            self.requests[request['requestId']] = entry
            self.events.put((None, 'extension_' + operation, request))
            return entry, None

    def is_pending(self, request_id):
        with self.lock:
            entry = self.requests.get(request_id)
            return bool(entry and not entry['event'].is_set() and time.monotonic() < entry['deadline'])

    def complete(self, request_id, ok, code='ready', extra=None):
        if code not in MESSAGES:
            code, ok = 'prepare_failed', False
        with self.lock:
            entry = self.requests.get(request_id)
            if entry and not entry['event'].is_set():
                if time.monotonic() >= entry['deadline']:
                    ok, code = False, 'timeout'
                entry['result'] = self.result(entry.get('wireId', request_id), ok, code)
                if extra is not None and entry['operation'] != 'show':
                    entry['result'].update(extra)
                entry['finished'] = time.monotonic()
                entry['event'].set()

    def close(self):
        with self.lock:
            self.closed = True
            pending = [key for key, entry in self.requests.items() if not entry['event'].is_set()]
        for key in pending:
            self.complete(key, False, 'closed')
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=1)
