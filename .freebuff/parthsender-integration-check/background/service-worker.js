/**
 * Background Service Worker for WhatsApp Bulk Sender
 * Manages persistent sending queue, WhatsApp tab state, and pacing delays.
 */

importScripts('manager-bridge.js');

let isLoopRunning = false;

// Extension Installation & Startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background SW] Extension installed');
  initializeStorage();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background SW] Extension started');
  checkAndResumeQueue();
});

// Periodic alarm keepalive to prevent Manifest V3 Service Worker termination during 500+ queues
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'QUEUE_KEEPALIVE') {
    checkAndResumeQueue();
  }
});

function setupKeepAliveAlarm(enable) {
  if (enable) {
    chrome.alarms.create('QUEUE_KEEPALIVE', { periodInMinutes: 0.5 });
  } else {
    chrome.alarms.clear('QUEUE_KEEPALIVE');
  }
}

function initializeStorage() {
  chrome.storage.local.get(['pacingDelay', 'skipDuplicates', 'queueState', 'history'], (data) => {
    const updates = {};
    if (data.pacingDelay === undefined) updates.pacingDelay = 10;
    if (data.skipDuplicates === undefined) updates.skipDuplicates = true;
    if (data.queueState === undefined) updates.queueState = 'idle';
    if (!Array.isArray(data.history)) updates.history = [];
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
}

function checkAndResumeQueue() {
  chrome.storage.local.get(['queueState', 'queue'], (data) => {
    if (data.queueState === 'running' && Array.isArray(data.queue) && data.queue.length > 0) {
      const hasPending = data.queue.some(item => item.status === 'Pending' || item.status === 'Processing');
      if (hasPending) {
        if (!isLoopRunning) {
          console.log('[Background SW] Resuming queue from background check');
          startQueueLoop();
        }
      } else {
        chrome.storage.local.set({ queueState: 'completed' });
        setupKeepAliveAlarm(false);
      }
    } else {
      setupKeepAliveAlarm(false);
    }
  });
}

// Listen to messages from Popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;
  // Manager actions are handled by the separate bridge listener.
  if (typeof action === 'string' && action.startsWith('MANAGER_')) return false;

  switch (action) {
    case 'START_QUEUE':
      setupKeepAliveAlarm(true);
      chrome.storage.local.set({ queueState: 'running' }, () => {
        startQueueLoop();
        sendResponse({ success: true, message: 'Queue started' });
      });
      return true;

    case 'PAUSE_QUEUE':
      setupKeepAliveAlarm(false);
      chrome.storage.local.set({ queueState: 'paused' }, () => {
        isLoopRunning = false;
        sendResponse({ success: true, message: 'Queue paused' });
      });
      return true;

    case 'RESUME_QUEUE':
      setupKeepAliveAlarm(true);
      chrome.storage.local.set({ queueState: 'running' }, () => {
        startQueueLoop();
        sendResponse({ success: true, message: 'Queue resumed' });
      });
      return true;

    case 'STOP_QUEUE':
      setupKeepAliveAlarm(false);
      chrome.storage.local.set({ queueState: 'idle' }, () => {
        isLoopRunning = false;
        sendResponse({ success: true, message: 'Queue stopped' });
      });
      return true;

    case 'GET_STATUS':
      chrome.storage.local.get(['queue', 'queueState', 'pacingDelay'], (data) => {
        sendResponse({
          queueState: data.queueState || 'idle',
          queue: data.queue || [],
          pacingDelay: data.pacingDelay || 10,
          isLoopRunning
        });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
      return false;
  }
});

/**
 * Main queue processing loop
 */
async function startQueueLoop() {
  if (isLoopRunning) {
    console.log('[Background SW] Loop already active');
    return;
  }

  isLoopRunning = true;
  console.log('[Background SW] Queue loop active');

  try {
    while (isLoopRunning) {
      const storageData = await getStorageData(['queue', 'queueState', 'pacingDelay', 'history', 'queueCommonImage']);
      const { queueState, pacingDelay = 10, queueCommonImage = null } = storageData;
      let queue = storageData.queue || [];
      let history = storageData.history || [];

      if (queueState !== 'running') {
        console.log(`[Background SW] Queue loop stopped. State: ${queueState}`);
        break;
      }

      const itemIndex = queue.findIndex(item => item.status === 'Pending' || item.status === 'Processing');
      if (itemIndex === -1) {
        console.log('[Background SW] All items processed. Campaign complete.');
        await setStorageData({ queueState: 'completed' });
        notifyPopup('CAMPAIGN_COMPLETED');
        break;
      }

      const item = queue[itemIndex];
      if (!ManagerBridge.canStart(item)) {
        await ManagerBridge.pauseRemoteQueue(item.managerRequestId);
        await setStorageData({ queueState: 'paused' });
        break;
      }
      console.log(`[Background SW] Processing item ${itemIndex + 1}/${queue.length}: ${item.phone}`);
      await ManagerBridge.status(item, 'sending');

      queue[itemIndex].status = 'Processing';
      queue[itemIndex].attempts = (queue[itemIndex].attempts || 0) + 1;
      await setStorageData({ queue });
      notifyPopup('QUEUE_UPDATED');

      const whatsappTab = await getOrOpenWhatsAppTab();
      if (!whatsappTab) {
        queue[itemIndex].status = 'Failed';
        queue[itemIndex].error = 'Could not open or access WhatsApp Web tab';
        await setStorageData({ queue });
        await ManagerBridge.status(item, 'failed', 'SEND_FAILED');
        notifyPopup('QUEUE_UPDATED');
        break;
      }

      // Determine if this item has an image (check both inline image and common-image flag)
      const hasImage = item.hasCommonImage || !!item.image;

      // For text-only: pre-fill text via URL param so WhatsApp auto-populates compose box.
      // For image: navigate without text param (text goes into caption box by content script).
      const targetUrl = hasImage
        ? `https://web.whatsapp.com/send?phone=${item.phone}`
        : `https://web.whatsapp.com/send?phone=${item.phone}&text=${encodeURIComponent(item.finalMessage || '')}`;

      console.log(`[Background SW] Navigating to phone ${item.phone} (hasImage: ${hasImage})`);

      // Ensure content script is alive BEFORE navigating
      const csReady = await waitForContentScript(whatsappTab.id, 20000);
      if (!csReady) {
        // Content script not available yet — do a hard nav to load WhatsApp properly
        console.warn('[Background SW] Content script not ready, falling back to hard navigation...');
        await updateTabUrlAndWait(whatsappTab.id, targetUrl);
        await sleep(4000);
      } else {
        // Use SPA navigation via content script — WhatsApp Web handles window.location changes
        // internally via its router WITHOUT a full page reload, so the session stays alive.
        // Hard reloads (chrome.tabs.update) on every contact cause WhatsApp logout.
        await sendMessageToTab(whatsappTab.id, {
          action: 'NAVIGATE_TO_PHONE',
          payload: { url: targetUrl }
        });
        await sleep(2500);
      }

      // Re-verify content script is still responsive after navigation
      const csReadyAfterNav = await waitForContentScript(whatsappTab.id, 15000);
      if (!csReadyAfterNav) {
        console.warn('[Background SW] Content script lost after navigation. Marking Failed.');
        queue[itemIndex].status = 'Failed';
        queue[itemIndex].error = 'Content script not ready after navigation';
        await setStorageData({ queue });
        await ManagerBridge.status(item, 'failed', 'SEND_FAILED');
        notifyPopup('QUEUE_UPDATED');
        continue;
      }

      // Resolve the effective image for this item:
      // hasCommonImage flag means the image is stored once in queueCommonImage (avoids per-item quota breach)
      const effectiveImage = item.hasCommonImage ? queueCommonImage : (item.image || null);

      // Trigger message send in Content Script
      const sendResult = await sendMessageToTab(whatsappTab.id, {
        action: 'SEND_MESSAGE',
        payload: {
          phone: item.phone,
          text: item.finalMessage,
          image: effectiveImage
        }
      });

      const freshData = await getStorageData(['queue', 'history']);
      queue = freshData.queue || queue;
      history = freshData.history || history;

      if (sendResult && sendResult.success) {
        queue[itemIndex].status = 'Sent';
        queue[itemIndex].sentAt = new Date().toISOString();
        queue[itemIndex].error = null;

        if (item.phone && !history.includes(item.phone)) {
          history.push(item.phone);
        }
      } else {
        queue[itemIndex].status = 'Failed';
        queue[itemIndex].error = sendResult ? sendResult.error : 'No response from WhatsApp Web tab';
      }

      await setStorageData({ queue, history });
      await ManagerBridge.status(item, sendResult && sendResult.success ? 'sent' : 'failed', sendResult && sendResult.success ? undefined : 'SEND_FAILED');
      notifyPopup('QUEUE_UPDATED');

      const checkState = await getStorageData(['queueState']);
      if (checkState.queueState !== 'running') {
        console.log('[Background SW] Queue state changed; exiting loop');
        break;
      }

      const delayMs = Math.max(3, parseInt(pacingDelay, 10) || 10) * 1000;
      console.log(`[Background SW] Waiting pacing delay: ${delayMs / 1000}s`);
      await sleep(delayMs);
    }
  } catch (err) {
    console.error('[Background SW] Queue loop error:', err);
  } finally {
    const endingData = await getStorageData(['queue', 'queueState', 'managerRequests']);
    const remoteItem = (endingData.queue || []).find(item => item && item.managerRequestId);
    if (remoteItem) {
      const record = endingData.managerRequests && endingData.managerRequests[remoteItem.managerRequestId];
      const terminalStatus = endingData.queueState === 'completed' ? 'completed' : (record && record.status === 'stopping' ? 'stopped' : null);
      if (terminalStatus) await ManagerBridge.finishRequest(remoteItem.managerRequestId, terminalStatus);
    }
    isLoopRunning = false;
    console.log('[Background SW] Queue loop ended');
  }
}

async function getOrOpenWhatsAppTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const tab = tabs[0];
        chrome.tabs.update(tab.id, { active: true }, () => resolve(tab));
      } else {
        chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: true }, (newTab) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => resolve(newTab), 3500);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
  });
}

