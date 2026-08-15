const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      if (!env.DB) return page('Erro', '<p>Banco DB não conectado.</p>', 500);
      if (!env.TEACHER_PASSWORD || !env.AUTH_SECRET) return page('Erro', '<p>Secrets não configurados.</p>', 500);

      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (path === '/login') return method === 'POST' ? loginPost(request, env) : page('Login', loginForm());
      if (path === '/logout') return logout();
      if (path.startsWith('/p/')) return publicExam(request, env, path.split('/')[2], '/p');
      if (path.startsWith('/e/')) return publicExam(request, env, path.split('/')[2], '/e');

      if (!(await isTeacher(request, env))) return redirect('/login');

      if (path === '/') return dashboard(env);
      if (path === '/banco') return method === 'POST' ? addQuestion(request, env) : bank(env);
      if (path === '/banco/importar' && method === 'POST') return importQuestions(request, env);
      if (path === '/banco/limpar-repetitivas') return method === 'POST'
        ? cleanupRepetitiveQuestions(request, env)
        : cleanupRepetitiveQuestionsPage(env);
      if (path === '/provas/nova') return method === 'POST' ? createExam(request, env) : newExam(env);
      if (path === '/provas/zerar') return method === 'POST' ? resetCreatedExams(request, env) : resetCreatedExamsPage(env);
      if (path === '/resultados') return globalResults(env);

      let m = path.match(/^\/provas\/(\d+)$/);
      if (m) return examDetail(env, Number(m[1]), url.origin);

      m = path.match(/^\/provas\/(\d+)\/toggle$/);
      if (m && method === 'POST') return toggleExam(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/resultados$/);
      if (m) return examResults(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/resultados\.csv$/);
      if (m) return resultsCsv(env, Number(m[1]));

      return page('Não encontrado', '<p>Página não encontrada.</p>', 404);
    } catch (e) {
      console.error(e);
      return page('Erro no sistema', `<p>${esc(e.message || String(e))}</p>`, 500);
    }
  }
};

async function loginPost(request, env) {
  const f = await request.formData();
  if (String(f.get('password') || '') !== env.TEACHER_PASSWORD) {
    return page('Login', loginForm('Senha incorreta.'), 401);
  }
  const token = await makeSession(env.AUTH_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `teacher=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
    }
  });
}

function loginForm(error = '') {
  return `<div class="login"><h1>EducaFísica <span>Avalia</span></h1><p>Área do professor</p>${error ? `<div class="alert">${esc(error)}</div>` : ''}<form method="post"><label>Senha<input type="password" name="password" required></label><button>Entrar</button></form></div>`;
}

function logout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': 'teacher=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    }
  });
}

async function makeSession(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return `${ts}.${await hmac(secret, ts)}`;
}

async function isTeacher(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const part = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('teacher='));
  if (!part) return false;
  const token = part.slice(8);
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.floor(Date.now() / 1000) - Number(ts) > 43200) return false;
  return sig === await hmac(env.AUTH_SECRET, ts);
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function dashboard(env) {
  const exams = await env.DB.prepare(`
    SELECT
      e.*,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_score,
      sc.id AS school_id,
      sc.name AS school_name,
      cl.shift AS shift,
      COALESCE(cl.class_name,e.class_name) AS linked_class_name,
      COALESCE(cl.grade,e.grade) AS linked_grade,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN submissions su ON su.exam_id=e.id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY e.id
    ORDER BY sc.name, cl.shift, linked_class_name, e.id DESC
  `).all();

  const q = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE active=1').first();
  const s = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();
  const avg = await env.DB.prepare('SELECT ROUND(AVG(percent),1) AS a FROM submissions').first();

  const shiftStats = await env.DB.prepare(`
    SELECT
      COALESCE(cl.shift,'Sem turno') AS shift,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_percent
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY COALESCE(cl.shift,'Sem turno')
    ORDER BY
      CASE COALESCE(cl.shift,'Sem turno')
        WHEN 'Manhã' THEN 1
        WHEN 'Tarde' THEN 2
        WHEN 'Noturno' THEN 3
        WHEN 'Integral' THEN 4
        ELSE 5
      END
  `).all();

  const recentGrades = await env.DB.prepare(`
    SELECT
      su.id,
      su.student_name,
      su.percent,
      su.score,
      su.submitted_at,
      e.id AS exam_id,
      e.title AS exam_title,
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    ORDER BY su.id DESC
    LIMIT 100
  `).all();

  const classStats = await env.DB.prepare(`
    SELECT
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,'Sem turma') AS class_name,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_percent
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY
      COALESCE(sc.name,'Sem escola definida'),
      COALESCE(cl.shift,'Sem turno'),
      COALESCE(cl.class_name,e.class_name,'Sem turma')
    ORDER BY school_name, shift, class_name
  `).all();

  const shiftAverageCards = shiftStats.results.map(r => {
    const mean = r.avg_percent == null ? '—' : Number(r.avg_percent).toFixed(1).replace('.', ',');
    const cls = Number(r.avg_percent || 0) >= 60 ? 'mean-good' : 'mean-low';
    const icon = r.shift === 'Noturno' ? '🌙' : r.shift === 'Tarde' ? '☀️' : r.shift === 'Integral' ? '🕘' : '🌤️';
    return `<div class="mean-row ${cls}"><span class="mean-label">${icon} <b>${esc(r.shift)}</b><small>${r.submissions} resposta(s)</small></span><strong>${mean}</strong></div>`;
  }).join('');

  const classAverageCards = classStats.results.map(r => {
    const mean = r.avg_percent == null ? '—' : Number(r.avg_percent).toFixed(1).replace('.', ',');
    const cls = Number(r.avg_percent || 0) >= 60 ? 'mean-good' : 'mean-low';
    return `<div class="mean-row ${cls}"><span class="mean-label"><b>Turma ${esc(r.class_name)}</b><small>${esc(r.school_name)} · ${esc(r.shift)} · ${r.submissions} resposta(s)</small></span><strong>${mean}</strong></div>`;
  }).join('');

  const studentGradeRows = recentGrades.results.map((r, index) => {
    const note = Number(r.percent || 0);
    const noteText = Number.isInteger(note)
      ? String(note)
      : note.toFixed(1).replace('.', ',');
    const noteClass = note >= 60 ? 'student-note-blue' : 'student-note-red';
    const initials = String(r.student_name || '?')
      .trim()
      .split(/\s+/)
      .slice(0,2)
      .map(x => x.charAt(0).toUpperCase())
      .join('');

    return `
      <a class="student-grade-row"
         href="/provas/${r.exam_id}/resultados"
         data-student-search="${attr((
           (r.student_name || '') + ' ' +
           (r.school_name || '') + ' ' +
           (r.shift || '') + ' ' +
           (r.class_name || '') + ' ' +
           (r.exam_title || '')
         ).toLowerCase())}">
        <span class="student-grade-avatar">${esc(initials || '?')}</span>
        <span class="student-grade-info">
          <b>${esc(r.student_name)}</b>
          <small>${esc(r.school_name)} · ${esc(r.shift)} · <strong>Turma ${esc(r.class_name)}</strong></small>
          <em>${esc(r.exam_title)}</em>
        </span>
        <span class="student-note ${noteClass}">
          <small>NOTA</small>
          <b>${noteText}</b>
          <i>/100</i>
        </span>
      </a>`;
  }).join('');
  const schoolCount = await env.DB.prepare(`
    SELECT COUNT(DISTINCT school_id) AS c
    FROM exam_context
  `).first();

  const groups = new Map();

  for (const e of exams.results) {
    const school = e.school_name || 'Sem escola definida';
    const shift = e.shift || 'Sem turno';
    const className = e.linked_class_name || e.class_name || 'Sem turma';

    if (!groups.has(school)) {
      groups.set(school, { exams: 0, submissions: 0, open: 0, shifts: new Map() });
    }

    const schoolGroup = groups.get(school);
    schoolGroup.exams += 1;
    schoolGroup.submissions += Number(e.submissions || 0);
    schoolGroup.open += e.active ? 1 : 0;

    if (!schoolGroup.shifts.has(shift)) schoolGroup.shifts.set(shift, new Map());
    const shiftGroup = schoolGroup.shifts.get(shift);
    if (!shiftGroup.has(className)) shiftGroup.set(className, []);
    shiftGroup.get(className).push(e);
  }

  const schoolBlocks = [...groups.entries()].map(([schoolName, school], schoolIndex) => {
    const shiftBlocks = [...school.shifts.entries()].map(([shiftName, classes]) => {
      const classBlocks = [...classes.entries()].map(([className, classExams]) => {
        const examCards = classExams.map(e => `
          <a class="exam-card v7" href="/provas/${e.id}">
            <div class="exam-card-top">
              <div>
                <span class="mini-chip">${e.trimester ? e.trimester + 'º TRI' : 'PROVA'}</span>
                <h4>${esc(e.title)}</h4>
              </div>
              <span class="status-pill ${e.active ? 'open' : 'closed'}">${e.active ? '● Aberta' : 'Encerrada'}</span>
            </div>
            <div class="exam-metrics">
              <span><b>${e.submissions || 0}</b> respostas</span>
              <span><b>${e.avg_score ?? '—'}</b> média</span>
              <span>${esc(e.linked_grade || e.grade || '')}</span>
            </div>
            <div class="card-arrow">Ver prova →</div>
          </a>
        `).join('');

        return `
          <details class="class-group" data-search="${attr((schoolName+' '+shiftName+' '+className+' '+classExams.map(x=>x.title).join(' ')).toLowerCase())}">
            <summary>
              <span class="class-avatar">${esc(className).slice(0,3)}</span>
              <span>
                <b>Turma ${esc(className)}</b>
                <small>${classExams.length} prova(s) · ${classExams.reduce((n,x)=>n+Number(x.submissions||0),0)} resposta(s)</small>
              </span>
              <span class="summary-chevron">›</span>
            </summary>
            <div class="exam-grid">${examCards}</div>
          </details>
        `;
      }).join('');

      return `
        <section class="shift-block">
          <div class="shift-title">
            <span class="shift-icon">${shiftName === 'Noturno' ? '🌙' : shiftName === 'Tarde' ? '☀️' : shiftName === 'Integral' ? '🕘' : '🌤️'}</span>
            <div><span class="eyebrow">TURNO</span><h3>${esc(shiftName)}</h3></div>
          </div>
          ${classBlocks}
        </section>
      `;
    }).join('');

    const schoolBadge = String(schoolIndex + 1).padStart(2,'0');
    return `
      <details class="school-group v7-school" open data-search="${attr(schoolName.toLowerCase())}">
        <summary>
          <div class="school-summary-main">
            <div class="school-icon v7"><span>🏫</span><small>${schoolBadge}</small></div>
            <div>
              <span class="eyebrow blue">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>${school.exams} prova(s) · ${school.submissions} resposta(s) · ${school.open} aberta(s)</p>
            </div>
          </div>
          <span class="summary-chevron">›</span>
        </summary>
        <div class="school-content">${shiftBlocks}</div>
      </details>
    `;
  }).join('');

  return page(
    'Painel',
    nav() + `
      <main class="dashboard-page">
        <section class="welcome-panel v7-welcome">
          <div class="welcome-copy">
            <span class="eyebrow white">EDUCAFÍSICA AVALIA</span>
            <h1>Olá, Professor Josemar!</h1>
            <p>Provas, turmas e resultados organizados por escola em um só lugar.</p>
            <div class="welcome-actions">
              <a class="btn light" href="/provas/nova">＋ Criar nova prova</a>
              <a class="btn glass" href="/resultados">▥ Ver resultados</a>
            </div>
          </div>
          <div class="welcome-mark">EF<span>✓</span></div>
        </section>

        <section class="quick-actions">
          <a href="/provas/nova" class="quick-card"><span class="quick-icon blue">✎</span><div><b>Nova prova</b><small>Gerar ou selecionar questões</small></div><i>›</i></a>
          <a href="/banco" class="quick-card"><span class="quick-icon purple">▤</span><div><b>Banco de questões</b><small>Consultar e cadastrar</small></div><i>›</i></a>
          <a href="/resultados" class="quick-card"><span class="quick-icon green">▥</span><div><b>Resultados</b><small>Escola, turma e prova</small></div><i>›</i></a>
          <a href="/banco#importar" class="quick-card"><span class="quick-icon orange">⇩</span><div><b>Importar questões</b><small>Adicionar banco em lote</small></div><i>›</i></a>
          <a href="/provas/zerar" class="quick-card danger-card"><span class="quick-icon red">⌫</span><div><b>Zerar provas de teste</b><small>Apagar provas e resultados criados</small></div><i>›</i></a>
        </section>

        <div class="cards dashboard-stats v7-stats">
          <div class="card stat stat-blue"><span class="stat-icon">❓</span><b>${q.c}</b><span>Questões ativas</span></div>
          <div class="card stat stat-purple"><span class="stat-icon">📝</span><b>${exams.results.length}</b><span>Provas criadas</span></div>
          <div class="card stat stat-green"><span class="stat-icon">✓</span><b>${s.c}</b><span>Respostas</span></div>
          <div class="card stat stat-orange"><span class="stat-icon">📊</span><b>${avg.a == null ? '—' : String(avg.a).replace('.', ',')}</b><span>Média geral /100</span></div>
        </div>

        <section class="dashboard-means">
          <div class="card mean-panel">
            <div class="mean-panel-head">
              <div><span class="eyebrow blue">VISÃO RÁPIDA</span><h2>Média por turno</h2></div>
              <span class="mean-scale">0–100</span>
            </div>
            <div class="mean-list">${shiftAverageCards || '<p class="muted">Ainda não há respostas.</p>'}</div>
          </div>

          <div class="card mean-panel">
            <div class="mean-panel-head">
              <div><span class="eyebrow blue">ACOMPANHAMENTO</span><h2>Média por turma</h2></div>
              <span class="mean-scale">0–100</span>
            </div>
            <div class="mean-list mean-scroll">${classAverageCards || '<p class="muted">Ainda não há respostas.</p>'}</div>
          </div>
        </section>

        <section class="card student-grades-panel">
          <div class="student-grades-head">
            <div>
              <span class="eyebrow blue">LEITURA RÁPIDA DAS NOTAS</span>
              <h2>Notas dos alunos</h2>
              <p>Nome, escola, turno, turma e nota em uma única visualização.</p>
            </div>
            <div class="student-grade-search">
              <span>⌕</span>
              <input id="studentGradeSearch" placeholder="Buscar aluno, turma ou escola">
            </div>
          </div>

          <div class="student-grade-legend">
            <span><i class="legend-note-blue"></i> 60 a 100</span>
            <span><i class="legend-note-red"></i> abaixo de 60</span>
            <a href="/resultados">Ver todos os resultados →</a>
          </div>

          <div class="student-grade-list" id="studentGradeList">
            ${studentGradeRows || `
              <div class="student-grade-empty">
                <span>👤</span>
                <b>Ainda não há notas registradas</b>
                <small>Quando os alunos enviarem as provas, os nomes, turmas e notas aparecerão aqui.</small>
              </div>
            `}
          </div>
        </section>

        <section class="section-heading split" id="escolas">
          <div>
            <span class="eyebrow blue">ORGANIZAÇÃO PEDAGÓGICA</span>
            <h2>Escolas, turnos e turmas</h2>
            <p>Cada prova permanece vinculada à turma em que foi criada.</p>
          </div>
          <div class="search-box"><span>⌕</span><input id="schoolSearch" placeholder="Buscar escola, turma ou prova"></div>
        </section>

        <div class="school-list" id="schoolList">
          ${schoolBlocks || `
            <div class="card empty-state">
              <div class="empty-icon">📝</div>
              <h2>Nenhuma prova criada ainda</h2>
              <p>Quando você criar uma avaliação, ela aparecerá dentro da escola, turno e turma corretos.</p>
              <a class="btn" href="/provas/nova">Criar primeira prova</a>
            </div>
          `}
        </div>
      </main>
      <script>
        const studentSearch = document.getElementById('studentGradeSearch');
        if (studentSearch) studentSearch.addEventListener('input', () => {
          const term = studentSearch.value.trim().toLowerCase();
          document.querySelectorAll('.student-grade-row').forEach(row => {
            const text = row.dataset.studentSearch || '';
            row.style.display = !term || text.includes(term) ? '' : 'none';
          });
        });

        const search = document.getElementById('schoolSearch');
        if (search) search.addEventListener('input', () => {
          const term = search.value.trim().toLowerCase();
          document.querySelectorAll('.v7-school').forEach(school => {
            const schoolText = school.textContent.toLowerCase();
            school.style.display = !term || schoolText.includes(term) ? '' : 'none';
            if (term && schoolText.includes(term)) school.open = true;
          });
        });
      </script>
    `
  );
}

async function resetCreatedExamsPage(env, message = '') {
  const e = await env.DB.prepare('SELECT COUNT(*) AS c FROM exams').first();
  const s = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();

  return page(
    'Zerar provas de teste',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card">
          <div class="reset-icon">⌫</div>
          <span class="eyebrow red-text">FERRAMENTA DE TESTE</span>
          <h1>Zerar provas criadas</h1>
          <p class="reset-lead">
            Use esta opção para limpar as avaliações de teste e começar novamente com o painel vazio.
          </p>

          ${message ? `<div class="reset-success">${esc(message)}</div>` : ''}

          <div class="reset-summary">
            <div><small>Provas que serão apagadas</small><b>${Number(e?.c || 0)}</b></div>
            <div><small>Respostas que serão apagadas</small><b>${Number(s?.c || 0)}</b></div>
          </div>

          <div class="reset-warning">
            <b>O que será apagado</b>
            <p>Provas criadas, questões vinculadas às provas, resultados, respostas dos alunos, tentativas e cronômetros dessas provas.</p>
          </div>

          <div class="reset-safe">
            <b>O que será mantido</b>
            <p>Banco de questões, escolas, turnos e turmas. Nada disso será apagado.</p>
          </div>

          <form method="post" action="/provas/zerar" class="reset-form"
                onsubmit="return confirm('Confirma apagar TODAS as provas criadas e seus resultados? O banco de questões e as escolas serão mantidos.');">
            <label>
              Para confirmar, digite <b>ZERAR</b>
              <input name="confirm_text" autocomplete="off" placeholder="Digite ZERAR" required>
            </label>
            <button class="danger-button" type="submit">⌫ Zerar provas criadas</button>
            <a class="btn secondary" href="/">Cancelar e voltar</a>
          </form>
        </section>
      </main>
    `
  );
}

