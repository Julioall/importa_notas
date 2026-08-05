(() => {
  'use strict';

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function setStep(modal, step) {
    const panel = modal.querySelector('#mqi-panel-import');
    if (!panel) return;
    panel.dataset.mqiFlowStep = String(step);

    panel.querySelectorAll('[data-mqi-step]').forEach(item => {
      const active = Number(item.dataset.mqiStep) === step;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-current', active ? 'step' : 'false');
    });

    panel.querySelectorAll('.mqi-flow-page').forEach(page => {
      const active = Number(page.dataset.stepPage) === step;
      page.hidden = !active;
      page.classList.toggle('is-active', active);
    });

    const body = modal.querySelector('.mqi-modal-body');
    if (body) body.scrollTop = 0;
  }

  function resetFlow(modal) {
    const input = modal.querySelector('#mqi-file');
    const fileName = modal.querySelector('#mqi-file-name');
    const trigger = modal.querySelector('#mqi-file-trigger');
    const apply = modal.querySelector('#mqi-apply-import');
    const validation = modal.querySelector('#mqi-flow-validation-content');
    const execution = modal.querySelector('#mqi-flow-execution-content');

    if (input) input.value = '';
    if (fileName) {
      fileName.textContent = '';
      fileName.hidden = true;
    }
    if (trigger) {
      trigger.classList.remove('has-file', 'is-dragover');
      const title = trigger.querySelector('.mqi-dropzone__title');
      const hint = trigger.querySelector('.mqi-dropzone__hint');
      if (title) title.textContent = 'Arraste e solte o arquivo aqui';
      if (hint) hint.textContent = 'ou clique para escolher';
    }
    if (apply) apply.disabled = true;
    if (validation) validation.innerHTML = '<p class="mqi-flow-empty">Selecione um arquivo para iniciar a validação.</p>';
    if (execution) execution.innerHTML = processing('Preparando o preenchimento...', 'Aguarde enquanto os dados são aplicados à página.');
    setStep(modal, 1);
  }

  function processing(title, description) {
    return `<div class="mqi-flow-processing"><span class="mqi-flow-spinner" aria-hidden="true"></span><strong>${title}</strong><small>${description}</small></div>`;
  }

  function copyValidation(modal) {
    const log = modal.querySelector('#mqi-log');
    const target = modal.querySelector('#mqi-flow-validation-content');
    if (!log || !target || log.hidden || !text(log.textContent)) return false;
    target.className = `mqi-flow-result ${log.className}`;
    target.innerHTML = log.innerHTML;
    return true;
  }

  function copyExecution(modal) {
    const log = modal.querySelector('#mqi-log');
    const target = modal.querySelector('#mqi-flow-execution-content');
    if (!log || !target || log.hidden || !text(log.textContent)) return false;
    target.innerHTML = `<div class="mqi-flow-complete-mark" aria-hidden="true">✓</div><div class="mqi-flow-complete-copy"><strong>Preenchimento concluído</strong><div class="mqi-flow-result ${log.className}">${log.innerHTML}</div><small>Revise os campos e use o botão nativo do Moodle para salvar.</small></div>`;
    return true;
  }

  function installLogObserver(modal) {
    const log = modal.querySelector('#mqi-log');
    if (!log) return;

    const observer = new MutationObserver(() => {
      const panel = modal.querySelector('#mqi-panel-import');
      if (!panel || panel.hidden) return;
      const step = Number(panel.dataset.mqiFlowStep || 1);

      if (step === 1 && copyValidation(modal)) {
        const input = modal.querySelector('#mqi-file');
        if (input?.files?.length) setStep(modal, 2);
      } else if (step === 2) {
        copyValidation(modal);
      } else if (step === 3) {
        copyExecution(modal);
      }
    });

    observer.observe(log, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function buildFlow(modal) {
    if (!modal || modal.dataset.mqiFlowInitialized === 'true') return;
    const panel = modal.querySelector('#mqi-panel-import');
    if (!panel) return;

    const intro = panel.querySelector('.mqi-panel-intro');
    const checks = [...panel.querySelectorAll(':scope > .mqi-check')];
    const prompt = panel.querySelector('.mqi-prompt-field');
    const fileField = panel.querySelector('.mqi-file-field');
    const actions = panel.querySelector('.mqi-actions--single');
    const apply = panel.querySelector('#mqi-apply-import');
    const log = modal.querySelector('#mqi-log');
    if (!fileField || !actions || !apply || !log) return;

    modal.dataset.mqiFlowInitialized = 'true';

    const stepper = document.createElement('ol');
    stepper.className = 'mqi-flow-stepper';
    stepper.setAttribute('aria-label', 'Etapas da importação');
    stepper.innerHTML = '<li data-mqi-step="1" class="is-active" aria-current="step"><span>1</span><strong>Adicionar</strong></li><li data-mqi-step="2"><span>2</span><strong>Validar</strong></li><li data-mqi-step="3"><span>3</span><strong>Executar</strong></li>';

    const page1 = document.createElement('section');
    page1.className = 'mqi-flow-page is-active';
    page1.dataset.stepPage = '1';
    page1.innerHTML = '<div class="mqi-flow-heading"><h3>Adicionar arquivo</h3><p>Escolha o arquivo com as correções que serão conferidas antes do preenchimento.</p></div>';
    intro?.remove();
    checks.forEach(check => page1.appendChild(check));
    if (prompt) page1.appendChild(prompt);
    page1.appendChild(fileField);

    const page2 = document.createElement('section');
    page2.className = 'mqi-flow-page';
    page2.dataset.stepPage = '2';
    page2.hidden = true;
    page2.innerHTML = '<div class="mqi-flow-heading"><h3>Validar arquivo</h3><p>Confira as correspondências antes de alterar os campos do Moodle.</p></div><div id="mqi-flow-validation-content" class="mqi-flow-result"><p class="mqi-flow-empty">Selecione um arquivo para iniciar a validação.</p></div><div class="mqi-flow-actions"><button type="button" id="mqi-flow-back" class="mqi-flow-secondary">Voltar</button></div>';
    actions.classList.add('mqi-flow-execute-actions');
    apply.textContent = 'Executar preenchimento';
    apply.disabled = true;
    page2.querySelector('.mqi-flow-actions').appendChild(actions);

    const page3 = document.createElement('section');
    page3.className = 'mqi-flow-page';
    page3.dataset.stepPage = '3';
    page3.hidden = true;
    page3.innerHTML = `<div class="mqi-flow-heading"><h3>Executar</h3><p>Acompanhe o resultado do preenchimento da página atual.</p></div><div id="mqi-flow-execution-content" class="mqi-flow-execution-content">${processing('Preparando o preenchimento...', 'Aguarde enquanto os dados são aplicados à página.')}</div><div class="mqi-flow-actions mqi-flow-actions--end"><button type="button" id="mqi-flow-finish" class="primary">Concluir</button></div>`;

    panel.replaceChildren(stepper, page1, page2, page3);
    log.hidden = true;
    log.classList.add('mqi-flow-source-log');

    const input = modal.querySelector('#mqi-file');
    input?.addEventListener('change', () => {
      if (!input.files?.length) return;
      const validation = modal.querySelector('#mqi-flow-validation-content');
      if (validation) validation.innerHTML = processing('Validando arquivo...', 'Comparando os registros com os alunos exibidos no Moodle.');
    });

    page2.querySelector('#mqi-flow-back').addEventListener('click', () => resetFlow(modal));

    apply.addEventListener('click', () => {
      setStep(modal, 3);
      const execution = modal.querySelector('#mqi-flow-execution-content');
      if (execution) execution.innerHTML = processing('Preenchendo a página...', 'Não feche esta janela durante o processamento.');
      setTimeout(() => copyExecution(modal), 100);
    }, { capture: true });

    page3.querySelector('#mqi-flow-finish').addEventListener('click', () => modal.querySelector('#mqi-close')?.click());

    installLogObserver(modal);
    resetFlow(modal);
  }

  const observer = new MutationObserver(() => {
    const modal = document.getElementById('mqi-modal');
    if (modal) buildFlow(modal);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const existing = document.getElementById('mqi-modal');
  if (existing) buildFlow(existing);
})();
