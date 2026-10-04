/* Local ParthSeva protocol v1 bridge. The one-use pairing code encodes the
 * runtime-selected loopback port and is the only endpoint discovery mechanism. */
const ManagerBridge = (() => {
  try { chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }, () => void chrome.runtime.lastError); } catch (_) { /* older Chrome builds */ }
  const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  const PAIRING_PORT_MIN = 49152;
  const PAIRING_PORT_COUNT = 16384;
  const PAIRING_SECRET_SPACE = Math.floor(PAIRING_ALPHABET.length ** 8 / PAIRING_PORT_COUNT);
  const RETRY_ALARM = 'PARTHSEVA_RECONNECT';
  let socket = null;
  let retryCount = 0;
  let intentionallyClosed = false;
  let pendingPairCode = null;
  let connecting = false;
  let flushingStatuses = false;
  let pingTimer = null;
  let queueCommandChain = Promise.resolve();
  const stoppingRequests = new Set();
  const activeRemoteRequests = new Set();

  function publish(status, error = '') {
    chrome.storage.local.set({ managerConnectionStatus: status, managerConnectionError: error });
    try { chrome.runtime.sendMessage({ event: 'MANAGER_CONNECTION_CHANGED', status, error }, () => void chrome.runtime.lastError); } catch (_) { /* popup closed */ }
  }

  function isLoopbackWebSocket(value) {
    try {
      const url = new URL(value);
      const port = Number(url.port);
      return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && port >= PAIRING_PORT_MIN && port < PAIRING_PORT_MIN + PAIRING_PORT_COUNT && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    } catch (_) { return false; }
  }

  function sameLoopbackEndpoint(a, b) {
    try {
      const left = new URL(a);
      const right = new URL(b);
      return isLoopbackWebSocket(a) && isLoopbackWebSocket(b) && left.hostname === right.hostname && left.port === right.port && left.pathname === '/' && right.pathname === '/' && !left.search && !right.search && !left.hash && !right.hash;
    } catch (_) { return false; }
  }

  function pairingUrl(code) {
    if (typeof code !== 'string' || !/^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}-[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}$/.test(code)) return null;
    let value = 0;
    for (const char of code.replace('-', '')) value = value * PAIRING_ALPHABET.length + PAIRING_ALPHABET.indexOf(char);
    const offset = Math.floor(value / PAIRING_SECRET_SPACE);
    if (offset >= PAIRING_PORT_COUNT) return null;
    return `ws://127.0.0.1:${PAIRING_PORT_MIN + offset}`;
  }

  function openSocket(url, purpose) {
    let ws;
    try { ws = new WebSocket(url); } catch (_) { connecting = false; publish('disconnected', 'Could not reach ParthSeva Manager.'); return; }
    socket = ws;
    ws.onopen = async () => {
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: 'PING', requestId: `ext-${Date.now()}` }), 20000);
      const stored = await get(['managerCredential']);
      if (purpose === 'PAIR' && pendingPairCode) send({ type: 'PAIR', pairingCode: pendingPairCode });
      else if (stored.managerCredential) send({ type: 'AUTH', deviceId: stored.managerCredential.deviceId, sessionToken: stored.managerCredential.sessionToken });
      else { connecting = false; publish('disconnected'); try { ws.close(); } catch (_) {} }
    };
    ws.onmessage = (event) => handleFrame(event.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      clearInterval(pingTimer); pingTimer = null;
      if (socket === ws) socket = null;
      connecting = false;
      if (intentionallyClosed) return;
      activeRemoteRequests.forEach(requestId => stoppingRequests.add(requestId));
      publish('disconnected');
      pauseRemoteQueue();
      scheduleReconnect();
    };
  }

  function handleFrame(raw) {
    let data;
    try { if (typeof raw !== 'string' || raw.length > 1_000_000) throw new Error(); data = JSON.parse(raw); }
    catch (_) { send({ type: 'ERROR', requestId: 'malformed-json', code: 'MALFORMED_JSON', message: 'Malformed JSON.' }); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') { send({ type: 'ERROR', requestId: 'invalid-message', code: 'INVALID_MESSAGE', message: 'Invalid protocol message.' }); return; }
    if (data.type === 'PAIR_SUCCESS') {
      if (typeof data.deviceId !== 'string' || !data.deviceId || data.deviceId.length > 100 || typeof data.sessionToken !== 'string' || data.sessionToken.length < 40 || data.sessionToken.length > 200 || data.protocolVersion !== 1 || !socket || !sameLoopbackEndpoint(data.serverUrl, socket.url)) {
        pendingPairCode = null; connecting = false; publish('disconnected', 'The desktop returned invalid pairing credentials.'); return;
      }
      chrome.storage.local.set({ managerCredential: { deviceId: data.deviceId, sessionToken: data.sessionToken, serverUrl: data.serverUrl } }, () => {
        pendingPairCode = null; retryCount = 0; connecting = false; intentionallyClosed = false; publish('connected'); flushStatuses();
      });
      return;
    }
    if (data.type === 'PAIR_REJECTED' || data.type === 'AUTH_REJECTED') {
      const reason = typeof data.message === 'string' && data.message.trim()
        ? data.message.slice(0, 200)
        : (data.type === 'AUTH_REJECTED' ? 'Connection expired. Pair again.' : 'Pairing code is invalid or expired.');
      if (data.type === 'AUTH_REJECTED') {
        intentionallyClosed = true;
        chrome.alarms.clear(RETRY_ALARM);
        chrome.storage.local.remove('managerCredential');
        publish('expired', reason);
      } else { intentionallyClosed = true; pendingPairCode = null; connecting = false; chrome.alarms.clear(RETRY_ALARM); publish('disconnected', reason); }
      try { socket && socket.close(); } catch (_) {}
      return;
    }
    if (data.type === 'AUTH_SUCCESS' && data.protocolVersion === 1) { retryCount = 0; connecting = false; publish('connected'); flushStatuses(); return; }
    if (data.type === 'DISCONNECT') {
      intentionallyClosed = true; retryCount = 0; chrome.alarms.clear(RETRY_ALARM);
      void pauseRemoteQueue();
      chrome.storage.local.remove('managerCredential'); connecting = false;
      publish('disconnected', 'ParthSeva Manager disconnected this device. Pair again to reconnect.');
      try { socket && socket.close(); } catch (_) {}
      return;
    }
    if (data.type === 'START_SENDING') { queueCommandChain = queueCommandChain.then(() => acceptQueue(data)).catch(() => send({ type: 'ERROR', requestId: typeof data.requestId === 'string' ? data.requestId.slice(0, 100) : 'invalid-request', code: 'QUEUE_FAILED', message: 'Could not accept the sending queue.' })); return; }
    if (data.type === 'STOP_SENDING') { queueCommandChain = queueCommandChain.then(() => stopQueue(data)).catch(() => send({ type: 'ERROR', requestId: typeof data.requestId === 'string' ? data.requestId.slice(0, 100) : 'invalid-request', code: 'STOP_FAILED', message: 'Could not stop the sending queue.' })); return; }
    if (data.type === 'PING' && typeof data.requestId === 'string' && data.requestId.length > 0 && data.requestId.length <= 100) { send({ type: 'PONG', requestId: data.requestId }); return; }
    if (data.type === 'PONG' && typeof data.requestId === 'string' && data.requestId.length > 0 && data.requestId.length <= 100) return;
    send({ type: 'ERROR', requestId: typeof data.requestId === 'string' ? data.requestId.slice(0, 100) : 'invalid-command', code: 'UNKNOWN_COMMAND', message: 'Unknown command.' });
  }

  async function acceptQueue(data) {
    if (typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 100 || !Array.isArray(data.messages)) { send({ type: 'ERROR', requestId: 'invalid-request', code: 'INVALID_QUEUE', message: 'Invalid queue.' }); return; }
    if (!data.messages.length || data.messages.length > 5000) { send({ type: 'ERROR', requestId: data.requestId, code: 'QUEUE_INVALID', message: 'Queue must contain 1 to 5000 messages.' }); return; }
    const ids = new Set();
    for (const m of data.messages) {
      if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(key => !['id', 'name', 'phone', 'message'].includes(key)) || typeof m.id !== 'string' || !m.id.trim() || m.id.length > 100 || ids.has(m.id) ||
          typeof m.name !== 'string' || !m.name.trim() || m.name.length > 200 || typeof m.phone !== 'string' || !/^\+?[0-9 ()-]{10,24}$/.test(m.phone) || m.phone.replace(/\D/g, '').length < 10 || m.phone.replace(/\D/g, '').length > 15 ||
          typeof m.message !== 'string' || !m.message.trim() || m.message.length > 5000) {
        send({ type: 'ERROR', requestId: data.requestId, code: 'INVALID_QUEUE', message: 'Queue contains an invalid or duplicate message.' }); return;
      }
      ids.add(m.id);
    }
    const existing = await get(['managerRequests', 'queueState', 'queue']);
    const records = existing.managerRequests || {};
    if (records[data.requestId]) { send({ type: 'ERROR', requestId: data.requestId, code: 'DUPLICATE_REQUEST', message: 'Request was already received.' }); return; }
    const unfinishedQueue = Array.isArray(existing.queue) && existing.queue.some(item => item && (item.status === 'Pending' || item.status === 'Processing'));
    if (existing.queueState === 'running' || unfinishedQueue) { send({ type: 'ERROR', requestId: data.requestId, code: 'SENDER_BUSY', message: 'Finish or stop the current sender queue before starting a Manager queue.' }); return; }
    const queue = data.messages.map((m, index) => ({
      id: `manager-${data.requestId}-${index}`, index: index + 1, phone: m.phone.replace(/\D/g, ''), originalPhone: m.phone,
      name: m.name || '', messageTemplate: m.message, finalMessage: m.message, image: null, hasCommonImage: false,
      status: 'Pending', attempts: 0, error: null, createdAt: new Date().toISOString(), sentAt: null,
      managerRequestId: data.requestId, managerMessageId: m.id
    }));
    records[data.requestId] = { status: 'active', updatedAt: Date.now() };
    activeRemoteRequests.add(data.requestId);
    await set({ managerRequests: records, queue, queueCommonImage: null, queueState: 'running' });
    chrome.alarms.create('QUEUE_KEEPALIVE', { periodInMinutes: 0.5 });
    startQueueLoop();
  }

  async function stopQueue(data) {
    if (typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 100) { send({ type: 'ERROR', requestId: 'invalid-request', code: 'INVALID_REQUEST', message: 'Invalid request.' }); return; }
    const current = await get(['managerRequests', 'queue']);
    const rec = current.managerRequests && current.managerRequests[data.requestId];
    if (rec && (rec.status === 'active' || rec.status === 'stopping')) {
      stoppingRequests.add(data.requestId);
      rec.status = 'stopping';
      const queue = Array.isArray(current.queue) ? current.queue : [];
      const skipped = queue.filter(item => item && item.managerRequestId === data.requestId && item.status === 'Pending');
      skipped.forEach(item => { item.status = 'Skipped'; item.error = 'Stopped before sending.'; });
      await set({ managerRequests: current.managerRequests, queue, queueState: 'paused' });
      for (const item of skipped) await status(item, 'skipped');
      if (!isLoopRunning) await finishRequest(data.requestId, 'stopped');
    }
  }

  function status(item, value, errorCode) {
    if (!item || !item.managerRequestId || !item.managerMessageId) return Promise.resolve();
    const event = { type: 'STATUS', requestId: item.managerRequestId, messageId: item.managerMessageId, status: value };
    if (errorCode) event.errorCode = errorCode;
    return get(['managerStatusOutbox']).then(async data => {
      const outbox = Array.isArray(data.managerStatusOutbox) ? data.managerStatusOutbox : [];
      outbox.push(event);
      await set({ managerStatusOutbox: outbox.slice(-10000) });
      flushStatuses();
    });
  }

  async function finishRequest(requestId, value) {
    stoppingRequests.delete(requestId);
    activeRemoteRequests.delete(requestId);
    const data = await get(['managerRequests']);
    const records = data.managerRequests || {};
    if (records[requestId]) { records[requestId].status = value; records[requestId].updatedAt = Date.now(); await set({ managerRequests: records }); }
    const event = { type: 'STATUS', requestId, status: value };
    const outboxData = await get(['managerStatusOutbox']);
    const outbox = Array.isArray(outboxData.managerStatusOutbox) ? outboxData.managerStatusOutbox : [];
    outbox.push(event);
    await set({ managerStatusOutbox: outbox.slice(-10000) });
    flushStatuses();
  }

  async function pauseRemoteQueue(requestId) {
    const data = await get(['queue', 'queueState', 'managerRequests']);
    const remoteItem = Array.isArray(data.queue) && data.queue.find(item => item && item.managerRequestId && (!requestId || item.managerRequestId === requestId));
    if (!remoteItem || data.queueState !== 'running') return;
    stoppingRequests.add(remoteItem.managerRequestId);
    const records = data.managerRequests || {};
    const record = records[remoteItem.managerRequestId];
    if (record && record.status === 'active') record.status = 'stopping';
    await set({ queueState: 'paused', managerRequests: records });
  }

  async function flushStatuses() {
    if (flushingStatuses || !socket || socket.readyState !== WebSocket.OPEN) return;
    flushingStatuses = true;
    try {
      const data = await get(['managerStatusOutbox']);
      const outbox = Array.isArray(data.managerStatusOutbox) ? data.managerStatusOutbox : [];
      let sent = 0;
      while (sent < outbox.length && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(outbox[sent])); sent++;
      }
      if (sent) await set({ managerStatusOutbox: outbox.slice(sent) });
    } catch (_) { /* retained for the next authenticated connection */ }
    finally { flushingStatuses = false; }
  }

  function send(value) { if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify(value)); } catch (_) {} } }
  function canStart(item) { return !item || !item.managerRequestId || (socket && socket.readyState === WebSocket.OPEN && !stoppingRequests.has(item.managerRequestId)); }
  function get(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
  function set(value) { return new Promise(resolve => chrome.storage.local.set(value, resolve)); }
  function scheduleReconnect() {
    if (intentionallyClosed) return;
    const delay = Math.min(5 * (2 ** retryCount), 300) * 1000;
    retryCount++;
    chrome.alarms.create(RETRY_ALARM, { when: Date.now() + delay });
  }
  function connectWithSavedCredential() {
    if (socket || connecting || intentionallyClosed) return;
    get(['managerCredential']).then(data => {
      if (!data.managerCredential) { publish('disconnected'); return; }
      if (!isLoopbackWebSocket(data.managerCredential.serverUrl) || typeof data.managerCredential.deviceId !== 'string' || typeof data.managerCredential.sessionToken !== 'string') {
        chrome.storage.local.remove('managerCredential'); publish('expired', 'Connection expired. Pair again.'); return;
      }
      connecting = true; publish('connecting'); openSocket(data.managerCredential.serverUrl, 'AUTH');
    });
  }

  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === RETRY_ALARM) connectWithSavedCredential(); });
  chrome.runtime.onStartup.addListener(connectWithSavedCredential);
  chrome.runtime.onInstalled.addListener(connectWithSavedCredential);
  connectWithSavedCredential();
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.action === 'MANAGER_CONNECT') {
      const code = typeof message.pairingCode === 'string' ? message.pairingCode.trim().toUpperCase() : '';
      const url = pairingUrl(code);
      if (!url) { respond({ success: false, error: 'Enter a valid XXXX-XXXX pairing code.' }); return; }
      intentionallyClosed = false; pendingPairCode = code; connecting = true; retryCount = 0; publish('connecting'); openSocket(url, 'PAIR'); respond({ success: true }); return;
    }
    if (message && message.action === 'MANAGER_DISCONNECT') {
      intentionallyClosed = true; connecting = false; pendingPairCode = null; retryCount = 0;
      chrome.alarms.clear(RETRY_ALARM); chrome.storage.local.remove(['managerCredential']);
      void pauseRemoteQueue();
      if (socket) { const ws = socket; socket = null; ws.close(); }
      publish('disconnected'); respond({ success: true }); return;
    }
    if (message && message.action === 'MANAGER_RECONNECT') { intentionallyClosed = false; retryCount = 0; connectWithSavedCredential(); respond({ success: true }); }
  });
  return { status, finishRequest, canStart, pauseRemoteQueue, connectWithSavedCredential };
})();
