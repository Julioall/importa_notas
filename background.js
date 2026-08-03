'use strict';

const PENDING_DOWNLOADS = new Map();
const PENDING_DOWNLOAD_TTL = 3 * 60 * 1000;

function sanitizeRelativeDownloadPath(value) {
  return String(value || '')
    .split('/')
    .map(segment => segment
      .replace(/[<>:"\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 100))
    .filter(Boolean)
    .join('/')
    .slice(0, 480);
}

function cleanExpiredPendingDownloads() {
  const now = Date.now();
  for (const [token, item] of PENDING_DOWNLOADS.entries()) {
    if (!item || now - item.createdAt > PENDING_DOWNLOAD_TTL) {
      PENDING_DOWNLOADS.delete(token);
    }
  }
}

function validateRegistration(message) {
  if (!message || message.type !== 'mqi-register-pending-download') {
    throw new Error('Solicitação de nome de download inválida.');
  }

  const token = String(message.token || '').trim().toLowerCase();
  if (!/^[a-z0-9]{12,80}$/.test(token)) {
    throw new Error('Identificador de download inválido.');
  }

  const filename = sanitizeRelativeDownloadPath(message.filename);
  if (!filename || !filename.toLowerCase().endsWith('.zip')) {
    throw new Error('Nome do arquivo ZIP inválido.');
  }

  return { token, filename };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'mqi-register-pending-download') return false;

  try {
    cleanExpiredPendingDownloads();
    const request = validateRegistration(message);
    PENDING_DOWNLOADS.set(request.token, {
      filename: request.filename,
      createdAt: Date.now(),
    });
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
  }

  return false;
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  cleanExpiredPendingDownloads();
  const currentName = String(downloadItem.filename || '').split(/[\\/]/).pop() || '';
  const match = currentName.match(/^mqi-pending-([a-z0-9]{12,80})\.zip$/i);
  if (!match) return;

  const token = match[1].toLowerCase();
  const pending = PENDING_DOWNLOADS.get(token);
  if (!pending) return;

  PENDING_DOWNLOADS.delete(token);
  suggest({
    filename: pending.filename,
    conflictAction: 'uniquify',
  });
});
