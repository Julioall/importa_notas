(() => {
  'use strict';

  const VERSION = '2.0.0';

  const STATE = {
    records: [],
    fileName: '',
    validationWarnings: [],
    lastReport: null,
  };

  const COURSE_BADGE_STATE = {
    results: new Map(),
    inFlight: new Map(),
    scanTimer: null,
  };

  // As contagens ficam somente em memória para cada carregamento. Não reutilizar
  // sessionStorage evita que categoria e curso compartilhem uma leitura antiga.
  const CATEGORY_PENDING_STATE = {
    results: new Map(),
    inFlight: new Map(),
    scanTimer: null,
  };

  const BULK_DOWNLOAD_STATE = {
    running: false,
  };

  const PENDING_FEATURE_DEFAULTS = Object.freeze({
    coursePendingChecks: true,
    categoryPendingChecks: true,
    pendingBadges: true,
    pendingDownloads: true,
  });
  let PENDING_FEATURES = { ...PENDING_FEATURE_DEFAULTS };

  function loadPendingFeatureSettings() {
    if (!globalThis.chrome?.storage?.local) return Promise.resolve();

    return new Promise(resolve => {
      chrome.storage.local.get(PENDING_FEATURE_DEFAULTS, values => {
        PENDING_FEATURES = Object.fromEntries(Object.keys(PENDING_FEATURE_DEFAULTS).map(key => [
          key,
          typeof values[key] === 'boolean' ? values[key] : PENDING_FEATURE_DEFAULTS[key],
        ]));
        resolve();
      });
    });
  }

  function pendingFeatureEnabled(name) {
    return PENDING_FEATURES[name] !== false;
  }

  const COLUMN_ALIASES = {
    nome: [
      'nome', 'aluno', 'estudante', 'discente', 'nome do aluno',
      'nome completo', 'nome do estudante', 'estudante nome'
    ],
    nota: [
      'nota', 'grade', 'pontuacao', 'pontuação', 'score',
      'nota sugerida', 'nota final', 'pontuacao sugerida', 'pontuação sugerida'
    ],
    feedback: [
      'feedback', 'comentario', 'comentário', 'comentarios', 'comentários',
      'comentario de feedback', 'comentário de feedback', 'comentarios de feedback',
      'comentários de feedback', 'observacao', 'observação', 'retorno', 'devolutiva'
    ],
    situacao: [
      'situacao', 'situação', 'status', 'tag', 'classificacao', 'classificação',
      'resultado', 'analise', 'análise', 'diagnostico', 'diagnóstico'
    ]
  };

  const SITUATIONS = [
    { value: '', label: 'Sem tag', tone: 'neutral', alert: false },
    { value: 'corrigido', label: 'Corrigido', tone: 'info', alert: false },
    { value: 'atensao', label: 'Atensão', tone: 'warning', alert: true },
    { value: 'perigo', label: 'Perigo', tone: 'danger', alert: true }
  ];

  const SITUATION_SYNONYMS = {
    corrigido: [
      'corrigido', 'ok', 'satisfatorio', 'satisfatório',
      'concluido', 'concluído', 'atendido',
      'revisao necessaria', 'revisão necessária',
      'precisa revisar', 'requer revisao', 'requer revisão', 'pendente'
    ],
    atensao: [
      'atensao', 'atensão', 'atenção',
      'sem conteudo relevante', 'sem conteúdo relevante',
      'conteudo irrelevante', 'conteúdo irrelevante',
      'sem conteudo', 'sem conteúdo'
    ],
    perigo: [
      'perigo', 'erro no arquivo', 'arquivo com erro',
      'arquivo invalido', 'arquivo inválido', 'arquivo corrompido',
      'erro arquivo', 'sem envio valido', 'sem envio válido',
      'sem entrega', 'nao enviado', 'não enviado'
    ]
  };

  const TEMPLATE_CSV = [
    'nome;nota;feedback;situacao',
    'Nome Completo do Aluno;45;Feedback objetivo e individualizado para o aluno.;Corrigido',
    'Outro Aluno;;O arquivo enviado é válido, mas não apresenta o conteúdo solicitado na atividade.;Atensão',
    'Outro Aluno 2;;Não foi possível ler o arquivo enviado. Envie novamente em um formato válido.;Perigo'
  ].join('\n');

  const CORRECTION_PROMPT = [
    'Atue como um tutor acolhedor e criterioso, seguindo as orientações do Guia do Tutor, e corrija as atividades dos alunos.',
    'Gere um ARQUIVO CSV para download e importação no Moodle.',
    '',
    'Retorne somente o conteúdo do CSV, sem Markdown e sem texto adicional.',
    'Use ponto e vírgula como separador.',
    'O único cabeçalho obrigatório é nome. Inclua ao menos uma destas colunas: nota, feedback ou situacao.',
    'Formato completo recomendado:',
    'nome;nota;feedback;situacao',
    'Quando não houver nota, também é aceito:',
    'nome;feedback;situacao',
    '',
    'A coluna situacao deve usar somente uma destas três tags:',
    '- Corrigido',
    '- Atensão',
    '- Perigo',
    '',
    'Regras gerais:',
    '- Preserve o nome do aluno exatamente como aparece na listagem do Moodle.',
    '- Não invente alunos ausentes na lista de envios.',
    '- Avalie somente com base nas evidências presentes na entrega do aluno e nas orientações fornecidas.',
    '- Todo fato mencionado no feedback deve poder ser confirmado no arquivo do aluno, nos critérios de avaliação ou nas instruções da atividade.',
    '- Não invente conteúdo, trechos, respostas, fontes, etapas realizadas, intenção, esforço, nota, critério ou resultado que não esteja explícito nas evidências disponíveis.',
    '- Não presuma que o estudante pesquisou, entendeu, tentou realizar ou concluiu algo quando isso não puder ser verificado.',
    '- Se uma informação não puder ser confirmada, diga que não foi possível identificá-la ou avaliá-la. Nunca complete lacunas com suposições.',
    '- Use a tag Corrigido quando o arquivo puder ser lido e tiver conteúdo relevante para a correção, mesmo que existam pontos a melhorar.',
    '- Use a tag Atensão quando o arquivo for válido e puder ser aberto, mas não apresentar o conteúdo solicitado na atividade.',
    '- Use a tag Perigo quando o arquivo não puder ser lido, estiver corrompido, inválido ou não for possível identificar uma entrega válida.',
    '- Use nota numérica somente quando ela puder ser justificada pelos critérios e pelas evidências. Se não for possível justificar a nota, deixe a coluna nota vazia.',
    '',
    'Como escrever o feedback:',
    '- Escreva como uma mensagem humana do tutor diretamente para o estudante, usando o nome dele quando disponível.',
    '- Comece com uma saudação e agradeça ou reconheça o envio da atividade.',
    '- Explique o resultado com base nos critérios da atividade: destaque algo que o estudante demonstrou e cite, de forma concreta, o que precisa ser mantido ou melhorado.',
    '- Quando houver algo a melhorar, explique o motivo e indique um próximo passo prático, como o conteúdo que deve ser estudado, revisto ou acrescentado.',
    '- Termine com incentivo genuíno e disponibilidade para esclarecer dúvidas, sem prometer resultados nem usar elogios genéricos.',
    '- Para Atensão, explique com respeito que o arquivo foi aberto, mas não contém o que foi solicitado, e diga exatamente o que deve ser enviado ou acrescentado.',
    '- Para Perigo, informe que o arquivo não pôde ser lido ou é inválido; não invente uma avaliação e oriente o estudante a reenviar um arquivo válido.',
    '- Evite tom robótico, acusatório ou punitivo, frases prontas repetidas e comentários vagos como "faça melhor".',
    '- Não use ponto e vírgula dentro do feedback.',
    '- Não use quebras de linha dentro do feedback.',
    '',
    'Exemplos de feedback baseados em fatos:',
    '- Corrigido: "Olá, Ana! Obrigado pelo envio da atividade. No seu arquivo, você apresentou as etapas de identificação do problema e justificou a escolha conforme o critério solicitado. Para fortalecer a resposta, detalhe como chegou ao resultado na etapa final. Continue se dedicando!"',
    '- Atensão: "Olá, Bruno! Obrigado pelo envio. O arquivo foi aberto, mas não localizei nele a análise solicitada na atividade. Para que essa etapa possa ser avaliada, acrescente a análise do caso e envie o arquivo novamente. Se precisar, estou à disposição para orientar."',
    '- Perigo: "Olá, Carla! Recebi seu envio, mas não foi possível abrir o arquivo para verificar o conteúdo. Por isso, não consigo avaliar a atividade neste momento. Reenvie o arquivo em um formato válido e, se tiver dúvidas, pode me procurar."',
    '',
    'Exemplos de situacao:',
    '- Corrigido: o arquivo é legível e contém material relevante para a correção.',
    '- Atensão: o arquivo é válido e legível, mas não contém o conteúdo solicitado.',
    '- Perigo: o arquivo não pode ser lido ou não é uma entrega válida.'
  ].join('\n');

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9 ]/g, '').trim();
  }

  function situationMeta(value) {
    return SITUATIONS.find(item => item.value === value) || SITUATIONS[0];
  }

  function normalizeSituation(value) {
    const raw = normalizeText(value);
    if (!raw) return '';

    for (const [key, synonyms] of Object.entries(SITUATION_SYNONYMS)) {
      if (synonyms.some(item => normalizeText(item) === raw)) return key;
    }

    if (raw.includes('erro') || raw.includes('inval') || raw.includes('corromp') || raw.includes('sem envio') || raw.includes('sem entrega')) return 'perigo';
    if (raw.includes('conteudo') || raw.includes('atens') || raw.includes('atencao')) return 'atensao';
    if (raw.includes('revisao') || raw.includes('pendente')) return 'corrigido';
    if (raw.includes('corrig')) return 'corrigido';
    return '';
  }

  function detectPageDecimalSeparator() {
    const gradeFields = [...document.querySelectorAll('input.quickgrade[id^="quickgrade_"], input[name^="quickgrade_"]')]
      .filter(input => !input.id.includes('comments') && !input.name.includes('comments'));

    const values = gradeFields.map(input => input.value || '').join(' ');
    if (/\d,\d/.test(values)) return ',';

    const gradeCells = [...document.querySelectorAll('td.grade, th.grade, td.c4, th.c4')]
      .map(cell => cell.textContent || '')
      .join(' ');
    if (/\d,\d/.test(gradeCells)) return ',';

    return '.';
  }

  function normalizeGradeForPage(value, decimalSeparator = detectPageDecimalSeparator()) {
    let grade = String(value ?? '').trim();
    if (!grade) return '';

    grade = grade.replace(/^['"]|['"]$/g, '').trim();
    grade = grade.replace(/\s*\/\s*.+$/, '');
    grade = grade.replace(/[^0-9,.-]/g, '');
    if (!grade) return '';

    if (decimalSeparator === ',') {
      if (grade.includes(',') && grade.includes('.')) {
        grade = grade.replace(/\./g, '');
      } else if (grade.includes('.') && !grade.includes(',')) {
        grade = grade.replace('.', ',');
      }
    } else {
      if (grade.includes(',') && grade.includes('.')) {
        grade = grade.replace(/,/g, '');
      } else if (grade.includes(',') && !grade.includes('.')) {
        grade = grade.replace(',', '.');
      }
    }
    return grade;
  }

  function dispatchFieldEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function getGradeInputs(root = document) {
    return [...root.querySelectorAll('input.quickgrade[id^="quickgrade_"], input.quickgrade[name^="quickgrade_"], input[id^="quickgrade_"], input[name^="quickgrade_"]')]
      .filter(input => !input.id.includes('comments') && !input.name.includes('comments'));
  }

  function getFeedbackTextareas(root = document) {
    return [...root.querySelectorAll('textarea.quickgrade[id^="quickgrade_comments_"], textarea.quickgrade[name^="quickgrade_comments_"], textarea[id^="quickgrade_comments_"], textarea[name^="quickgrade_comments_"]')];
  }

  function getQuickGradingCheckbox() {
    const direct = document.querySelector('input[type="checkbox"][id^="quickgrading"], input[type="checkbox"][name="quickgrading"]');
    if (direct) return direct;

    const label = [...document.querySelectorAll('label')]
      .find(item => normalizeText(item.textContent) === 'avaliacao rapida');
    const targetId = label?.getAttribute('for');
    return targetId ? document.getElementById(targetId) : null;
  }

  function getPageReadiness() {
    const url = new URL(window.location.href);
    const table = document.querySelector('table#submissions');
    const root = table || document;
    const gradeFields = getGradeInputs(root);
    const feedbackFields = getFeedbackTextareas(root);
    const quickGradingCheckbox = getQuickGradingCheckbox();
    const isAssignView = /\/mod\/assign\/view\.php$/.test(url.pathname);
    const isGradingAction = url.searchParams.get('action') === 'grading';
    const quickGradingEnabled = Boolean(quickGradingCheckbox?.checked);

    return {
      isSupported: isAssignView && isGradingAction && quickGradingEnabled && Boolean(table) && (gradeFields.length > 0 || feedbackFields.length > 0),
      canShowButton: isAssignView && isGradingAction && Boolean(table) && Boolean(quickGradingCheckbox),
      isAssignView,
      isGradingAction,
      hasQuickGradingOption: Boolean(quickGradingCheckbox),
      quickGradingEnabled,
      hasTable: Boolean(table),
      gradeCount: gradeFields.length,
      feedbackCount: feedbackFields.length,
    };
  }

  function formatPageReadinessError(readiness) {
    if (!readiness.isAssignView || !readiness.isGradingAction) {
      return 'Abra a tela de correção rápida do Moodle: /mod/assign/view.php?action=grading.';
    }
    if (!readiness.hasQuickGradingOption) return 'Opção Avaliação rápida não encontrada nesta página.';
    if (!readiness.quickGradingEnabled) return 'Marque a opção Avaliação rápida para exibir os campos editáveis da tabela.';
    if (!readiness.hasTable) return 'Tabela de envios do Moodle não encontrada nesta página.';
    if (!readiness.gradeCount && !readiness.feedbackCount) return 'Nenhum campo editável de Nota ou Comentários de feedback foi encontrado.';
    return 'Esta página não parece ser uma tela de correção rápida compatível.';
  }

  function createUI() {
    if (document.getElementById('mqi-import-button')) return;

    const readiness = getPageReadiness();
    if (!readiness.canShowButton) return;

    const gradeNavItem = findGradeNavItem();
    const button = document.createElement('button');
    button.id = 'mqi-import-button';
    button.type = 'button';
    button.className = readiness.isSupported
      ? 'btn btn-primary mqi-import-button'
      : 'btn btn-secondary mqi-import-button mqi-import-disabled';
    button.textContent = 'Importar';
    button.disabled = !readiness.isSupported;
    button.title = readiness.isSupported ? 'Importar feedback, notas opcionais e situações' : formatPageReadinessError(readiness);
    button.addEventListener('click', toggleModal);

    if (gradeNavItem) {
      gradeNavItem.appendChild(button);
    } else {
      button.classList.add('mqi-floating-fallback');
      document.body.appendChild(button);
    }
  }

  function findGradeNavItem() {
    const main = document.querySelector('[role="main"]') || document;
    const links = [...main.querySelectorAll('.navitem a.btn[href*="action=grader"]')];
    const gradeLink = links.find(link => normalizeText(link.textContent) === 'nota') || links[0];
    return gradeLink?.closest('.navitem') || null;
  }

  function toggleModal() {
    const existing = document.getElementById('mqi-backdrop');
    if (existing) {
      existing.remove();
      return;
    }
    openModal();
  }

  function openModal() {
    const backdrop = document.createElement('div');
    backdrop.id = 'mqi-backdrop';
    backdrop.innerHTML = `
      <div id="mqi-modal" role="dialog" aria-modal="true" aria-labelledby="mqi-modal-title">
        <header class="mqi-modal-header">
          <h2 id="mqi-modal-title">Importar notas</h2>
          <button type="button" id="mqi-close" aria-label="Fechar">×</button>
        </header>
        <nav class="mqi-tabs" role="tablist" aria-label="Opções do importador">
          <button type="button" class="mqi-tab is-active" id="mqi-tab-import" data-panel="mqi-panel-import" role="tab" aria-selected="true" aria-controls="mqi-panel-import">Importação</button>
          <button type="button" class="mqi-tab" id="mqi-tab-bulk" data-panel="mqi-panel-bulk" role="tab" aria-selected="false" aria-controls="mqi-panel-bulk">Lançamento em massa</button>
        </nav>
        <main class="mqi-modal-body">
          <section id="mqi-panel-import" class="mqi-tab-panel is-active" role="tabpanel" aria-labelledby="mqi-tab-import">
            <p class="mqi-panel-intro">Selecione o arquivo de correção para conferir e preencher a página atual do Moodle.</p>
            <label class="mqi-check"><input id="mqi-overwrite-grade" type="checkbox" checked /> Sobrescrever nota existente</label>
            <label class="mqi-check"><input id="mqi-overwrite-feedback" type="checkbox" checked /> Sobrescrever feedback existente</label>
            <label class="mqi-check"><input id="mqi-flex-match" type="checkbox" checked /> Permitir comparação flexível de nomes</label>

            <div class="mqi-field mqi-prompt-field">
              <label for="mqi-correction-prompt">Prompt de correção</label>
              <div class="mqi-prompt-layout">
                <textarea id="mqi-correction-prompt" class="mqi-textarea mqi-prompt-textarea" readonly>${escapeHtml(CORRECTION_PROMPT)}</textarea>
                <button type="button" id="mqi-copy-prompt" class="mqi-copy-prompt" title="Copiar prompt de correção">▣ <span>Copiar prompt</span></button>
              </div>
            </div>

            <div class="mqi-field mqi-file-field">
              <label for="mqi-file-trigger">Selecionar arquivo</label>
              <input id="mqi-file" type="file" accept=".csv,.txt,.tsv,.xlsx" hidden />
              <button type="button" id="mqi-file-trigger" class="mqi-select-trigger" aria-haspopup="dialog">${escapeHtml(STATE.fileName || 'Selecionar arquivo...')}</button>
              <div id="mqi-file-name" class="mqi-help-text">${STATE.fileName ? escapeHtml(STATE.fileName) : 'Nenhum arquivo selecionado.'}</div>
              <div class="mqi-help-text mqi-auto-validation">A verificação é feita automaticamente ao selecionar o arquivo.</div>
            </div>

            <div class="mqi-actions mqi-actions--single">
              <button type="button" id="mqi-apply-import" class="primary" ${STATE.records.length ? '' : 'disabled'}>Preencher página</button>
            </div>
          </section>

          <section id="mqi-panel-bulk" class="mqi-tab-panel" role="tabpanel" aria-labelledby="mqi-tab-bulk" hidden>
            <div class="mqi-field">
              <label for="mqi-bulk-scope">Aplicar para</label>
              <select id="mqi-bulk-scope" class="mqi-input">
                <option value="submitted">Todos com envio</option>
                <option value="all">Todos os alunos exibidos</option>
              </select>
            </div>
            <div class="mqi-field mqi-bulk-grade-field">
              <label for="mqi-bulk-grade">Nota padrão (opcional)</label>
              <div class="mqi-grade-inline">
                <input id="mqi-bulk-grade" class="mqi-input" type="text" inputmode="decimal" placeholder="Deixe em branco para lançar somente o feedback" />
                <span id="mqi-max-grade-hint" class="mqi-grade-hint"></span>
              </div>
            </div>
            <div class="mqi-field">
              <label for="mqi-bulk-feedback">Feedback genérico</label>
              <textarea id="mqi-bulk-feedback" class="mqi-textarea" placeholder="Use {nome} para personalizar o feedback de cada aluno."></textarea>
              <div class="mqi-help-text">Exemplo: Olá, {nome}. Parabéns pelo envio da atividade.</div>
            </div>
            <label class="mqi-check"><input id="mqi-bulk-overwrite-grade" type="checkbox" checked /> Sobrescrever nota existente</label>
            <label class="mqi-check"><input id="mqi-bulk-overwrite-feedback" type="checkbox" checked /> Sobrescrever feedback existente</label>
            <div class="mqi-help-text mqi-bulk-scope-help">O preenchimento considera somente os alunos carregados na página atual.</div>
            <div class="mqi-actions mqi-actions--single">
              <button type="button" id="mqi-apply-bulk" class="primary">Lançar para todos</button>
            </div>
          </section>
        </main>
        <footer class="mqi-modal-footer">
          <div id="mqi-log" class="mqi-log mqi-log--info">${STATE.records.length ? 'Arquivo pronto para preenchimento.' : 'Nenhum arquivo importado.'}</div>
          <div class="mqi-credit">v${VERSION} · <a href="https://www.linkedin.com/in/julioall/" target="_blank" rel="noopener noreferrer">By Julio</a></div>
        </footer>
      </div>
    `;

    document.body.appendChild(backdrop);
    configureGradeAvailability(backdrop);

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) backdrop.remove();
    });

    backdrop.querySelector('#mqi-close').addEventListener('click', () => backdrop.remove());
    backdrop.querySelectorAll('.mqi-tab').forEach(tab => {
      tab.addEventListener('click', () => activateModalTab(backdrop, tab.dataset.panel));
    });
    backdrop.querySelector('#mqi-copy-prompt').addEventListener('click', copyCorrectionPrompt);
    backdrop.querySelector('#mqi-file-trigger').addEventListener('click', () => backdrop.querySelector('#mqi-file').click());
    backdrop.querySelector('#mqi-file').addEventListener('change', onFileSelected);
    backdrop.querySelector('#mqi-apply-import').addEventListener('click', applyImport);
    backdrop.querySelector('#mqi-apply-bulk').addEventListener('click', applyBulkLaunch);

    updateMaxGradeHint();
  }

  function activateModalTab(backdrop, panelId) {
    backdrop.querySelectorAll('.mqi-tab').forEach(tab => {
      const active = tab.dataset.panel === panelId;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    backdrop.querySelectorAll('.mqi-tab-panel').forEach(panel => {
      const active = panel.id === panelId;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  }

  function updateMaxGradeHint() {
    const hint = document.getElementById('mqi-max-grade-hint');
    if (!hint) return;
    const maxText = extractPageMaxGradeText();
    hint.textContent = maxText ? `/ ${maxText}` : '';
  }

  function extractPageMaxGradeText() {
    const sample = [...document.querySelectorAll('td, th, span, div')]
      .map(node => (node.textContent || '').trim())
      .find(text => /^\/\s*\d+([.,]\d+)?$/.test(text));
    return sample ? sample.replace(/^\//, '').trim() : '50';
  }

  function log(message, tone = 'info') {
    const el = document.getElementById('mqi-log');
    if (!el) return;
    el.className = `mqi-log mqi-log--${tone}`;
    if (typeof message === 'string') {
      el.innerHTML = message;
    } else {
      el.innerHTML = String(message ?? '');
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${TEMPLATE_CSV}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo_importacao_notas.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function configureGradeAvailability(backdrop) {
    const readiness = getPageReadiness();
    if (readiness.gradeCount > 0) return;

    const importOverwrite = backdrop.querySelector('#mqi-overwrite-grade');
    const bulkOverwrite = backdrop.querySelector('#mqi-bulk-overwrite-grade');
    const bulkGrade = backdrop.querySelector('#mqi-bulk-grade');
    const hint = backdrop.querySelector('#mqi-max-grade-hint');

    [importOverwrite, bulkOverwrite].forEach(input => {
      if (!input) return;
      input.checked = false;
      input.disabled = true;
      input.closest('.mqi-check')?.classList.add('mqi-control-disabled');
    });

    if (bulkGrade) {
      bulkGrade.value = '';
      bulkGrade.disabled = true;
      bulkGrade.placeholder = 'Esta atividade não possui campo de nota';
    }
    if (hint) hint.textContent = 'Somente o feedback será preenchido.';
  }

  async function copyCorrectionPrompt() {
    const prompt = document.getElementById('mqi-correction-prompt')?.value || CORRECTION_PROMPT;
    try {
      await copyTextToClipboard(prompt);
      log('<strong>Prompt copiado.</strong> Agora é só colar na IA.', 'success');
    } catch (error) {
      console.error(error);
      log('<strong>Não foi possível copiar automaticamente.</strong> Selecione o prompt e copie manualmente.', 'warning');
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Falha ao copiar texto.');
  }

  async function onFileSelected(event) {
    const file = event.target.files?.[0];
    const fileNameEl = document.getElementById('mqi-file-name');
    const trigger = document.getElementById('mqi-file-trigger');

    if (fileNameEl) fileNameEl.textContent = file ? file.name : 'Nenhum arquivo selecionado.';
    if (trigger) trigger.textContent = file ? file.name : 'Selecionar arquivo...';
    if (!file) return;

    try {
      if (!/\.(csv|txt|tsv|xlsx)$/i.test(file.name)) {
        throw new Error('Formato não suportado. Use CSV, TSV, TXT ou XLSX.');
      }

      STATE.fileName = file.name;
      const lower = file.name.toLowerCase();
      let rows;

      if (lower.endsWith('.xlsx')) {
        rows = await parseXlsxFile(file);
      } else {
        const text = await file.text();
        rows = parseDelimitedText(text);
      }

      const parsed = parseImportRows(rows);
      STATE.records = parsed.records;
      STATE.validationWarnings = parsed.warnings;
      STATE.lastReport = null;

      const applyButton = document.getElementById('mqi-apply-import');
      if (applyButton) applyButton.disabled = STATE.records.length === 0;

      // A seleção do arquivo já executa a conferência sem alterar os campos do Moodle.
      const report = buildImportReport({ apply: false });
      if (report.error) {
        log(`<strong>Não foi possível verificar automaticamente.</strong> ${escapeHtml(report.error)}`, 'error');
      } else {
        STATE.lastReport = report;
        renderReport(report);
      }
    } catch (error) {
      console.error(error);
      STATE.records = [];
      STATE.validationWarnings = [];
      STATE.lastReport = null;
      const applyButton = document.getElementById('mqi-apply-import');
      if (applyButton) applyButton.disabled = true;
      log(`<strong>Erro no arquivo.</strong> ${escapeHtml(error.message)}`, 'error');
    }
  }

  function parseDelimitedText(text) {
    const cleanText = String(text ?? '').replace(/^\uFEFF/, '');
    const delimiter = detectDelimiter(cleanText);
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const next = cleanText[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === delimiter) {
        row.push(value);
        value = '';
        continue;
      }

      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') i++;
        row.push(value);
        if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
        row = [];
        value = '';
        continue;
      }

      value += char;
    }

    row.push(value);
    if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
    return rows;
  }

  function detectDelimiter(text) {
    const firstLine = String(text).split(/\r?\n/).find(line => line.trim()) || '';
    const counts = [
      { delimiter: ';', count: (firstLine.match(/;/g) || []).length },
      { delimiter: '\t', count: (firstLine.match(/\t/g) || []).length },
      { delimiter: ',', count: (firstLine.match(/,/g) || []).length },
    ];
    counts.sort((a, b) => b.count - a.count);
    return counts[0].count > 0 ? counts[0].delimiter : ';';
  }

  function parseImportRows(rows) {
    if (!rows || rows.length < 2) {
      throw new Error('Arquivo vazio ou sem linhas de dados. Use nome e ao menos uma das colunas nota, feedback ou situacao.');
    }

    const headers = rows[0].map(normalizeHeader);
    const indexes = {
      nome: findHeaderIndex(headers, COLUMN_ALIASES.nome),
      nota: findHeaderIndex(headers, COLUMN_ALIASES.nota),
      feedback: findHeaderIndex(headers, COLUMN_ALIASES.feedback),
      situacao: findHeaderIndex(headers, COLUMN_ALIASES.situacao),
    };

    if (indexes.nome === -1) {
      throw new Error('Cabeçalho obrigatório não encontrado: nome.');
    }

    if (indexes.nota === -1 && indexes.feedback === -1 && indexes.situacao === -1) {
      throw new Error('Inclua ao menos uma coluna de ação: nota, feedback ou situacao.');
    }

    const records = [];
    const warnings = [];

    rows.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const nome = String(row[indexes.nome] ?? '').trim();
      const nota = indexes.nota !== -1 ? String(row[indexes.nota] ?? '').trim() : '';
      const feedback = indexes.feedback !== -1 ? String(row[indexes.feedback] ?? '').trim() : '';
      const situacaoRaw = indexes.situacao !== -1 ? String(row[indexes.situacao] ?? '').trim() : '';
      const situacao = normalizeSituation(situacaoRaw);
      const hasAnyValue = row.some(cell => String(cell ?? '').trim());

      if (!hasAnyValue) return;
      if (!nome) {
        warnings.push(`Linha ${rowNumber} ignorada: nome vazio.`);
        return;
      }
      if (!nota && !feedback && !situacao) {
        warnings.push(`Linha ${rowNumber} ignorada: informe nota, feedback ou situacao.`);
        return;
      }
      if (nota && !isValidImportedGrade(nota)) {
        warnings.push(`Linha ${rowNumber} ignorada: nota inválida "${nota}".`);
        return;
      }
      if (situacaoRaw && !situacao) {
        warnings.push(`Linha ${rowNumber}: situacao "${situacaoRaw}" não reconhecida. A tag foi ignorada.`);
      }

      records.push({
        rowNumber,
        nome,
        nota,
        feedback,
        situacao,
        situacaoLabel: situationMeta(situacao).label,
      });
    });

    if (!records.length) throw new Error('Nenhum registro válido encontrado no arquivo.');
    return { records, warnings };
  }

  function isValidImportedGrade(value) {
    const normalized = normalizeGradeForPage(value, '.');
    if (!normalized || !/\d/.test(normalized)) return false;
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0;
  }

  function findHeaderIndex(headers, aliases) {
    const normalizedAliases = aliases.map(normalizeHeader);
    let index = headers.findIndex(header => normalizedAliases.includes(header));
    if (index !== -1) return index;
    return headers.findIndex(header => normalizedAliases.some(alias => header.includes(alias) || alias.includes(header)));
  }

  function extractStudentName(nameCell) {
    if (!nameCell) return '';
    const link = nameCell.querySelector('a[href*="/user/view.php"]') || nameCell.querySelector('a') || nameCell;
    const clone = link.cloneNode(true);
    clone.querySelectorAll('img, .userinitials, .accesshide, .visually-hidden, .sr-only').forEach(node => node.remove());
    let name = clone.textContent || '';
    name = name.replace(/\s+/g, ' ').trim();

    if (!name) {
      name = link.getAttribute('title') || link.getAttribute('aria-label') || nameCell.textContent || '';
      name = name.replace(/\s+/g, ' ').trim();
    }
    return name;
  }

  function getUserIdFromRow(row, gradeInput) {
    const gradeName = gradeInput?.name || gradeInput?.id || '';
    const gradeMatch = gradeName.match(/quickgrade_(\d+)/);
    if (gradeMatch) return gradeMatch[1];

    const selected = row.querySelector('input[name="selectedusers"], input[id^="selectuser_"]');
    return selected?.value || (selected?.id || '').replace(/^selectuser_/, '') || '';
  }

  function getMoodleRows() {
    const table = document.querySelector('table#submissions');
    const rows = table
      ? [...table.querySelectorAll('tbody tr')]
      : [...document.querySelectorAll('table.generaltable tbody tr, tr')];

    const seen = new Set();
    const items = [];

    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);

      const gradeInput = getGradeInputs(row)[0];
      const userId = getUserIdFromRow(row, gradeInput);
      const feedbackTextarea = userId
        ? row.querySelector(`textarea#quickgrade_comments_${CSS.escape(userId)}, textarea[name="quickgrade_comments_${CSS.escape(userId)}"]`)
        : getFeedbackTextareas(row)[0];
      const nameCell = row.querySelector('td.username, td[class~="username"], .cell.username');
      const statusCell = row.querySelector('td.status, td[class~="status"], .cell.status, td.c3');
      const filesCell = row.querySelector('td.c6, td[class*="files"], .assignsubmission_file');
      const name = extractStudentName(nameCell);
      if (!name || (!gradeInput && !feedbackTextarea)) continue;

      const statusText = normalizeText(statusCell?.textContent || '');
      const hasSubmission = Boolean(
        row.querySelector('.submissionstatussubmitted, .submissionstatussubmitteddraft, .fileuploadsubmission a, .assignsubmission_file a') ||
        /enviado|submetido|avaliacao|avaliação/.test(statusText)
      );

      items.push({
        row,
        userId,
        name,
        normalizedName: normalizeText(name),
        gradeInput,
        feedbackTextarea,
        nameCell,
        statusCell,
        filesCell,
        hasSubmission,
      });
    }

    return items;
  }

  function findStudentGradingRow(element) {
    const direct = element.closest('tr[id^="mod_assign_grading-"]');
    if (direct) return direct;

    let current = element;
    while (current && current !== document.documentElement) {
      if (current.tagName === 'TR' && current.querySelector('td.username, td[class~="username"], .cell.username')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function installStudentDownloadRenaming(root = document) {
    root.querySelectorAll('a[href*="assignsubmission_file"]')
      .forEach(link => prepareStudentDownloadLink(link));
  }

  function prepareStudentDownloadLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return;

    const downloadName = buildStudentDownloadName(link);
    if (!downloadName) return;

    link.dataset.mqiStudentDownload = 'true';
    link.dataset.mqiDownloadName = downloadName;
    link.classList.add('mqi-student-download');
    link.setAttribute('download', downloadName);
    link.title = `Baixar como ${downloadName}`;

    if (link.dataset.mqiDownloadHandler !== 'true') {
      link.dataset.mqiDownloadHandler = 'true';
      link.addEventListener('click', handleStudentFileDownload, { capture: true });
    }
  }

  function buildStudentDownloadName(link) {
    const row = findStudentGradingRow(link);
    if (!row) return '';

    const nameCell = row.querySelector('td.username, td[class~="username"], .cell.username');
    const studentName = sanitizeFileName(extractStudentName(nameCell));
    if (!studentName) return '';

    const links = [...row.querySelectorAll('a[href*="assignsubmission_file"]')];
    const index = links.indexOf(link);
    const suffix = links.length > 1 && index >= 0 ? ` - ${index + 1}` : '';
    return `${studentName}${suffix}${getFileExtension(link)}`;
  }

  function sanitizeFileName(value) {
    return String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 140);
  }

  function getFileExtension(link) {
    const visibleName = (link.textContent || '').trim();
    const visibleMatch = visibleName.match(/(\.[a-z0-9]{1,12})$/i);
    if (visibleMatch) return visibleMatch[1].toLowerCase();

    try {
      const pathName = decodeURIComponent(new URL(link.href, window.location.href).pathname);
      const pathMatch = pathName.match(/(\.[a-z0-9]{1,12})$/i);
      return pathMatch ? pathMatch[1].toLowerCase() : '';
    } catch {
      return '';
    }
  }

  async function handleStudentFileDownload(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const link = event.currentTarget;
    const downloadName = buildStudentDownloadName(link) || link.dataset.mqiDownloadName;
    if (!downloadName) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    link.classList.add('mqi-download-busy');
    link.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(link.href, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
      if (response.redirected && /\/login\//.test(response.url)) throw new Error('Sessão do Moodle expirada');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const temporaryLink = document.createElement('a');
      temporaryLink.href = objectUrl;
      temporaryLink.download = downloadName;
      temporaryLink.style.display = 'none';
      document.body.appendChild(temporaryLink);
      temporaryLink.click();
      temporaryLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
    } catch (error) {
      console.error('Não foi possível baixar o arquivo com o nome do aluno.', error);
      const fallbackLink = document.createElement('a');
      fallbackLink.href = link.href;
      fallbackLink.download = downloadName;
      fallbackLink.target = '_self';
      fallbackLink.style.display = 'none';
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      fallbackLink.remove();
    } finally {
      link.classList.remove('mqi-download-busy');
      link.removeAttribute('aria-busy');
    }
  }

  function findStudentRow(record, moodleRows, allowFlexible) {
    const wanted = normalizeText(record.nome);
    if (!wanted) return { status: 'not_found' };

    const exact = moodleRows.filter(item => item.normalizedName === wanted);
    if (exact.length === 1) return { status: 'found', match: exact[0], method: 'exato' };
    if (exact.length > 1) return { status: 'ambiguous', matches: exact, method: 'exato' };

    const contains = moodleRows.filter(item => {
      if (wanted.length < 10 || item.normalizedName.length < 10) return false;
      return item.normalizedName.includes(wanted) || wanted.includes(item.normalizedName);
    });
    if (contains.length === 1) return { status: 'found', match: contains[0], method: 'contém' };
    if (contains.length > 1) return { status: 'ambiguous', matches: contains, method: 'contém' };

    if (!allowFlexible) return { status: 'not_found' };

    const wantedTokens = wanted.split(' ').filter(token => token.length > 1);
    if (wantedTokens.length < 2) return { status: 'not_found' };

    const first = wantedTokens[0];
    const last = wantedTokens[wantedTokens.length - 1];
    const candidates = moodleRows
      .map(item => {
        const rowTokens = item.normalizedName.split(' ').filter(token => token.length > 1);
        const tokenSet = new Set(rowTokens);
        const hits = wantedTokens.filter(token => tokenSet.has(token)).length;
        const hasEdges = tokenSet.has(first) && tokenSet.has(last);
        const ratio = hits / wantedTokens.length;
        return { item, hits, ratio, hasEdges };
      })
      .filter(candidate => candidate.hasEdges && candidate.hits >= Math.min(3, wantedTokens.length) && candidate.ratio >= 0.6)
      .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits);

    if (!candidates.length) return { status: 'not_found' };

    const best = candidates[0];
    const tied = candidates.filter(candidate => candidate.ratio === best.ratio && candidate.hits === best.hits);
    if (tied.length === 1) return { status: 'found', match: best.item, method: 'flexível' };
    return { status: 'ambiguous', matches: tied.map(candidate => candidate.item), method: 'flexível' };
  }

  function clearHighlights() {
    document.querySelectorAll('tr.mqi-found, tr.mqi-applied, tr.mqi-ambiguous, tr.mqi-status-success, tr.mqi-status-info, tr.mqi-status-warning, tr.mqi-status-danger, tr.mqi-status-review, tr.mqi-status-muted, tr.mqi-status-neutral')
      .forEach(row => {
        row.classList.remove('mqi-found', 'mqi-applied', 'mqi-ambiguous', 'mqi-status-success', 'mqi-status-info', 'mqi-status-warning', 'mqi-status-danger', 'mqi-status-review', 'mqi-status-muted', 'mqi-status-neutral');
      });

    document.querySelectorAll('.mqi-row-badge').forEach(node => node.remove());
  }

  function markRowSituation(rowItem, situationValue) {
    if (!rowItem?.row || !situationValue) return;
    const meta = situationMeta(situationValue);
    const row = rowItem.row;
    row.classList.remove('mqi-status-success', 'mqi-status-info', 'mqi-status-warning', 'mqi-status-danger', 'mqi-status-review', 'mqi-status-muted', 'mqi-status-neutral');
    row.classList.add(`mqi-status-${meta.tone}`);

    const host = rowItem.nameCell || row.querySelector('td') || row;
    const badge = document.createElement('span');
    badge.className = `mqi-row-badge mqi-row-badge--${meta.tone}`;
    badge.textContent = meta.label;
    const previous = host.querySelector('.mqi-row-badge');
    if (previous) previous.remove();
    host.appendChild(badge);
  }

  function buildImportReport({ apply = false } = {}) {
    clearHighlights();

    const readiness = getPageReadiness();
    if (!readiness.isSupported) return { error: formatPageReadinessError(readiness) };
    if (!STATE.records.length) return { error: 'Importe um arquivo CSV ou XLSX primeiro.' };

    const allowFlexible = document.getElementById('mqi-flex-match')?.checked ?? true;
    const overwriteGrade = document.getElementById('mqi-overwrite-grade')?.checked ?? true;
    const overwriteFeedback = document.getElementById('mqi-overwrite-feedback')?.checked ?? true;
    const decimalSeparator = detectPageDecimalSeparator();
    const moodleRows = getMoodleRows();

    const report = {
      mode: 'import',
      apply,
      fileName: STATE.fileName,
      records: STATE.records.length,
      pageRows: moodleRows.length,
      found: [],
      applied: [],
      skipped: [],
      notFound: [],
      ambiguous: [],
      attention: [],
      warnings: [...STATE.validationWarnings],
      situationCounts: {}
    };

    if (!readiness.gradeCount && STATE.records.some(record => record.nota)) {
      report.warnings.push('A atividade não possui campo de nota; os valores da coluna nota serão ignorados.');
    }
    if (!readiness.feedbackCount && STATE.records.some(record => record.feedback)) {
      report.warnings.push('A atividade não possui campo de feedback; os textos da coluna feedback serão ignorados.');
    }

    for (const record of STATE.records) {
      const result = findStudentRow(record, moodleRows, allowFlexible);

      if (result.status === 'not_found') {
        report.notFound.push(record.nome);
        continue;
      }
      if (result.status === 'ambiguous') {
        report.ambiguous.push(`${record.nome} → ${result.matches.map(item => item.name).join(' | ')}`);
        result.matches.forEach(item => item.row.classList.add('mqi-ambiguous'));
        continue;
      }

      const match = result.match;
      match.row.classList.add('mqi-found');
      if (record.situacao) {
        markRowSituation(match, record.situacao);
        const meta = situationMeta(record.situacao);
        report.situationCounts[meta.label] = (report.situationCounts[meta.label] || 0) + 1;
        if (meta.alert) report.attention.push(`${record.nome}: ${meta.label}`);
      }

      report.found.push(`${record.nome} → ${match.name}${result.method ? ` (${result.method})` : ''}`);

      if (!apply) continue;

      let changed = false;
      const changedFields = [];
      const skippedFields = [];
      const grade = normalizeGradeForPage(record.nota, decimalSeparator);

      if (match.gradeInput && grade) {
        if (overwriteGrade || !match.gradeInput.value.trim()) {
          match.gradeInput.value = grade;
          dispatchFieldEvents(match.gradeInput);
          changed = true;
          changedFields.push('nota');
        } else {
          skippedFields.push('nota já preenchida');
        }
      }

      if (match.feedbackTextarea && record.feedback) {
        if (overwriteFeedback || !match.feedbackTextarea.value.trim()) {
          match.feedbackTextarea.value = record.feedback;
          dispatchFieldEvents(match.feedbackTextarea);
          changed = true;
          changedFields.push('feedback');
        } else {
          skippedFields.push('feedback já preenchido');
        }
      }

      if (record.situacao) {
        changed = true;
        changedFields.push(`tag: ${situationMeta(record.situacao).label}`);
      }

      if (changed) {
        if (!record.situacao) match.row.classList.add('mqi-applied');
        report.applied.push(`${record.nome}: ${changedFields.join(' + ')}`);
      } else {
        report.skipped.push(`${record.nome}: ${skippedFields.join(', ') || 'sem alteração aplicável'}`);
      }
    }

    return report;
  }

  function previewImport() {
    const report = buildImportReport({ apply: false });
    if (report.error) return log(`<strong>Não foi possível verificar.</strong> ${escapeHtml(report.error)}`, 'error');
    STATE.lastReport = report;
    renderReport(report);
  }

  function applyImport() {
    const report = buildImportReport({ apply: true });
    if (report.error) return log(`<strong>Não foi possível preencher.</strong> ${escapeHtml(report.error)}`, 'error');
    STATE.lastReport = report;
    renderReport(report);
  }

  function buildBulkPayload() {
    const scope = document.getElementById('mqi-bulk-scope')?.value || 'submitted';
    const grade = (document.getElementById('mqi-bulk-grade')?.value || '').trim();
    const feedback = (document.getElementById('mqi-bulk-feedback')?.value || '').trim();
    const overwriteGrade = document.getElementById('mqi-bulk-overwrite-grade')?.checked ?? true;
    const overwriteFeedback = document.getElementById('mqi-bulk-overwrite-feedback')?.checked ?? true;

    if (!grade && !feedback) {
      return { error: 'Informe ao menos uma nota padrão ou um feedback genérico.' };
    }

    const readiness = getPageReadiness();
    if (grade && !readiness.gradeCount && !feedback) {
      return { error: 'Esta atividade não possui campo de nota. Informe um feedback genérico para continuar.' };
    }
    if (grade && !isValidImportedGrade(grade)) {
      return { error: 'A nota padrão informada é inválida.' };
    }

    return {
      scope,
      grade: readiness.gradeCount ? grade : '',
      feedback,
      overwriteGrade,
      overwriteFeedback
    };
  }

  function buildBulkReport({ apply = false } = {}) {
    clearHighlights();

    const readiness = getPageReadiness();
    if (!readiness.isSupported) return { error: formatPageReadinessError(readiness) };

    const payload = buildBulkPayload();
    if (payload.error) return { error: payload.error };

    const decimalSeparator = detectPageDecimalSeparator();
    const allRows = getMoodleRows();
    const targets = payload.scope === 'submitted' ? allRows.filter(item => item.hasSubmission) : allRows;
    if (!targets.length) return { error: 'Nenhum aluno elegível foi encontrado para o lançamento em massa.' };

    const report = {
      mode: 'bulk',
      apply,
      scope: payload.scope,
      totalTargets: targets.length,
      applied: [],
      skipped: [],
      attention: [],
      situationCounts: {},
    };

    for (const item of targets) {
      item.row.classList.add('mqi-found');
      let changed = false;
      const changedFields = [];
      const skippedFields = [];

      if (payload.grade && item.gradeInput) {
        const normalizedGrade = normalizeGradeForPage(payload.grade, decimalSeparator);
        if (payload.overwriteGrade || !item.gradeInput.value.trim()) {
          if (apply) {
            item.gradeInput.value = normalizedGrade;
            dispatchFieldEvents(item.gradeInput);
          }
          changed = true;
          changedFields.push('nota');
        } else {
          skippedFields.push('nota já preenchida');
        }
      }

      if (payload.feedback && item.feedbackTextarea) {
        const message = payload.feedback.replace(/\{\s*nome\s*\}/gi, item.name.split(' ')[0]);
        if (payload.overwriteFeedback || !item.feedbackTextarea.value.trim()) {
          if (apply) {
            item.feedbackTextarea.value = message;
            dispatchFieldEvents(item.feedbackTextarea);
          }
          changed = true;
          changedFields.push('feedback');
        } else {
          skippedFields.push('feedback já preenchido');
        }
      }

      if (changed) {
        if (apply) item.row.classList.add('mqi-applied');
        report.applied.push(`${item.name}: ${changedFields.join(' + ')}`);
      } else {
        report.skipped.push(`${item.name}: ${skippedFields.join(', ') || 'sem alteração aplicável'}`);
      }
    }

    return report;
  }

  function previewBulkLaunch() {
    const report = buildBulkReport({ apply: false });
    if (report.error) return log(`<strong>Não foi possível verificar.</strong> ${escapeHtml(report.error)}`, 'error');
    STATE.lastReport = report;
    renderReport(report);
  }

  function applyBulkLaunch() {
    const report = buildBulkReport({ apply: true });
    if (report.error) return log(`<strong>Não foi possível lançar.</strong> ${escapeHtml(report.error)}`, 'error');
    STATE.lastReport = report;
    renderReport(report);
  }

  function reportTone(report) {
    if (report.notFound?.length || report.ambiguous?.length) return 'warning';
    if (report.attention?.length) return 'warning';
    if (report.mode === 'import' && Object.keys(report.situationCounts || {}).length) return 'info';
    return report.apply ? 'success' : 'info';
  }

  function renderReport(report) {
    const tone = reportTone(report);
    const scopeLabel = report.mode === 'bulk'
      ? (report.scope === 'submitted' ? 'Todos com envio' : 'Todos os alunos exibidos')
      : `Arquivo: ${escapeHtml(report.fileName)}`;

    const chips = [];
    if (report.mode === 'import') {
      chips.push(`<span class="mqi-chip mqi-chip--info">Registros: ${report.records}</span>`);
      chips.push(`<span class="mqi-chip mqi-chip--info">Encontrados: ${report.found.length}</span>`);
      if (report.apply) chips.push(`<span class="mqi-chip mqi-chip--success">Preenchidos: ${report.applied.length}</span>`);
      if (report.ambiguous.length) chips.push(`<span class="mqi-chip mqi-chip--warning">Ambíguos: ${report.ambiguous.length}</span>`);
      if (report.notFound.length) chips.push(`<span class="mqi-chip mqi-chip--warning">Não encontrados: ${report.notFound.length}</span>`);
    } else {
      chips.push(`<span class="mqi-chip mqi-chip--info">Alvos: ${report.totalTargets}</span>`);
      chips.push(`<span class="mqi-chip mqi-chip--success">Atingidos: ${report.applied.length}</span>`);
      if (report.skipped.length) chips.push(`<span class="mqi-chip mqi-chip--warning">Ignorados: ${report.skipped.length}</span>`);
    }

    Object.entries(report.situationCounts || {}).forEach(([label, count]) => {
      const meta = SITUATIONS.find(item => item.label === label) || situationMeta('');
      chips.push(`<span class="mqi-chip mqi-chip--${meta.tone}">${escapeHtml(label)}: ${count}</span>`);
    });

    const sections = [];
    if (report.warnings?.length) {
      sections.push(`<div class="mqi-report-list"><div><strong>Avisos do arquivo</strong></div><ul>${report.warnings.slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }
    if (report.attention?.length) {
      sections.push(`<div class="mqi-report-list"><div><strong>Correções com atenção</strong></div><ul>${report.attention.slice(0, 8).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }
    if (report.ambiguous?.length) {
      sections.push(`<div class="mqi-report-list"><div><strong>Nomes ambíguos</strong></div><ul>${report.ambiguous.slice(0, 8).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }
    if (report.notFound?.length) {
      sections.push(`<div class="mqi-report-list"><div><strong>Não encontrados</strong></div><ul>${report.notFound.slice(0, 8).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }
    if (report.skipped?.length) {
      sections.push(`<div class="mqi-report-list"><div><strong>Ignorados</strong></div><ul>${report.skipped.slice(0, 8).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }

    const actionText = report.apply
      ? 'Preenchimento concluído. Revise a tabela e clique no botão nativo do Moodle para salvar.'
      : 'Verificação concluída. Nenhum campo foi salvo ainda.';

    log(`
      <div class="mqi-report-title"><strong>${report.mode === 'bulk' ? 'Lançamento em massa' : 'Importação de arquivo'}</strong> · ${scopeLabel}</div>
      <div class="mqi-report-chips">${chips.join('')}</div>
      <div class="mqi-report-note">${escapeHtml(actionText)}</div>
      ${sections.join('')}
    `, tone);
  }

  async function parseXlsxFile(file) {
    const buffer = await file.arrayBuffer();
    const files = await unzipXlsx(buffer);

    const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']);
    const workbookRels = parseWorkbookRels(files['xl/_rels/workbook.xml.rels']);
    const sheetPath = firstSheetPath(files['xl/workbook.xml'], workbookRels) || 'xl/worksheets/sheet1.xml';
    const sheetXml = files[sheetPath] || files['xl/worksheets/sheet1.xml'];

    if (!sheetXml) throw new Error('Não foi possível localizar a primeira planilha no XLSX.');
    return parseSheetXml(sheetXml, sharedStrings);
  }

  async function unzipXlsx(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const eocdOffset = findEndOfCentralDirectory(view);
    if (eocdOffset < 0) throw new Error('Arquivo XLSX inválido: diretório ZIP não encontrado.');

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    const files = {};
    let ptr = centralOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const fileNameLength = view.getUint16(ptr + 28, true);
      const extraLength = view.getUint16(ptr + 30, true);
      const commentLength = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const fileName = decodeUtf8(bytes.slice(ptr + 46, ptr + 46 + fileNameLength));

      if (!fileName.endsWith('/')) {
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.slice(dataStart, dataStart + compressedSize);
        let contentBytes;

        if (method === 0) {
          contentBytes = compressed;
        } else if (method === 8) {
          contentBytes = await inflateRaw(compressed);
        } else {
          throw new Error(`Método de compressão XLSX não suportado: ${method}`);
        }

        files[fileName] = decodeUtf8(contentBytes);
      }

      ptr += 46 + fileNameLength + extraLength + commentLength;
    }

    return files;
  }

  function findEndOfCentralDirectory(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (!('DecompressionStream' in window)) {
      throw new Error('Este navegador não oferece DecompressionStream. Use CSV ou Chrome/Edge atualizado.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const result = await new Response(stream).arrayBuffer();
    return new Uint8Array(result);
  }

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return [...doc.querySelectorAll('si')].map(si => [...si.querySelectorAll('t')].map(t => t.textContent || '').join(''));
  }

  function parseWorkbookRels(xml) {
    if (!xml) return {};
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rels = {};
    [...doc.querySelectorAll('Relationship')].forEach(rel => {
      rels[rel.getAttribute('Id')] = rel.getAttribute('Target');
    });
    return rels;
  }

  function firstSheetPath(workbookXml, rels) {
    if (!workbookXml) return null;
    const doc = new DOMParser().parseFromString(workbookXml, 'application/xml');
    const sheet = doc.querySelector('sheet');
    if (!sheet) return null;
    const relId = sheet.getAttribute('r:id') || sheet.getAttribute('id');
    const target = rels[relId];
    if (!target) return null;
    return target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
  }

  function parseSheetXml(xml, sharedStrings) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];

    [...doc.querySelectorAll('sheetData row')].forEach(rowEl => {
      const row = [];
      [...rowEl.querySelectorAll('c')].forEach(cell => {
        const ref = cell.getAttribute('r') || '';
        const colIndex = columnIndexFromCellRef(ref);
        const type = cell.getAttribute('t');
        let value = '';

        if (type === 'inlineStr') {
          value = [...cell.querySelectorAll('is t')].map(t => t.textContent || '').join('');
        } else {
          const raw = cell.querySelector('v')?.textContent || '';
          value = type === 's' ? (sharedStrings[Number(raw)] || '') : raw;
        }
        row[colIndex] = value;
      });

      rows.push(row.map(cell => cell ?? ''));
    });

    return rows.filter(row => row.some(cell => String(cell).trim() !== ''));
  }

  function columnIndexFromCellRef(ref) {
    const letters = (ref.match(/[A-Z]+/) || ['A'])[0];
    let index = 0;
    for (const letter of letters) {
      index = index * 26 + (letter.charCodeAt(0) - 64);
    }
    return index - 1;
  }

  function isCourseViewPage() {
    const url = new URL(window.location.href);
    return /\/course\/view\.php$/.test(url.pathname);
  }

  function getAssignmentIdFromUrl(href) {
    try {
      const url = new URL(href, window.location.href);
      if (!/\/mod\/assign\/view\.php$/.test(url.pathname)) return '';
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function collectCourseAssignments(root = document) {
    const cards = [...root.querySelectorAll('li.activity.assign.modtype_assign, li.activity.modtype_assign')];
    const found = new Map();

    cards.forEach(card => {
      const link = card.querySelector('.activitytitle.modtype_assign a[href*="/mod/assign/view.php"], a[href*="/mod/assign/view.php"]');
      if (!link) return;
      const assignmentId = getAssignmentIdFromUrl(link.href) || card.dataset.id || '';
      if (!assignmentId || found.has(assignmentId)) return;

      const iconHost = card.querySelector('.activity-icon.activityiconcontainer, .activityiconcontainer, .activity-icon')
        || card.querySelector('.activity-name-area, .activityname')
        || card;
      const badgeHost = card.querySelector('.activity-grid')
        || card.querySelector('.activity-item')
        || card;
      const name = extractCourseActivityName(card, link);
      found.set(assignmentId, { assignmentId, card, link, iconHost, badgeHost, name });
    });

    return [...found.values()];
  }

  function extractCourseActivityName(card, link) {
    const instance = card.querySelector('.instancename');
    if (instance) {
      const clone = instance.cloneNode(true);
      clone.querySelectorAll('.accesshide, .visually-hidden, .sr-only').forEach(node => node.remove());
      const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return (link.textContent || '').replace(/\s+/g, ' ').trim() || `Atividade ${getAssignmentIdFromUrl(link.href)}`;
  }

  function clearCourseBadgeCache(assignments = collectCourseAssignments()) {
    assignments.forEach(({ assignmentId }) => {
      COURSE_BADGE_STATE.results.delete(assignmentId);
    });
  }

  function ensurePendingBadge(assignment, state = 'loading', count = null, message = '') {
    const { iconHost, badgeHost, assignmentId, name } = assignment;
    if (!(badgeHost instanceof Element)) return null;

    if (!pendingFeatureEnabled('pendingBadges')) {
      assignment.card.querySelector(`.mqi-pending-badge[data-assignment-id="${CSS.escape(assignmentId)}"]`)?.remove();
      badgeHost.classList.remove('mqi-pending-badge-layer');
      iconHost?.classList?.remove('mqi-pending-icon-reference');
      assignment.card.classList.remove('mqi-assignment-has-pending');
      delete assignment.card.dataset.mqiPendingCount;
      return null;
    }

    badgeHost.classList.add('mqi-pending-badge-layer');
    if (iconHost instanceof Element) iconHost.classList.add('mqi-pending-icon-reference');

    let badge = assignment.card.querySelector(`.mqi-pending-badge[data-assignment-id="${CSS.escape(assignmentId)}"]`);

    if (state === 'empty') {
      badge?.remove();
      badgeHost.classList.remove('mqi-pending-badge-layer');
      iconHost?.classList?.remove('mqi-pending-icon-reference');
      assignment.card.classList.remove('mqi-assignment-has-pending');
      delete assignment.card.dataset.mqiPendingCount;
      return null;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mqi-pending-badge';
      badge.dataset.assignmentId = assignmentId;
      badge.setAttribute('aria-hidden', 'true');
    }
    if (badge.parentElement !== badgeHost) badgeHost.appendChild(badge);

    badge.className = `mqi-pending-badge mqi-pending-badge--${state}`;
    if (state === 'pending') {
      const label = count > 99 ? '99+' : String(count);
      badge.textContent = label;
      badge.title = `${count} ${count === 1 ? 'envio precisa' : 'envios precisam'} de avaliação em ${name}`;
      assignment.card.classList.add('mqi-assignment-has-pending');
      assignment.card.dataset.mqiPendingCount = String(count);
    } else if (state === 'error') {
      badge.textContent = '!';
      badge.title = message || `Não foi possível consultar ${name}`;
      assignment.card.classList.remove('mqi-assignment-has-pending');
      delete assignment.card.dataset.mqiPendingCount;
    } else {
      badge.textContent = '…';
      badge.title = `Consultando correções pendentes de ${name}`;
      assignment.card.classList.remove('mqi-assignment-has-pending');
      delete assignment.card.dataset.mqiPendingCount;
    }
    return badge;
  }

  function isPendingEvaluationLabel(value) {
    const label = normalizeText(value);
    const accepted = [
      'precisa de avaliacao',
      'necessita avaliacao',
      'requer avaliacao',
      'needs grading',
      'requires grading',
      'submissions need grading',
      'submissoes que precisam de avaliacao',
      'submissoes que necessitam avaliacao',
    ];
    return accepted.includes(label)
      || (label.includes('avaliacao') && (label.includes('precisa') || label.includes('necessita') || label.includes('requer')))
      || (label.includes('grading') && (label.includes('needs') || label.includes('requires')));
  }

  function parsePendingEvaluationCount(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr, [role="row"]')];

    for (const row of rows) {
      const cells = [...row.querySelectorAll('th, td, [role="rowheader"], [role="cell"]')]
        .filter((cell, index, all) => all.indexOf(cell) === index);
      const labelIndex = cells.findIndex(cell => isPendingEvaluationLabel(cell.textContent || ''));
      if (labelIndex < 0) continue;

      const valueCell = cells[labelIndex + 1] || cells[cells.length - 1];
      const valueText = (valueCell?.textContent || '').replace(/\s+/g, ' ').trim();
      const match = valueText.match(/\d+/);
      if (!match) return 0;
      return Number.parseInt(match[0], 10);
    }

    return null;
  }

  async function fetchPendingEvaluationCount(assignment) {
    if (COURSE_BADGE_STATE.inFlight.has(assignment.assignmentId)) {
      return COURSE_BADGE_STATE.inFlight.get(assignment.assignmentId);
    }

    const request = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(assignment.link.href, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
          },
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const finalUrl = new URL(response.url, window.location.href);
        if (finalUrl.origin !== window.location.origin) throw new Error('Redirecionamento para domínio não autorizado');

        const html = await response.text();
        if (/\/login\//.test(finalUrl.pathname) || (/name=["']username["']/i.test(html) && /name=["']password["']/i.test(html))) {
          throw new Error('Sessão do Moodle expirada');
        }

        const count = parsePendingEvaluationCount(html);
        if (count === null) throw new Error('Campo “Precisa de avaliação” não encontrado');

        const verifiedCount = count > 0
          ? (await collectPendingRows(assignment, count, { requireSessionKey: false })).selectedUsers.length
          : 0;

        return verifiedCount;
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    COURSE_BADGE_STATE.inFlight.set(assignment.assignmentId, request);
    try {
      return await request;
    } finally {
      COURSE_BADGE_STATE.inFlight.delete(assignment.assignmentId);
    }
  }

  function placePendingSummaryAtTop(main, summary) {
    const marker = main.querySelector('#maincontent') || document.querySelector('#maincontent');
    if (marker?.parentElement) {
      marker.insertAdjacentElement('afterend', summary);
      return;
    }

    const notifications = main.querySelector(':scope > .notifications, .notifications');
    if (notifications?.parentElement) {
      notifications.insertAdjacentElement('afterend', summary);
      return;
    }

    main.prepend(summary);
  }

  function ensureCoursePendingSummary() {
    let summary = document.getElementById('mqi-course-pending-summary');
    if (summary) return summary;

    const main = document.querySelector('[role="main"]') || document.querySelector('#region-main') || document.body;
    summary = document.createElement('div');
    summary.id = 'mqi-course-pending-summary';
    summary.className = 'mqi-course-pending-summary is-loading';
    summary.innerHTML = `
      <span class="mqi-course-pending-summary__icon" aria-hidden="true">✓</span>
      <span class="mqi-course-pending-summary__text">Consultando atividades que precisam de avaliação…</span>
      <span class="mqi-course-pending-summary__actions">
        <button type="button" class="mqi-course-pending-summary__download" title="Baixar somente os envios pendentes de correção deste curso" aria-label="Baixar somente os envios pendentes de correção deste curso" hidden>↓ <span>Baixar pendentes</span></button>
        <button type="button" class="mqi-course-pending-summary__refresh" title="Atualizar contagens" aria-label="Atualizar contagens">↻</button>
      </span>
    `;

    placePendingSummaryAtTop(main, summary);

    summary.querySelector('.mqi-course-pending-summary__refresh')?.addEventListener('click', () => {
      clearCourseBadgeCache();
      scanCoursePendingCorrections({ force: true });
    });
    summary.querySelector('.mqi-course-pending-summary__download')?.addEventListener('click', event => {
      startCourseSubmissionDownloads(event.currentTarget);
    });
    return summary;
  }

  function updateCoursePendingSummary(assignments, errorCount = 0) {
    const summary = ensureCoursePendingSummary();
    const text = summary.querySelector('.mqi-course-pending-summary__text');
    const values = assignments
      .map(item => COURSE_BADGE_STATE.results.get(item.assignmentId))
      .filter(value => Number.isFinite(value));
    const totalPending = values.reduce((sum, value) => sum + value, 0);
    const activitiesPending = values.filter(value => value > 0).length;
    const downloadButton = summary.querySelector('.mqi-course-pending-summary__download');
    const stillLoading = assignments.some(item => {
      const hasResult = Number.isFinite(COURSE_BADGE_STATE.results.get(item.assignmentId));
      const hasLoadingBadge = Boolean(item.iconHost?.querySelector?.('.mqi-pending-badge--loading'));
      return !hasResult && hasLoadingBadge;
    }) || assignments.some(item => COURSE_BADGE_STATE.inFlight.has(item.assignmentId));

    summary.classList.toggle('is-loading', stillLoading);
    summary.classList.toggle('has-pending', totalPending > 0);
    summary.classList.toggle('is-clear', !stillLoading && totalPending === 0 && errorCount === 0);
    summary.classList.toggle('has-error', errorCount > 0);
    if (downloadButton) downloadButton.hidden = !pendingFeatureEnabled('pendingDownloads') || totalPending === 0;

    if (stillLoading) {
      text.textContent = 'Consultando atividades que precisam de avaliação…';
      return;
    }

    if (totalPending > 0) {
      text.innerHTML = `<strong>${totalPending}</strong> ${totalPending === 1 ? 'envio pendente' : 'envios pendentes'} em <strong>${activitiesPending}</strong> ${activitiesPending === 1 ? 'atividade' : 'atividades'}.`;
    } else if (errorCount > 0) {
      text.textContent = `Nenhuma pendência identificada. ${errorCount} ${errorCount === 1 ? 'atividade não pôde' : 'atividades não puderam'} ser consultada${errorCount === 1 ? '' : 's'}.`;
    } else {
      text.textContent = 'Nenhuma atividade precisa de avaliação neste momento.';
    }
  }

  async function runWithConcurrency(items, limit, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        await worker(item);
      }
    });
    await Promise.all(runners);
  }

  async function scanCoursePendingCorrections({ force = false } = {}) {
    if (!isCourseViewPage()) return;

    const assignments = collectCourseAssignments();
    if (!assignments.length) return;

    ensureCoursePendingSummary();
    let errorCount = 0;

    assignments.forEach(assignment => {
      const known = force ? undefined : COURSE_BADGE_STATE.results.get(assignment.assignmentId);
      if (Number.isFinite(known)) {
        ensurePendingBadge(assignment, known > 0 ? 'pending' : 'empty', known);
      } else {
        ensurePendingBadge(assignment, 'loading');
      }
    });
    updateCoursePendingSummary(assignments, errorCount);

    const toFetch = assignments.filter(assignment => force || !Number.isFinite(COURSE_BADGE_STATE.results.get(assignment.assignmentId)));
    await runWithConcurrency(toFetch, 4, async assignment => {
      try {
        const count = await fetchPendingEvaluationCount(assignment);
        COURSE_BADGE_STATE.results.set(assignment.assignmentId, count);
        ensurePendingBadge(assignment, count > 0 ? 'pending' : 'empty', count);
      } catch (error) {
        errorCount += 1;
        console.warn(`Não foi possível consultar a atividade ${assignment.assignmentId}.`, error);
        ensurePendingBadge(assignment, 'error', null, error?.message || 'Falha na consulta');
      } finally {
        updateCoursePendingSummary(assignments, errorCount);
      }
    });

    updateCoursePendingSummary(assignments, errorCount);
  }

  function scheduleCoursePendingScan(delay = 250) {
    if (!isCourseViewPage()) return;
    window.clearTimeout(COURSE_BADGE_STATE.scanTimer);
    COURSE_BADGE_STATE.scanTimer = window.setTimeout(() => scanCoursePendingCorrections(), delay);
  }

  function installCoursePendingObserver() {
    if (!isCourseViewPage()) return;
    scheduleCoursePendingScan(50);

    const observer = new MutationObserver(mutations => {
      const addedAssignment = mutations.some(mutation => [...mutation.addedNodes].some(node => {
        if (!(node instanceof Element)) return false;
        return node.matches?.('li.activity.assign.modtype_assign, li.activity.modtype_assign')
          || Boolean(node.querySelector?.('li.activity.assign.modtype_assign, li.activity.modtype_assign'));
      }));
      if (addedAssignment) scheduleCoursePendingScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        clearCourseBadgeCache();
        scanCoursePendingCorrections({ force: true });
      }
    });
  }


  function isCategoryPage() {
    const url = new URL(window.location.href);
    return /\/course\/index\.php$/.test(url.pathname) && url.searchParams.has('categoryid');
  }

  function getCourseIdFromUrl(href) {
    try {
      const url = new URL(href, window.location.href);
      if (!/\/course\/view\.php$/.test(url.pathname)) return '';
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function parseCategoryDate(value) {
    const match = String(value || '').match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
    if (!match) return null;

    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return timestamp;
  }

  function isFutureCategoryCourse(container) {
    const startTimestamp = parseCategoryDate(container?.textContent || '');
    if (!Number.isFinite(startTimestamp)) return false;

    const today = new Date();
    const todayTimestamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return startTimestamp > todayTimestamp;
  }

  function collectCategoryCourses(root = document) {
    const main = root.querySelector?.('[role="main"], #region-main') || root;
    const links = [...main.querySelectorAll('a[href*="/course/view.php"]')];
    const found = new Map();

    links.forEach(link => {
      if (link.closest('nav, .breadcrumb, .navbar, .primary-navigation, .secondary-navigation, .pagination')) return;
      const courseId = getCourseIdFromUrl(link.href);
      if (!courseId || found.has(courseId)) return;

      const container = link.closest('.coursebox, .course-card, .dashboard-card, [data-courseid], li.course, .card, .course-summaryitem, .course-listitem')
        || link.closest('li, article, section, div');
      if (!container) return;

      const nameNode = container.querySelector('.coursename a[href*="/course/view.php"], .course-name a[href*="/course/view.php"], [data-region="course-name"] a[href*="/course/view.php"], h3 a[href*="/course/view.php"], h4 a[href*="/course/view.php"]') || link;
      const name = (nameNode.textContent || link.textContent || `Curso ${courseId}`).replace(/\s+/g, ' ').trim();
      if (!name) return;
      if (isFutureCategoryCourse(container)) return;

      const titleHost = nameNode.closest('.coursename, .course-name, [data-region="course-name"], h3, h4') || nameNode.parentElement || container;
      found.set(courseId, { courseId, link: nameNode, container, titleHost, name });
    });

    return [...found.values()];
  }

  function clearCategoryPendingCache(courses = collectCategoryCourses()) {
    courses.forEach(course => {
      const result = CATEGORY_PENDING_STATE.results.get(course.courseId);
      (result?.assignmentIds || []).forEach(assignmentId => {
        COURSE_BADGE_STATE.results.delete(assignmentId);
      });
      CATEGORY_PENDING_STATE.results.delete(course.courseId);
    });
  }

  function ensureCategoryCourseBadge(course, state = 'loading', result = null, message = '') {
    if (!(course.titleHost instanceof Element)) return null;
    let badge = course.titleHost.querySelector(`.mqi-category-pending-badge[data-course-id="${CSS.escape(course.courseId)}"]`);

    if (!pendingFeatureEnabled('pendingBadges')) {
      badge?.remove();
      course.container.classList.remove('mqi-category-course-has-pending', 'mqi-category-course-is-clear');
      delete course.container.dataset.mqiPendingCount;
      return null;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.courseId = course.courseId;
      badge.className = 'mqi-category-pending-badge';
      badge.setAttribute('aria-live', 'polite');
      course.titleHost.appendChild(badge);
    }

    course.container.classList.remove('mqi-category-course-has-pending', 'mqi-category-course-is-clear');
    delete course.container.dataset.mqiPendingCount;

    badge.className = `mqi-category-pending-badge mqi-category-pending-badge--${state}`;
    if (state === 'pending') {
      const total = result.totalPending;
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.title = `${total} ${total === 1 ? 'envio pendente' : 'envios pendentes'} em ${result.activitiesPending} ${result.activitiesPending === 1 ? 'atividade' : 'atividades'} de ${course.name}${result.errors ? ' (leitura parcial)' : ''}`;
      badge.setAttribute('aria-label', badge.title);
      course.container.classList.add('mqi-category-course-has-pending');
      course.container.dataset.mqiPendingCount = String(total);
    } else if (state === 'clear') {
      const assignmentCount = Number(result?.assignmentCount) || 0;
      badge.textContent = '✓';
      badge.title = assignmentCount > 0
        ? `${course.name} foi verificada: nenhuma correção pendente em ${assignmentCount} ${assignmentCount === 1 ? 'atividade consultada' : 'atividades consultadas'}.`
        : `${course.name} foi verificada: nenhuma atividade do tipo Tarefa foi encontrada.`;
      badge.setAttribute('aria-label', badge.title);
      course.container.classList.add('mqi-category-course-is-clear');
    } else if (state === 'error') {
      badge.textContent = '!';
      badge.title = message || `Não foi possível consultar as pendências de ${course.name}`;
      badge.setAttribute('aria-label', badge.title);
    } else {
      badge.textContent = '…';
      badge.title = `Consultando pendências de ${course.name}`;
      badge.setAttribute('aria-label', badge.title);
    }
    return badge;
  }

  function discoverAssignmentsFromCourseDocument(doc, baseUrl) {
    const found = new Map();
    const cards = [...doc.querySelectorAll('li.activity.assign.modtype_assign, li.activity.modtype_assign')];

    cards.forEach(card => {
      const link = card.querySelector('.activitytitle.modtype_assign a[href*="/mod/assign/view.php"], a[href*="/mod/assign/view.php"]');
      if (!link) return;
      const href = new URL(link.getAttribute('href') || link.href, baseUrl).href;
      const assignmentId = getAssignmentIdFromUrl(href);
      if (!assignmentId || found.has(assignmentId)) return;
      const name = extractCourseActivityName(card, link);
      found.set(assignmentId, {
        assignmentId,
        name,
        link: { href },
        card,
        iconHost: null,
      });
    });
    return [...found.values()];
  }

  async function fetchHtmlDocument(url, label) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      const finalUrl = new URL(response.url, window.location.href);
      if (finalUrl.origin !== window.location.origin) throw new Error(`${label}: redirecionamento não autorizado`);
      const html = await response.text();
      if (/\/login\//.test(finalUrl.pathname) || (/name=["']username["']/i.test(html) && /name=["']password["']/i.test(html))) {
        throw new Error('Sessão do Moodle expirada');
      }
      return { doc: new DOMParser().parseFromString(html, 'text/html'), finalUrl: finalUrl.href };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${label}: tempo limite excedido`);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchCategoryCoursePending(course) {
    if (CATEGORY_PENDING_STATE.inFlight.has(course.courseId)) {
      return CATEGORY_PENDING_STATE.inFlight.get(course.courseId);
    }

    const request = (async () => {
      const { doc, finalUrl } = await fetchHtmlDocument(course.link.href, `Curso ${course.name}`);
      const assignments = discoverAssignmentsFromCourseDocument(doc, finalUrl);
      let errors = 0;
      const counts = new Map();

      await runWithConcurrency(assignments, 3, async assignment => {
        try {
          const count = await fetchPendingEvaluationCount(assignment);
          COURSE_BADGE_STATE.results.set(assignment.assignmentId, count);
          counts.set(assignment.assignmentId, count);
        } catch (error) {
          errors += 1;
          console.warn(`Não foi possível consultar a atividade ${assignment.assignmentId} do curso ${course.courseId}.`, error);
        }
      });

      const values = [...counts.values()];
      const result = {
        totalPending: values.reduce((sum, count) => sum + count, 0),
        activitiesPending: values.filter(count => count > 0).length,
        assignmentCount: assignments.length,
        assignmentIds: assignments.map(item => item.assignmentId),
        errors,
      };
      return result;
    })();

    CATEGORY_PENDING_STATE.inFlight.set(course.courseId, request);
    try {
      return await request;
    } finally {
      CATEGORY_PENDING_STATE.inFlight.delete(course.courseId);
    }
  }

  function ensureCategoryPendingSummary() {
    let summary = document.getElementById('mqi-category-pending-summary');
    if (summary) return summary;

    const main = document.querySelector('[role="main"]') || document.querySelector('#region-main') || document.body;
    summary = document.createElement('div');
    summary.id = 'mqi-category-pending-summary';
    summary.className = 'mqi-course-pending-summary mqi-category-pending-summary is-loading';
    summary.innerHTML = `
      <span class="mqi-course-pending-summary__icon" aria-hidden="true">✓</span>
      <span class="mqi-course-pending-summary__text">Consultando pendências dos cursos exibidos…</span>
      <span class="mqi-course-pending-summary__actions">
        <button type="button" class="mqi-course-pending-summary__download" title="Baixar somente os envios pendentes de correção dos cursos exibidos" aria-label="Baixar somente os envios pendentes de correção dos cursos exibidos" hidden>↓ <span>Baixar pendentes</span></button>
        <button type="button" class="mqi-course-pending-summary__refresh" title="Atualizar contagens" aria-label="Atualizar contagens">↻</button>
      </span>
    `;
    placePendingSummaryAtTop(main, summary);

    summary.querySelector('.mqi-course-pending-summary__refresh')?.addEventListener('click', () => {
      clearCategoryPendingCache();
      scanCategoryPendingCorrections({ force: true });
    });
    summary.querySelector('.mqi-course-pending-summary__download')?.addEventListener('click', event => {
      startCategorySubmissionDownloads(event.currentTarget);
    });
    return summary;
  }

  function updateCategoryPendingSummary(courses, errorCount = 0) {
    const summary = ensureCategoryPendingSummary();
    const text = summary.querySelector('.mqi-course-pending-summary__text');
    const results = courses.map(course => CATEGORY_PENDING_STATE.results.get(course.courseId)).filter(Boolean);
    const totalPending = results.reduce((sum, result) => sum + result.totalPending, 0);
    const activitiesPending = results.reduce((sum, result) => sum + result.activitiesPending, 0);
    const coursesPending = results.filter(result => result.totalPending > 0).length;
    const downloadButton = summary.querySelector('.mqi-course-pending-summary__download');
    const stillLoading = courses.some(course => CATEGORY_PENDING_STATE.inFlight.has(course.courseId))
      || courses.some(course => !CATEGORY_PENDING_STATE.results.has(course.courseId) && course.titleHost?.querySelector('.mqi-category-pending-badge--loading'));

    summary.classList.toggle('is-loading', stillLoading);
    summary.classList.toggle('has-pending', totalPending > 0);
    summary.classList.toggle('is-clear', !stillLoading && totalPending === 0 && errorCount === 0);
    summary.classList.toggle('has-error', errorCount > 0);
    if (downloadButton) downloadButton.hidden = !pendingFeatureEnabled('pendingDownloads') || totalPending === 0;

    if (stillLoading) {
      text.textContent = 'Consultando pendências dos cursos exibidos…';
    } else if (totalPending > 0) {
      text.innerHTML = `<strong>${totalPending}</strong> ${totalPending === 1 ? 'envio pendente' : 'envios pendentes'} em <strong>${activitiesPending}</strong> ${activitiesPending === 1 ? 'atividade' : 'atividades'} de <strong>${coursesPending}</strong> ${coursesPending === 1 ? 'curso' : 'cursos'}.`;
    } else if (errorCount > 0) {
      text.textContent = `Nenhuma pendência confirmada. ${errorCount} ${errorCount === 1 ? 'curso teve' : 'cursos tiveram'} leitura parcial.`;
    } else {
      text.textContent = 'Nenhuma correção pendente nos cursos exibidos nesta categoria.';
    }
  }

  async function scanCategoryPendingCorrections({ force = false } = {}) {
    if (!isCategoryPage()) return;
    const courses = collectCategoryCourses();
    if (!courses.length) return;

    ensureCategoryPendingSummary();
    let errorCount = 0;

    courses.forEach(course => {
      const cached = force ? null : CATEGORY_PENDING_STATE.results.get(course.courseId);
      if (cached) {
        CATEGORY_PENDING_STATE.results.set(course.courseId, cached);
        ensureCategoryCourseBadge(course, cached.totalPending > 0 ? 'pending' : (cached.errors > 0 ? 'error' : 'clear'), cached, cached.errors ? 'A leitura deste curso foi parcial' : '');
      } else {
        ensureCategoryCourseBadge(course, 'loading');
      }
    });
    updateCategoryPendingSummary(courses, errorCount);

    const toFetch = courses.filter(course => force || !CATEGORY_PENDING_STATE.results.has(course.courseId));
    await runWithConcurrency(toFetch, 2, async course => {
      try {
        const result = await fetchCategoryCoursePending(course);
        CATEGORY_PENDING_STATE.results.set(course.courseId, result);
        ensureCategoryCourseBadge(course, result.totalPending > 0 ? 'pending' : (result.errors > 0 ? 'error' : 'clear'), result, result.errors ? 'A leitura deste curso foi parcial' : '');
        if (result.errors > 0) errorCount += 1;
      } catch (error) {
        errorCount += 1;
        console.warn(`Não foi possível consultar o curso ${course.courseId}.`, error);
        ensureCategoryCourseBadge(course, 'error', null, error?.message || 'Falha na consulta');
      } finally {
        updateCategoryPendingSummary(courses, errorCount);
      }
    });
    updateCategoryPendingSummary(courses, errorCount);
  }

  function scheduleCategoryPendingScan(delay = 300) {
    if (!isCategoryPage()) return;
    window.clearTimeout(CATEGORY_PENDING_STATE.scanTimer);
    CATEGORY_PENDING_STATE.scanTimer = window.setTimeout(() => scanCategoryPendingCorrections(), delay);
  }

  function installCategoryPendingObserver() {
    if (!isCategoryPage()) return;
    scheduleCategoryPendingScan(80);

    const observer = new MutationObserver(mutations => {
      const addedCourse = mutations.some(mutation => [...mutation.addedNodes].some(node => {
        if (!(node instanceof Element)) return false;
        return node.matches?.('a[href*="/course/view.php"], .coursebox, .course-card, [data-courseid]')
          || Boolean(node.querySelector?.('a[href*="/course/view.php"]'));
      }));
      if (addedCourse) scheduleCategoryPendingScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        clearCategoryPendingCache();
        scanCategoryPendingCorrections({ force: true });
      }
    });
  }


  function extractSummaryNumberFromDocument(doc, labels) {
    const accepted = labels.map(normalizeText);
    const rows = [...doc.querySelectorAll('.gradingsummarytable tr, .submissionstatustable tr, [data-region="grading-summary"] tr')];
    for (const row of rows) {
      const heading = row.querySelector('th, td:first-child');
      const label = normalizeText(heading?.textContent || '');
      if (!accepted.includes(label)) continue;
      const valueCell = row.querySelector('td:last-child');
      const match = (valueCell?.textContent || '').replace(/\D/g, '').match(/\d+/);
      return match ? Number.parseInt(match[0], 10) : 0;
    }
    return null;
  }

  function getCurrentCourseName() {
    const selectors = [
      '.page-header-headings h1',
      '.page-context-header h1',
      '#page-header h1',
      '[role="main"] h1',
      'h1'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = (node?.textContent || '').replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    return document.title.replace(/\s*[|–-].*$/, '').trim() || 'Curso Moodle';
  }

  function getCurrentCategoryName() {
    const selectors = [
      '.page-header-headings h1',
      '.page-context-header h1',
      '#page-header h1',
      '[role="main"] h1',
      'h1'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = (node?.textContent || '').replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    const id = new URL(window.location.href).searchParams.get('categoryid');
    return id ? `Categoria ${id}` : 'Categoria Moodle';
  }

  function sanitizeDownloadPathSegment(value, fallback = 'Sem nome') {
    const sanitized = sanitizeFileName(value)
      .replace(/^\.+/, '')
      .replace(/[\/\\]+/g, ' - ')
      .trim()
      .slice(0, 90);
    return sanitized || fallback;
  }

  function buildAssignmentGradingUrl(assignment, page = 0, perPage = 500) {
    const url = new URL(assignment.link.href, window.location.href);
    url.search = '';
    url.searchParams.set('id', assignment.assignmentId);
    url.searchParams.set('action', 'grading');
    url.searchParams.set('status', 'requiregrading');
    url.searchParams.set('perpage', String(perPage));
    url.searchParams.set('page', String(page));
    return url.href;
  }

  function extractSessionKey(doc) {
    const input = doc.querySelector('input[name="sesskey"][value]');
    if (input?.value) return input.value;

    const link = [...doc.querySelectorAll('a[href*="sesskey="]')].find(item => {
      try {
        return Boolean(new URL(item.getAttribute('href') || item.href, window.location.href).searchParams.get('sesskey'));
      } catch {
        return false;
      }
    });
    if (link) {
      try {
        return new URL(link.getAttribute('href') || link.href, window.location.href).searchParams.get('sesskey') || '';
      } catch {
        // Continua para a leitura dos scripts da página.
      }
    }

    const html = doc.documentElement?.innerHTML || '';
    const patterns = [
      /["']sesskey["']\s*:\s*["']([^"']+)["']/i,
      /M\.cfg\.sesskey\s*=\s*["']([^"']+)["']/i,
      /sesskey=([A-Za-z0-9]+)/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  function extractPendingUserIds(doc) {
    const candidateIds = [];
    const pendingIds = [];
    const rows = [...doc.querySelectorAll('table#submissions tbody tr, table.gradingtable tbody tr, .gradingtable table tbody tr')];

    const readFeedback = row => {
      const field = row.querySelector('textarea[name^="quickgrade_comments_"], textarea[id^="quickgrade_comments_"]');
      return (field?.value || field?.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const readGrade = row => {
      const cell = row.querySelector('td.grade, td[data-field="grade"], td[id$="_c4"]');
      if (!cell) return '';

      const input = cell.querySelector('input.quickgrade, input[name^="quickgrade_"]');
      if (input) return (input.value || input.getAttribute('value') || '').trim();

      const clone = cell.cloneNode(true);
      clone.querySelectorAll('a, button, input, select, textarea, .action-menu, [role="menu"], .commands, .visually-hidden, .accesshide, .sr-only')
        .forEach(node => node.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const hasGrade = value => {
      const compact = String(value || '').replace(/\s+/g, '').toLowerCase();
      return Boolean(compact) && !['-', '–', '—', 'n/a', 'na'].includes(compact);
    };

    rows.forEach(row => {
      const selector = row.querySelector('input[name="selectedusers"][value], input[id^="selectuser_"][value]');
      const raw = selector?.value || (selector?.id || '').replace(/^selectuser_/, '');
      if (!/^\d+$/.test(raw || '')) return;

      candidateIds.push(raw);
      if (!readFeedback(row) && !hasGrade(readGrade(row))) pendingIds.push(raw);
    });

    return {
      candidateIds: [...new Set(candidateIds)],
      pendingIds: [...new Set(pendingIds)],
    };
  }

  function knownPendingCount(assignment) {
    const inMemory = COURSE_BADGE_STATE.results.get(assignment.assignmentId);
    if (Number.isFinite(inMemory)) return inMemory;
    return null;
  }

  async function collectPendingRows(assignment, expectedPending, { requireSessionKey = true } = {}) {
    const perPage = 500;
    const maximumPages = 50;
    const candidates = new Set();
    const selected = new Set();
    let sesskey = '';
    let finalOrigin = window.location.origin;

    for (let page = 0; page < maximumPages; page += 1) {
      const gradingUrl = buildAssignmentGradingUrl(assignment, page, perPage);
      const { doc, finalUrl } = await fetchHtmlDocument(gradingUrl, `Pendências de ${assignment.name}, página ${page + 1}`);
      const parsedUrl = new URL(finalUrl, window.location.href);
      finalOrigin = parsedUrl.origin;
      sesskey = sesskey || extractSessionKey(doc);

      const pageResult = extractPendingUserIds(doc);
      const before = candidates.size;
      pageResult.candidateIds.forEach(id => candidates.add(id));
      pageResult.pendingIds.forEach(id => selected.add(id));
      const added = candidates.size - before;

      if (!pageResult.candidateIds.length || added === 0) break;
    }

    if (requireSessionKey && !sesskey) {
      throw new Error(`Não foi possível localizar a chave de segurança da atividade ${assignment.name}.`);
    }
    if (Number.isFinite(expectedPending) && expectedPending > 0 && !candidates.size) {
      throw new Error(`O Moodle informou pendências em ${assignment.name}, mas não retornou alunos no filtro “Requer notas”.`);
    }
    if (Number.isFinite(expectedPending) && candidates.size < expectedPending) {
      throw new Error(`A leitura de ${assignment.name} ficou incompleta: ${candidates.size} de ${expectedPending} candidatos foram identificados.`);
    }

    return {
      selectedUsers: [...selected],
      candidateUsers: [...candidates],
      sesskey,
      postUrl: `${finalOrigin}/mod/assign/view.php`,
    };
  }

  async function collectPendingSelection(assignment, expectedPending) {
    return collectPendingRows(assignment, expectedPending);
  }

  async function collectPendingDownloadMetadata(assignment) {
    let pending = knownPendingCount(assignment);
    if (!Number.isFinite(pending)) {
      pending = await fetchPendingEvaluationCount(assignment);
      COURSE_BADGE_STATE.results.set(assignment.assignmentId, pending);
    }

    if (pending <= 0) {
      return { ...assignment, pending, selectedUsers: [], postUrl: '', sesskey: '' };
    }

    const selection = await collectPendingSelection(assignment, pending);
    return {
      ...assignment,
      pending,
      ...selection,
    };
  }

  async function requestPendingArchive(item) {
    if (!item.postUrl || !item.sesskey || !item.selectedUsers?.length) {
      throw new Error(`Dados insuficientes para baixar as pendências de ${item.name}.`);
    }

    const body = new URLSearchParams();
    body.set('id', item.assignmentId);
    body.set('action', 'gradingbatchoperation');
    body.set('operation', 'downloadselected');
    body.set('selectedusers', item.selectedUsers.join(','));
    body.set('returnaction', 'grading');
    body.set('sesskey', item.sesskey);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(item.postUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'Accept': 'application/zip,application/octet-stream,text/html;q=0.8,*/*;q=0.5',
        },
        body,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const finalUrl = new URL(response.url, window.location.href);
      if (finalUrl.origin !== window.location.origin) throw new Error('Redirecionamento para domínio não autorizado');
      if (/\/login\//.test(finalUrl.pathname)) throw new Error('Sessão do Moodle expirada');

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const disposition = (response.headers.get('content-disposition') || '').toLowerCase();
      if (contentType.includes('text/html') && !disposition.includes('attachment')) {
        const html = await response.text();
        const errorDoc = new DOMParser().parseFromString(html, 'text/html');
        const errorText = (errorDoc.querySelector('.alert-danger, .error, [role="alert"]')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        throw new Error(errorText || 'O Moodle não gerou o arquivo ZIP dos alunos selecionados.');
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error('O arquivo ZIP retornado pelo Moodle está vazio.');
      return blob;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Tempo limite excedido ao gerar o ZIP de ${item.name}.`);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function createDownloadToken() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/[^a-z0-9]/gi, '');
  }

  function registerDownloadFilename(token, filename) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        resolve({ fallback: true });
        return;
      }
      chrome.runtime.sendMessage({
        type: 'mqi-register-pending-download',
        token,
        filename,
      }, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'Não foi possível preparar o nome do download.'));
          return;
        }
        resolve(response);
      });
    });
  }

  async function startBlobDownload(blob, filename) {
    const token = createDownloadToken();
    const fallbackName = `mqi-pending-${token}.zip`;
    const registration = await registerDownloadFilename(token, filename);

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = registration?.fallback ? (filename.split('/').pop() || 'pendentes.zip') : fallbackName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
  }

  function setDownloadButtonState(button, text, busy = false) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    const label = button.querySelector('span');
    if (label) label.textContent = text;
    else button.textContent = text;
  }

  async function preparePendingAssignments(assignments, button) {
    const candidates = assignments.filter(assignment => {
      const known = knownPendingCount(assignment);
      return known === null || known > 0;
    });
    const metadata = new Array(candidates.length);
    let completed = 0;

    await runWithConcurrency(candidates, 2, async assignment => {
      const index = candidates.indexOf(assignment);
      try {
        metadata[index] = await collectPendingDownloadMetadata(assignment);
      } catch (error) {
        metadata[index] = {
          ...assignment,
          error: error?.message || String(error),
          pending: knownPendingCount(assignment),
          selectedUsers: [],
        };
      } finally {
        completed += 1;
        setDownloadButtonState(button, `Preparando ${completed}/${candidates.length}`, true);
      }
    });

    return metadata.filter(Boolean);
  }

  async function beginPendingDownloads(items, rootSegments, button) {
    let started = 0;
    let failed = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const pendingCount = item.selectedUsers.length;
      const fileName = `${sanitizeDownloadPathSegment(item.name, `Atividade ${item.assignmentId}`)} - ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}.zip`;
      const filename = [...rootSegments, fileName].map(segment => sanitizeDownloadPathSegment(segment)).join('/');
      setDownloadButtonState(button, `Baixando ${index + 1}/${items.length}`, true);
      try {
        const blob = await requestPendingArchive(item);
        await startBlobDownload(blob, filename);
        started += 1;
      } catch (error) {
        failed += 1;
        console.error(`Falha ao baixar as pendências de ${item.name}.`, error);
      }
      await new Promise(resolve => window.setTimeout(resolve, 350));
    }
    return { started, failed };
  }

  async function startCourseSubmissionDownloads(button) {
    if (!pendingFeatureEnabled('pendingDownloads') || BULK_DOWNLOAD_STATE.running || !isCourseViewPage()) return;
    const assignments = collectCourseAssignments();
    if (!assignments.length) {
      window.alert('Nenhuma atividade do tipo Tarefa foi encontrada nesta página.');
      return;
    }

    BULK_DOWNLOAD_STATE.running = true;
    setDownloadButtonState(button, 'Preparando…', true);
    try {
      const metadata = await preparePendingAssignments(assignments, button);
      const downloadable = metadata.filter(item => item.selectedUsers?.length > 0 && !item.error);
      const unreadable = metadata.filter(item => item.error).length;
      if (!downloadable.length) {
        window.alert(unreadable
          ? 'Nenhuma pendência pôde ser preparada. Algumas atividades não puderam ser consultadas.'
          : 'Nenhuma atividade deste curso possui envios pendentes de correção.');
        return;
      }

      const totalPending = downloadable.reduce((sum, item) => sum + item.selectedUsers.length, 0);
      const confirmed = window.confirm(`Serão gerados ${downloadable.length} arquivos ZIP com ${totalPending} ${totalPending === 1 ? 'envio pendente' : 'envios pendentes'} de correção. Nenhum envio já avaliado será incluído. Continuar?`);
      if (!confirmed) return;

      const result = await beginPendingDownloads(
        downloadable,
        ['Moodle - Pendentes de correção', getCurrentCourseName()],
        button
      );
      window.alert(`${result.started} ${result.started === 1 ? 'download foi iniciado' : 'downloads foram iniciados'}${result.failed ? `. ${result.failed} falharam.` : '.'}`);
    } catch (error) {
      console.error('Falha no download das pendências do curso.', error);
      window.alert(`Não foi possível preparar os downloads: ${error?.message || error}`);
    } finally {
      BULK_DOWNLOAD_STATE.running = false;
      setDownloadButtonState(button, 'Baixar pendentes', false);
    }
  }

  async function collectCategoryPendingDownloadItems(courses, button) {
    const courseResults = new Array(courses.length);
    let completedCourses = 0;
    await runWithConcurrency(courses, 2, async course => {
      const courseIndex = courses.indexOf(course);
      try {
        const { doc, finalUrl } = await fetchHtmlDocument(course.link.href, `Curso ${course.name}`);
        const assignments = discoverAssignmentsFromCourseDocument(doc, finalUrl);
        const metadata = await preparePendingAssignments(assignments, button);
        courseResults[courseIndex] = {
          course,
          items: metadata.filter(item => item.selectedUsers?.length > 0 && !item.error),
          errors: metadata.filter(item => item.error).length,
        };
      } catch (error) {
        courseResults[courseIndex] = { course, items: [], errors: 1, error: error?.message || String(error) };
      } finally {
        completedCourses += 1;
        setDownloadButtonState(button, `Cursos ${completedCourses}/${courses.length}`, true);
      }
    });
    return courseResults.filter(Boolean);
  }

  async function startCategorySubmissionDownloads(button) {
    if (!pendingFeatureEnabled('pendingDownloads') || BULK_DOWNLOAD_STATE.running || !isCategoryPage()) return;
    const courses = collectCategoryCourses();
    if (!courses.length) {
      window.alert('Nenhum curso foi encontrado nesta página de categoria.');
      return;
    }

    const initialConfirm = window.confirm(`A extensão consultará os ${courses.length} cursos exibidos e preparará somente os envios que ainda requerem correção. Continuar?`);
    if (!initialConfirm) return;

    BULK_DOWNLOAD_STATE.running = true;
    setDownloadButtonState(button, 'Preparando…', true);
    try {
      const courseResults = await collectCategoryPendingDownloadItems(courses, button);
      const entries = courseResults.flatMap(result => result.items.map(item => ({ ...item, course: result.course })));
      const errors = courseResults.reduce((sum, result) => sum + result.errors, 0);
      if (!entries.length) {
        window.alert(errors
          ? 'Nenhuma pendência pôde ser preparada. Alguns cursos ou atividades não puderam ser consultados.'
          : 'Nenhum curso exibido possui envios pendentes de correção.');
        return;
      }

      const totalPending = entries.reduce((sum, item) => sum + item.selectedUsers.length, 0);
      const confirmed = window.confirm(`Serão gerados ${entries.length} arquivos ZIP com ${totalPending} ${totalPending === 1 ? 'envio pendente' : 'envios pendentes'}, organizados por categoria, curso e atividade.${errors ? ` Houve ${errors} falhas de leitura que serão ignoradas.` : ''} Continuar?`);
      if (!confirmed) return;

      let started = 0;
      let failed = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        setDownloadButtonState(button, `Baixando ${index + 1}/${entries.length}`, true);
        const pendingCount = entry.selectedUsers.length;
        const fileName = `${sanitizeDownloadPathSegment(entry.name, `Atividade ${entry.assignmentId}`)} - ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}.zip`;
        const filename = [
          'Moodle - Pendentes de correção',
          getCurrentCategoryName(),
          entry.course.name,
          fileName,
        ].map(segment => sanitizeDownloadPathSegment(segment)).join('/');
        try {
          const blob = await requestPendingArchive(entry);
          await startBlobDownload(blob, filename);
          started += 1;
        } catch (error) {
          failed += 1;
          console.error(`Falha ao baixar ${entry.course.name} / ${entry.name}.`, error);
        }
        await new Promise(resolve => window.setTimeout(resolve, 350));
      }
      window.alert(`${started} ${started === 1 ? 'download foi iniciado' : 'downloads foram iniciados'}${failed ? `. ${failed} falharam.` : '.'}`);
    } catch (error) {
      console.error('Falha no download das pendências da categoria.', error);
      window.alert(`Não foi possível preparar os downloads: ${error?.message || error}`);
    } finally {
      BULK_DOWNLOAD_STATE.running = false;
      setDownloadButtonState(button, 'Baixar pendentes', false);
    }
  }

  async function initializeContentScript() {
    await loadPendingFeatureSettings();
    createUI();
    if (pendingFeatureEnabled('coursePendingChecks')) installCoursePendingObserver();
    if (pendingFeatureEnabled('categoryPendingChecks')) installCategoryPendingObserver();
    installStudentDownloadRenaming();
  }

  initializeContentScript();

  let downloadScanTimer = null;
  const downloadObserver = new MutationObserver(mutations => {
    window.clearTimeout(downloadScanTimer);
    downloadScanTimer = window.setTimeout(() => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          if (node.matches?.('a[href*="assignsubmission_file"]')) prepareStudentDownloadLink(node);
          installStudentDownloadRenaming(node);
        });
      }
      installStudentDownloadRenaming();
    }, 100);
  });
  downloadObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
