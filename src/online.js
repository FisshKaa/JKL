'use strict';
// Прямое соединение двух браузеров (WebRTC) через PeerJS.
// Сервер PeerJS нужен только чтобы браузеры нашли друг друга; сам бой идёт напрямую,
// а если прямой путь закрыт NAT-ом — через TURN-ретранслятор.
const ROOM_PREFIX = 'lumen-duel-v1-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECT_TIMEOUT = 15000;

function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[(Math.random() * ROOM_ALPHABET.length) | 0];
  return s;
}

// Свой TURN-сервер (из окна онлайна) хранится в браузере
function loadCustomTurn() {
  try { const t = JSON.parse(localStorage.getItem('lumen3d:turn') || 'null'); return t && t.urls ? t : null; } catch (e) { return null; }
}
function saveCustomTurn(t) {
  try { if (t && t.urls) localStorage.setItem('lumen3d:turn', JSON.stringify(t)); else localStorage.removeItem('lumen3d:turn'); } catch (e) { /* без сохранения */ }
}

function iceServers() {
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Ретрансляторы PeerJS (стоят у библиотеки по умолчанию)
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    // Публичный бесплатный ретранслятор Open Relay: через порты 80/443 проходит даже строгие сети
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  const custom = loadCustomTurn();
  if (custom) {
    const urls = custom.urls.split(/[\s,]+/).filter(Boolean);
    if (urls.length) list.unshift({ urls, username: custom.username || undefined, credential: custom.credential || undefined });
  }
  return list;
}

class OnlineLink {
  // h: { onOpen(), onMessage(m), onClose(), onStatus(text), onError(text) }
  constructor(h) { this.h = h; this.peer = null; this.conn = null; this.role = null; this.watch = 0; }

  makePeer(id) {
    return new Peer(id, { debug: 1, config: { iceServers: iceServers(), iceTransportPolicy: 'all' } });
  }

  host(code) {
    this.role = 'host'; this.code = code;
    this.peer = this.makePeer(ROOM_PREFIX + code);
    this.peer.on('open', () => this.h.onStatus('Комната готова. Отправь ссылку или код сопернику.'));
    this.peer.on('connection', c => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'busy' }); setTimeout(() => c.close(), 300); }); return; }
      this.h.onStatus('Соперник нашёл комнату, устанавливаем соединение…');
      this.attach(c);
    });
    this.peer.on('error', e => this.fail(e));
    this.peer.on('disconnected', () => {
      if (!this.conn) this.h.onStatus('Нет связи с сервером комнат, пробуем ещё раз…');
      try { this.peer.reconnect(); } catch (err) { /* ничего */ }
    });
  }

  join(code) {
    this.role = 'guest'; this.code = code;
    this.peer = this.makePeer(undefined);
    this.h.onStatus('Подключаемся к серверу комнат…');
    this.peer.on('open', () => {
      this.h.onStatus('Ищем комнату…');
      this.attach(this.peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' }));
    });
    this.peer.on('error', e => this.fail(e));
  }

  attach(c) {
    this.conn = c;
    const started = performance.now();
    let lastState = '';
    c.on('open', () => { clearInterval(this.watch); this.h.onOpen(); });
    c.on('data', m => { if (m && m.t === 'busy') { this.h.onError('В этой комнате уже идёт бой.'); return; } this.h.onMessage(m); });
    c.on('close', () => { clearInterval(this.watch); this.h.onClose(); });
    c.on('error', e => this.fail(e));
    // Следим за пробивкой NAT, чтобы не висеть молча на «Ищем комнату…»
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (c.open) { clearInterval(this.watch); return; }
      const pc = c.peerConnection;
      const st = pc ? pc.iceConnectionState : 'new';
      if (st !== lastState) {
        lastState = st;
        const txt = {
          new: this.role === 'guest' ? 'Комната найдена, договариваемся о соединении…' : 'Договариваемся о соединении…',
          checking: 'Пробиваемся напрямую через NAT…',
          connected: 'Соединение есть, открываем канал…',
          completed: 'Соединение есть, открываем канал…',
          disconnected: 'Связь прерывается, ждём…',
        }[st];
        if (txt) this.h.onStatus(txt);
      }
      if (st === 'failed' || performance.now() - started > CONNECT_TIMEOUT) {
        clearInterval(this.watch);
        this.h.onError(st === 'failed'
          ? 'Прямое соединение не прошло: сеть одного из вас его блокирует. Укажите свой TURN-сервер ниже или попробуйте другую сеть (например, раздать интернет с телефона).'
          : 'Соединение не установилось за 15 секунд. Проверьте, что хозяин комнаты не закрыл окно, или укажите свой TURN-сервер ниже.');
        try { c.close(); } catch (e) { /* уже закрыт */ }
      }
    }, 500);
  }

  fail(e) {
    const type = e && e.type;
    const text = {
      'peer-unavailable': 'Комната не найдена. Проверь код: может, хозяин её уже закрыл или ушёл со страницы.',
      'unavailable-id': 'Такой код уже занят, создай комнату ещё раз.',
      'network': 'Нет связи с сервером комнат. Проверь интернет.',
      'server-error': 'Сервер комнат не отвечает. Попробуй чуть позже.',
      'browser-incompatible': 'Этот браузер не поддерживает прямое соединение.',
      'webrtc': 'Браузер не смог создать прямое соединение.',
    }[type] || 'Ошибка соединения' + (type ? ` (${type})` : '') + '.';
    this.h.onError(text);
  }

  send(m) { if (this.conn && this.conn.open) { try { this.conn.send(m); } catch (e) { /* канал закрывается */ } } }

  close() {
    clearInterval(this.watch);
    try { if (this.conn) this.conn.close(); } catch (e) { /* уже закрыт */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* уже закрыт */ }
    this.conn = null; this.peer = null;
  }
}