async function resetCreatedExams(request, env) {
  const f = await request.formData();
  const confirmText = String(f.get('confirm_text') || '').trim().toUpperCase();

  if (confirmText !== 'ZERAR') {
    return resetCreatedExamsPage(env, 'Nada foi apagado. Digite exatamente ZERAR para confirmar.');
  }

  await ensureExamAttemptTables(env);

  const beforeExams = await env.DB.prepare('SELECT COUNT(*) AS c FROM exams').first();
  const beforeSubs = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();

  // A ordem evita registros órfãos e respeita possíveis chaves estrangeiras.
  await ensureExamVariantTables(env);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM attempt_questions`),
    env.DB.prepare(`
      DELETE FROM attempt_answers
      WHERE attempt_id IN (SELECT id FROM exam_attempts)
    `),
    env.DB.prepare(`DELETE FROM exam_attempts`),
    env.DB.prepare(`
      DELETE FROM answers
      WHERE submission_id IN (SELECT id FROM submissions)
    `),
    env.DB.prepare(`DELETE FROM submissions`),
    env.DB.prepare(`DELETE FROM exam_questions`),
    env.DB.prepare(`DELETE FROM exam_context`),
    env.DB.prepare(`DELETE FROM exam_variant_settings`),
    env.DB.prepare(`DELETE FROM exams`)
  ]);

  const deletedExams = Number(beforeExams?.c || 0);
  const deletedSubs = Number(beforeSubs?.c || 0);

  return page(
    'Painel zerado',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card success-reset">
          <div class="success">✓</div>
          <span class="eyebrow blue">LIMPEZA CONCLUÍDA</span>
          <h1>Painel de provas zerado</h1>
          <p>Foram apagadas <b>${deletedExams}</b> prova(s) e <b>${deletedSubs}</b> resposta(s) de teste.</p>
          <div class="reset-safe">
            <b>Seu banco continua intacto</b>
            <p>Questões, escolas, turnos e turmas foram preservados.</p>
          </div>
          <div class="form-actions">
            <a class="btn" href="/">Voltar ao painel</a>
            <a class="btn secondary" href="/provas/nova">Criar nova prova</a>
          </div>
        </section>
      </main>
    `
  );
}

