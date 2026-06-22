(() => {
  'use strict';

  const STATE = {
    records: [],
    fileName: '',
    lastReport: null,
    validationWarnings: [],
  };

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
    ]
  };

  const TEMPLATE_CSV_WITH_GRADE = [
    'nome;nota;feedback',
    'Nome Completo do Aluno;45;Feedback objetivo e individualizado para o aluno.',
  ].join('\n');

  const CORRECTION_PROMPT = [
    'Corrija as atividades dos alunos e gere uma planilha para importação no Moodle.',
    '',
    'Retorne somente CSV separado por ponto e vírgula, sem Markdown e sem texto adicional.',
    'Use exatamente estes cabeçalhos:',
    'nome;nota;feedback',
    '',
    'Dados de entrada:',
    '- Lista de alunos e entregas exportadas do Moodle.',
    '- Enunciado da atividade, quando disponível.',
    '- Critérios de avaliação, rubrica ou orientações da atividade, quando disponíveis.',
    '- Nota máxima ou escala de avaliação, quando disponível.',
    '',
    'Regras gerais:',
    '- Preserve o nome do aluno exatamente como aparece no Moodle.',
    '- Não invente alunos ausentes na lista de envios.',
    '- Não invente entrega, conteúdo, prazo, critério, rubrica, pontuação ou informação que não esteja disponível.',
    '- Exija que a entrega esteja em arquivo anexado. Entregas feitas apenas em texto, comentário ou mensagem sem arquivo devem ser tratadas como sem entrega válida.',
    '- Avalie somente com base nas evidências presentes na entrega do aluno e nas orientações fornecidas.',
    '- Quando houver critérios de avaliação, use-os como referência principal.',
    '- Quando não houver critérios explícitos, avalie de forma geral considerando aderência ao enunciado, completude da resposta, clareza, organização, coerência, aplicação dos conhecimentos solicitados e qualidade da entrega.',
    '- Use nota numérica, com vírgula ou ponto decimal se necessário.',
    '- Se não houver entrega ou se o arquivo estiver vazio/inacessível, atribua a nota conforme a evidência disponível e registre isso no feedback.',
    '- Caso a decisão exija validação humana, ainda assim gere uma sugestão preliminar de nota e feedback, sem afirmar decisão oficial do tutor.',
    '',
    'Regras para o feedback:',
    '- Escreva um feedback curto, claro, individualizado e acolhedor, no padrão do Guia do Tutor.',
    '- O feedback deve indicar o desempenho do estudante na atividade.',
    '- Sempre que possível, mencione um ponto positivo observado.',
    '- Quando houver falhas, explique objetivamente o que precisa ser melhorado.',
    '- Quando a atividade estiver satisfatória, parabenize o estudante e destaque o atendimento ao que foi solicitado.',
    '- Quando a atividade estiver parcialmente satisfatória, reconheça o que foi atendido e oriente o que faltou completar, aprofundar ou corrigir.',
    '- Quando a atividade estiver insatisfatória, reconheça o esforço ou envio, indique a principal lacuna e oriente a revisão com base no enunciado ou nos critérios.',
    '- Use linguagem respeitosa, motivadora e formativa.',
    '- Não use tom punitivo, irônico, genérico demais ou acusatório.',
    '- Não use ponto e vírgula dentro do feedback, para não quebrar o CSV.',
    '- Não use quebras de linha dentro do feedback.',
    '- Não assine como tutor no feedback.',
    '',
    'Modelos de referência para variar o feedback, sem copiar sempre igual:',
    '',
    'Satisfatório:',
    'Olá, [nome]. Parabéns pelo envio da atividade. Sua entrega atendeu ao que foi solicitado, apresentou boa organização e demonstrou compreensão dos conhecimentos trabalhados. Continue evoluindo e mantendo esse cuidado nas próximas atividades.',
    '',
    'Parcialmente satisfatório:',
    'Olá, [nome]. Obrigado pelo envio da atividade. Você atendeu parte da proposta e apresentou pontos importantes, mas precisa complementar ou ajustar alguns aspectos para atender melhor aos critérios. Revise o enunciado e observe com atenção o que foi solicitado.',
    '',
    'Insatisfatório:',
    'Olá, [nome]. Obrigado pelo envio da atividade. Sua entrega apresenta limitações em relação ao que foi solicitado e precisa ser revista com mais atenção. Retome o enunciado, verifique os critérios da atividade e complemente sua resposta para demonstrar melhor os conhecimentos esperados.',
    '',
    'Sem entrega ou arquivo inacessível:',
    'Olá, [nome]. Não foi possível identificar uma entrega válida para avaliação. Verifique o arquivo enviado e as orientações da atividade no AVA. Caso tenha dúvidas, procure apoio para regularizar sua participação e continuar avançando nos estudos.',
  ].join('\n');

  function getTemplateCsv() {
    return TEMPLATE_CSV_WITH_GRADE;
  }

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
    if (!targetId) return null;

    return document.getElementById(targetId);
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
      isSupported: isAssignView && isGradingAction && Boolean(table) && feedbackFields.length > 0,
      canShowButton: isAssignView && isGradingAction && Boolean(table) && (Boolean(quickGradingCheckbox) || feedbackFields.length > 0),
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
    if (!readiness.quickGradingEnabled && !readiness.feedbackCount) return 'Marque a opção Avaliação rápida para exibir o campo de Comentários de feedback.';
    if (!readiness.hasTable) return 'Tabela de envios do Moodle não encontrada nesta página.';
    if (!readiness.feedbackCount) return 'Campo de Comentários de feedback não encontrado na tabela de correção rápida.';
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
    button.title = readiness.isSupported
      ? 'Importar notas e feedback'
      : formatPageReadinessError(readiness);
    button.addEventListener('click', togglePanel);

    if (gradeNavItem) {
      gradeNavItem.appendChild(button);
    } else {
      button.classList.add('mqi-floating-fallback');
      document.body.appendChild(button);
    }
  }

  function findGradeNavItem() {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;

    const links = [...main.querySelectorAll('.navitem a.btn[href*="action=grader"]')];
    const gradeLink = links.find(link => normalizeText(link.textContent) === 'nota') || links[0];
    return gradeLink?.closest('.navitem') || null;
  }

  function togglePanel() {
    const existing = document.getElementById('mqi-panel');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('section');
    panel.id = 'mqi-panel';
    const readiness = getPageReadiness();
    const hasGradeFields = readiness.gradeCount > 0;
    const headersHelp = '<code>nome</code>, <code>nota</code>, <code>feedback</code>';
    const overwriteGradeOption = hasGradeFields
      ? `
        <label class="mqi-check">
          <input id="mqi-overwrite-grade" type="checkbox" checked />
          Sobrescrever nota existente
        </label>`
      : '';
    const triggerButton = document.getElementById('mqi-import-button');
    if (triggerButton && !triggerButton.classList.contains('mqi-floating-fallback')) {
      panel.classList.add('mqi-panel-anchored');
    }

    panel.innerHTML = `
      <header>
        <span>Importador de Notas</span>
        <button type="button" id="mqi-close" aria-label="Fechar">×</button>
      </header>
      <main>
        <div class="mqi-help">
          Importe um <strong>CSV</strong> ou <strong>XLSX</strong> com cabeçalhos:<br>
          ${headersHelp}
          <button type="button" id="mqi-download-template" class="mqi-subtle-button">baixar modelo</button>
        </div>

        <div class="mqi-file-row">
          <input id="mqi-file" class="mqi-file-input" type="file" accept=".csv,.txt,.tsv,.xlsx" />
          <label class="mqi-file-picker" for="mqi-file">
            <span class="mqi-file-button">Escolher arquivo</span>
            <span id="mqi-file-name" class="mqi-file-name">Nenhum arquivo selecionado</span>
          </label>
        </div>

        ${overwriteGradeOption}
        <label class="mqi-check">
          <input id="mqi-overwrite-feedback" type="checkbox" checked />
          Sobrescrever feedback existente
        </label>
        <label class="mqi-check">
          <input id="mqi-flex-match" type="checkbox" checked />
          Permitir comparação flexível de nomes
        </label>

        <details class="mqi-prompt-details">
          <summary>Prompt de correção</summary>
          <textarea id="mqi-correction-prompt" readonly>${escapeHtml(CORRECTION_PROMPT)}</textarea>
          <button type="button" id="mqi-copy-prompt" class="mqi-copy-button">Copiar prompt</button>
        </details>

        <div class="mqi-actions">
          <button type="button" id="mqi-preview">Verificar</button>
          <button type="button" id="mqi-apply" class="primary">Preencher página</button>
        </div>

        <div id="mqi-log">Nenhum arquivo importado.</div>
        <div class="mqi-credit">
          <a href="https://github.com/Julioall" target="_blank" rel="noopener noreferrer">By Julio</a>
        </div>
      </main>
    `;

    document.body.appendChild(panel);
    if (panel.classList.contains('mqi-panel-anchored')) {
      positionPanelBelowButton(panel, triggerButton);
    }

    panel.querySelector('#mqi-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#mqi-file').addEventListener('change', onFileSelected);
    panel.querySelector('#mqi-download-template').addEventListener('click', downloadTemplate);
    panel.querySelector('#mqi-copy-prompt').addEventListener('click', copyCorrectionPrompt);
    panel.querySelector('#mqi-preview').addEventListener('click', previewImport);
    panel.querySelector('#mqi-apply').addEventListener('click', applyImport);
  }

  function positionPanelBelowButton(panel, button) {
    if (!panel || !button) return;

    const gap = 8;
    const pagePadding = 12;
    const rect = button.getBoundingClientRect();
    const width = panel.offsetWidth || 450;
    const left = Math.min(
      Math.max(pagePadding, window.scrollX + rect.right - width),
      window.scrollX + document.documentElement.clientWidth - width - pagePadding
    );

    panel.style.top = `${window.scrollY + rect.bottom + gap}px`;
    panel.style.left = `${left}px`;
  }

  function log(message) {
    const el = document.getElementById('mqi-log');
    if (el) el.textContent = message;
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${getTemplateCsv()}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo_importacao_notas.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copyCorrectionPrompt() {
    const prompt = document.getElementById('mqi-correction-prompt')?.value || CORRECTION_PROMPT;
    const button = document.getElementById('mqi-copy-prompt');

    try {
      await copyTextToClipboard(prompt);
      if (button) {
        button.textContent = 'Copiado';
        window.setTimeout(() => {
          button.textContent = 'Copiar prompt';
        }, 1600);
      }
    } catch (error) {
      console.error(error);
      log('Não foi possível copiar automaticamente. Selecione o prompt e copie manualmente.');
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function onFileSelected(event) {
    const file = event.target.files?.[0];
    const fileNameEl = document.getElementById('mqi-file-name');
    if (fileNameEl) {
      fileNameEl.textContent = file ? file.name : 'Nenhum arquivo selecionado';
    }
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
      const lines = [
        `Arquivo: ${file.name}`,
        'Validação: arquivo compatível.',
        `Registros válidos importados: ${STATE.records.length}`,
        '',
        'Use “Verificar” antes de preencher.',
        'A extensão preenche a tela, mas não salva no Moodle.'
      ];

      if (STATE.validationWarnings.length) {
        lines.push('');
        lines.push('Avisos de validação:');
        lines.push(...STATE.validationWarnings.slice(0, 8).map(warning => `- ${warning}`));
        if (STATE.validationWarnings.length > 8) {
          lines.push(`- Mais ${STATE.validationWarnings.length - 8} aviso(s).`);
        }
      }

      log(lines.join('\n'));
    } catch (error) {
      console.error(error);
      STATE.records = [];
      STATE.lastReport = null;
      STATE.validationWarnings = [];
      log(`Erro ao importar arquivo: ${error.message}`);
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
      throw new Error('Arquivo vazio ou sem linhas de dados. Use as colunas nome e feedback. A coluna nota é opcional.');
    }

    const headers = rows[0].map(normalizeHeader);
    const indexes = {
      nome: findHeaderIndex(headers, COLUMN_ALIASES.nome),
      nota: findHeaderIndex(headers, COLUMN_ALIASES.nota),
      feedback: findHeaderIndex(headers, COLUMN_ALIASES.feedback),
    };

    const requiredColumns = ['nome', 'feedback'];
    const missing = requiredColumns.filter(name => indexes[name] === -1);

    if (missing.length) {
      throw new Error(`Cabeçalhos não encontrados: ${missing.join(', ')}. Use nome e feedback. A coluna nota é opcional.`);
    }

    const records = [];
    const warnings = [];

    rows.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const nome = String(row[indexes.nome] ?? '').trim();
      const nota = indexes.nota === -1 ? '' : String(row[indexes.nota] ?? '').trim();
      const feedback = String(row[indexes.feedback] ?? '').trim();
      const hasAnyValue = row.some(cell => String(cell ?? '').trim());

      if (!hasAnyValue) return;

      if (!nome) {
        warnings.push(`Linha ${rowNumber} ignorada: nome vazio.`);
        return;
      }

      if (!nota && !feedback) {
        warnings.push(`Linha ${rowNumber} ignorada: informe nota ou feedback.`);
        return;
      }

      if (nota && !isValidImportedGrade(nota)) {
        warnings.push(`Linha ${rowNumber} ignorada: nota inválida "${nota}".`);
        return;
      }

      records.push({ rowNumber, nome, nota, feedback });
    });

    if (!records.length) {
      throw new Error('Nenhum registro válido encontrado no arquivo.');
    }

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
    index = headers.findIndex(header => normalizedAliases.some(alias => header.includes(alias) || alias.includes(header)));
    return index;
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
      const name = extractStudentName(nameCell);
      if (!name || (!gradeInput && !feedbackTextarea)) continue;

      items.push({
        row,
        userId,
        name,
        normalizedName: normalizeText(name),
        gradeInput,
        feedbackTextarea,
      });
    }

    return items;
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

  function buildReport({ apply = false } = {}) {
    clearHighlights();

    const readiness = getPageReadiness();
    if (!readiness.isSupported) {
      return { error: formatPageReadinessError(readiness) };
    }

    if (!STATE.records.length) {
      return { error: 'Importe um arquivo CSV ou XLSX primeiro.' };
    }

    const allowFlexible = document.getElementById('mqi-flex-match')?.checked ?? true;
    const overwriteGrade = document.getElementById('mqi-overwrite-grade')?.checked ?? true;
    const overwriteFeedback = document.getElementById('mqi-overwrite-feedback')?.checked ?? true;
    const decimalSeparator = detectPageDecimalSeparator();
    const moodleRows = getMoodleRows();

    const found = [];
    const applied = [];
    const skipped = [];
    const notFound = [];
    const ambiguous = [];

    for (const record of STATE.records) {
      const result = findStudentRow(record, moodleRows, allowFlexible);

      if (result.status === 'not_found') {
        notFound.push(record.nome);
        continue;
      }

      if (result.status === 'ambiguous') {
        ambiguous.push(`${record.nome} → ${result.matches.map(item => item.name).join(' | ')}`);
        result.matches.forEach(item => item.row.classList.add('mqi-ambiguous'));
        continue;
      }

      const match = result.match;
      found.push(`${record.nome} → ${match.name}${result.method ? ` (${result.method})` : ''}`);
      match.row.classList.add('mqi-found');

      if (!apply) continue;

      let changed = false;
      const fieldsChanged = [];
      const fieldsSkipped = [];

      const grade = normalizeGradeForPage(record.nota, decimalSeparator);
      if (match.gradeInput && grade) {
        if (overwriteGrade || !match.gradeInput.value.trim()) {
          match.gradeInput.value = grade;
          dispatchFieldEvents(match.gradeInput);
          changed = true;
          fieldsChanged.push('nota');
        } else {
          fieldsSkipped.push('nota já preenchida');
        }
      }

      if (match.feedbackTextarea && record.feedback) {
        if (overwriteFeedback || !match.feedbackTextarea.value.trim()) {
          match.feedbackTextarea.value = record.feedback;
          dispatchFieldEvents(match.feedbackTextarea);
          changed = true;
          fieldsChanged.push('feedback');
        } else {
          fieldsSkipped.push('feedback já preenchido');
        }
      }

      if (changed) {
        match.row.classList.add('mqi-applied');
        applied.push(`${record.nome}: ${fieldsChanged.join(' + ')}`);
      } else {
        skipped.push(`${record.nome}: ${fieldsSkipped.join(', ') || 'sem campo aplicável'}`);
      }
    }

    return {
      fileName: STATE.fileName,
      records: STATE.records.length,
      pageRows: moodleRows.length,
      found,
      applied,
      skipped,
      notFound,
      ambiguous,
      apply,
    };
  }

  function previewImport() {
    const report = buildReport({ apply: false });
    if (report.error) {
      log(report.error);
      return;
    }

    STATE.lastReport = report;
    log(formatReport(report));
  }

  function applyImport() {
    const report = buildReport({ apply: true });
    if (report.error) {
      log(report.error);
      return;
    }

    STATE.lastReport = report;
    log(formatReport(report));
  }

  function formatReport(report) {
    const lines = [
      `Arquivo: ${report.fileName}`,
      `Registros na planilha: ${report.records}`,
      `Linhas de aluno detectadas na página: ${report.pageRows}`,
      `Alunos encontrados: ${report.found.length}`,
      `Ambíguos: ${report.ambiguous.length}`,
      `Não encontrados: ${report.notFound.length}`,
    ];

    if (report.apply) {
      lines.push(`Preenchidos: ${report.applied.length}`);
      lines.push(`Ignorados: ${report.skipped.length}`);
    }

    lines.push('');
    lines.push(report.apply
      ? 'Revise a tabela e clique no botão nativo do Moodle para salvar as alterações.'
      : 'Verificação concluída. Nenhum campo foi alterado.');

    if (report.ambiguous.length) {
      lines.push('');
      lines.push('Nomes ambíguos, não preenchidos:');
      lines.push(...report.ambiguous.map(name => `- ${name}`));
    }

    if (report.notFound.length) {
      lines.push('');
      lines.push('Nomes não encontrados nesta página:');
      lines.push(...report.notFound.map(name => `- ${name}`));
    }

    if (report.skipped?.length) {
      lines.push('');
      lines.push('Ignorados:');
      lines.push(...report.skipped.map(name => `- ${name}`));
    }

    return lines.join('\n');
  }

  function clearHighlights() {
    document.querySelectorAll('tr.mqi-found, tr.mqi-applied, tr.mqi-ambiguous').forEach(row => {
      row.classList.remove('mqi-found', 'mqi-applied', 'mqi-ambiguous');
    });
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

  createUI();
})();
