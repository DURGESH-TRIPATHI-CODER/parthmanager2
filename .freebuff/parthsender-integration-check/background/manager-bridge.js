/* Optional ParthSeva Manager pairing/queue adapter for ParthSender MV3.
 * It feeds validated records into the existing service-worker queue and never
 * implements message delivery itself. */
const ManagerBridge = (() => {
  const RETRY_ALARM = 'PARTHSEVA_RECONNECT';
  const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  const SECRET_SPACE = Math.floor(ALPHABET.length ** 8 / 16384);
  const PORT_MIN = 49152;
  const CODE_RE = /^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}-[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}$/;
  let socket = null;
  let retryCount = 0;
  let intentionallyClosed = false;
  let pendingPairCode = null;
  let connecting = false;
  let flushingStatuses = false;
  let keepAliveTimer = null;

  function publish(status, error = '') {
    chrome.storage.local.set({ managerConnectionStatus: status, managerConnectionError: error });
    try { chrome.runtime.sendMessage({ event: 'MANAGER_CONNECTION_CHANGED', status, error }, () => void chrome.runtime.lastError); } catch (_) { /* popup closed */ }
  }

  function pairingPort(code) {
    if (!CODE_RE.test(code)) return null;
    const raw = code.replace('-', '');
    let value = 0;
    for (const char of raw) value = value * ALPHABET.length + ALPHABET.indexOf(char);
    const offset = Math.floor(value / SECRET_SPACE);
    return offset < 16384 ? PORT_MIN + offset : null;
  }

  function isLoopbackUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'ws:' && u.hostname === '127.0.0.1' && !u.username && !u.password && Number(u.port) >= PORT_MIN && Number(u.port) <= 65535;
    } catch (_) { return false; }
  }

  function connectWithPairingCode(code) {
    const port = pairingPort(code);
    if (!port) { publish('disconnected', 'Pairing code is invalid.'); return false; }
    intentionallyClosed = false;
    pendingPairCode = code;
    connecting = true;
    retryCount = 0;
    openSocket(`ws://127.0.0.1:${port}`, 'PAIR');
    return true;
  }

  function openSocket(url, purpose) {
    if (!isLoopbackUrl(url)) { connecting = false; publish('disconnected', 'Desktop connection is not a valid local address.'); return; }
    let ws;
    try { ws = new WebSocket(url); }
    catch (_) { connecting = false; publish('disconnected', 'Could not reach ParthSeva Manager.'); scheduleReconnect(); return; }
    socket = ws;
    ws.onopen = async () => {
      const stored = await get(['managerCredential']);
      if (purpose === 'PAIR' && pendingPairCode) send({ type: 'PAIR', pairingCode: pendingPairCode });
      else if (stored.managerCredential && isLoopbackUrl(stored.managerCredential.serverUrl)) {
        send({ type: 'AUTH', deviceId: stored.managerCredential.deviceId, sessionToken: stored.managerCredential.sessionToken });
      } else { connecting = false; publish('disconnected', 'Pair this extension with ParthSeva Manager.'); ws.close(); }
      startKeepAlive(ws);
    };
    ws.onmessage = (event) => handleFrame(event.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      if (socket === ws) socket = null;
      connecting = false;
      if (intentionallyClosed) return;
      publish('disconnected', 'Connection lost. Reconnecting…');
      stopManagerQueuesForConnectionLoss();
      scheduleReconnect();
    };
  }

  function startKeepAlive(ws) {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) { clearInterval(keepAliveTimer); keepAliveTimer = null; return; }
      send({ type: 'PING', requestId: `keepalive-${Date.now()}` });
    }, 20_000);
  }

  function handleFrame(raw) {
    let data;
    try { if (typeof raw !== 'string' || raw.length > 1_000_000) throw new Error(); data = JSON.parse(raw); }
    catch (_) { if (socket) socket.close(1007, 'Malformed JSON'); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') { if (socket) socket.close(1008, 'Invalid message'); return; }
    if (data.type === 'PAIR_SUCCESS') {
      if (typeof data.deviceId !== 'string' || !data.deviceId || data.deviceId.length > 100 || typeof data.sessionToken !== 'string' || data.sessionToken.length < 40 || data.sessionToken.length > 200 || !isLoopbackUrl(data.serverUrl)) {
        pendingPairCode = null; connecting = false; publish('disconnected', 'The desktop returned invalid pairing credentials.'); socket?.close(); return;
      }
      chrome.storage.local.set({ managerCredential: { deviceId: data.deviceId, sessionToken: data.sessionToken, serverUrl: data.serverUrl } }, () => {
        pendingPairCode = null; retryCount = 0; connecting = false; intentionallyClosed = false; publish('connected'); flushStatuses();
      });
      return;
    }
    if (data.type === 'PAIR_REJECTED') {
      pendingPairCode = null; intentionallyClosed = true; connecting = false;
      publish('disconnected', data.message === 'Pairing code is invalid or expired.' ? data.message : 'ParthSeva Manager rejected the pairing code.');
      socket?.close(); return;
    }
    if (data.type === 'AUTH_REJECTED') {
      intentionallyClosed = true; connecting = false; chrome.alarms.clear(RETRY_ALARM);
      chrome.storage.local.remove('managerCredential');
      publish('expired', 'Connection expired. Pair again.'); socket?.close(); return;
    }
    if (data.type === 'AUTH_SUCCESS') { retryCount = 0; connecting = false; publish('connected'); flushStatuses(); return; }
    if (data.type === 'DISCONNECT') {
      intentionallyClosed = true; connecting = false; chrome.alarms.clear(RETRY_ALARM);
      chrome.storage.local.remove('managerCredential');
      stopManagerQueuesForConnectionLoss();
      publish('expired', 'ParthSeva Manager disconnected this device. Pair again.'); socket?.close(); return;
    }
    if (data.type === 'START_SENDING') { void acceptQueue(data); return; }
    if (data.type === 'STOP_SENDING') { void stopQueue(data); return; }
    if (data.type === 'PING' && validRequestId(data.requestId)) { send({ type: 'PONG', requestId: data.requestId }); return; }
    if (data.type === 'PONG') return;
    send({ type: 'ERROR', requestId: validRequestId(data.requestId) ? data.requestId : crypto.randomUUID(), code: 'UNKNOWN_COMMAND', message: 'Unsupported command.' });
  }

  function validRequestId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 100; }
  function validQueue(data) {
    if (!validRequestId(data.requestId) || !Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 5000) return false;
    const ids = new Set();
    return data.messages.every((m) => {
      if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some((key) => !['id', 'name', 'phone', 'message'].includes(key))) return false;
      const digits = typeof m.phone === 'string' ? m.phone.replace(/\D/g, '') : '';
      if (typeof m.id !== 'string' || !m.id.trim() || m.id.length > 100 || ids.has(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 200 || typeof m.phone !== 'string' || !/^\+?[0-9 ()-]{10,24}$/.test(m.phone) || digits.length < 10 || digits.length > 15 || typeof m.message !== 'string' || !m.message.trim() || m.message.length > 5000) return false;
      ids.add(m.id);
      return true;
    });
  }

  async function acceptQueue(data) {
    if (!validQueue(data)) { send({ type: 'ERROR', requestId: validRequestId(data.requestId) ? data.requestId : crypto.randomUUID(), code: 'INVALID_QUEUE', message: 'The message queue is invalid.' }); return; }
    const existing = await get(['managerRequests', 'queueState']);
    const records = existing.managerRequests && typeof existing.managerRequests === 'object' ? existing.managerRequests : {};
    if (records[data.requestId]) { send({ type: 'ERROR', requestId: data.requestId, code: 'DUPLICATE_REQUEST', message: 'This request was already received.' }); return; }
    if (existing.queueState === 'running' || existing.queueState === 'stopping') { send({ type: 'ERROR', requestId: data.requestId, code: 'SENDER_BUSY', message: 'The sender is already processing another queue.' }); return; }
    const queue = data.messages.map((m, index) => ({
      id: `manager-${data.requestId}-${index}`, index: index + 1, phone: m.phone.replace(/\D/g, ''), originalPhone: m.phone,
      name: m.name, messageTemplate: m.message, finalMessage: m.message, image: null, hasCommonImage: false,
      status: 'Pending', attempts: 0, error: null, createdAt: new Date().toISOString(), sentAt: null,
      managerRequestId: data.requestId, managerMessageId: m.id
    }));
    records[data.requestId] = { status: 'active', updatedAt: Date.now() };
    await set({ managerRequests: records, queue, queueCommonImage: null, queueState: 'running' });
    for (const item of queue) await status(item, 'pending');
    chrome.alarms.create('QUEUE_KEEPALIVE', { periodInMinutes: 0.5 });
    startQueueLoop();
  }

  async function stopQueue(data) {
    if (!validRequestId(data.requestId)) { send({ type: 'ERROR', requestId: crypto.randomUUID(), code: 'INVALID_REQUEST', message: 'Invalid stop request.' }); return; }
    const current = await get(['managerRequests', 'queueState']);
    const records = current.managerRequests || {};
    const record = records[data.requestId];
    if (!record || record.status !== 'active') { send({ type: 'ERROR', requestId: data.requestId, code: 'UNKNOWN_REQUEST', message: 'No active request matches this stop command.' }); return; }
    record.status = 'stopping';
    await set({ managerRequests: records, queueState: 'stopping' });
    if (!isLoopRunning) startQueueLoop();
  }

  async function stopManagerQueuesForConnectionLoss() {
    const current = await get(['managerRequests', 'queueState']);
    const records = current.managerRequests || {};
    let changed = false;
    for (const record of Object.values(records)) if (record.status === 'active') { record.status = 'stopping'; changed = true; }
    if (changed) {
      await set({ managerRequests: records, queueState: 'stopping' });
      if (!isLoopRunning) startQueueLoop();
    }
  }

  async function finalizeRun() {
    const current = await get(['managerRequests', 'queueState']);
    const records = current.managerRequests || {};
    for (const [requestId, record] of Object.entries(records)) {
      if (record.status === 'stopping') await finish(requestId, 'stopped');
      else if (record.status === 'active' && current.queueState === 'completed') await finish(requestId, 'completed');
      else if (record.status === 'active' && current.queueState === 'idle') await finish(requestId, 'stopped');
    }
    if (current.queueState === 'stopping') await set({ queueState: 'paused' });
  }

  async function finish(requestId, statusValue) {
    const data = await get(['managerRequests']);
    const records = data.managerRequests || {};
    const record = records[requestId];
    if (!record || (record.status !== 'active' && record.status !== 'stopping')) return;
    record.status = statusValue;
    record.updatedAt = Date.now();
    await set({ managerRequests: records });
    await enqueueStatus({ type: 'STATUS', requestId, status: statusValue });
  }

  function status(item, value, errorCode) {
    if (!item || !item.managerRequestId || !item.managerMessageId) return Promise.resolve();
    const event = { type: 'STATUS', requestId: item.managerRequestId, messageId: item.managerMessageId, status: value };
    if (errorCode) event.errorCode = errorCode;
    return enqueueStatus(event);
  }

  async function enqueueStatus(event) {
    const data = await get(['managerStatusOutbox']);
    const outbox = Array.isArray(data.managerStatusOutbox) ? data.managerStatusOutbox : [];
    outbox.push(event);
    await set({ managerStatusOutbox: outbox.slice(-10000) });
    flushStatuses();
  }

  async function flushStatuses() {
    if (flushingStatuses || !socket || socket.readyState !== WebSocket.OPEN) return;
    flushingStatuses = true;
    try {
      const data = await get(['managerStatusOutbox']);
      const outbox = Array.isArray(data.managerStatusOutbox) ? data.managerStatusOutbox : [];
      let sent = 0;
      while (sent < outbox.length && socket && socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(outbox[sent])); sent++; }
      if (sent) await set({ managerStatusOutbox: outbox.slice(sent) });
    } catch (_) { /* retain queued status updates for reconnect */ }
    finally { flushingStatuses = false; }
  }

  function send(value) { if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify(value)); } catch (_) {} } }
  function get(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); }
  function set(value) { return new Promise((resolve) => chrome.storage.local.set(value, resolve)); }
  function scheduleReconnect() {
    if (intentionallyClosed) return;
    const delay = Math.min(5 * (2 ** retryCount), 300) * 1000;
    retryCount = Math.min(retryCount + 1, 6);
    chrome.alarms.create(RETRY_ALARM, { when: Date.now() + delay + Math.random() * Math.min(delay * 0.2, 5000) });
  }
  function connectWithSavedCredential() {
    if (socket || connecting || intentionallyClosed) return;
    get(['managerCredential']).then((data) => {
      const credential = data.managerCredential;
      if (!credential || !isLoopbackUrl(credential.serverUrl)) { publish('disconnected'); return; }
      connecting = true; publish('connecting'); openSocket(credential.serverUrl, 'AUTH');
    });
  }

  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === RETRY_ALARM) { if (pendingPairCode && !intentionallyClosed) openSocket(`ws://127.0.0.1:${pairingPort(pendingPairCode)}`, 'PAIR'); else connectWithSavedCredential(); } });
  chrome.runtime.onStartup.addListener(connectWithSavedCredential);
  chrome.runtime.onInstalled.addListener(connectWithSavedCredential);
  connectWithSavedCredential();
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.action === 'MANAGER_CONNECT') {
      const code = typeof message.pairingCode === 'string' ? message.pairingCode.trim().toUpperCase() : '';
      if (!CODE_RE.test(code) || !pairingPort(code)) { respond({ success: false, error: 'Enter a valid pairing code in XXXX-XXXX format.' }); return; }
      chrome.alarms.clear(RETRY_ALARM);
      if (socket) { intentionallyClosed = true; socket.close(); socket = null; }
      intentionallyClosed = false; pendingPairCode = code; connecting = true; retryCount = 0;
      publish('connecting'); openSocket(`ws://127.0.0.1:${pairingPort(code)}`, 'PAIR'); respond({ success: true }); return;
    }
    if (message && message.action === 'MANAGER_DISCONNECT') {
      intentionallyClosed = true; connecting = false; pendingPairCode = null; retryCount = 0;
      chrome.alarms.clear(RETRY_ALARM);
      stopManagerQueuesForConnectionLoss();
      chrome.storage.local.remove(['managerCredential', 'managerStatusOutbox']);
      if (socket) { const ws = socket; socket = null; ws.close(); }
      publish('disconnected'); respond({ success: true }); return;
    }
    if (message && message.action === 'MANAGER_RECONNECT') { intentionallyClosed = false; retryCount = 0; connectWithSavedCredential(); respond({ success: true }); }
  });
  return { status, finish, finalizeRun, connectWithSavedCredential };
})();
