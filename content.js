(() => {
  'use strict';

  const STATE = {
    records: [],
    fileName: '',
    lastReport: null,
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

  function createUI() {
    if (document.getElementById('mqi-import-button')) return;

    const gradeNavItem = findGradeNavItem();
    const hasQuickGradeFields = document.querySelector('table#submissions, input.quickgrade[id^="quickgrade_"], textarea[id^="quickgrade_comments_"]');
    if (!gradeNavItem && !hasQuickGradeFields) return;

    const button = document.createElement('button');
    button.id = 'mqi-import-button';
    button.type = 'button';
    button.className = 'btn btn-primary mqi-import-button';
    button.textContent = 'Importar';
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
          <code>nome</code>, <code>nota</code>, <code>feedback</code>
        </div>

        <div class="mqi-file-row">
          <input id="mqi-file" class="mqi-file-input" type="file" accept=".csv,.txt,.tsv,.xlsx" />
          <label class="mqi-file-picker" for="mqi-file">
            <span class="mqi-file-button">Escolher arquivo</span>
            <span id="mqi-file-name" class="mqi-file-name">Nenhum arquivo selecionado</span>
          </label>
        </div>

        <label class="mqi-check">
          <input id="mqi-overwrite-grade" type="checkbox" checked />
          Sobrescrever nota existente
        </label>
        <label class="mqi-check">
          <input id="mqi-overwrite-feedback" type="checkbox" checked />
          Sobrescrever feedback existente
        </label>
        <label class="mqi-check">
          <input id="mqi-flex-match" type="checkbox" checked />
          Permitir comparação flexível de nomes
        </label>

        <div class="mqi-actions">
          <button type="button" id="mqi-preview">Verificar</button>
          <button type="button" id="mqi-apply" class="primary">Preencher página</button>
        </div>

        <div id="mqi-log">Nenhum arquivo importado.</div>
      </main>
    `;

    document.body.appendChild(panel);
    if (panel.classList.contains('mqi-panel-anchored')) {
      positionPanelBelowButton(panel, triggerButton);
    }

    panel.querySelector('#mqi-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#mqi-file').addEventListener('change', onFileSelected);
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

  async function onFileSelected(event) {
    const file = event.target.files?.[0];
    const fileNameEl = document.getElementById('mqi-file-name');
    if (fileNameEl) {
      fileNameEl.textContent = file ? file.name : 'Nenhum arquivo selecionado';
    }
    if (!file) return;

    try {
      STATE.fileName = file.name;
      const lower = file.name.toLowerCase();
      let rows;

      if (lower.endsWith('.xlsx')) {
        rows = await parseXlsxFile(file);
      } else {
        const text = await file.text();
        rows = parseDelimitedText(text);
      }

      STATE.records = rowsToRecords(rows);
      STATE.lastReport = null;
      log([
        `Arquivo: ${file.name}`,
        `Registros válidos importados: ${STATE.records.length}`,
        '',
        'Use “Verificar” antes de preencher.',
        'A extensão preenche a tela, mas não salva no Moodle.'
      ].join('\n'));
    } catch (error) {
      console.error(error);
      STATE.records = [];
      STATE.lastReport = null;
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

  function rowsToRecords(rows) {
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map(normalizeHeader);
    const indexes = {
      nome: findHeaderIndex(headers, COLUMN_ALIASES.nome),
      nota: findHeaderIndex(headers, COLUMN_ALIASES.nota),
      feedback: findHeaderIndex(headers, COLUMN_ALIASES.feedback),
    };

    const missing = Object.entries(indexes)
      .filter(([, index]) => index === -1)
      .map(([name]) => name);

    if (missing.length) {
      throw new Error(`Cabeçalhos não encontrados: ${missing.join(', ')}. Use nome, nota e feedback.`);
    }

    return rows.slice(1)
      .map((row, index) => ({
        rowNumber: index + 2,
        nome: String(row[indexes.nome] ?? '').trim(),
        nota: String(row[indexes.nota] ?? '').trim(),
        feedback: String(row[indexes.feedback] ?? '').trim(),
      }))
      .filter(record => record.nome && (record.nota || record.feedback));
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
    const rows = [...document.querySelectorAll('table#submissions tbody tr, table.generaltable tbody tr, tr')];
    const seen = new Set();
    const items = [];

    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);

      const gradeInput = [...row.querySelectorAll('input.quickgrade[id^="quickgrade_"], input.quickgrade[name^="quickgrade_"], input[id^="quickgrade_"], input[name^="quickgrade_"]')]
        .find(input => !input.id.includes('comments') && !input.name.includes('comments'));
      const userId = getUserIdFromRow(row, gradeInput);
      const feedbackTextarea = userId
        ? row.querySelector(`textarea#quickgrade_comments_${CSS.escape(userId)}, textarea[name="quickgrade_comments_${CSS.escape(userId)}"]`)
        : row.querySelector('textarea.quickgrade[id^="quickgrade_comments_"], textarea[name^="quickgrade_comments_"]');

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
