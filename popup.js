'use strict';

const SETTINGS_DEFAULTS = Object.freeze({
  coursePendingChecks: true,
  categoryPendingChecks: true,
  pendingBadges: true,
  pendingDownloads: true,
});

const MOODLE_HOSTS = new Set(['ead.fieg.com.br', 'ead.senai.br']);
const inputs = [...document.querySelectorAll('input[data-setting]')];
const status = document.getElementById('status');
const saveButton = document.getElementById('save-settings');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function readSettings() {
  return new Promise(resolve => {
    if (!globalThis.chrome?.storage?.local) {
      resolve({ ...SETTINGS_DEFAULTS });
      return;
    }

    chrome.storage.local.get(SETTINGS_DEFAULTS, values => {
      resolve(Object.fromEntries(Object.keys(SETTINGS_DEFAULTS).map(key => [
        key,
        typeof values[key] === 'boolean' ? values[key] : SETTINGS_DEFAULTS[key],
      ])));
    });
  });
}

function writeSettings(settings) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.set(settings, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve();
    });
  });
}

function applySettings(settings) {
  inputs.forEach(input => {
    input.checked = Boolean(settings[input.dataset.setting]);
  });
}

function currentSettings() {
  return Object.fromEntries(inputs.map(input => [input.dataset.setting, input.checked]));
}

function isMoodleTab(tab) {
  try {
    const url = new URL(tab?.url || '');
    return url.protocol === 'https:' && MOODLE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function reloadMoodleTab() {
  if (!globalThis.chrome?.tabs?.query) return Promise.resolve(false);

  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (!tab?.id || !isMoodleTab(tab) || !chrome.tabs.reload) {
        resolve(false);
        return;
      }
      chrome.tabs.reload(tab.id, {}, () => resolve(true));
    });
  });
}

async function saveAndApply() {
  saveButton.disabled = true;
  try {
    await writeSettings(currentSettings());
    setStatus('Salvo. Recarregando o Moodle…');
    const reloaded = await reloadMoodleTab();
    if (!reloaded) setStatus('Salvo. Abra uma página do Moodle para aplicar.');
  } catch (error) {
    setStatus(`Não foi possível salvar: ${error?.message || error}`, true);
    saveButton.disabled = false;
  }
}

async function initialize() {
  try {
    applySettings(await readSettings());
    setStatus('Escolha as opções e clique em salvar.');
    saveButton.addEventListener('click', saveAndApply);
  } catch (error) {
    setStatus(`Não foi possível carregar: ${error?.message || error}`, true);
  }
}

initialize();