function updateTabUrlAndWait(tabId, targetUrl, timeoutMs = 25000) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(false);
        }
      }, timeoutMs);

      const listener = (tId, changeInfo) => {
        if (tId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(true);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url: targetUrl, active: true });
    });
  });
}

function sendMessageToTab(tabId, message, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: 'Tab messaging timeout (45s)' });
      }
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          console.warn('[Background SW] tab sendMessage error:', chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message || 'Content script unreachable' });
        } else {
          resolve(response || { success: false, error: 'Empty response from content script' });
        }
      }
    });
  });
}

/**
 * Pings the content script with retries until it responds or times out.
 * Returns true if content script is alive, false on timeout.
 */
function waitForContentScript(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function ping() {
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not ready yet, retry after 700ms
          setTimeout(ping, 700);
        } else {
          resolve(true);
        }
      });
    }
    ping();
  });
}

function notifyPopup(event) {
  // NOTE: chrome.runtime.sendMessage does NOT return a Promise in MV3 service workers.
  // Do NOT use .catch() here — it will throw a TypeError and crash the queue loop.
  try {
    chrome.runtime.sendMessage({ event }, () => {
      // Suppress "Could not establish connection" errors when popup is closed
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // Popup is not open — safe to ignore
  }
}

function getStorageData(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res || {})));
}

function setStorageData(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('Quota')) {
          console.error('Storage quota exceeded in background, clearing data');
          chrome.storage.local.clear(() => {
            chrome.storage.local.set(obj, () => {
              if (chrome.runtime.lastError) {
                console.error('Storage set error after clear:', chrome.runtime.lastError);
              }
              resolve(true);
            });
          });
        } else {
          console.error('Storage set error:', chrome.runtime.lastError);
          resolve(true);
        }
      } else {
        resolve(true);
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
