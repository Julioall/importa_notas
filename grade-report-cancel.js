(() => {
  'use strict';

  const STATE = {
    running: false,
    cancelled: false,
    controllers: new Set(),
  };

  const nativeFetch = window.fetch.bind(window);

  function isGradeReportRequest(input) {
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, location.href);
      return url.origin === location.origin && url.pathname === '/grade/report/grader/index.php';
    } catch {
      return false;
    }
  }

  function createAbortError() {
    return new DOMException('Geração do relatório cancelada.', 'AbortError');
  }

  window.fetch = function mqiCancelableFetch(input, init = {}) {
    if (!STATE.running || !isGradeReportRequest(input)) {
      return nativeFetch(input, init);
    }

    if (STATE.cancelled) return Promise.reject(createAbortError());

    const controller = new AbortController();
    const externalSignal = init?.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);

    if (externalSignal) {
      if (externalSignal.aborted) abortFromExternal();
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }

    STATE.controllers.add(controller);

    return nativeFetch(input, { ...init, signal: controller.signal })
      .finally(() => {
        STATE.controllers.delete(controller);
        externalSignal?.removeEventListener?.('abort', abortFromExternal);
      });
  };

  function ensureCancelButton() {
    const actions = document.querySelector('.mqi-grade-report-toolbar__actions');
    if (!actions || document.getElementById('mqi-grade-report-cancel')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'mqi-grade-report-cancel';
    button.className = 'btn btn-secondary';
    button.textContent = 'Cancelar';
    button.hidden = true;
    button.addEventListener('click', cancelReport);

    const generateButton = document.getElementById('mqi-grade-report-generate');
    actions.insertBefore(button, generateButton || null);
  }

  function setCancelButtonVisible(visible) {
    const button = document.getElementById('mqi-grade-report-cancel');
    if (!button) return;
    button.hidden = !visible;
    button.disabled = !visible || STATE.cancelled;
    button.textContent = STATE.cancelled ? 'Cancelando...' : 'Cancelar';
  }

  function setCancelledStatus() {
    const status = document.getElementById('mqi-grade-report-status');
    if (!status) return;
    status.hidden = false;
    status.className = 'mqi-grade-report-status mqi-grade-report-status--warning';
    status.textContent = 'Criação do relatório cancelada. Nenhum arquivo foi gerado.';
  }

  function cancelReport() {
    if (!STATE.running || STATE.cancelled) return;
    STATE.cancelled = true;
    setCancelButtonVisible(true);
    STATE.controllers.forEach((controller) => controller.abort(createAbortError()));
    STATE.controllers.clear();
    setCancelledStatus();
  }

  function beginGeneration() {
    STATE.running = true;
    STATE.cancelled = false;
    STATE.controllers.clear();
    setCancelButtonVisible(true);
  }

  function finishGeneration() {
    const wasCancelled = STATE.cancelled;
    STATE.running = false;
    STATE.controllers.clear();
    setCancelButtonVisible(false);
    if (wasCancelled) setCancelledStatus();
  }

  document.addEventListener('click', (event) => {
    const generateButton = event.target.closest?.('#mqi-grade-report-generate');
    if (generateButton && !generateButton.disabled) beginGeneration();

    const download = event.target.closest?.('a[download^="Relatório de Notas"]');
    if (download && STATE.cancelled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      download.remove();
      setCancelledStatus();
    }
  }, true);

  const observer = new MutationObserver(() => {
    ensureCancelButton();

    const generateButton = document.getElementById('mqi-grade-report-generate');
    if (!generateButton || !STATE.running) return;

    if (!generateButton.disabled) finishGeneration();
    else if (STATE.cancelled) setCancelledStatus();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'class'],
  });

  ensureCancelButton();
})();
