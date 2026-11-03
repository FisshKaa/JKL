'use strict';
// Прямое соединение двух браузеров (WebRTC) через PeerJS.
// Сервер PeerJS нужен только чтобы браузеры нашли друг друга; сам бой идёт напрямую.
const ROOM_PREFIX = 'lumen-duel-v1-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[(Math.random() * ROOM_ALPHABET.length) | 0];
  return s;
}

class OnlineLink {
  // h: { onOpen(), onMessage(m), onClose(), onStatus(text), onError(text) }
  constructor(h) { this.h = h; this.peer = null; this.conn = null; this.role = null; }

  available() { return typeof Peer !== 'undefined'; }

  host(code) {
    this.role = 'host'; this.code = code;
    this.peer = new Peer(ROOM_PREFIX + code, { debug: 1 });
    this.peer.on('open', () => this.h.onStatus('Комната готова. Отправь ссылку или код сопернику.'));
    this.peer.on('connection', c => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'busy' }); setTimeout(() => c.close(), 300); }); return; }
      this.attach(c);
    });
    this.peer.on('error', e => this.fail(e));
    this.peer.on('disconnected', () => { if (!this.conn) this.h.onStatus('Нет связи с сервером комнат, пробуем ещё раз…'); try { this.peer.reconnect(); } catch (err) { /* ничего */ } });
  }

  join(code) {
    this.role = 'guest'; this.code = code;
    this.peer = new Peer(undefined, { debug: 1 });
    this.peer.on('open', () => {
      this.h.onStatus('Ищем комнату…');
      this.attach(this.peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' }));
    });
    this.peer.on('error', e => this.fail(e));
  }

  attach(c) {
    this.conn = c;
    c.on('open', () => this.h.onOpen());
    c.on('data', m => { if (m && m.t === 'busy') { this.h.onError('В этой комнате уже идёт бой.'); return; } this.h.onMessage(m); });
    c.on('close', () => this.h.onClose());
    c.on('error', e => this.fail(e));
  }

  fail(e) {
    const type = e && e.type;
    const text = {
      'peer-unavailable': 'Комната не найдена. Проверь код: может, хозяин её уже закрыл.',
      'unavailable-id': 'Такой код уже занят, создай комнату ещё раз.',
      'network': 'Нет связи с сервером комнат. Проверь интернет.',
      'server-error': 'Сервер комнат не отвечает. Попробуй чуть позже.',
      'browser-incompatible': 'Этот браузер не поддерживает прямое соединение.',
    }[type] || 'Ошибка соединения' + (type ? ` (${type})` : '') + '.';
    this.h.onError(text);
  }

  send(m) { if (this.conn && this.conn.open) { try { this.conn.send(m); } catch (e) { /* канал закрывается */ } } }

  close() {
    try { if (this.conn) this.conn.close(); } catch (e) { /* уже закрыт */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* уже закрыт */ }
    this.conn = null; this.peer = null;
  }
}
