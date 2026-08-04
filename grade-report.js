(() => {
  'use strict';

  const isMyCoursesPage =
    (location.hostname === 'ead.fieg.com.br' && location.pathname === '/my/courses.php') ||
    (location.hostname === 'ead.senai.br' && ['/my/', '/my/index.php'].includes(location.pathname));

  if (!isMyCoursesPage || document.documentElement.dataset.mqiGradeReportLoaded === '1') return;
  document.documentElement.dataset.mqiGradeReportLoaded = '1';

  const STATE = {
    selected: new Map(),
    generating: false,
    observer: null,
    scanTimer: null,
  };

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function parseGrade(value) {
    const text = normalizeText(value).replace(/\u00a0/g, '');
    if (!text || text === '-' || text === '–') return null;
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text;
    const number = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function getCourseData(card) {
    const id = card.dataset.courseId;
    const name = normalizeText(card.querySelector('a.coursename')?.textContent) || `Unidade ${id}`;
    const category = normalizeText(card.querySelector('.categoryname')?.textContent);
    const courseUrl = card.querySelector('a.coursename')?.href || `${location.origin}/course/view.php?id=${id}`;
    return { id, name, category, courseUrl };
  }

  function createCourseSelector(card) {
    if (card.querySelector('.mqi-grade-report-selector')) return;
    const course = getCourseData(card);
    if (!course.id) return;

    const selector = document.createElement('label');
    selector.className = 'mqi-grade-report-selector';
    selector.title = `Incluir ${course.name} no relatório`;
    selector.innerHTML = `
      <input type="checkbox" aria-label="Selecionar ${escapeXml(course.name)} para o relatório">
      <span aria-hidden="true"></span>
    `;

    const checkbox = selector.querySelector('input');
    checkbox.checked = STATE.selected.has(course.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        STATE.selected.set(course.id, course);
        card.classList.add('mqi-grade-report-selected');
      } else {
        STATE.selected.delete(course.id);
        card.classList.remove('mqi-grade-report-selected');
      }
      updateToolbar();
    });

    card.classList.add('mqi-grade-report-course');
    if (checkbox.checked) card.classList.add('mqi-grade-report-selected');
    card.prepend(selector);
  }

  function scanCourseCards() {
    document.querySelectorAll('.course-summaryitem[data-course-id]').forEach(createCourseSelector);
    ensureToolbar();
    updateToolbar();
  }

  function scheduleScan() {
    clearTimeout(STATE.scanTimer);
    STATE.scanTimer = setTimeout(scanCourseCards, 120);
  }

  function findToolbarHost() {
    const firstCard = document.querySelector('.course-summaryitem[data-course-id]');
    return firstCard?.parentElement || document.querySelector('[data-region="courses-view"]') || document.querySelector('main') || document.body;
  }

  function ensureToolbar() {
    if (document.getElementById('mqi-grade-report-toolbar')) return;
    const host = findToolbarHost();
    if (!host) return;

    const toolbar = document.createElement('section');
    toolbar.id = 'mqi-grade-report-toolbar';
    toolbar.className = 'mqi-grade-report-toolbar';
    toolbar.setAttribute('aria-label', 'Gerador de relatório de notas');
    toolbar.innerHTML = `
      <div class="mqi-grade-report-toolbar__content">
        <div>
          <strong>Relatório de notas</strong>
          <span id="mqi-grade-report-count">Nenhuma unidade selecionada</span>
        </div>
        <div class="mqi-grade-report-toolbar__actions">
          <button type="button" id="mqi-grade-report-select-all" class="btn btn-secondary btn-sm">Selecionar todas</button>
          <button type="button" id="mqi-grade-report-generate" class="btn btn-primary" disabled>Gerar relatório</button>
        </div>
      </div>
      <div id="mqi-grade-report-status" class="mqi-grade-report-status" role="status" aria-live="polite" hidden></div>
    `;

    host.before(toolbar);
    toolbar.querySelector('#mqi-grade-report-select-all').addEventListener('click', toggleAllCourses);
    toolbar.querySelector('#mqi-grade-report-generate').addEventListener('click', generateReport);
  }

  function updateToolbar() {
    const count = STATE.selected.size;
    const countEl = document.getElementById('mqi-grade-report-count');
    const generateButton = document.getElementById('mqi-grade-report-generate');
    const selectAllButton = document.getElementById('mqi-grade-report-select-all');
    const checkboxes = [...document.querySelectorAll('.mqi-grade-report-selector input')];

    if (countEl) countEl.textContent = count ? `${count} unidade${count === 1 ? '' : 's'} selecionada${count === 1 ? '' : 's'}` : 'Nenhuma unidade selecionada';
    if (generateButton) generateButton.disabled = STATE.generating || count === 0;
    if (selectAllButton) {
      const allSelected = checkboxes.length > 0 && checkboxes.every((checkbox) => checkbox.checked);
      selectAllButton.textContent = allSelected ? 'Limpar seleção' : 'Selecionar todas';
      selectAllButton.disabled = STATE.generating || checkboxes.length === 0;
    }
  }

  function toggleAllCourses() {
    const checkboxes = [...document.querySelectorAll('.mqi-grade-report-selector input')];
    const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked !== shouldSelect) {
        checkbox.checked = shouldSelect;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function setStatus(message, tone = 'info') {
    const status = document.getElementById('mqi-grade-report-status');
    if (!status) return;
    status.hidden = !message;
    status.className = `mqi-grade-report-status mqi-grade-report-status--${tone}`;
    status.textContent = message;
  }

  async function fetchDocument(url) {
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'follow' });
    if (!response.ok) throw new Error(`O Moodle respondeu com status ${response.status}.`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const loginForm = doc.querySelector('form#login, form[action*="/login/index.php"]');
    if (loginForm) throw new Error('A sessão do Moodle expirou. Entre novamente e repita a operação.');
    return doc;
  }

  function findCourseTotalItemId(doc) {
    const headers = [...doc.querySelectorAll('th[data-itemid]')];
    const exact = headers.find((header) => normalizeText(header.querySelector('.gradeitemheader')?.textContent).toLowerCase() === 'total do curso');
    const fallback = headers.find((header) => {
      const text = normalizeText(header.querySelector('.gradeitemheader')?.textContent || header.textContent).toLowerCase();
      return header.classList.contains('courseitem') || text.includes('total do curso');
    });
    return (exact || fallback)?.dataset.itemid || null;
  }

  function extractStudents(doc, totalItemId) {
    return [...doc.querySelectorAll('tr.userrow[data-uid], tr.userrow')].map((row) => {
      const name = normalizeText(row.querySelector('a.username')?.textContent || row.querySelector('th.user')?.textContent);
      const userId = row.dataset.uid || row.id?.match(/(\d+)/)?.[1] || name;
      const gradeCell = row.querySelector(`td[data-itemid="${CSS.escape(totalItemId)}"]`);
      const gradeText = normalizeText(gradeCell?.querySelector('.gradevalue')?.textContent || gradeCell?.textContent);
      return { userId, name, grade: parseGrade(gradeText) };
    }).filter((student) => student.name);
  }

  function getPaginationUrls(doc, courseId) {
    return [...doc.querySelectorAll('a[href]')].map((anchor) => {
      try { return new URL(anchor.href, location.origin); } catch { return null; }
    }).filter((url) =>
      url &&
      url.origin === location.origin &&
      url.pathname === '/grade/report/grader/index.php' &&
      url.searchParams.get('id') === String(courseId) &&
      url.searchParams.has('page')
    ).map((url) => url.href);
  }

  async function loadCourseGrades(course, progress) {
    const startUrl = `${location.origin}/grade/report/grader/index.php?id=${encodeURIComponent(course.id)}`;
    const queue = [startUrl];
    const visited = new Set();
    const students = new Map();
    let totalItemId = null;

    while (queue.length && visited.size < 60) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      progress(`Lendo ${course.name} — página ${visited.size}...`);
      const doc = await fetchDocument(url);
      totalItemId ||= findCourseTotalItemId(doc);
      if (!totalItemId) throw new Error('A coluna “Total do curso” não foi localizada.');
      extractStudents(doc, totalItemId).forEach((student) => students.set(student.userId, student));
      getPaginationUrls(doc, course.id).forEach((nextUrl) => {
        if (!visited.has(nextUrl) && !queue.includes(nextUrl)) queue.push(nextUrl);
      });
    }

    if (!students.size) throw new Error('Nenhum aluno foi localizado no relatório de notas.');
    return {
      ...course,
      reportUrl: startUrl,
      students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  }

  function classifyGrades(students) {
    return students.reduce((summary, student) => {
      if (student.grade === null) summary.noGrade += 1;
      else if (student.grade < 50) summary.failed += 1;
      else if (student.grade < 70) summary.recovery += 1;
      else summary.approved += 1;
      if (student.grade !== null) summary.withGrade += 1;
      return summary;
    }, { noGrade: 0, failed: 0, recovery: 0, approved: 0, withGrade: 0 });
  }

  function sanitizeSheetName(value, used) {
    const base = normalizeText(value).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Unidade';
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const addition = ` (${suffix++})`;
      name = `${base.slice(0, 31 - addition.length)}${addition}`;
    }
    used.add(name.toLowerCase());
    return name;
  }

  function textCell(value, style = '') {
    return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
  }

  function numberCell(value) {
    return value === null
      ? '<Cell><Data ss:Type="String"></Data></Cell>'
      : `<Cell ss:StyleID="Grade"><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  function buildWorkbookXml(reports) {
    const usedNames = new Set(['situação']);
    const worksheets = reports.map((report) => {
      const sheetName = sanitizeSheetName(report.name, usedNames);
      const rows = report.students.map((student) => `<Row>${textCell(student.name)}${numberCell(student.grade)}</Row>`).join('');
      return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>
        <Column ss:Width="290"/><Column ss:Width="120"/>
        <Row>${textCell('Aluno', 'Header')}${textCell(report.name, 'Header')}</Row>${rows}
      </Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><AutoFilter x:Range="R1C1:R${report.students.length + 1}C2" xmlns:x="urn:schemas-microsoft-com:office:excel"/></WorksheetOptions></Worksheet>`;
    }).join('');

    const summaryRows = reports.map((report) => {
      const summary = classifyGrades(report.students);
      return `<Row>${textCell(report.reportUrl)}${textCell(report.name)}${numberCell(summary.noGrade)}${numberCell(summary.failed)}${numberCell(summary.recovery)}${numberCell(summary.approved)}${numberCell(summary.withGrade)}</Row>`;
    }).join('');

    const summarySheet = `<Worksheet ss:Name="Situação"><Table>
      <Column ss:Width="260"/><Column ss:Width="290"/><Column ss:Width="80"/><Column ss:Width="85"/><Column ss:Width="90"/><Column ss:Width="85"/><Column ss:Width="100"/>
      <Row>${['Origem', 'UC', 'Sem Nota', 'Reprovados', 'Recuperação', 'Aprovados', 'Total com Nota'].map((value) => textCell(value, 'Header')).join('')}</Row>${summaryRows}
    </Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;

    return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Styles>
          <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>
          <Style ss:ID="Header"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F6CBF" ss:Pattern="Solid"/></Style>
          <Style ss:ID="Grade"><Alignment ss:Horizontal="Center"/><NumberFormat ss:Format="0.00"/></Style>
        </Styles>${worksheets}${summarySheet}
      </Workbook>`;
  }

  function downloadWorkbook(reports) {
    const xml = buildWorkbookXml(reports);
    const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Intl.DateTimeFormat('pt-BR').format(new Date()).replace(/\//g, '-');
    const category = reports.length === 1 ? reports[0].category || reports[0].name : `${reports.length} unidades`;
    const safeCategory = category.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
    anchor.href = url;
    anchor.download = `Relatório de Notas ${date} - ${safeCategory}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function generateReport() {
    if (STATE.generating || !STATE.selected.size) return;
    STATE.generating = true;
    updateToolbar();
    setStatus('Preparando o relatório...', 'info');

    const reports = [];
    const errors = [];
    const courses = [...STATE.selected.values()];

    for (let index = 0; index < courses.length; index += 1) {
      const course = courses[index];
      try {
        const report = await loadCourseGrades(course, (message) => setStatus(`${index + 1}/${courses.length} — ${message}`, 'info'));
        reports.push(report);
      } catch (error) {
        errors.push(`${course.name}: ${error.message}`);
      }
    }

    if (reports.length) {
      downloadWorkbook(reports);
      setStatus(errors.length
        ? `Relatório gerado com ${reports.length} unidade(s). ${errors.length} não puderam ser lidas: ${errors.join(' | ')}`
        : `Relatório gerado com ${reports.length} unidade(s).`, errors.length ? 'warning' : 'success');
    } else {
      setStatus(`Não foi possível gerar o relatório. ${errors.join(' | ')}`, 'error');
    }

    STATE.generating = false;
    updateToolbar();
  }

  scanCourseCards();
  STATE.observer = new MutationObserver(scheduleScan);
  STATE.observer.observe(document.body, { childList: true, subtree: true });
})();