async function globalResults(env) {
  const rows = await env.DB.prepare(`
    SELECT
      e.id,
      e.title,
      e.active,
      sc.name AS school_name,
      cl.shift AS shift,
      COALESCE(cl.class_name,e.class_name) AS class_name,
      COALESCE(cl.grade,e.grade) AS grade,
      ec.trimester AS trimester,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_percent,
      COALESCE(SUM(su.percent),0) AS percent_sum
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    LEFT JOIN submissions su ON su.exam_id=e.id
    GROUP BY e.id
    ORDER BY sc.name, cl.shift, class_name, ec.trimester, e.id DESC
  `).all();

  const groups = new Map();

  for (const r of rows.results) {
    const school = r.school_name || 'Sem escola definida';
    const shift = r.shift || 'Sem turno';
    const cls = r.class_name || 'Sem turma';

    if (!groups.has(school)) {
      groups.set(school, { submissions: 0, percentSum: 0, exams: 0, shifts: new Map() });
    }

    const sg = groups.get(school);
    sg.submissions += Number(r.submissions || 0);
    sg.percentSum += Number(r.percent_sum || 0);
    sg.exams += 1;

    if (!sg.shifts.has(shift)) {
      sg.shifts.set(shift, { submissions: 0, percentSum: 0, classes: new Map() });
    }

    const shiftGroup = sg.shifts.get(shift);
    shiftGroup.submissions += Number(r.submissions || 0);
    shiftGroup.percentSum += Number(r.percent_sum || 0);

    if (!shiftGroup.classes.has(cls)) shiftGroup.classes.set(cls, []);
    shiftGroup.classes.get(cls).push(r);
  }

  const formatAvg = (sum, total) =>
    total ? (sum / total).toFixed(1).replace('.', ',') : '—';

  const blocks = [...groups.entries()].map(([schoolName, sg]) => {
    const schoolAvg = formatAvg(sg.percentSum, sg.submissions);

    const shiftBlocks = [...sg.shifts.entries()].map(([shift, shiftGroup]) => {
      const shiftAvg = formatAvg(shiftGroup.percentSum, shiftGroup.submissions);

      const classCards = [...shiftGroup.classes.entries()].map(([cls, exams]) => {
        const total = exams.reduce((n, e) => n + Number(e.submissions || 0), 0);
        const sum = exams.reduce((n, e) => n + Number(e.percent_sum || 0), 0);
        const classAvg = formatAvg(sum, total);

        const examRows = exams.map(e => {
          const examAvg = e.avg_percent == null ? '—' : Number(e.avg_percent).toFixed(1).replace('.', ',');
          return `
            <a class="result-exam-row" href="/provas/${e.id}/resultados">
              <div>
                <span class="mini-chip">${e.trimester ? e.trimester + 'º TRI' : 'PROVA'}</span>
                <b>${esc(e.title)}</b>
                <small>${esc(e.grade || '')}</small>
              </div>
              <div class="result-numbers">
                <span><b>${e.submissions || 0}</b><small>respostas</small></span>
                <span><b>${examAvg}</b><small>média /100</small></span>
                <i>›</i>
              </div>
            </a>`;
        }).join('');

        return `
          <section class="result-class-card">
            <div class="result-class-head">
              <div>
                <span class="class-avatar">${esc(cls).slice(0,3)}</span>
                <div>
                  <b>Turma ${esc(cls)}</b>
                  <small>${esc(shift)} · ${exams.length} prova(s) · ${total} resposta(s)</small>
                </div>
              </div>
              <div class="class-average"><small>Média da turma /100</small><b>${classAvg}</b></div>
            </div>
            ${examRows}
          </section>`;
      }).join('');

      const shiftIcon = shift === 'Noturno' ? '🌙' : shift === 'Tarde' ? '☀️' : shift === 'Integral' ? '🕘' : '🌤️';

      return `
        <div class="result-shift">
          <div class="shift-title result-shift-title">
            <span class="shift-icon">${shiftIcon}</span>
            <div><span class="eyebrow">TURNO</span><h3>${esc(shift)}</h3></div>
            <div class="shift-average"><small>Média do turno /100</small><b>${shiftAvg}</b></div>
          </div>
          ${classCards}
        </div>`;
    }).join('');

    return `
      <details class="school-result-group" open>
        <summary>
          <div class="school-summary-main">
            <div class="school-icon v7"><span>🏫</span></div>
            <div>
              <span class="eyebrow blue">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>${sg.exams} prova(s) · ${sg.submissions} resposta(s)</p>
            </div>
          </div>
          <div class="school-average">
            <small>Média da escola /100</small><b>${schoolAvg}</b><span class="summary-chevron">›</span>
          </div>
        </summary>
        <div class="school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  return page('Resultados gerais', nav() + `
    <main>
      <section class="results-header v7-results-hero">
        <div>
          <span class="eyebrow white">RESULTADOS PEDAGÓGICOS</span>
          <h1>Resultados por escola</h1>
          <p>Médias normalizadas de 0 a 100, organizadas por escola, turno, turma e prova.</p>
        </div>
        <a class="btn light" href="/">← Voltar ao painel</a>
      </section>
      <div class="section-heading">
        <span class="eyebrow blue">VISÃO ORGANIZADA</span>
        <h2>Escola → turno → turma → prova</h2>
        <p>As questões podem ser sorteadas; os resultados continuam vinculados à turma correta.</p>
      </div>
      <div class="school-list">
        ${blocks || '<div class="card empty-state"><h2>Ainda não há resultados</h2><p>Os resultados aparecerão aqui quando os alunos enviarem as provas.</p></div>'}
      </div>
    </main>`);
}


async function cleanupRepetitiveQuestionsPage(env, message = '') {
  const matchWhere = `
    (
      lower(trim(q.statement)) LIKE 'em uma atividade do%'
      OR lower(trim(q.statement)) LIKE 'em uma aula d%'
    )
  `;

  const total = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions q
    WHERE q.active=1 AND ${matchWhere}
  `).first();

  const linked = await env.DB.prepare(`
    SELECT COUNT(DISTINCT q.id) AS c
    FROM questions q
    JOIN exam_questions eq ON eq.question_id=q.id
    WHERE q.active=1 AND ${matchWhere}
  `).first();

  return page(
    'Limpar questões repetitivas',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card">
          <div class="reset-icon">🧹</div>
          <span class="eyebrow red-text">LIMPEZA DO BANCO DE QUESTÕES</span>
          <h1>Excluir enunciados antigos</h1>
          <p class="reset-lead">
            Esta ferramenta localiza questões de qualquer série que começam por
            <b>“Em uma atividade do...”</b> ou <b>“Em uma aula da/do/de...”</b>.
          </p>

          ${message ? `<div class="reset-success">${esc(message)}</div>` : ''}

          <div class="reset-summary">
            <div><small>Questões localizadas</small><b>${Number(total?.c || 0)}</b></div>
            <div><small>Já usadas em provas</small><b>${Number(linked?.c || 0)}</b></div>
          </div>

          <div class="reset-warning">
            <b>Como a limpeza funciona</b>
            <p>As questões não usadas em nenhuma prova são apagadas definitivamente. Se alguma já estiver ligada a uma prova existente, ela será desativada do banco para preservar a prova e o resultado antigo.</p>
          </div>

          <div class="reset-safe">
            <b>O que não será afetado</b>
            <p>As novas questões humanizadas, escolas, turmas, resultados e demais questões permanecem no sistema.</p>
          </div>

          <form method="post" action="/banco/limpar-repetitivas" class="reset-form"
                onsubmit="return confirm('Confirma a limpeza das questões com esses enunciados antigos?');">
            <label>
              Para confirmar, digite <b>EXCLUIR</b>
              <input name="confirm_text" autocomplete="off" placeholder="Digite EXCLUIR" required>
            </label>
            <button class="danger-button" type="submit">🧹 Excluir questões repetitivas</button>
            <a class="btn secondary" href="/banco">Cancelar e voltar</a>
          </form>
        </section>
      </main>
    `
  );
}

async function cleanupRepetitiveQuestions(request, env) {
  const f = await request.formData();
  const confirmText = String(f.get('confirm_text') || '').trim().toUpperCase();

  if (confirmText !== 'EXCLUIR') {
    return cleanupRepetitiveQuestionsPage(env, 'Nada foi excluído. Digite exatamente EXCLUIR para confirmar.');
  }

  const before = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).first();

  // Primeiro tira todas as questões correspondentes do banco ativo.
  await env.DB.prepare(`
    UPDATE questions
    SET active=0
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).run();

  // Depois apaga fisicamente as que nunca foram utilizadas em uma prova.
  await env.DB.prepare(`
    DELETE FROM questions
    WHERE active=0
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM exam_questions eq
        WHERE eq.question_id=questions.id
      )
  `).run();

  const removed = Number(before?.c || 0);

  return page(
    'Limpeza concluída',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card success-reset">
          <div class="success">✓</div>
          <span class="eyebrow blue">BANCO ATUALIZADO</span>
          <h1>Questões repetitivas removidas</h1>
          <p><b>${removed}</b> questão(ões) deixaram de aparecer no banco ativo e não serão mais sorteadas em novas provas.</p>
          <div class="reset-safe">
            <b>Banco preservado</b>
            <p>Questões humanizadas e demais conteúdos permaneceram ativos.</p>
          </div>
          <div class="form-actions">
            <a class="btn" href="/banco">Voltar ao banco</a>
            <a class="btn secondary" href="/">Ir ao painel</a>
          </div>
        </section>
      </main>
    `
  );
}

async function bank(env) {
  const repetitive = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).first();

  const qs = await env.DB.prepare(`
    SELECT *
    FROM questions
    WHERE active=1
    ORDER BY id DESC
  `).all();

  const sources = await env.DB.prepare(`
    SELECT DISTINCT source AS name
    FROM questions
    WHERE active=1 AND source IS NOT NULL AND TRIM(source)<>''
    ORDER BY source
  `).all();

  const sourceOptions = sources.results
    .map(s => `<option>${esc(s.name)}</option>`)
    .join('');

  const rows = qs.results.map(q => `
    <tr>
      <td>${q.id}</td>
      <td>${esc(q.grade)}</td>
      <td>${esc(q.trimester ? q.trimester + 'º' : 'Geral')}</td>
      <td>${esc(q.source || 'Autoral')}</td>
      <td>${esc(q.topic)}</td>
      <td>${esc(q.difficulty || 'Média')}</td>
      <td>${esc(q.statement)}</td>
      <td><b>${q.correct}</b></td>
    </tr>
  `).join('');

  return page(
    'Banco de questões',
    nav() + `
      <main>
        <div class="hero">
          <div>
            <h1>Banco de Questões</h1>
            <p>Organize por fonte, trimestre, assunto, dificuldade e habilidade.</p>
          </div>
          <a class="btn secondary" href="/">← Painel</a>
        </div>

        <div class="card cleanup-bank-card">
          <div class="cleanup-bank-main">
            <div>
              <span class="eyebrow red-text">LIMPEZA DO BANCO</span>
              <h2>Excluir questões com enunciado repetitivo</h2>
              <p>Encontradas agora: <b>${Number(repetitive?.c || 0)}</b> questão(ões) começando por “Em uma atividade do...” ou “Em uma aula da/do/de...”.</p>
            </div>
            <a class="btn danger-link" href="/banco/limpar-repetitivas">Revisar e excluir</a>
          </div>
        </div>

        <div class="card">
          <h2>Importar questões em lote</h2>
          <p>Envie um arquivo de banco de questões preparado para o sistema. Assim você pode adicionar dezenas ou centenas de questões de uma só vez.</p>

          <form method="post" action="/banco/importar" enctype="multipart/form-data">
            <label>
              Arquivo do banco (.json ou .txt)
              <input type="file" name="question_file" accept=".json,.txt,application/json,text/plain" required>
            </label>
            <button style="margin-top:12px">📥 Importar questões</button>
          </form>

          <p style="margin-top:10px"><small>O sistema valida cada questão antes de salvar e mostra quantas foram importadas.</small></p>
        </div>

        <div class="card">
          <h2>Adicionar questão</h2>

          <form method="post" class="grid">
            <label>
              Nível
              <select name="level">
                <option>Fundamental</option>
                <option>Médio</option>
              </select>
            </label>

            <label>
              Ano/Série
              <input name="grade" placeholder="8º ano" required>
            </label>

            <label>
              Trimestre
              <select name="trimester">
                <option value="0">Geral</option>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
              </select>
            </label>

            <label>
              Fonte / Referência
              <select name="source">
                ${sourceOptions}
              </select>
            </label>

            <label>
              Unidade temática
              <input name="unit_theme" placeholder="Esportes">
            </label>

            <label>
              Assunto
              <input name="topic" placeholder="Voleibol" required>
            </label>

            <label>
              Subassunto
              <input name="subtopic" placeholder="Fundamentos / regras">
            </label>

            <label>
              Dificuldade
              <select name="difficulty">
                <option>Fácil</option>
                <option selected>Média</option>
                <option>Difícil</option>
              </select>
            </label>

            <label class="span">
              Habilidade / Objetivo
              <input name="skill" placeholder="Habilidade curricular ou objetivo de aprendizagem">
            </label>

            <label class="span">
              Enunciado
              <textarea name="statement" required></textarea>
            </label>

            <label>
              Alternativa A
              <input name="option_a" required>
            </label>

            <label>
              Alternativa B
              <input name="option_b" required>
            </label>

            <label>
              Alternativa C
              <input name="option_c" required>
            </label>

            <label>
              Alternativa D
              <input name="option_d" required>
            </label>

            <label>
              Gabarito
              <select name="correct">
                <option>A</option>
                <option>B</option>
                <option>C</option>
                <option>D</option>
              </select>
            </label>

            <div>
              <button>Salvar questão</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>Questões cadastradas</h2>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ano</th>
                  <th>Tri</th>
                  <th>Fonte</th>
                  <th>Assunto</th>
                  <th>Dificuldade</th>
                  <th>Questão</th>
                  <th>Gab.</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </main>
    `
  );
}

async function addQuestion(request, env) {
  const f = await request.formData();

  await env.DB.prepare(`
    INSERT INTO questions
    (
      level,
      grade,
      topic,
      statement,
      option_a,
      option_b,
      option_c,
      option_d,
      correct,
      source,
      trimester,
      unit_theme,
      subtopic,
      difficulty,
      skill,
      active
    )
    VALUES
    (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1
    )
  `).bind(
    f.get('level'),
    f.get('grade'),
    f.get('topic'),
    f.get('statement'),
    f.get('option_a'),
    f.get('option_b'),
    f.get('option_c'),
    f.get('option_d'),
    f.get('correct'),
    f.get('source') || 'Questões autorais',
    Number(f.get('trimester') || 0),
    f.get('unit_theme') || '',
    f.get('subtopic') || '',
    f.get('difficulty') || 'Média',
    f.get('skill') || ''
  ).run();

  return redirect('/banco');
}


async function importQuestions(request, env) {
  const f = await request.formData();
  const file = f.get('question_file');

  if (!file || typeof file.text !== 'function') {
    return page(
      'Importação',
      '<div class="login"><h2>Selecione um arquivo válido.</h2><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  const raw = await file.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch (e) {
    return page(
      'Importação',
      '<div class="login"><h2>Arquivo inválido.</h2><p>O arquivo precisa estar no formato preparado para o EducaFísica Avalia.</p><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  if (!Array.isArray(data)) {
    return page(
      'Importação',
      '<div class="login"><h2>Formato inválido.</h2><p>O arquivo deve conter uma lista de questões.</p><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  const validCorrect = new Set(['A','B','C','D']);
  const validDifficulty = new Set(['Fácil','Média','Difícil']);
  const prepared = [];
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const q = data[i] || {};
    const row = i + 1;

    const required = [
      ['level', q.level],
      ['grade', q.grade],
      ['topic', q.topic],
      ['statement', q.statement],
      ['option_a', q.option_a],
      ['option_b', q.option_b],
      ['option_c', q.option_c],
      ['option_d', q.option_d],
      ['correct', q.correct]
    ];

    const missing = required.filter(([_, v]) => !String(v ?? '').trim()).map(([k]) => k);

    if (missing.length) {
      errors.push(`Questão ${row}: campos ausentes (${missing.join(', ')})`);
      continue;
    }

    const correct = String(q.correct).trim().toUpperCase();
    if (!validCorrect.has(correct)) {
      errors.push(`Questão ${row}: gabarito precisa ser A, B, C ou D`);
      continue;
    }

    let difficulty = String(q.difficulty || 'Média').trim();
    if (!validDifficulty.has(difficulty)) difficulty = 'Média';

    let trimester = Number(q.trimester ?? 0);
    if (![0,1,2,3].includes(trimester)) trimester = 0;

    prepared.push({
      level: String(q.level).trim(),
      grade: String(q.grade).trim(),
      topic: String(q.topic).trim(),
      statement: String(q.statement).trim(),
      option_a: String(q.option_a).trim(),
      option_b: String(q.option_b).trim(),
      option_c: String(q.option_c).trim(),
      option_d: String(q.option_d).trim(),
      correct,
      source: String(q.source || 'Questões autorais').trim(),
      trimester,
      unit_theme: String(q.unit_theme || '').trim(),
      subtopic: String(q.subtopic || '').trim(),
      difficulty,
      skill: String(q.skill || '').trim()
    });
  }

  if (!prepared.length) {
    const detail = errors.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('');
    return page(
      'Importação',
      `<div class="login"><h2>Nenhuma questão foi importada.</h2><ul style="text-align:left">${detail}</ul><a class="btn" href="/banco">Voltar</a></div>`,
      400
    );
  }

  const statements = prepared.map(q =>
    env.DB.prepare(`
      INSERT INTO questions
      (
        level, grade, topic, statement,
        option_a, option_b, option_c, option_d,
        correct, source, trimester, unit_theme,
        subtopic, difficulty, skill, active
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `).bind(
      q.level,
      q.grade,
      q.topic,
      q.statement,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.correct,
      q.source,
      q.trimester,
      q.unit_theme,
      q.subtopic,
      q.difficulty,
      q.skill
    )
  );

  // D1 batch limits can vary; import in smaller chunks.
  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }

  const warning = errors.length
    ? `<p><b>${errors.length}</b> registro(s) ignorado(s) por erro.</p>`
    : '';

  return page(
    'Importação concluída',
    `
      <div class="login">
        <h1>✅ Banco atualizado</h1>
        <p><b>${prepared.length}</b> questão(ões) importada(s) com sucesso.</p>
        ${warning}
        <a class="btn" href="/banco">Ver Banco de Questões</a>
        <a class="btn secondary" href="/provas/nova">Criar prova</a>
      </div>
    `
  );
}

async function newExam(env) {
  const qs = await env.DB.prepare(`
    SELECT *
    FROM questions
    WHERE active=1
    ORDER BY level,grade,topic,id
  `).all();

  const schools = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE active=1
    ORDER BY name
  `).all();

  const sources = await env.DB.prepare(`
    SELECT DISTINCT source AS name
    FROM questions
    WHERE active=1 AND source IS NOT NULL AND TRIM(source)<>''
    ORDER BY source
  `).all();

  const topics = await env.DB.prepare(`
    SELECT DISTINCT topic
    FROM questions
    WHERE active=1 AND topic<>''
    ORDER BY topic
  `).all();

  const items = qs.results.map(q => `
    <label
      class="pick manual-question"
      data-grade="${attr(q.grade)}"
      data-trimester="${q.trimester || 0}"
      data-source="${attr(q.source || 'Autoral')}"
      data-topic="${attr(q.topic)}"
      data-difficulty="${attr(q.difficulty || 'Média')}"
    >
      <input type="checkbox" name="question_ids" value="${q.id}">
      <span>
        <b>${esc(q.grade)} · ${esc(q.topic)}</b><br>
        <small>${esc(q.source || 'Autoral')} · ${q.trimester ? q.trimester + 'º tri' : 'Geral'} · ${esc(q.difficulty || 'Média')}</small><br>
        ${esc(q.statement)}
      </span>
    </label>
  `).join('');

  const schoolOptions = schools.results.map(s =>
    `<option value="${s.id}">${esc(s.name)}</option>`
  ).join('');

  const sourceOptions = sources.results.map(s => {
    const selected = s.name === 'Banco Humanizado 2026 · CREP/RCO+' ? ' selected' : '';
    return `<option value="${attr(s.name)}"${selected}>${esc(s.name)}${selected ? ' · recomendado' : ''}</option>`;
  }).join('');

  const topicOptions = topics.results.map(t =>
    `<option value="${attr(t.topic)}">${esc(t.topic)}</option>`
  ).join('');

  return page(
    'Criar prova',
    nav() + `
      <main>
        <div class="hero">
          <div>
            <h1>Criar Prova</h1>
            <p>Escolha qualquer escola, turno, série e turma. A turma é cadastrada automaticamente quando necessário.</p>
          </div>
          <a class="btn secondary" href="/">← Painel</a>
        </div>

        <form method="post" id="examCreateForm">
          <div class="card grid">
            <label class="span">
              Título
              <input name="title" placeholder="Prova do 2º trimestre" required>
            </label>

            <label class="span">
              Escola
              <select name="school_id" id="school" required>
                <option value="">Selecione a escola</option>
                ${schoolOptions}
              </select>
            </label>

            <label>
              Turno
              <select name="shift" id="shift" required>
                <option value="">Selecione</option>
                <option>Manhã</option>
                <option>Tarde</option>
                <option>Noturno</option>
                <option>Integral</option>
              </select>
            </label>

            <label>
              Etapa
              <select name="education_level" id="educationLevel" required>
                <option value="Fundamental">Ensino Fundamental</option>
                <option value="Médio">Ensino Médio</option>
              </select>
            </label>

            <label>
              Ano/Série
              <select name="grade" id="grade" required></select>
            </label>

            <label>
              Turma
              <select name="class_letter" id="classLetter" required>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="G">G</option>
                <option value="H">H</option>
                <option value="T">T</option>
                <option value="OUTRA">Outra turma</option>
              </select>
            </label>

            <label id="customClassWrap" style="display:none">
              Nome da turma
              <input name="custom_class" id="customClass" placeholder="Ex.: 1T, 8G, EJA A">
            </label>

            <label>
              Modalidade
              <select name="modality" id="modality">
                <option value="Regular">Regular</option>
                <option value="Técnico">Técnico</option>
              </select>
            </label>

            <label>
              Trimestre
              <select name="trimester" id="trimester" required>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
              </select>
            </label>

            <label>
              Valor da prova
              <input name="total_points" type="number" step="0.1" value="10" required>
            </label>

            <div class="span info-box">
              <b>Como funciona:</b> não é necessário cadastrar previamente cada turma de cada escola.
              Ao criar a prova, o sistema registra automaticamente a combinação escolhida de escola, turno, série e turma.
              Para turma técnica, mantenha a série normal (ex.: <b>1ª série</b>) e selecione <b>Técnico</b> em Modalidade.
            </div>
          </div>

          <div class="card">
            <h2>Como você quer montar?</h2>

            <div class="mode-grid">
              <label class="mode-card">
                <input type="radio" name="generation_mode" value="auto" checked>
                <span>
                  <b>🎲 Gerar automaticamente</b><br>
                  <small>Escolha fonte, assunto, dificuldade e quantidade.</small>
                </span>
              </label>

              <label class="mode-card">
                <input type="radio" name="generation_mode" value="manual">
                <span>
                  <b>☑️ Selecionar manualmente</b><br>
                  <small>Marque as questões que quiser.</small>
                </span>
              </label>
            </div>
          </div>

          <div class="card" id="autoBox">
            <h2>Gerador automático</h2>

            <div class="grid">
              <label>
                Fonte / Referência
                <select name="source_filter">
                  <option value="">Todas</option>
                  ${sourceOptions}
                </select>
              </label>

              <label>
                Assunto
                <select name="topic_filter">
                  <option value="">Todos</option>
                  ${topicOptions}
                </select>
              </label>

              <label>
                Dificuldade
                <select name="difficulty_filter">
                  <option value="">Mista</option>
                  <option>Fácil</option>
                  <option>Média</option>
                  <option>Difícil</option>
                </select>
              </label>

              <label>
                Número de questões
                <input id="questionCount" name="question_count" type="number" min="1" max="60" value="10" inputmode="numeric">
                <small>Escolha de 1 a 60, conforme a quantidade disponível no banco.</small>
              </label>
            </div>

            <div class="count-picker" aria-label="Atalhos de quantidade">
              <span>Quantidade rápida:</span>
              ${[5,10,15,20,25,30,40,50,60].map(n => `<button type="button" class="count-chip${n===10?' active':''}" data-count="${n}">${n}</button>`).join('')}
            </div>

            <div class="info-box">
              O sistema usa o <b>ano/série</b> e o <b>trimestre</b> escolhidos para localizar as questões correspondentes. Você pode gerar até <b>60 questões</b>, desde que existam questões suficientes para os filtros escolhidos.
            </div>

            <button style="margin-top:15px">🎲 Gerar prova aleatória</button>
          </div>

          <div class="card" id="manualBox" style="display:none">
            <h2>Seleção manual</h2>
            <div class="filter-note" id="manualStatus">Mostrando questões compatíveis com a série e o trimestre.</div>
            <div class="question-list">${items}</div>
            <button style="margin-top:15px">Criar com questões selecionadas</button>
          </div>
        </form>
      </main>

      <script>
        const educationLevel = document.getElementById('educationLevel');
        const grade = document.getElementById('grade');
        const classLetter = document.getElementById('classLetter');
        const customClassWrap = document.getElementById('customClassWrap');
        const customClass = document.getElementById('customClass');
        const trimester = document.getElementById('trimester');
        const questionCount = document.getElementById('questionCount');
        const countChips = document.querySelectorAll('.count-chip');

        countChips.forEach(chip => chip.addEventListener('click', () => {
          questionCount.value = chip.dataset.count;
          countChips.forEach(c => c.classList.toggle('active', c === chip));
        }));
        questionCount.addEventListener('input', () => {
          let n = Number(questionCount.value || 1);
          if (n > 60) questionCount.value = 60;
          countChips.forEach(c => c.classList.toggle('active', Number(c.dataset.count) === Number(questionCount.value)));
        });

        const gradesByLevel = {
          'Fundamental': ['6º ano','7º ano','8º ano','9º ano'],
          'Médio': ['1ª série','2ª série','3ª série']
        };

        function fillGrades() {
          const values = gradesByLevel[educationLevel.value] || [];
          grade.innerHTML = values.map(v => '<option value="' + v + '">' + v + '</option>').join('');
          filterManualQuestions();
        }

        function toggleCustomClass() {
          const show = classLetter.value === 'OUTRA';
          customClassWrap.style.display = show ? 'block' : 'none';
          customClass.required = show;
        }

        function filterManualQuestions() {
          const selectedGrade = grade.value;
          const selectedTri = trimester.value;
          let visible = 0;
          document.querySelectorAll('.manual-question').forEach(el => {
            const gradeOk = !selectedGrade || el.dataset.grade === selectedGrade;
            const triOk = el.dataset.trimester === '0' || el.dataset.trimester === selectedTri;
            const show = gradeOk && triOk;
            el.style.display = show ? 'flex' : 'none';
            if (show) visible++;
          });
          const status = document.getElementById('manualStatus');
          if (status) status.textContent = visible + ' questão(ões) disponíveis para ' + selectedGrade + ' · ' + selectedTri + 'º trimestre.';
        }

        educationLevel.addEventListener('change', fillGrades);
        grade.addEventListener('change', filterManualQuestions);
        trimester.addEventListener('change', filterManualQuestions);
        classLetter.addEventListener('change', toggleCustomClass);
        fillGrades();
        toggleCustomClass();

        const autoBox = document.getElementById('autoBox');
        const manualBox = document.getElementById('manualBox');
        const modes = document.querySelectorAll('input[name="generation_mode"]');

        function updateMode() {
          const mode = document.querySelector('input[name="generation_mode"]:checked').value;
          autoBox.style.display = mode === 'auto' ? 'block' : 'none';
          manualBox.style.display = mode === 'manual' ? 'block' : 'none';
          if (mode === 'manual') filterManualQuestions();
        }

        modes.forEach(m => m.addEventListener('change', updateMode));
        updateMode();
      </script>
    `
  );
}

async function createExam(request, env) {
  const f = await request.formData();

  const schoolId = Number(f.get('school_id'));
  const shift = String(f.get('shift') || '').trim();
  const educationLevel = String(f.get('education_level') || '').trim();
  const grade = String(f.get('grade') || '').trim();
  const classLetter = String(f.get('class_letter') || '').trim();
  const customClass = String(f.get('custom_class') || '').trim();
  const modality = String(f.get('modality') || 'Regular').trim();

  const school = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE id=? AND active=1
  `).bind(schoolId).first();

  if (!school || !shift || !grade || !classLetter) {
    return page(
      'Atenção',
      '<div class="login"><h2>Preencha escola, turno, série e turma.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const allowedGrades = educationLevel === 'Médio'
    ? ['1ª série','2ª série','3ª série']
    : ['6º ano','7º ano','8º ano','9º ano'];

  if (!allowedGrades.includes(grade)) {
    return page(
      'Atenção',
      '<div class="login"><h2>Ano/Série inválido.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const prefix = grade.startsWith('1ª') ? '1'
    : grade.startsWith('2ª') ? '2'
    : grade.startsWith('3ª') ? '3'
    : grade.startsWith('6º') ? '6'
    : grade.startsWith('7º') ? '7'
    : grade.startsWith('8º') ? '8'
    : grade.startsWith('9º') ? '9'
    : '';

  let baseClassName;
  if (classLetter === 'OUTRA') {
    if (!customClass) {
      return page(
        'Atenção',
        '<div class="login"><h2>Digite o nome da outra turma.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }
    baseClassName = customClass;
  } else {
    baseClassName = `${prefix}${classLetter}`;
  }

  const className = modality === 'Técnico'
    ? `${baseClassName} (Técnico)`
    : baseClassName;

  // Reutiliza a turma se ela já existir; caso contrário, cadastra automaticamente.
  let classInfo = await env.DB.prepare(`
    SELECT id,school_id,shift,class_name,grade
    FROM school_classes
    WHERE school_id=? AND shift=? AND class_name=? AND grade=? AND active=1
    ORDER BY id
    LIMIT 1
  `).bind(schoolId, shift, className, grade).first();

  if (!classInfo) {
    const inserted = await env.DB.prepare(`
      INSERT INTO school_classes (school_id, shift, class_name, grade, active)
      VALUES (?,?,?,?,1)
    `).bind(schoolId, shift, className, grade).run();

    classInfo = {
      id: inserted.meta.last_row_id,
      school_id: schoolId,
      shift,
      class_name: className,
      grade
    };
  }

  const mode = String(f.get('generation_mode') || 'auto');
  const trimester = Number(f.get('trimester') || 1);

  let ids = [];
  let studentQuestionCount = 0;

  if (mode === 'manual') {
    ids = f.getAll('question_ids').map(Number).filter(Boolean);

    studentQuestionCount = ids.length;

    if (!ids.length) {
      return page(
        'Atenção',
        '<div class="login"><h2>Selecione pelo menos uma questão.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }
  } else {
    const source = String(f.get('source_filter') || '').trim();
    const topic = String(f.get('topic_filter') || '').trim();
    const difficulty = String(f.get('difficulty_filter') || '').trim();
    const count = Math.max(1, Math.min(60, Number(f.get('question_count') || 10)));
    studentQuestionCount = count;

    const clauses = [
      'active=1',
      'grade=?',
      '(trimester=0 OR trimester=?)'
    ];

    const binds = [grade, trimester];

    if (source) {
      clauses.push('source=?');
      binds.push(source);
    }

    if (topic) {
      clauses.push('topic=?');
      binds.push(topic);
    }

    if (difficulty) {
      clauses.push('difficulty=?');
      binds.push(difficulty);
    }

    const sql = `
      SELECT id
      FROM questions
      WHERE ${clauses.join(' AND ')}
      ORDER BY RANDOM()
      LIMIT ?
    `;

    // A prova guarda um banco de até 60 questões compatíveis.
    // Cada aluno receberá apenas studentQuestionCount delas.
    binds.push(60);

    const picked = await env.DB.prepare(sql).bind(...binds).all();
    ids = picked.results.map(x => Number(x.id));

    if (ids.length < count) {
      const criteria = [
        grade,
        `${trimester}º trimestre`,
        source || 'todas as fontes',
        topic || 'todos os assuntos',
        difficulty || 'dificuldade mista'
      ].join(' · ');

      return page(
        'Banco insuficiente',
        `
          <div class="login">
            <h2>Não há questões suficientes para esse filtro.</h2>
            <p>Encontradas: <b>${ids.length}</b> de <b>${count}</b>.</p>
            <p><small>${esc(criteria)}</small></p>
            <p>Cadastre mais questões no Banco de Questões ou escolha filtros mais amplos.</p>
            <a class="btn" href="/provas/nova">Voltar</a>
            <a class="btn secondary" href="/banco">Abrir banco</a>
          </div>
        `,
        400
      );
    }
  }

  const token = await uniqueExamToken(env);

  const r = await env.DB.prepare(`
    INSERT INTO exams
      (token,title,level,grade,class_name,total_points,active)
    VALUES
      (?,?,?,?,?,?,1)
  `).bind(
    token,
    f.get('title'),
    educationLevel === 'Médio' ? 'Médio' : 'Fundamental',
    grade,
    className,
    Number(f.get('total_points') || 10)
  ).run();

  const examId = r.meta.last_row_id;

  await env.DB.batch(
    ids.map((id, i) =>
      env.DB
        .prepare('INSERT INTO exam_questions (exam_id,question_id,position) VALUES (?,?,?)')
        .bind(examId, id, i + 1)
    )
  );

  await env.DB.prepare(`
    INSERT OR REPLACE INTO exam_context
      (exam_id, school_id, school_class_id, trimester)
    VALUES
      (?,?,?,?)
  `).bind(
    examId,
    schoolId,
    classInfo.id,
    trimester
  ).run();

  await ensureExamVariantTables(env);

  await env.DB.prepare(`
    INSERT OR REPLACE INTO exam_variant_settings
      (exam_id, question_count, randomize_questions, randomize_options)
    VALUES (?,?,1,1)
  `).bind(
    examId,
    Math.max(1, Math.min(studentQuestionCount || ids.length, ids.length))
  ).run();

  return redirect(`/provas/${examId}`);
}

async function examDetail(env, id, origin) {
  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      c.class_name AS linked_class_name,
      c.grade AS linked_grade,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(id).first();

  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);

  await ensureExamVariantTables(env);

  const variantSettings = await env.DB.prepare(`
    SELECT question_count, randomize_questions, randomize_options
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(id).first();

  const qs = await env.DB.prepare(`
    SELECT q.*,eq.position
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    WHERE eq.exam_id=?
    ORDER BY eq.position
  `).bind(id).all();

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submissions WHERE exam_id=?'
  ).bind(id).first();

  const perStudentCount = Math.max(
    1,
    Math.min(
      Number(variantSettings?.question_count || qs.results.length),
      qs.results.length || 1
    )
  );

  const link = `${origin}/e/${e.token}`;
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(link)}&size=240&margin=2&ecLevel=M&format=svg`;
  const list = qs.results.map(q =>
    `<li><b>${q.position}. ${esc(q.topic)}</b> — ${esc(q.statement)}</li>`
  ).join('');

  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  return page(
    e.title,
    nav() + `
      <main>
        <div class="hero">
          <div>
            <h1>${esc(e.title)}</h1>
            <p>${context || (esc(e.grade) + ' · ' + esc(e.class_name || ''))}</p>
          </div>
          <a class="btn secondary" href="/">← Painel</a>
        </div>

        <div class="cards">
          <div class="card stat"><b>${count.c}</b><span>Respostas</span></div>
          <div class="card stat"><b>${perStudentCount}</b><span>Questões por aluno</span></div>
          <div class="card stat"><b>${qs.results.length}</b><span>Banco da prova</span></div>
          <div class="card stat"><b>${e.active ? 'Aberta' : 'Encerrada'}</b><span>Status</span></div>
        </div>

        <div class="card share-exam-card">
          <div class="share-exam-copy">
            <span class="eyebrow blue">ACESSO DO ALUNO</span>
            <h2>Link curto da prova</h2>
            <div class="short-link-box">
              <input id="link" value="${attr(link)}" readonly>
              <button onclick="navigator.clipboard.writeText(document.getElementById('link').value);this.textContent='Copiado ✓';">Copiar link</button>
            </div>
            <p><small>Envie o mesmo link para toda a turma. Cada aluno recebe uma versão individual da prova.</small></p>
            <div class="variant-note">🔀 Questões e alternativas são embaralhadas individualmente. Quando o banco da prova tem mais questões que a quantidade escolhida, cada aluno também recebe uma seleção diferente.</div>
          </div>
          <div class="qr-box">
            <img src="${attr(qrUrl)}" width="210" height="210" alt="QR Code para abrir a prova">
            <b>QR Code da prova</b>
            <small>O aluno aponta a câmera e abre diretamente.</small>
          </div>
        </div>

        <div class="card actions">
          <a class="btn" href="/provas/${id}/resultados">Notas e gráficos</a>
          <form method="post" action="/provas/${id}/toggle">
            <button class="secondary">${e.active ? 'Encerrar prova' : 'Reabrir prova'}</button>
          </form>
          <a class="btn secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a>
        </div>

        <div class="card">
          <h2>Banco de questões desta prova</h2>
          <p><small>Este é o conjunto usado para gerar as versões individuais. O aluno vê ${perStudentCount} questão(ões).</small></p>
          <ol>${list}</ol>
        </div>
      </main>
    `
  );
}

async function toggleExam(env, id) {
  await env.DB.prepare('UPDATE exams SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run();
  return redirect(`/provas/${id}`);
}


async function publicExam(request, env, token, publicPrefix = '/p') {
  const publicPath = `${publicPrefix}/${token}`;

  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.token=?
  `).bind(token).first();

  if (!e) return page('Link inválido', '<div class="login"><h2>Prova não encontrada.</h2></div>', 404);
  if (!e.active) return page('Prova encerrada', '<div class="login"><h2>O professor encerrou esta prova.</h2></div>', 403);

  await ensureExamVariantTables(env);

  const cookieName = `ea_${e.id}`;
  const cookieToken = readCookie(request, cookieName);

  let attempt = cookieToken
    ? await env.DB.prepare(`
        SELECT * FROM exam_attempts
        WHERE exam_id=? AND attempt_token=?
        ORDER BY id DESC LIMIT 1
      `).bind(e.id, cookieToken).first()
    : null;

  const now = Math.floor(Date.now() / 1000);

  // Garante que tentativas antigas/retomadas tenham uma versão individual fixa.
  if (attempt) {
    await ensureAttemptVariant(env, e.id, attempt.id);
  }

  let attemptQs = attempt
    ? await loadAttemptVariantQuestions(env, attempt.id)
    : [];

  // Se o tempo terminou enquanto o aluno estava fora, finaliza usando apenas
  // as questões que pertencem à versão individual daquele aluno.
  if (attempt && attempt.status === 'in_progress' && now >= Number(attempt.deadline_at)) {
    const result = await finalizeAttempt(env, e, attemptQs, attempt, Number(attempt.deadline_at));
    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, true));
  }

  if (request.method === 'GET') {
    if (!attempt) return page(e.title, studentStartPage(e));

    if (attempt.status === 'submitted') {
      const result = await loadAttemptResult(env, attempt, attemptQs.length);
      return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
    }

    const saved = await env.DB.prepare(`
      SELECT question_id,answer
      FROM attempt_answers
      WHERE attempt_id=?
    `).bind(attempt.id).all();

    const savedMap = Object.fromEntries(
      saved.results.map(x => [String(x.question_id), String(x.answer || '')])
    );

    return page(e.title, studentForm(e, attemptQs, attempt, savedMap));
  }

  const f = await request.formData();
  const action = String(f.get('action') || 'submit');

  if (action === 'start') {
    if (attempt && attempt.status === 'in_progress') return redirect(publicPath);

    const name = String(f.get('student_name') || '').trim();
    if (!name) return page(e.title, studentStartPage(e, 'Digite seu nome completo.'), 400);

    const existing = await env.DB.prepare(`
      SELECT id
      FROM submissions
      WHERE exam_id=? AND lower(trim(student_name))=lower(trim(?))
      ORDER BY id DESC LIMIT 1
    `).bind(e.id, name).first();

    if (existing) {
      return page(
        'Prova já realizada',
        `<div class="login"><h2>Esta prova já foi enviada com o nome <b>${esc(name)}</b>.</h2><p>Se houver algum problema, fale com o professor.</p></div>`,
        409
      );
    }

    // Mesmo nome = mesma tentativa, mesmo relógio e mesma versão.
    const previousAttempt = await env.DB.prepare(`
      SELECT *
      FROM exam_attempts
      WHERE exam_id=?
        AND lower(trim(student_name))=lower(trim(?))
        AND status='in_progress'
      ORDER BY id DESC
      LIMIT 1
    `).bind(e.id, name).first();

    if (previousAttempt) {
      await ensureAttemptVariant(env, e.id, previousAttempt.id);
      const previousQs = await loadAttemptVariantQuestions(env, previousAttempt.id);

      if (Math.floor(Date.now() / 1000) >= Number(previousAttempt.deadline_at)) {
        await finalizeAttempt(
          env,
          e,
          previousQs,
          previousAttempt,
          Number(previousAttempt.deadline_at)
        );
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: publicPath,
          'Set-Cookie': `${cookieName}=${previousAttempt.attempt_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        }
      });
    }

    const attemptToken =
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '').slice(0, 12);

    const startedAt = Math.floor(Date.now() / 1000);
    const deadlineAt = startedAt + 50 * 60;

    const inserted = await env.DB.prepare(`
      INSERT INTO exam_attempts
        (exam_id,attempt_token,student_name,started_at,deadline_at,status,suspicious_events)
      VALUES (?,?,?,?,?,'in_progress',0)
    `).bind(e.id, attemptToken, name, startedAt, deadlineAt).run();

    // Aqui nasce a versão individual:
    // questões sorteadas do pool + ordem das questões + ordem A/B/C/D.
    await ensureAttemptVariant(env, e.id, inserted.meta.last_row_id);

    return new Response(null, {
      status: 302,
      headers: {
        Location: publicPath,
        'Set-Cookie': `${cookieName}=${attemptToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
      }
    });
  }

  if (!attempt) {
    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, error: 'attempt_not_found' }, 409);
    }

    return page(
      e.title,
      studentStartPage(e, 'Sua sessão não foi encontrada. Inicie a prova novamente.'),
      409
    );
  }

  // Atualiza a versão individual depois de qualquer retomada.
  await ensureAttemptVariant(env, e.id, attempt.id);
  attemptQs = await loadAttemptVariantQuestions(env, attempt.id);

  if (attempt.status === 'submitted') {
    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, submitted: true }, 409);
    }

    const result = await loadAttemptResult(env, attempt, attemptQs.length);
    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
  }

  const current = Math.floor(Date.now() / 1000);

  if (current >= Number(attempt.deadline_at)) {
    const result = await finalizeAttempt(env, e, attemptQs, attempt, Number(attempt.deadline_at));

    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, expired: true, redirect: publicPath }, 409);
    }

    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, true));
  }

  if (action === 'autosave') {
    const qid = Number(f.get('question_id'));
    const answer = String(f.get('answer') || '');

    const validQuestion = attemptQs.some(q => Number(q.id) === qid);

    if (!validQuestion || !['A','B','C','D'].includes(answer)) {
      return jsonResponse({ ok: false, error: 'invalid_answer' }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO attempt_answers (attempt_id,question_id,answer,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(attempt_id,question_id)
      DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at
    `).bind(attempt.id, qid, answer, current).run();

    return jsonResponse({
      ok: true,
      remaining: Math.max(0, Number(attempt.deadline_at) - current)
    });
  }

  if (action === 'event') {
    await env.DB.prepare(`
      UPDATE exam_attempts
      SET suspicious_events=suspicious_events+1
      WHERE id=? AND status='in_progress'
    `).bind(attempt.id).run();

    return jsonResponse({ ok: true });
  }

  // Salva as respostas finais da versão individual.
  const finalSave = [];

  for (const q of attemptQs) {
    const answer = String(f.get(`q_${q.id}`) || '');

    if (['A','B','C','D'].includes(answer)) {
      finalSave.push(
        env.DB.prepare(`
          INSERT INTO attempt_answers (attempt_id,question_id,answer,updated_at)
          VALUES (?,?,?,?)
          ON CONFLICT(attempt_id,question_id)
          DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at
        `).bind(attempt.id, q.id, answer, current)
      );
    }
  }

  if (finalSave.length) await env.DB.batch(finalSave);

  const result = await finalizeAttempt(env, e, attemptQs, attempt, current);
  return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
}


async function ensureExamVariantTables(env) {
  await ensureExamAttemptTables(env);

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exam_variant_settings (
      exam_id INTEGER PRIMARY KEY,
      question_count INTEGER NOT NULL DEFAULT 10,
      randomize_questions INTEGER NOT NULL DEFAULT 1,
      randomize_options INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS attempt_questions (
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      option_order TEXT NOT NULL DEFAULT 'ABCD',
      PRIMARY KEY (attempt_id,question_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt_position
    ON attempt_questions (attempt_id,position)
  `).run();
}

function shuffledOptionOrder() {
  const a = ['A','B','C','D'];

  for (let i = a.length - 1; i > 0; i--) {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    const j = byte[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a.join('');
}

async function ensureAttemptVariant(env, examId, attemptId) {
  const existing = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM attempt_questions
    WHERE attempt_id=?
  `).bind(attemptId).first();

  if (Number(existing?.c || 0) > 0) return;

  const poolCount = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM exam_questions
    WHERE exam_id=?
  `).bind(examId).first();

  const totalPool = Number(poolCount?.c || 0);
  if (!totalPool) return;

  const settings = await env.DB.prepare(`
    SELECT question_count, randomize_questions, randomize_options
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(examId).first();

  // Provas antigas: usa todas as questões existentes, mas já embaralha
  // ordem de questões e alternativas.
  const requested = Math.max(
    1,
    Math.min(
      Number(settings?.question_count || totalPool),
      totalPool
    )
  );

  const randomizeQuestions = settings?.randomize_questions == null
    ? 1
    : Number(settings.randomize_questions);

  const randomizeOptions = settings?.randomize_options == null
    ? 1
    : Number(settings.randomize_options);

  const picked = await env.DB.prepare(`
    SELECT question_id
    FROM exam_questions
    WHERE exam_id=?
    ORDER BY ${randomizeQuestions ? 'RANDOM()' : 'position'}
    LIMIT ?
  `).bind(examId, requested).all();

  if (!picked.results.length) return;

  await env.DB.batch(
    picked.results.map((row, index) =>
      env.DB.prepare(`
        INSERT OR IGNORE INTO attempt_questions
          (attempt_id,question_id,position,option_order)
        VALUES (?,?,?,?)
      `).bind(
        attemptId,
        Number(row.question_id),
        index + 1,
        randomizeOptions ? shuffledOptionOrder() : 'ABCD'
      )
    )
  );
}

async function loadAttemptVariantQuestions(env, attemptId) {
  const rows = await env.DB.prepare(`
    SELECT
      q.*,
      aq.position,
      aq.option_order
    FROM attempt_questions aq
    JOIN questions q ON q.id=aq.question_id
    WHERE aq.attempt_id=?
    ORDER BY aq.position
  `).bind(attemptId).all();

  return rows.results.map(row => {
    const order = String(row.option_order || 'ABCD').toUpperCase();
    const safeOrder =
      order.length === 4 &&
      [...order].every(x => ['A','B','C','D'].includes(x)) &&
      new Set(order).size === 4
        ? order
        : 'ABCD';

    const originalOptions = {
      A: row.option_a,
      B: row.option_b,
      C: row.option_c,
      D: row.option_d
    };

    const displayedLetters = ['A','B','C','D'];

    const displayedOptions = {};
    displayedLetters.forEach((displayLetter, index) => {
      displayedOptions[displayLetter] = originalOptions[safeOrder[index]];
    });

    const correctIndex = safeOrder.indexOf(String(row.correct || '').toUpperCase());
    const displayedCorrect = correctIndex >= 0
      ? displayedLetters[correctIndex]
      : String(row.correct || '').toUpperCase();

    return {
      ...row,
      option_a: displayedOptions.A,
      option_b: displayedOptions.B,
      option_c: displayedOptions.C,
      option_d: displayedOptions.D,
      correct: displayedCorrect
    };
  });
}

async function ensureExamAttemptTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      attempt_token TEXT NOT NULL UNIQUE,
      student_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      submitted_at INTEGER,
      submission_id INTEGER,
      status TEXT NOT NULL DEFAULT 'in_progress',
      suspicious_events INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_token
    ON exam_attempts (exam_id,attempt_token)
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS attempt_answers (
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (attempt_id,question_id)
    )
  `).run();
}

async function finalizeAttempt(env, e, qs, attempt, finishedAt) {
  const fresh = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=?').bind(attempt.id).first();
  if (fresh && fresh.status === 'submitted') {
    return loadAttemptResult(env, fresh, qs.length);
  }

  const saved = await env.DB.prepare(`
    SELECT question_id,answer
    FROM attempt_answers
    WHERE attempt_id=?
  `).bind(attempt.id).all();

  const answerMap = new Map(saved.results.map(x => [Number(x.question_id), String(x.answer || '')]));
  let correct = 0;

  const answerRows = qs.map(q => {
    const a = answerMap.get(Number(q.id)) || '';
    const ok = a === q.correct ? 1 : 0;
    correct += ok;
    return { q: Number(q.id), a, ok };
  });

  const percent = qs.length ? Math.round((correct / qs.length) * 1000) / 10 : 0;
  const score = Math.round((percent / 100) * Number(e.total_points) * 100) / 100;
  const end = Math.min(Number(finishedAt || Math.floor(Date.now()/1000)), Number(attempt.deadline_at));
  const duration = Math.max(0, Math.min(50 * 60, end - Number(attempt.started_at)));
  const fixedClass = e.linked_class_name || e.class_name || '';

  const r = await env.DB.prepare(`
    INSERT INTO submissions
      (exam_id,student_name,student_class,score,percent,duration_seconds)
    VALUES (?,?,?,?,?,?)
  `).bind(
    e.id,
    attempt.student_name,
    fixedClass,
    score,
    percent,
    duration
  ).run();

  const sid = r.meta.last_row_id;

  if (answerRows.length) {
    await env.DB.batch(
      answerRows.map(x =>
        env.DB.prepare(`
          INSERT INTO answers
            (submission_id,question_id,answer,is_correct)
          VALUES (?,?,?,?)
        `).bind(sid, x.q, x.a, x.ok)
      )
    );
  }

  await env.DB.prepare(`
    UPDATE exam_attempts
    SET status='submitted', submitted_at=?, submission_id=?
    WHERE id=?
  `).bind(Math.floor(Date.now()/1000), sid, attempt.id).run();

  return {
    score,
    percent,
    correct,
    duration,
    suspicious_events: Number(attempt.suspicious_events || 0)
  };
}

async function loadAttemptResult(env, attempt, questionCount) {
  const sub = attempt.submission_id
    ? await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(attempt.submission_id).first()
    : null;

  if (!sub) {
    return {
      score: 0,
      percent: 0,
      correct: 0,
      duration: 50 * 60,
      suspicious_events: Number(attempt.suspicious_events || 0)
    };
  }

  const c = await env.DB.prepare(`
    SELECT COALESCE(SUM(is_correct),0) AS correct
    FROM answers
    WHERE submission_id=?
  `).bind(sub.id).first();

  return {
    score: Number(sub.score || 0),
    percent: Number(sub.percent || 0),
    correct: Number(c.correct || 0),
    duration: Number(sub.duration_seconds || 0),
    suspicious_events: Number(attempt.suspicious_events || 0)
  };
}

function studentStartPage(e, error = '') {
  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  return `
    <main class="student">
      <div class="student-head modern">
        <div class="logo-box">EF</div>
        <div>
          <span class="eyebrow blue">EDUCAFÍSICA AVALIA</span>
          <h1>${esc(e.title)}</h1>
          <p>${context || (esc(e.grade) + ' · ' + esc(e.class_name || ''))}</p>
        </div>
      </div>

      ${error ? `<div class="alert">${esc(error)}</div>` : ''}

      <section class="card exam-rules-card">
        <div class="rules-icon">⏱️</div>
        <div>
          <span class="eyebrow blue">ANTES DE COMEÇAR</span>
          <h2>Você terá 50 minutos para realizar a prova.</h2>
          <p>O relógio começa quando você tocar em <b>Iniciar prova</b> e <b>não pausa</b>.</p>
          <div class="rule-list">
            <div><b>50:00</b><span>tempo total</span></div>
            <div><b>↩</b><span>se fechar, volta com o tempo restante</span></div>
            <div><b>✓</b><span>respostas são salvas automaticamente</span></div>
          </div>
          <div class="variant-student-info">
            🔀 <b>Versão individual:</b> a ordem das questões e das alternativas pode ser diferente da prova dos seus colegas.
          </div>
          <div class="warning-box">
            <b>Importante:</b> ao chegar a 00:00, a prova será enviada automaticamente com as respostas salvas até aquele momento.
            Não é permitido copiar, imprimir ou registrar a tela da avaliação.
          </div>
        </div>
      </section>

      <form method="post" class="card start-exam-form">
        <input type="hidden" name="action" value="start">
        <label>
          Nome completo
          <input name="student_name" autocomplete="name" required placeholder="Digite seu nome completo">
        </label>
        <label class="ack-row">
          <input type="checkbox" required>
          <span>Li as orientações e estou pronto para iniciar. Sei que o tempo não será pausado.</span>
        </label>
        <button class="big" type="submit">Iniciar prova · 50 minutos</button>
      </form>
    </main>
    <style>
      .exam-rules-card{display:grid;grid-template-columns:70px 1fr;gap:16px;align-items:start}
      .rules-icon{width:64px;height:64px;border-radius:18px;background:#eaf2ff;display:grid;place-items:center;font-size:30px}
      .exam-rules-card h2{margin:5px 0 8px}
      .rule-list{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:15px}
      .rule-list div{background:#f7f9fc;border:1px solid #e3e9f2;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:3px}
      .rule-list b{font-size:20px;color:#2367f2}.rule-list span{font-size:11px;color:#667386}
      .variant-student-info{margin-top:14px;padding:12px;border-radius:12px;background:#edf5ff;border:1px solid #cfe0fb;color:#1b559e;font-size:13px;line-height:1.5}
      .warning-box{margin-top:14px;padding:12px;border-radius:12px;background:#fff7e8;border:1px solid #f4d998;color:#6d551e;font-size:13px;line-height:1.5}
      .ack-row{display:flex!important;flex-direction:row!important;align-items:flex-start;gap:10px;margin:14px 0}.ack-row input{width:auto;margin-top:3px}
      @media(max-width:650px){.exam-rules-card{grid-template-columns:1fr}.rule-list{grid-template-columns:1fr}.rules-icon{width:52px;height:52px}}
    </style>
  `;
}

function studentForm(e, qs, attempt, savedMap = {}) {
  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  const student = esc(attempt.student_name);
  const watermarkText = `${student} · ${esc(e.linked_class_name || e.class_name || '')}`;

  return `
    <main class="student exam-secure" id="secureExam">
      <div class="exam-watermarks" aria-hidden="true">
        <span>${watermarkText}</span><span>${watermarkText}</span><span>${watermarkText}</span>
        <span>${watermarkText}</span><span>${watermarkText}</span><span>${watermarkText}</span>
      </div>

      <div class="timer-sticky" id="timerBar">
        <div>
          <small>Tempo restante</small>
          <b id="timer">50:00</b>
        </div>
        <span id="saveState">✓ Respostas salvas automaticamente</span>
      </div>

      <div class="student-head modern">
        <div class="logo-box">EF</div>
        <div>
          <span class="eyebrow blue">EDUCAFÍSICA AVALIA</span>
          <h1>${esc(e.title)}</h1>
          <p>${context || (esc(e.grade) + ' · ' + esc(e.class_name || ''))}</p>
        </div>
      </div>

      <div class="card student-id-card">
        <div class="fixed-class">
          <span>Aluno</span>
          <b>${student}</b>
          <small>O tempo continua contando mesmo se a página for fechada.</small>
        </div>
        <div class="fixed-class">
          <span>Turma da prova</span>
          <b>${esc(e.linked_class_name || e.class_name || '')}</b>
          <small>A turma é definida pelo professor.</small>
        </div>
      </div>

      <div class="individual-version-notice">🔀 Esta é uma versão individual da prova. Questões e alternativas podem estar em ordem diferente.</div>
      <div class="anti-copy-notice">🔒 Avaliação protegida: copiar, imprimir ou registrar a tela não é permitido. Seu nome aparece como marca d'água.</div>

      <form method="post" id="examForm">
        <input type="hidden" name="action" value="submit">

        ${qs.map(q => `
          <section class="card question-card">
            <div class="qnum">Questão ${q.position}</div>
            <h2>${esc(q.statement)}</h2>
            ${['A','B','C','D'].map(x => `
              <label class="answer">
                <input
                  type="radio"
                  name="q_${q.id}"
                  value="${x}"
                  data-qid="${q.id}"
                  ${savedMap[String(q.id)] === x ? 'checked' : ''}
                  required
                >
                <span><b>${x}</b> ${esc(q['option_' + x.toLowerCase()])}</span>
              </label>
            `).join('')}
          </section>
        `).join('')}

        <button class="big" id="submitBtn">Enviar prova</button>
      </form>

      <div class="focus-warning" id="focusWarning">
        <div>
          <b>Você saiu da tela da prova.</b>
          <p>O relógio continuou contando. Volte à avaliação.</p>
          <button type="button" id="closeFocusWarning">Continuar prova</button>
        </div>
      </div>
    </main>

    <style>
      .exam-secure{-webkit-user-select:none;user-select:none}
      .exam-secure input,.exam-secure button{user-select:auto}
      .timer-sticky{position:sticky;top:8px;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#10213d;color:#fff;border-radius:15px;padding:10px 14px;margin-bottom:12px;box-shadow:0 10px 28px rgba(16,33,61,.22)}
      .timer-sticky div{display:flex;flex-direction:column}.timer-sticky small{font-size:10px;opacity:.75}.timer-sticky b{font-size:27px;letter-spacing:1px}.timer-sticky>span{font-size:11px;opacity:.88;text-align:right}
      .timer-sticky.urgent{background:#a52c2c;animation:pulseTimer 1s infinite alternate}
      @keyframes pulseTimer{from{transform:scale(1)}to{transform:scale(1.008)}}
      .individual-version-notice{position:relative;z-index:2;margin:0 0 9px;padding:10px 12px;border-radius:11px;background:#edf5ff;border:1px solid #cfe0fb;color:#1b559e;font-size:12px;font-weight:750}
      .anti-copy-notice{position:relative;z-index:2;margin:0 0 14px;padding:10px 12px;border-radius:11px;background:#fff7e8;border:1px solid #f0d596;color:#6d551e;font-size:12px;font-weight:700}
      .question-card,.student-head,.student-id-card,#examForm,.timer-sticky{position:relative;z-index:2}
      .exam-watermarks{position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden;display:grid;grid-template-columns:repeat(2,1fr);align-content:space-around;justify-items:center;opacity:.075}
      .exam-watermarks span{font-size:19px;font-weight:900;transform:rotate(-28deg);white-space:nowrap;color:#10213d}
      .focus-warning{position:fixed;inset:0;background:rgba(10,20,36,.82);backdrop-filter:blur(8px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
      .focus-warning.show{display:flex}.focus-warning>div{max-width:420px;background:#fff;border-radius:20px;padding:25px;text-align:center}.focus-warning b{font-size:21px}.focus-warning p{color:#667386}
      @media print{body{display:none!important}}
      @media(max-width:650px){.timer-sticky>span{max-width:145px}.exam-watermarks{grid-template-columns:1fr}.exam-watermarks span:nth-child(even){display:none}}
    </style>

    <script>
      (() => {
        const deadline = ${Number(attempt.deadline_at)} * 1000;
        const timer = document.getElementById('timer');
        const timerBar = document.getElementById('timerBar');
        const form = document.getElementById('examForm');
        const submitBtn = document.getElementById('submitBtn');
        const saveState = document.getElementById('saveState');
        const focusWarning = document.getElementById('focusWarning');
        const closeFocusWarning = document.getElementById('closeFocusWarning');
        let submitting = false;
        let eventSentAt = 0;

        function fmt(ms) {
          const total = Math.max(0, Math.ceil(ms / 1000));
          const m = Math.floor(total / 60);
          const s = total % 60;
          return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
        }

        function updateTimer() {
          const left = deadline - Date.now();
          timer.textContent = fmt(left);
          if (left <= 5 * 60 * 1000) timerBar.classList.add('urgent');
          if (left <= 0 && !submitting) {
            submitting = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Tempo encerrado · enviando...';
            form.submit();
          }
        }

        async function postSmall(data) {
          try {
            return await fetch(location.href, {
              method: 'POST',
              body: new URLSearchParams(data),
              credentials: 'same-origin',
              keepalive: true,
              headers: {'Accept':'application/json'}
            });
          } catch (_) {
            return null;
          }
        }

        document.querySelectorAll('input[type="radio"][data-qid]').forEach(input => {
          input.addEventListener('change', async () => {
            saveState.textContent = 'Salvando...';
            const res = await postSmall({
              action: 'autosave',
              question_id: input.dataset.qid,
              answer: input.value
            });
            if (res && res.ok) {
              saveState.textContent = '✓ Resposta salva';
            } else {
              saveState.textContent = '⚠ Verifique sua conexão';
            }
          });
        });

        form.addEventListener('submit', () => {
          submitting = true;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Enviando prova...';
        });

        // Dificulta cópia/impressão. Em navegador comum, nenhum site consegue impedir screenshot do sistema operacional com 100% de garantia.
        ['copy','cut','contextmenu','dragstart'].forEach(type => {
          document.addEventListener(type, ev => ev.preventDefault());
        });

        document.addEventListener('keydown', ev => {
          const key = String(ev.key || '').toLowerCase();
          if ((ev.ctrlKey || ev.metaKey) && ['c','p','s','u'].includes(key)) {
            ev.preventDefault();
          }
          if (key === 'printscreen') {
            ev.preventDefault();
            navigator.clipboard?.writeText?.('');
          }
        });

        async function registerExit() {
          const now = Date.now();
          if (now - eventSentAt < 2500) return;
          eventSentAt = now;
          postSmall({action:'event', kind:'page_hidden'});
        }

        document.addEventListener('visibilitychange', () => {
          if (document.hidden && !submitting) {
            registerExit();
          } else if (!document.hidden && !submitting) {
            focusWarning.classList.add('show');
          }
        });

        window.addEventListener('blur', () => {
          if (!submitting) registerExit();
        });

        closeFocusWarning.addEventListener('click', () => focusWarning.classList.remove('show'));

        updateTimer();
        setInterval(updateTimer, 250);
      })();
    </script>
  `;
}

function studentResultPage(e, name, result, totalQuestions, expired = false) {
  const fixedClass = e.linked_class_name || e.class_name || '';
  const grade100 = Math.round(Number(result.percent || 0) * 10) / 10;
  const gradeText = Number.isInteger(grade100)
    ? String(grade100)
    : grade100.toFixed(1).replace('.', ',');

  let message = '';
  let messageIcon = '💙';

  if (grade100 === 100) {
    message = 'Excelente! Parabéns! Você alcançou 100 pontos. Continue brilhando!';
    messageIcon = '🏆';
  } else if (grade100 > 80) {
    message = 'Parabéns! Rumo ao topo!';
    messageIcon = '🚀';
  } else if (grade100 >= 60) {
    message = 'Muito bem! Continue avançando!';
    messageIcon = '👏';
  } else {
    message = 'Vamos melhorar, você consegue!';
    messageIcon = '💪';
  }

  const gradeClass = grade100 >= 60 ? 'grade-blue' : 'grade-red';
  const pointInfo = Number(e.total_points) === 100
    ? ''
    : `<p class="points-detail">Pontuação da prova: <b>${result.score}</b> de <b>${e.total_points}</b> pontos</p>`;

  return `
    <main class="student result-page">
      <section class="result-student-card">
        <div class="result-check">${expired ? '⏱️' : '✓'}</div>

        <span class="eyebrow blue">EDUCAFÍSICA AVALIA</span>
        <h1>${expired ? 'Tempo encerrado!' : 'Prova concluída!'}</h1>
        <p class="result-student-name">${esc(name)}</p>
        <p class="result-context">${esc(fixedClass)}${e.school_name ? ` · ${esc(e.school_name)}` : ''}</p>

        ${expired ? `
          <div class="result-time-alert">
            O limite de 50 minutos foi atingido. Foram consideradas as respostas salvas até o fim do tempo.
          </div>
        ` : ''}

        <div class="student-grade-box ${gradeClass}">
          <small>SUA NOTA</small>
          <div class="student-grade-number">${gradeText}</div>
          <span>de 100</span>
        </div>

        <div class="student-feedback ${gradeClass}">
          <span class="feedback-emoji">${messageIcon}</span>
          <b>${message}</b>
        </div>

        <div class="result-details-grid">
          <div>
            <small>Acertos</small>
            <b>${result.correct}/${totalQuestions}</b>
          </div>
          <div>
            <small>Aproveitamento</small>
            <b>${gradeText}%</b>
          </div>
          <div>
            <small>Tempo utilizado</small>
            <b>${formatDuration(result.duration)}</b>
          </div>
        </div>

        ${pointInfo}

        <p class="result-final-note">Sua avaliação foi registrada com sucesso.</p>
      </section>
    </main>
  `;
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const part = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : '';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function examResults(env, id) {
  await ensureExamAttemptTables(env);
  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      COALESCE(c.grade,e.grade) AS linked_grade,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(id).first();

  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);

  const subs = await env.DB.prepare(`
    SELECT
      su.*,
      COALESCE(ea.suspicious_events,0) AS suspicious_events,
      COALESCE(SUM(a.is_correct),0) AS correct_answers,
      COUNT(a.question_id) AS total_answers
    FROM submissions su
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
    LEFT JOIN answers a ON a.submission_id=su.id
    WHERE su.exam_id=?
    GROUP BY su.id
    ORDER BY su.student_name COLLATE NOCASE
  `).bind(id).all();

  const st = await env.DB.prepare(`
    SELECT
      COUNT(*) AS n,
      ROUND(AVG(percent),1) AS avg_score,
      ROUND(MAX(percent),1) AS max_score,
      ROUND(MIN(percent),1) AS min_score
    FROM submissions
    WHERE exam_id=?
  `).bind(id).first();

  const qs = await env.DB.prepare(`
    SELECT
      q.id,
      q.statement,
      q.topic,
      eq.position,
      COUNT(a.submission_id) AS total,
      COALESCE(SUM(a.is_correct),0) AS correct,
      CASE
        WHEN COUNT(a.submission_id)=0 THEN 0
        ELSE ROUND(100.0*SUM(a.is_correct)/COUNT(a.submission_id),1)
      END AS pct
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    LEFT JOIN answers a
      ON a.question_id=q.id
      AND a.submission_id IN (
        SELECT id FROM submissions WHERE exam_id=?
      )
    WHERE eq.exam_id=?
    GROUP BY q.id,q.statement,q.topic,eq.position
    ORDER BY eq.position
  `).bind(id, id).all();

  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  const rows = subs.results.map((s, index) => {
    const note = Number(s.percent || 0);
    const noteText = Number.isInteger(note) ? String(note) : note.toFixed(1).replace('.', ',');
    const noteClass = note >= 60 ? 'table-note-blue' : 'table-note-red';
    return `
      <tr>
        <td>
          <div class="result-student-cell">
            <span class="student-number">${index + 1}</span>
            <b>${esc(s.student_name)}</b>
          </div>
        </td>
        <td><span class="class-table-chip">${esc(e.linked_class_name || e.class_name || s.student_class || '')}</span></td>
        <td><span class="table-note ${noteClass}">${noteText}<small>/100</small></span></td>
        <td><b>${Number(s.correct_answers || 0)}</b> de <b>${Number(s.total_answers || 0)}</b></td>
        <td>${formatDuration(s.duration_seconds)}</td>
        <td>${Number(s.suspicious_events || 0)}</td>
      </tr>`;
  }).join('');

  const bars = qs.results.map(q => {
    const pct = Math.max(0, Math.min(100, Number(q.pct || 0)));
    const level = pct >= 70 ? 'good' : pct >= 50 ? 'mid' : 'low';
    return `
      <div class="bar-row performance-card">
        <div class="bar-label">
          <span><b>Q${q.position}</b> · ${esc(q.topic)}</span>
          <b class="pct-badge ${level}">${q.pct}%</b>
        </div>
        <div class="bar ${level}"><i style="width:${pct}%"></i></div>
        <small>${esc(q.statement)}</small>
      </div>
    `;
  }).join('');

  return page(
    'Resultados',
    nav() + `
      <main>
        <section class="results-header">
          <div>
            <span class="eyebrow blue">RESULTADOS DA TURMA</span>
            <h1>${esc(e.title)}</h1>
            <p>${context}</p>
          </div>
          <a class="btn secondary" href="/provas/${id}">← Voltar à prova</a>
        </section>

        <div class="cards dashboard-stats">
          <div class="card stat stat-blue"><span class="stat-icon">👥</span><b>${st.n || 0}</b><span>Alunos</span></div>
          <div class="card stat stat-purple"><span class="stat-icon">📊</span><b>${st.avg_score ?? '—'}</b><span>Média da turma /100</span></div>
          <div class="card stat stat-green"><span class="stat-icon">🏆</span><b>${st.max_score ?? '—'}</b><span>Maior nota /100</span></div>
          <div class="card stat stat-orange"><span class="stat-icon">📍</span><b>${st.min_score ?? '—'}</b><span>Menor nota /100</span></div>
        </div>

        <div class="card">
          <div class="card-heading-row">
            <div>
              <span class="eyebrow blue">DIAGNÓSTICO</span>
              <h2>Desempenho por questão</h2>
            </div>
            <span class="legend"><i class="legend-good"></i> ≥70% <i class="legend-mid"></i> 50–69% <i class="legend-low"></i> &lt;50%</span>
          </div>
          ${bars || '<p>Ainda não há respostas.</p>'}
        </div>

        <div class="card">
          <div class="card-heading-row">
            <div>
              <span class="eyebrow blue">ALUNOS</span>
              <h2>Notas da turma ${esc(e.linked_class_name || e.class_name || '')}</h2>
            </div>
            <a class="btn small secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a>
          </div>

          <div class="table">
            <table>
              <thead>
                <tr><th>Aluno</th><th>Turma</th><th>Nota /100</th><th>Acertos</th><th>Tempo</th><th>Saídas da tela</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="6">Ainda não há respostas.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </main>
    `
  );
}

async function resultsCsv(env, id) {
  const subs = await env.DB.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY student_name').bind(id).all();
  const lines = ['Nome;Turma;Nota;Percentual;Tempo (s);Enviado em'];
  for (const s of subs.results) lines.push([s.student_name, s.student_class, String(s.score).replace('.', ','), String(s.percent).replace('.', ',') + '%', s.duration_seconds || '', s.submitted_at].map(csvSafe).join(';'));
  return new Response('\ufeff' + lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="resultados_prova_${id}.csv"` } });
}

function nav() {
  return `<header class="topbar">
    <a class="brand" href="/"><span class="brand-mark">EF</span><span><b>EducaFísica</b><small>Avalia</small></span></a>
    <nav class="navlinks">
      <a href="/">⌂ <span>Painel</span></a>
      <a href="/provas/nova">＋ <span>Nova prova</span></a>
      <a href="/banco">▤ <span>Questões</span></a>
      <a href="/resultados">▥ <span>Resultados</span></a>
      <a class="logout-link" href="/logout">Sair</a>
    </nav>
  </header>`;
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · EducaFísica Avalia</title>${css()}</head><body>${body}</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } });
}

function css() {
  return `<style>
    :root{
      --primary:#2367f2;--primary2:#4a8cff;--navy:#13233d;--navy2:#1d365a;
      --green:#20ae68;--purple:#7459df;--orange:#ee9238;--red:#de5858;
      --ink:#172033;--muted:#6f7b91;--bg:#f3f6fb;--line:#e2e8f1;--white:#fff;
      --shadow:0 12px 34px rgba(24,48,82,.08);--shadow2:0 18px 50px rgba(24,48,82,.14)
    }
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
    a{text-decoration:none;color:var(--primary)}small{color:var(--muted)}
    .topbar{position:sticky;top:0;z-index:60;height:72px;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 max(18px,calc((100vw - 1160px)/2));box-shadow:0 3px 15px rgba(23,32,51,.04)}
    .brand{display:flex;align-items:center;gap:10px;color:var(--ink)}.brand-mark{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),#5d9cff);color:white;font-weight:900;box-shadow:0 8px 18px rgba(35,103,242,.2)}
    .brand>span:last-child{display:flex;flex-direction:column;line-height:1.05}.brand b{font-size:15px}.brand small{font-size:11px;color:var(--primary);font-weight:800;letter-spacing:.5px}
    .navlinks{display:flex;gap:5px;align-items:center}.navlinks a{color:#556176;font-weight:750;font-size:13px;padding:10px 11px;border-radius:10px;display:flex;gap:6px;align-items:center}.navlinks a:hover{background:#eef4ff;color:var(--primary)}.navlinks .logout-link{color:#a64c4c}
    main{max-width:1160px;margin:26px auto 50px;padding:0 18px}
    .welcome-panel,.results-header,.hero{display:flex;justify-content:space-between;gap:22px;align-items:center;margin-bottom:18px}.hero{background:white;border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:var(--shadow)}.hero h1,.results-header h1{margin:4px 0 6px;font-size:clamp(26px,4vw,38px);letter-spacing:-1px}.hero p,.results-header p{margin:0;color:var(--muted)}
    .v7-welcome{position:relative;overflow:hidden;min-height:250px;border-radius:28px;padding:32px;background:linear-gradient(125deg,#1856d9 0%,#2367f2 47%,#1aa96a 140%);color:white;box-shadow:0 20px 50px rgba(35,103,242,.22)}.v7-welcome:before{content:"";position:absolute;width:340px;height:340px;border-radius:50%;background:rgba(255,255,255,.08);right:-100px;top:-150px}.v7-welcome:after{content:"";position:absolute;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.06);right:130px;bottom:-110px}.welcome-copy{position:relative;z-index:2;max-width:660px}.v7-welcome h1{font-size:clamp(31px,5vw,48px);letter-spacing:-1.5px;margin:8px 0}.v7-welcome p{font-size:16px;color:rgba(255,255,255,.84);line-height:1.5}.welcome-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.welcome-mark{position:relative;z-index:2;width:132px;height:132px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);backdrop-filter:blur(7px);border-radius:34px;display:grid;place-items:center;font-size:48px;font-weight:900}.welcome-mark span{position:absolute;right:14px;bottom:10px;width:36px;height:36px;border-radius:50%;background:white;color:var(--green);display:grid;place-items:center;font-size:19px}
    .eyebrow{display:inline-block;font-size:10px;letter-spacing:1.3px;font-weight:900;color:var(--muted)}.eyebrow.blue{color:var(--primary)}.eyebrow.white{color:rgba(255,255,255,.78)}
    .btn,button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;padding:12px 17px;font-weight:850;font-size:14px;cursor:pointer;box-shadow:0 7px 18px rgba(35,103,242,.18)}.btn:hover,button:hover{filter:brightness(.98)}.btn.light{background:white;color:var(--primary);box-shadow:none}.btn.glass{background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);box-shadow:none}.secondary{background:white!important;color:var(--ink)!important;border:1px solid var(--line)!important;box-shadow:none!important}.small{padding:8px 11px;font-size:12px}.big{width:100%;font-size:16px;padding:15px}
    .quick-actions{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0 18px}.quick-card{background:white;border:1px solid var(--line);border-radius:17px;padding:15px;display:flex;align-items:center;gap:11px;color:var(--ink);box-shadow:0 6px 18px rgba(24,48,82,.05);transition:.15s}.quick-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.quick-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex:none}.quick-icon.blue{background:#e9f1ff;color:var(--primary)}.quick-icon.purple{background:#f0ecff;color:var(--purple)}.quick-icon.green{background:#e7f8ef;color:var(--green)}.quick-icon.orange{background:#fff2e6;color:var(--orange)}.quick-icon.red{background:#ffeded;color:var(--red)}.danger-card{border-color:#ffd7d7}.danger-card:hover{border-color:#f1a8a8}.quick-card>div{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.quick-card b{font-size:14px}.quick-card small{font-size:11px}.quick-card i{font-style:normal;font-size:22px;color:#a2aec0}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:19px;margin-bottom:15px;box-shadow:0 7px 22px rgba(24,48,82,.055)}.stat{position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:126px;justify-content:flex-end}.stat:after{content:"";position:absolute;width:95px;height:95px;border-radius:50%;right:-30px;top:-35px;opacity:.07;background:currentColor}.stat b{font-size:31px;line-height:1;margin-top:10px}.stat>span:last-child{color:var(--muted);font-size:12px;margin-top:4px}.stat-icon{font-size:20px}.stat-blue{color:var(--primary)}.stat-purple{color:var(--purple)}.stat-green{color:var(--green)}.stat-orange{color:var(--orange)}
    .section-heading{margin:28px 2px 14px}.section-heading.split{display:flex;justify-content:space-between;gap:14px;align-items:end}.section-heading h2{margin:4px 0;font-size:25px}.section-heading p{margin:0;color:var(--muted);font-size:13px}.search-box{min-width:300px;background:white;border:1px solid var(--line);border-radius:12px;display:flex;align-items:center;gap:7px;padding:0 11px}.search-box span{font-size:20px;color:#8996aa}.search-box input{border:0;box-shadow:none;padding:11px 4px}
    .school-list{display:grid;gap:14px}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}.school-group,.school-result-group{background:white;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}.school-group>summary,.school-result-group>summary{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px;cursor:pointer;background:linear-gradient(135deg,#fff,#f8fbff)}.school-summary-main{display:flex;align-items:center;gap:13px;min-width:0}.school-icon{width:50px;height:50px;border-radius:14px;background:#eaf2ff;display:grid;place-items:center;font-size:23px;flex:none}.school-icon.v7{position:relative}.school-icon.v7 small{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;background:var(--navy);color:white;display:grid;place-items:center;font-size:8px}.school-group h2,.school-result-group h2{margin:3px 0 4px;font-size:17px}.school-group p,.school-result-group p{margin:0;color:var(--muted);font-size:12px}.summary-chevron{font-size:26px;color:#8ba0bc;transition:.2s}details[open]>summary .summary-chevron{transform:rotate(90deg)}.school-content{padding:0 17px 17px}.shift-block,.result-shift{border-top:1px solid var(--line);padding-top:15px;margin-top:2px}.shift-title{display:flex;align-items:center;gap:9px;margin-bottom:10px}.shift-title h3{margin:1px 0 0;font-size:14px}.shift-icon{width:34px;height:34px;border-radius:10px;background:#f2f6fc;display:grid;place-items:center}
    .class-group{border:1px solid var(--line);border-radius:14px;margin:9px 0;background:#fbfcfe;overflow:hidden}.class-group>summary{cursor:pointer;padding:12px 13px;display:flex;align-items:center;gap:10px}.class-group>summary>span:nth-child(2){display:flex;flex-direction:column;gap:2px;flex:1}.class-avatar{min-width:38px;height:38px;padding:0 7px;border-radius:10px;background:#e9f1ff;color:var(--primary);display:grid;place-items:center;font-weight:900;font-size:12px}.exam-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 12px 12px}.exam-card{display:block;border:1px solid var(--line);border-radius:13px;padding:14px;background:white;color:var(--ink);transition:.15s}.exam-card:hover{transform:translateY(-1px);border-color:#bfd2f8;box-shadow:0 9px 20px rgba(35,103,242,.08)}.exam-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.exam-card h4{margin:6px 0 10px;font-size:15px;line-height:1.35}.mini-chip{display:inline-flex;background:#edf4ff;color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.6px;padding:4px 6px;border-radius:6px}.status-pill{white-space:nowrap;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850}.status-pill.open{background:#e8f8ef;color:#16814a}.status-pill.closed{background:#eef1f5;color:#667386}.exam-metrics{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:11px}.exam-metrics b{color:var(--ink)}.card-arrow{border-top:1px solid var(--line);margin-top:11px;padding-top:9px;color:var(--primary);font-size:11px;font-weight:800}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.span{grid-column:1/-1}label{display:flex;flex-direction:column;gap:7px;font-weight:750;font-size:13px}input,select,textarea{width:100%;padding:12px;border:1px solid #cfd8e6;border-radius:11px;font:inherit;background:white;outline:none}input:focus,select:focus,textarea:focus{border-color:#7aa9ff;box-shadow:0 0 0 3px rgba(35,103,242,.1)}textarea{min-height:95px}.question-list{display:grid;gap:9px}.pick,.answer{display:flex;flex-direction:row;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:12px;font-weight:500;background:#fff}.pick input,.answer input{width:auto;margin-top:4px;margin-right:10px}.answer:hover{border-color:#a9c7ff;background:#f8fbff}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions form{margin:0}.mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode-card{display:flex;flex-direction:row;align-items:flex-start;gap:10px;border:1px solid var(--line);border-radius:13px;padding:14px;cursor:pointer;background:#fff}.mode-card input{width:auto;margin-top:4px}.info-box,.filter-note{margin-top:12px;padding:12px;border-radius:11px;background:#f0f6ff;color:#41516b}
    .table{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:11px;border-bottom:1px solid var(--line);text-align:left}th{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.45px;background:#f8faff}tbody tr:hover{background:#f8fbff}
    .login{width:min(440px,calc(100% - 30px));margin:70px auto;background:white;padding:31px;border-radius:24px;box-shadow:var(--shadow2);text-align:center}.login:before{content:"EF";display:grid;place-items:center;margin:0 auto 15px;width:58px;height:58px;border-radius:17px;background:linear-gradient(135deg,var(--primary),var(--green));color:white;font-size:20px;font-weight:900}.login form{display:grid;gap:12px;text-align:left;margin-top:20px}.alert{background:#fff0f0;color:#a42b2b;padding:11px;border-radius:10px;margin:12px 0}.success{width:64px;height:64px;border-radius:50%;background:#e6f8ee;color:var(--green);display:grid;place-items:center;margin:auto;font-size:35px;font-weight:900}.grade{margin:18px 0;background:#f6f8fb;border-radius:15px;padding:19px;display:flex;flex-direction:column}.grade b{font-size:54px}
    .reset-page{max-width:720px}.reset-card{background:white;border:1px solid var(--line);border-radius:26px;padding:30px;box-shadow:var(--shadow2);text-align:center}.reset-icon{width:68px;height:68px;border-radius:20px;background:#ffeded;color:var(--red);display:grid;place-items:center;margin:0 auto 14px;font-size:34px;font-weight:900}.red-text{color:var(--red)}.reset-card h1{margin:8px 0 7px;font-size:clamp(28px,6vw,40px)}.reset-lead{max-width:560px;margin:0 auto 20px;color:var(--muted);line-height:1.55}.reset-summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.reset-summary>div{background:#f7f9fc;border:1px solid var(--line);border-radius:15px;padding:15px;display:flex;flex-direction:column;gap:6px}.reset-summary small{color:var(--muted);font-size:11px;text-transform:uppercase}.reset-summary b{font-size:30px}.reset-warning,.reset-safe{text-align:left;border-radius:15px;padding:14px 16px;margin:12px 0}.reset-warning{background:#fff0f0;border:1px solid #ffd2d2;color:#8d2d2d}.reset-safe{background:#edf8f2;border:1px solid #ccebd9;color:#176f47}.reset-warning p,.reset-safe p{margin:5px 0 0;line-height:1.45}.reset-form{display:grid;gap:12px;margin-top:20px;text-align:left}.reset-form label{display:grid;gap:7px}.danger-button{background:linear-gradient(135deg,#d94747,#b92d2d)!important;box-shadow:0 7px 18px rgba(185,45,45,.2)!important}.reset-success{background:#fff7e8;border:1px solid #f2d796;color:#795a12;border-radius:13px;padding:12px;margin:14px 0}.success-reset p{line-height:1.55}
    .result-page{max-width:680px}.result-student-card{background:white;border:1px solid var(--line);border-radius:28px;padding:30px;text-align:center;box-shadow:var(--shadow2);overflow:hidden}.result-check{width:70px;height:70px;border-radius:22px;background:linear-gradient(135deg,#eaf2ff,#e8f8ef);color:var(--primary);display:grid;place-items:center;margin:0 auto 14px;font-size:36px;font-weight:900}.result-student-card h1{margin:7px 0 5px;font-size:clamp(28px,6vw,42px);letter-spacing:-1px}.result-student-name{font-size:18px;font-weight:850;margin:8px 0 3px}.result-context{color:var(--muted);margin:0 0 18px;font-size:13px}.result-time-alert{background:#fff7e8;color:#6d551e;border:1px solid #f4dfad;border-radius:13px;padding:12px;margin:14px 0;text-align:left}.student-grade-box{border-radius:24px;padding:22px 18px;margin:19px auto 13px;display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:330px;border:2px solid currentColor}.student-grade-box small{font-size:11px;font-weight:900;letter-spacing:1.6px;color:inherit}.student-grade-number{font-size:clamp(68px,18vw,98px);font-weight:950;line-height:.95;letter-spacing:-4px;margin:8px 0 3px}.student-grade-box>span{font-weight:800;font-size:14px;opacity:.8}.grade-blue{color:#1764d8}.student-grade-box.grade-blue{background:#edf5ff}.grade-red{color:#c93636}.student-grade-box.grade-red{background:#fff0f0}.student-feedback{max-width:440px;margin:0 auto 20px;border-radius:15px;padding:14px 16px;display:flex;align-items:center;justify-content:center;gap:9px;font-size:17px}.student-feedback.grade-blue{background:#eaf3ff}.student-feedback.grade-red{background:#ffeded}.feedback-emoji{font-size:25px}.result-details-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}.result-details-grid>div{background:#f7f9fc;border:1px solid var(--line);border-radius:14px;padding:13px 8px;display:flex;flex-direction:column;gap:5px}.result-details-grid small{font-size:10px;text-transform:uppercase;letter-spacing:.5px}.result-details-grid b{font-size:18px}.points-detail{color:var(--muted);font-size:13px;margin:15px 0 0}.result-final-note{margin:18px 0 0;color:var(--green);font-weight:800}

    .student{max-width:780px}.student-head{display:flex;gap:12px;align-items:center}.student-head.modern{background:white;border:1px solid var(--line);border-radius:20px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}.student-head h1{margin:3px 0 4px}.student-head p{margin:0;color:var(--muted)}.logo-box{min-width:54px;width:54px;height:54px;border-radius:15px;background:linear-gradient(135deg,var(--primary),var(--green));display:grid;place-items:center;color:white;font-weight:900;box-shadow:0 8px 18px rgba(35,103,242,.2)}.student-id-card{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:end}.fixed-class{background:#f5f8fd;border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:3px}.fixed-class span,.fixed-class small{font-size:11px;color:var(--muted)}.fixed-class b{font-size:22px;color:var(--primary)}.question-card h2{font-size:18px;line-height:1.45}.qnum{font-size:10px;color:var(--primary);font-weight:900;text-transform:uppercase;letter-spacing:.7px}
    .results-header{background:white;border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:var(--shadow)}.v7-results-hero{background:linear-gradient(125deg,var(--navy),#235081);color:white}.v7-results-hero p{color:rgba(255,255,255,.76)}.bar-row{margin:18px 0}.bar-label{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px}.bar{height:11px;background:#edf1f6;border-radius:12px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--green))}.bar.good i{background:linear-gradient(90deg,#22a965,#53cc89)}.bar.mid i{background:linear-gradient(90deg,#e6a22d,#f2c760)}.bar.low i{background:linear-gradient(90deg,#df5a5a,#ee8585)}.pct-badge{padding:4px 8px;border-radius:999px;font-size:11px}.pct-badge.good{background:#e8f8ef;color:#16814a}.pct-badge.mid{background:#fff5dc;color:#9b6812}.pct-badge.low{background:#ffeded;color:#a23a3a}.performance-card{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fbfcfe}.performance-card small{display:block;margin-top:8px;line-height:1.4}.student-number{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#edf4ff;color:var(--primary);font-size:11px;font-weight:800;margin-right:5px}.card-heading-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.card-heading-row h2{margin:3px 0}.legend{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);flex-wrap:wrap}.legend i{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:5px}.legend-good{background:#34b874}.legend-mid{background:#e5aa37}.legend-low{background:#df6262}
    .school-result-group>summary{padding:19px}.school-average{display:flex;align-items:center;gap:12px}.school-average small,.class-average small{font-size:10px}.school-average b{font-size:23px;color:var(--primary)}.result-class-card{border:1px solid var(--line);border-radius:15px;overflow:hidden;background:#fbfcfe;margin:10px 0}.result-class-head{padding:12px;display:flex;justify-content:space-between;align-items:center}.result-class-head>div:first-child{display:flex;align-items:center;gap:9px}.result-class-head>div:first-child>div{display:flex;flex-direction:column}.class-average{text-align:right}.class-average b{display:block;color:var(--primary);font-size:19px}.result-exam-row{border-top:1px solid var(--line);padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--ink);background:white}.result-exam-row:hover{background:#f7faff}.result-exam-row>div:first-child{display:flex;flex-direction:column;gap:4px}.result-exam-row>div:first-child b{font-size:13px}.result-exam-row>div:first-child small{font-size:10px}.result-numbers{display:flex;align-items:center;gap:15px}.result-numbers span{display:flex;flex-direction:column;text-align:right}.result-numbers span b{font-size:14px}.result-numbers span small{font-size:9px}.result-numbers i{font-style:normal;font-size:22px;color:#93a3b8}
    .empty-state{text-align:center;padding:35px}.empty-icon{font-size:40px}
    .student-grades-panel{margin:0 0 28px;padding:0;overflow:hidden}.student-grades-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 20px 14px}.student-grades-head h2{margin:4px 0 3px;font-size:25px}.student-grades-head p{margin:0;color:var(--muted);font-size:13px}.student-grade-search{display:flex;align-items:center;gap:8px;min-width:300px;background:#f7f9fc;border:1px solid var(--line);border-radius:12px;padding:0 10px}.student-grade-search input{border:0;background:transparent;box-shadow:none;padding:11px 4px}.student-grade-legend{display:flex;align-items:center;gap:15px;padding:10px 20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fbfcfe;font-size:11px;color:var(--muted)}.student-grade-legend span{display:flex;align-items:center;gap:5px}.student-grade-legend a{margin-left:auto;font-weight:800}.legend-note-blue,.legend-note-red{display:inline-block;width:9px;height:9px;border-radius:50%}.legend-note-blue{background:#2367f2}.legend-note-red{background:#d84848}.student-grade-list{max-height:520px;overflow:auto}.student-grade-row{display:grid;grid-template-columns:48px 1fr 82px;gap:12px;align-items:center;padding:13px 20px;border-bottom:1px solid var(--line);color:var(--ink);transition:.15s}.student-grade-row:hover{background:#f7faff}.student-grade-avatar{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#edf4ff;color:var(--primary);font-size:12px;font-weight:900}.student-grade-info{min-width:0;display:flex;flex-direction:column;gap:2px}.student-grade-info>b{font-size:15px}.student-grade-info small{font-size:11px;color:#68758c}.student-grade-info small strong{color:var(--ink)}.student-grade-info em{font-style:normal;font-size:11px;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.student-note{height:58px;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.student-note small{font-size:8px;font-weight:900;letter-spacing:1px;color:inherit}.student-note b{font-size:25px;margin:3px 0}.student-note i{font-style:normal;font-size:9px;font-weight:800;opacity:.75}.student-note-blue{background:#eaf3ff;color:#1764d8}.student-note-red{background:#ffeded;color:#c93636}.student-grade-empty{padding:34px 20px;text-align:center;display:flex;flex-direction:column;gap:5px}.student-grade-empty>span{font-size:34px}.result-student-cell{display:flex;align-items:center;gap:7px;white-space:nowrap}.class-table-chip{display:inline-flex;padding:6px 9px;border-radius:999px;background:#f1f4f8;color:#42516a;font-weight:850;font-size:12px}.table-note{display:inline-flex;align-items:baseline;gap:2px;min-width:72px;justify-content:center;border-radius:10px;padding:7px 9px;font-size:18px;font-weight:950}.table-note small{font-size:9px;color:inherit}.table-note-blue{background:#eaf3ff;color:#1764d8}.table-note-red{background:#ffeded;color:#c93636}
    .dashboard-means{display:grid;grid-template-columns:.8fr 1.2fr;gap:16px;margin:18px 0 28px}.mean-panel{margin:0}.mean-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.mean-panel-head h2{margin:3px 0}.mean-scale{font-size:11px;font-weight:900;color:var(--muted);background:#f1f4f8;border-radius:999px;padding:6px 9px}.mean-list{display:grid;gap:8px}.mean-scroll{max-height:330px;overflow:auto;padding-right:4px}.mean-row{display:flex;justify-content:space-between;gap:13px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fbfcfe}.mean-row strong{font-size:23px;min-width:52px;text-align:right}.mean-label{display:flex;flex-direction:column;gap:2px}.mean-label small{font-size:10px;color:var(--muted)}.mean-good strong{color:#1764d8}.mean-low strong{color:#c93636}.muted{color:var(--muted)}.result-shift-title{display:flex;align-items:center}.shift-average{margin-left:auto;text-align:right;display:flex;flex-direction:column}.shift-average small{font-size:9px;color:var(--muted)}.shift-average b{font-size:21px;color:var(--primary)}.cleanup-bank-card{border-color:#ffd3d3;background:linear-gradient(135deg,#fff,#fff8f8)}.cleanup-bank-main{display:flex;justify-content:space-between;gap:18px;align-items:center}.cleanup-bank-main h2{margin:4px 0 7px}.danger-link{background:#c93636!important;color:white!important}.share-exam-card{display:grid;grid-template-columns:1fr 250px;gap:24px;align-items:center}.share-exam-copy h2{margin:4px 0 13px}.short-link-box{display:grid;grid-template-columns:1fr auto;gap:8px}.short-link-box button{white-space:nowrap}.qr-box{background:#f8fbff;border:1px solid var(--line);border-radius:18px;padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px}.qr-box img{max-width:100%;height:auto;border-radius:10px;background:white}.qr-box small{font-size:10px;color:var(--muted);line-height:1.35}
    .count-picker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 14px}.count-picker>span{font-size:12px;font-weight:850;color:var(--muted);margin-right:3px}.count-chip{width:auto!important;min-width:42px!important;padding:9px 12px!important;border-radius:999px!important;background:#f4f7fb!important;color:#40506a!important;border:1px solid var(--line)!important;box-shadow:none!important;font-size:13px!important}.count-chip.active,.count-chip:hover{background:#eaf2ff!important;color:var(--primary)!important;border-color:#a9c7f7!important;transform:none!important}
    @media(max-width:900px){.dashboard-means{grid-template-columns:1fr}.share-exam-card{grid-template-columns:1fr}.qr-box{max-width:300px}.quick-actions{grid-template-columns:1fr 1fr}.navlinks a span{display:none}.navlinks a{font-size:18px;padding:9px}.navlinks .logout-link{font-size:12px}.welcome-mark{width:105px;height:105px}.exam-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.student-grades-head{flex-direction:column;align-items:stretch}.student-grade-search{min-width:0;width:100%}.student-grade-row{grid-template-columns:40px 1fr 70px;padding:12px 13px}.student-grade-avatar{width:36px;height:36px}.student-note{height:54px}.student-note b{font-size:22px}.student-grade-legend{flex-wrap:wrap;padding:9px 13px}.student-grade-legend a{width:100%;margin-left:0}.cleanup-bank-main{flex-direction:column;align-items:flex-start}.short-link-box{grid-template-columns:1fr}.topbar{height:64px;padding:0 13px}.brand-mark{width:36px;height:36px}.navlinks{gap:0}.navlinks a{padding:8px}.navlinks .logout-link{display:none}main{padding:0 12px;margin-top:16px}.hero,.results-header,.welcome-panel{align-items:flex-start;flex-direction:column}.v7-welcome{padding:25px;min-height:auto}.welcome-mark{display:none}.quick-actions{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.span{grid-column:auto}.section-heading.split{align-items:flex-start;flex-direction:column}.search-box{min-width:0;width:100%}.student-id-card{grid-template-columns:1fr}.card-heading-row{align-items:flex-start;flex-direction:column}.school-average{gap:7px}.school-average b{font-size:18px}.result-exam-row{align-items:flex-start}.result-numbers{gap:9px}.mode-grid{grid-template-columns:1fr}}
    @media(max-width:440px){.reset-card{padding:22px 15px}.reset-summary{grid-template-columns:1fr}.result-student-card{padding:22px 15px}.result-details-grid{grid-template-columns:1fr}.student-grade-number{letter-spacing:-2px}.brand>span:last-child{display:none}.quick-actions{grid-template-columns:1fr}.quick-card{padding:13px}.v7-welcome h1{font-size:31px}.v7-welcome p{font-size:14px}.cards{grid-template-columns:1fr 1fr}.dashboard-stats .stat{min-height:116px;padding:14px}.dashboard-stats .stat b{font-size:27px}.school-group>summary,.school-result-group>summary{padding:13px}.school-icon{width:43px;height:43px}.school-content{padding:0 11px 11px}.result-numbers span:first-child{display:none}.exam-grid{padding:0 9px 9px}}
  </style>`;
}

function shortExamToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

async function uniqueExamToken(env) {
  for (let i = 0; i < 12; i++) {
    const token = shortExamToken();
    const exists = await env.DB.prepare('SELECT id FROM exams WHERE token=? LIMIT 1').bind(token).first();
    if (!exists) return token;
  }
  return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
}
function formatDuration(s) { s = Number(s || 0); const m = Math.floor(s / 60), sec = s % 60; return s ? `${m}m ${sec}s` : '—'; }
function csvSafe(v) { return String(v ?? '').replaceAll(';', ',').replaceAll('\n', ' '); }
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(v) { return esc(v).replaceAll('"', '&quot;'); }
