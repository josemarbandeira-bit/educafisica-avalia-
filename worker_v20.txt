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

      let m = path.match(/^\/imagem\/q\/(\d+)$/);
      if (m) return questionImageResponse(env, Number(m[1]));

      if (!(await isTeacher(request, env))) return redirect('/login');

      if (path === '/') return dashboard(env, url.searchParams.get('msg') || '');
      if (path === '/banco') return method === 'POST' ? addQuestion(request, env) : bank(env);
      if (path === '/banco/importar' && method === 'POST') return importQuestions(request, env);
      if (path === '/banco/limpar-repetitivas') return method === 'POST'
        ? cleanupRepetitiveQuestions(request, env)
        : cleanupRepetitiveQuestionsPage(env);

      m = path.match(/^\/banco\/imagem\/(\d+)$/);
      if (m) return method === 'POST'
        ? saveQuestionImage(request, env, Number(m[1]))
        : questionImageEditor(env, Number(m[1]));
      if (path === '/api/questoes') return manualQuestionsApi(url, env);
      if (path === '/provas/lote') return examBatchPage(url, env, request.url);
      if (path === '/provas/nova') return method === 'POST' ? createExam(request, env) : newExam(env);
      if (path === '/provas/zerar') return method === 'POST' ? resetCreatedExams(request, env) : resetCreatedExamsPage(env);
      if (path === '/resultados') return globalResults(env);
      if (path === '/caderno') return gradebookRco(env);

      m = path.match(/^\/provas\/(\d+)$/);
      if (m) return examDetail(env, Number(m[1]), url.origin);

      m = path.match(/^\/provas\/(\d+)\/toggle$/);
      if (m && method === 'POST') return toggleExam(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/excluir$/);
      if (m && method === 'POST') return deleteExam(env, Number(m[1]));

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

async function dashboard(env, message = '') {
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
      COALESCE(ec.trimester,0) AS trimester
    FROM exams e
    LEFT JOIN submissions su ON su.exam_id=e.id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY e.id
    ORDER BY sc.name, cl.shift, linked_class_name, ec.trimester, e.id DESC
  `).all();

  const q = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM questions WHERE active=1'
  ).first();

  const s = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submissions'
  ).first();

  const avg = await env.DB.prepare(
    'SELECT ROUND(AVG(percent),1) AS a FROM submissions'
  ).first();

  const openExams = exams.results.filter(e => Number(e.active) === 1).length;

  const schoolStats = await env.DB.prepare(`
    SELECT
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_percent
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    GROUP BY COALESCE(sc.name,'Sem escola definida')
    ORDER BY school_name
  `).all();

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

  const recentGrades = await env.DB.prepare(`
    SELECT
      su.id,
      su.student_name,
      su.percent,
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
    LIMIT 120
  `).all();

  const meanCard = (label, detail, value, icon) => {
    const numeric = value == null ? null : Number(value);
    const text = numeric == null
      ? '—'
      : numeric.toFixed(1).replace('.0','').replace('.', ',');
    const noteClass = numeric == null
      ? ''
      : numeric >= 60 ? 'dash-note-good' : 'dash-note-low';

    return `
      <div class="dash-mean-card ${noteClass}">
        <span class="dash-mean-icon">${icon}</span>
        <span class="dash-mean-copy">
          <b>${esc(label)}</b>
          <small>${esc(detail)}</small>
        </span>
        <strong>${text}</strong>
      </div>`;
  };

  const schoolAverageCards = schoolStats.results.map(r =>
    meanCard(
      r.school_name,
      `${r.submissions} resposta(s) · média /100`,
      r.avg_percent,
      '🏫'
    )
  ).join('');

  const shiftAverageCards = shiftStats.results.map(r =>
    meanCard(
      r.shift,
      `${r.submissions} resposta(s) · média /100`,
      r.avg_percent,
      r.shift === 'Noturno' ? '🌙' :
      r.shift === 'Tarde' ? '☀️' :
      r.shift === 'Integral' ? '🕘' : '🌤️'
    )
  ).join('');

  const classAverageCards = classStats.results.map(r =>
    meanCard(
      `Turma ${r.class_name}`,
      `${r.school_name} · ${r.shift}`,
      r.avg_percent,
      '👥'
    )
  ).join('');

  const studentGradeRows = recentGrades.results.map(r => {
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

  // Escola → turno → turma → trimestre → provas
  const groups = new Map();

  for (const e of exams.results) {
    const school = e.school_name || 'Sem escola definida';
    const shift = e.shift || 'Sem turno';
    const className = e.linked_class_name || e.class_name || 'Sem turma';
    const tri = Number(e.trimester || 0);

    if (!groups.has(school)) {
      groups.set(school, { exams: 0, submissions: 0, open: 0, shifts: new Map() });
    }

    const schoolGroup = groups.get(school);
    schoolGroup.exams += 1;
    schoolGroup.submissions += Number(e.submissions || 0);
    schoolGroup.open += Number(e.active) === 1 ? 1 : 0;

    if (!schoolGroup.shifts.has(shift)) schoolGroup.shifts.set(shift, new Map());
    const shiftGroup = schoolGroup.shifts.get(shift);

    if (!shiftGroup.has(className)) {
      shiftGroup.set(className, { exams: [], trimesters: new Map() });
    }

    const classGroup = shiftGroup.get(className);
    classGroup.exams.push(e);

    if (!classGroup.trimesters.has(tri)) classGroup.trimesters.set(tri, []);
    classGroup.trimesters.get(tri).push(e);
  }

  const trimesterTitle = tri =>
    tri === 1 ? '1º trimestre' :
    tri === 2 ? '2º trimestre' :
    tri === 3 ? '3º trimestre' :
    'Sem trimestre';

  const trimesterIcon = tri =>
    tri === 1 ? '①' :
    tri === 2 ? '②' :
    tri === 3 ? '③' : '•';

  const examCard = e => {
    const mean = e.avg_score == null
      ? '—'
      : Number(e.avg_score).toFixed(1).replace('.0','').replace('.', ',');

    return `
      <article class="dash-exam-card"
        data-exam-search="${attr((
          (e.title || '') + ' ' +
          (e.linked_grade || e.grade || '') + ' ' +
          (e.linked_class_name || e.class_name || '') + ' ' +
          (e.school_name || '') + ' ' +
          (e.shift || '')
        ).toLowerCase())}">
        <div class="dash-exam-top">
          <div>
            <span class="status-dot ${Number(e.active) === 1 ? 'is-open' : 'is-closed'}"></span>
            <small>${Number(e.active) === 1 ? 'ABERTA' : 'ENCERRADA'}</small>
          </div>
          <span class="dash-exam-id">#${e.id}</span>
        </div>

        <h4>${esc(e.title)}</h4>
        <p>${esc(e.linked_grade || e.grade || '')}</p>

        <div class="dash-exam-numbers">
          <span><b>${Number(e.submissions || 0)}</b><small>alunos</small></span>
          <span><b>${mean}</b><small>média</small></span>
        </div>

        <div class="dash-exam-actions">
          <a class="dash-action primary" href="/provas/${e.id}">Abrir</a>
          <a class="dash-action" href="/provas/${e.id}/resultados">Notas</a>
          <button type="button" class="dash-action link-action"
            onclick="copyExamLink('/e/${attr(e.token)}', this)">🔗</button>
          <form method="post" action="/provas/${e.id}/excluir"
            onsubmit="return confirm('Excluir esta prova e todos os resultados dela? Esta ação não pode ser desfeita.');">
            <button type="submit" class="dash-action delete-action" title="Excluir prova">🗑</button>
          </form>
        </div>
      </article>`;
  };

  const schoolBlocks = [...groups.entries()].map(([schoolName, school], schoolIndex) => {
    const shiftBlocks = [...school.shifts.entries()].map(([shiftName, classes]) => {
      const classBlocks = [...classes.entries()].map(([className, classData]) => {
        const triColumns = [1,2,3].map(tri => {
          const list = classData.trimesters.get(tri) || [];

          return `
            <section class="dash-trimester tri-${tri}">
              <div class="dash-trimester-head">
                <span>${trimesterIcon(tri)}</span>
                <div>
                  <b>${trimesterTitle(tri)}</b>
                  <small>${list.length} prova(s)</small>
                </div>
              </div>
              <div class="dash-trimester-body">
                ${list.map(examCard).join('') || `
                  <div class="dash-no-exam">
                    <span>＋</span>
                    <small>Nenhuma prova</small>
                  </div>`}
              </div>
            </section>`;
        }).join('');

        const withoutTri = classData.trimesters.get(0) || [];
        const extra = withoutTri.length
          ? `<section class="dash-trimester tri-0">
               <div class="dash-trimester-head"><span>•</span><div><b>Outras provas</b><small>${withoutTri.length} prova(s)</small></div></div>
               <div class="dash-trimester-body">${withoutTri.map(examCard).join('')}</div>
             </section>`
          : '';

        return `
          <details class="dash-class-card" open
            data-school-search="${attr((schoolName+' '+shiftName+' '+className+' '+classData.exams.map(x=>x.title).join(' ')).toLowerCase())}">
            <summary>
              <div class="dash-class-summary">
                <span class="dash-class-avatar">${esc(className).slice(0,4)}</span>
                <div>
                  <span class="eyebrow">TURMA</span>
                  <h3>${esc(className)}</h3>
                  <p>${classData.exams.length} prova(s) · ${classData.exams.reduce((n,x)=>n+Number(x.submissions||0),0)} resposta(s)</p>
                </div>
              </div>
              <span class="summary-chevron">›</span>
            </summary>
            <div class="dash-trimester-grid">${triColumns}${extra}</div>
          </details>`;
      }).join('');

      return `
        <section class="dash-shift">
          <div class="dash-shift-title">
            <span class="shift-icon">${
              shiftName === 'Noturno' ? '🌙' :
              shiftName === 'Tarde' ? '☀️' :
              shiftName === 'Integral' ? '🕘' : '🌤️'
            }</span>
            <div><span class="eyebrow">TURNO</span><h3>${esc(shiftName)}</h3></div>
          </div>
          ${classBlocks}
        </section>`;
    }).join('');

    const theme = (schoolIndex % 5) + 1;

    return `
      <details class="dash-school school-color-${theme}" open
        data-school-search="${attr(schoolName.toLowerCase())}">
        <summary>
          <div class="dash-school-main">
            <span class="dash-school-icon">🏫</span>
            <div>
              <span class="eyebrow">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>${school.exams} prova(s) · ${school.submissions} resposta(s) · ${school.open} aberta(s)</p>
            </div>
          </div>
          <span class="summary-chevron">›</span>
        </summary>
        <div class="dash-school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  const messageBox = message === 'deleted'
    ? `<div class="dashboard-toast-success">✓ Prova excluída com sucesso.</div>`
    : '';

  return page(
    'Painel',
    nav() + `
      <main class="dashboard-v16">
        ${messageBox}

        <section class="dash-hero">
          <div>
            <span class="eyebrow white">EDUCAFÍSICA AVALIA</span>
            <h1>Painel do professor</h1>
            <p>Mais simples: primeiro suas provas; depois notas e médias.</p>
          </div>

          <div class="dash-hero-actions">
            <a class="btn light" href="/provas/nova">＋ Nova prova</a>
            <a class="btn glass" href="/caderno">▦ Caderno RCO</a>
          </div>
        </section>

        <section class="dash-primary-actions">
          <a href="/provas/nova"><span>✎</span><div><b>Criar prova</b><small>Nova avaliação</small></div></a>
          <a href="/caderno"><span>▦</span><div><b>Caderno RCO</b><small>Notas por trimestre</small></div></a>
          <a href="/banco"><span>▤</span><div><b>Questões</b><small>Banco e importação</small></div></a>
          <a href="/resultados"><span>▥</span><div><b>Resultados</b><small>Gráficos e análises</small></div></a>
        </section>

        <section class="dash-summary-strip">
          <div class="dash-summary-card blue">
            <span>📊</span><b>${avg.a == null ? '—' : String(avg.a).replace('.', ',')}</b><small>Média geral /100</small>
          </div>
          <div class="dash-summary-card green">
            <span>👥</span><b>${s.c || 0}</b><small>Respostas</small>
          </div>
          <div class="dash-summary-card purple">
            <span>📝</span><b>${openExams}</b><small>Provas abertas</small>
          </div>
          <div class="dash-summary-card orange">
            <span>❓</span><b>${q.c || 0}</b><small>Questões ativas</small>
          </div>
        </section>

        <div class="dash-tabs" role="tablist">
          <button type="button" class="dash-tab active" data-tab="provas">📝 Provas e turmas</button>
          <button type="button" class="dash-tab" data-tab="notas">📊 Notas e médias</button>
        </div>

        <section id="dashTabProvas" class="dash-tab-panel active">
          <div class="dash-section-head">
            <div>
              <span class="eyebrow blue">MINHAS PROVAS</span>
              <h2>Escola → turma → trimestre</h2>
              <p>As provas do 1º, 2º e 3º trimestre ficam juntas. Em cada prova você pode abrir, ver notas, copiar o link ou excluir.</p>
            </div>

            <div class="search-box dash-search">
              <span>⌕</span>
              <input id="schoolSearch" placeholder="Buscar escola, turma ou prova">
            </div>
          </div>

          <div id="schoolList">
            ${schoolBlocks || `
              <div class="card empty-state">
                <div class="empty-icon">📝</div>
                <h2>Nenhuma prova criada</h2>
                <p>Crie uma prova e ela aparecerá aqui, na escola, turma e trimestre corretos.</p>
                <a class="btn" href="/provas/nova">Criar primeira prova</a>
              </div>`}
          </div>

          <div class="dash-tools card">
            <div>
              <span class="eyebrow">FERRAMENTAS</span>
              <b>Testes e manutenção</b>
              <small>Opções menos usadas ficam aqui para não poluir o painel.</small>
            </div>
            <div>
              <a class="btn small secondary" href="/banco#importar">Importar questões</a>
              <a class="btn small danger-soft" href="/provas/zerar">Zerar provas de teste</a>
            </div>
          </div>
        </section>

        <section id="dashTabNotas" class="dash-tab-panel">
          <div class="dash-notes-top">
            <div class="dash-general-average">
              <small>MÉDIA GERAL</small>
              <b>${avg.a == null ? '—' : String(avg.a).replace('.', ',')}</b>
              <span>de 100</span>
            </div>

            <div class="card dash-rco-callout">
              <span class="rco-callout-icon">▦</span>
              <div>
                <span class="eyebrow blue">PARA LANÇAR NOTAS</span>
                <h3>Caderno RCO</h3>
                <p>Alunos em ordem alfabética, provas do trimestre juntas e botões de copiar.</p>
              </div>
              <a class="btn small" href="/caderno">Abrir caderno</a>
            </div>
          </div>

          <div class="dash-average-grid">
            <div class="card dash-average-panel">
              <div class="dash-average-title"><span>🏫</span><div><b>Média por escola</b><small>Visão geral de cada colégio</small></div></div>
              <div class="dash-mean-list">${schoolAverageCards || '<p class="muted">Sem notas ainda.</p>'}</div>
            </div>

            <div class="card dash-average-panel">
              <div class="dash-average-title"><span>🕘</span><div><b>Média por turno</b><small>Manhã, tarde e noturno</small></div></div>
              <div class="dash-mean-list">${shiftAverageCards || '<p class="muted">Sem notas ainda.</p>'}</div>
            </div>

            <div class="card dash-average-panel wide">
              <div class="dash-average-title"><span>👥</span><div><b>Média por turma</b><small>Escola, turno e turma</small></div></div>
              <div class="dash-mean-list scroll">${classAverageCards || '<p class="muted">Sem notas ainda.</p>'}</div>
            </div>
          </div>

          <section class="card student-grades-panel dash-students-panel">
            <div class="student-grades-head">
              <div>
                <span class="eyebrow blue">ALUNOS</span>
                <h2>Notas dos alunos</h2>
                <p>Nome, turma, escola, prova e nota /100.</p>
              </div>

              <div class="student-grade-search">
                <span>⌕</span>
                <input id="studentGradeSearch" placeholder="Buscar aluno, turma ou escola">
              </div>
            </div>

            <div class="student-grade-legend">
              <span><i class="legend-note-blue"></i> 60 a 100</span>
              <span><i class="legend-note-red"></i> abaixo de 60</span>
              <a href="/caderno">Organizar para o RCO →</a>
            </div>

            <div class="student-grade-list" id="studentGradeList">
              ${studentGradeRows || `
                <div class="student-grade-empty">
                  <span>👤</span>
                  <b>Ainda não há notas registradas</b>
                  <small>Os alunos aparecerão aqui quando enviarem as provas.</small>
                </div>`}
            </div>
          </section>
        </section>
      </main>

      <div id="copyToast" class="copy-toast">✓ Link da prova copiado</div>

      <script>
        const tabs = document.querySelectorAll('.dash-tab');
        const panelProvas = document.getElementById('dashTabProvas');
        const panelNotas = document.getElementById('dashTabNotas');

        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.forEach(x => x.classList.remove('active'));
            tab.classList.add('active');

            const isProvas = tab.dataset.tab === 'provas';
            panelProvas.classList.toggle('active', isProvas);
            panelNotas.classList.toggle('active', !isProvas);
          });
        });

        const studentSearch = document.getElementById('studentGradeSearch');
        if (studentSearch) {
          studentSearch.addEventListener('input', () => {
            const term = studentSearch.value.trim().toLowerCase();

            document.querySelectorAll('.student-grade-row').forEach(row => {
              const text = row.dataset.studentSearch || '';
              row.style.display = !term || text.includes(term) ? '' : 'none';
            });
          });
        }

        const search = document.getElementById('schoolSearch');
        if (search) {
          search.addEventListener('input', () => {
            const term = search.value.trim().toLowerCase();

            document.querySelectorAll('.dash-school').forEach(school => {
              const schoolText = school.textContent.toLowerCase();
              const match = !term || schoolText.includes(term);
              school.style.display = match ? '' : 'none';

              if (term && match) {
                school.open = true;
                school.querySelectorAll('.dash-class-card').forEach(c => c.open = true);
              }
            });
          });
        }

        async function copyExamLink(path, button) {
          const link = location.origin + path;

          try {
            await navigator.clipboard.writeText(link);
            const old = button.innerHTML;
            button.innerHTML = '✓';
            button.classList.add('copied');
            showCopyToast();
            setTimeout(() => {
              button.innerHTML = old;
              button.classList.remove('copied');
            }, 1500);
          } catch (e) {
            prompt('Copie o link da prova:', link);
          }
        }

        function showCopyToast() {
          const toast = document.getElementById('copyToast');
          if (!toast) return;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1500);
        }
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



async function gradebookRco(env) {
  const rows = await env.DB.prepare(`
    SELECT
      e.id AS exam_id,
      e.title AS exam_title,
      COALESCE(ec.trimester,0) AS trimester,
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name,
      COALESCE(cl.grade,e.grade,'') AS grade,
      su.student_name,
      su.percent
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    ORDER BY
      school_name,
      shift,
      class_name,
      trimester,
      e.id,
      su.student_name COLLATE NOCASE
  `).all();

  const hierarchy = new Map();

  for (const r of rows.results) {
    const school = r.school_name || 'Sem escola definida';
    const shift = r.shift || 'Sem turno';
    const cls = r.class_name || 'Sem turma';
    const tri = Number(r.trimester || 0) || 0;

    if (!hierarchy.has(school)) hierarchy.set(school, new Map());
    const schoolMap = hierarchy.get(school);

    if (!schoolMap.has(shift)) schoolMap.set(shift, new Map());
    const shiftMap = schoolMap.get(shift);

    if (!shiftMap.has(cls)) {
      shiftMap.set(cls, { grade: r.grade || '', trimesters: new Map() });
    }

    const classData = shiftMap.get(cls);

    if (!classData.trimesters.has(tri)) {
      classData.trimesters.set(tri, {
        exams: new Map(),
        students: new Map()
      });
    }

    const triData = classData.trimesters.get(tri);

    if (!triData.exams.has(Number(r.exam_id))) {
      triData.exams.set(Number(r.exam_id), {
        id: Number(r.exam_id),
        title: r.exam_title || `Prova ${r.exam_id}`
      });
    }

    const normalized = String(r.student_name || '')
      .trim()
      .toLocaleLowerCase('pt-BR');

    if (!triData.students.has(normalized)) {
      triData.students.set(normalized, {
        name: String(r.student_name || '').trim(),
        grades: new Map()
      });
    }

    triData.students.get(normalized).grades.set(
      Number(r.exam_id),
      Number(r.percent || 0)
    );
  }

  const noteText = value => {
    if (value == null || Number.isNaN(Number(value))) return '';
    const n = Math.round(Number(value) * 10) / 10;
    return Number.isInteger(n)
      ? String(n)
      : n.toFixed(1).replace('.', ',');
  };

  const triTitle = tri =>
    tri === 1 ? '1º TRIMESTRE' :
    tri === 2 ? '2º TRIMESTRE' :
    tri === 3 ? '3º TRIMESTRE' :
    'SEM TRIMESTRE';

  const triIcon = tri =>
    tri === 1 ? '①' :
    tri === 2 ? '②' :
    tri === 3 ? '③' : '•';

  let schoolIndex = 0;

  const schoolBlocks = [...hierarchy.entries()].map(([schoolName, schoolMap]) => {
    schoolIndex += 1;
    const theme = ((schoolIndex - 1) % 5) + 1;

    const shiftBlocks = [...schoolMap.entries()].map(([shift, shiftMap]) => {
      const shiftIcon =
        shift === 'Noturno' ? '🌙' :
        shift === 'Tarde' ? '☀️' :
        shift === 'Integral' ? '🕘' : '🌤️';

      const classBlocks = [...shiftMap.entries()].map(([cls, classData], classIndex) => {
        const trimesterPanels = [1,2,3].map(tri => {
          const triData = classData.trimesters.get(tri);

          if (!triData) {
            return `
              <section class="rco-trimester tri-${tri} rco-empty-tri">
                <div class="rco-tri-head">
                  <div>
                    <span class="rco-tri-number">${triIcon(tri)}</span>
                    <div><small>TRIMESTRE</small><h4>${triTitle(tri)}</h4></div>
                  </div>
                  <span class="rco-no-data">Sem notas ainda</span>
                </div>
              </section>`;
          }

          const exams = [...triData.exams.values()];
          const students = [...triData.students.values()]
            .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

          const studentRows = students.map((student, idx) => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null);

            const valid = values.filter(v => v != null && !Number.isNaN(Number(v)));
            const average = valid.length
              ? valid.reduce((a,b) => a + Number(b), 0) / valid.length
              : null;

            const examCells = exams.map(exam => {
              const val = student.grades.has(exam.id)
                ? student.grades.get(exam.id)
                : null;

              if (val == null) return `<td><span class="rco-missing">—</span></td>`;

              const clsNote = Number(val) >= 60 ? 'rco-note-blue' : 'rco-note-red';
              return `<td><span class="rco-note ${clsNote}">${noteText(val)}</span></td>`;
            }).join('');

            const avgClass = average == null
              ? ''
              : Number(average) >= 60 ? 'rco-note-blue' : 'rco-note-red';

            return `
              <tr>
                <td class="rco-student-number">${idx + 1}</td>
                <td class="rco-student-name">${esc(student.name)}</td>
                ${examCells}
                <td class="rco-average-cell">
                  ${average == null
                    ? '<span class="rco-missing">—</span>'
                    : `<span class="rco-note rco-average-note ${avgClass}">${noteText(average)}</span>`}
                </td>
              </tr>`;
          }).join('');

          const classSafe = `rco_${schoolIndex}_${classIndex}_${tri}`;

          const namesAndAverage = students.map(student => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null)
              .filter(v => v != null && !Number.isNaN(Number(v)));
            const avg = values.length
              ? values.reduce((a,b) => a + Number(b), 0) / values.length
              : null;
            return `${student.name}\t${avg == null ? '' : noteText(avg)}`;
          }).join('\n');

          const onlyAverage = students.map(student => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null)
              .filter(v => v != null && !Number.isNaN(Number(v)));
            const avg = values.length
              ? values.reduce((a,b) => a + Number(b), 0) / values.length
              : null;
            return avg == null ? '' : noteText(avg);
          }).join('\n');

          const examCopyButtons = exams.map(exam => {
            const copyId = `${classSafe}_exam_${exam.id}`;
            const text = students.map(student => {
              const val = student.grades.has(exam.id)
                ? student.grades.get(exam.id)
                : null;
              return `${student.name}\t${val == null ? '' : noteText(val)}`;
            }).join('\n');

            return `
              <textarea class="copy-source" id="${copyId}">${esc(text)}</textarea>
              <button type="button" class="rco-copy-chip" onclick="copyRco('${copyId}',this)">
                ⧉ ${esc(exam.title)}
              </button>`;
          }).join('');

          return `
            <section class="rco-trimester tri-${tri}">
              <div class="rco-tri-head">
                <div>
                  <span class="rco-tri-number">${triIcon(tri)}</span>
                  <div>
                    <small>TRIMESTRE</small>
                    <h4>${triTitle(tri)}</h4>
                    <p>${students.length} aluno(s) · ${exams.length} prova(s)</p>
                  </div>
                </div>

                <div class="rco-main-copy">
                  <textarea class="copy-source" id="${classSafe}_names_avg">${esc(namesAndAverage)}</textarea>
                  <textarea class="copy-source" id="${classSafe}_avg">${esc(onlyAverage)}</textarea>
                  <button type="button" class="btn small rco-copy-primary"
                          onclick="copyRco('${classSafe}_names_avg',this)">
                    📋 Nome + média
                  </button>
                  <button type="button" class="btn small secondary"
                          onclick="copyRco('${classSafe}_avg',this)">
                    Só médias
                  </button>
                </div>
              </div>

              <div class="rco-exam-copy-row">
                <span>Copiar prova para o RCO:</span>
                ${examCopyButtons}
              </div>

              <div class="rco-table-wrap">
                <table class="rco-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Aluno</th>
                      ${exams.map(exam => `
                        <th>
                          <span>${esc(exam.title)}</span>
                          <small>${tri}º tri</small>
                        </th>`).join('')}
                      <th class="rco-average-head">Média TRI</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${studentRows}
                  </tbody>
                </table>
              </div>
            </section>`;
        }).join('');

        return `
          <details class="rco-class-card" open>
            <summary>
              <div class="rco-class-left">
                <span class="rco-class-badge">${esc(cls).slice(0,4)}</span>
                <div>
                  <span class="eyebrow">TURMA</span>
                  <h3>${esc(cls)}</h3>
                  <p>${esc(classData.grade || '')} · ${esc(shift)}</p>
                </div>
              </div>
              <span class="summary-chevron">›</span>
            </summary>
            <div class="rco-class-content">
              ${trimesterPanels}
            </div>
          </details>`;
      }).join('');

      return `
        <section class="rco-shift-block">
          <div class="rco-shift-head">
            <span class="rco-shift-icon">${shiftIcon}</span>
            <div>
              <span class="eyebrow">TURNO</span>
              <h3>${esc(shift)}</h3>
            </div>
          </div>
          ${classBlocks}
        </section>`;
    }).join('');

    return `
      <details class="rco-school-card school-theme-${theme}" open>
        <summary>
          <div class="rco-school-main">
            <span class="rco-school-icon">🏫</span>
            <div>
              <span class="eyebrow">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>Turmas e notas organizadas por trimestre</p>
            </div>
          </div>
          <span class="summary-chevron">›</span>
        </summary>
        <div class="rco-school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  return page('Caderno RCO', nav() + `
    <main class="rco-page">
      <section class="rco-hero">
        <div>
          <span class="eyebrow white">CADERNO DIGITAL</span>
          <h1>Notas organizadas para o RCO</h1>
          <p>Escola → turno → turma → 1º, 2º e 3º trimestre → provas → alunos.</p>
        </div>
        <div class="rco-hero-actions">
          <a class="btn light" href="/">← Painel</a>
          <a class="btn glass" href="/resultados">Resultados gerais</a>
        </div>
      </section>

      <section class="rco-help-strip">
        <div><span>🏫</span><b>Escola</b><small>cada colégio separado</small></div>
        <div><span>👥</span><b>Turma</b><small>alunos em ordem alfabética</small></div>
        <div><span>①②③</span><b>Trimestres</b><small>provas ficam juntas</small></div>
        <div><span>📋</span><b>RCO</b><small>cópia em um toque</small></div>
      </section>

      <div class="rco-toolbar card">
        <div>
          <span class="eyebrow blue">LOCALIZAR RAPIDAMENTE</span>
          <h2>Buscar no caderno</h2>
        </div>
        <div class="search-box rco-search">
          <span>⌕</span>
          <input id="rcoSearch" placeholder="Digite escola, turma ou turno">
        </div>
      </div>

      <div id="rcoBook">
        ${schoolBlocks || `
          <div class="card empty-state">
            <div class="empty-icon">📘</div>
            <h2>Ainda não há notas</h2>
            <p>Quando os alunos concluírem as provas, o caderno será montado automaticamente.</p>
          </div>`}
      </div>
    </main>

    <div id="copyToast" class="copy-toast">✓ Copiado para a área de transferência</div>

    <script>
      async function copyRco(id, button) {
        const source = document.getElementById(id);
        if (!source) return;

        try {
          await navigator.clipboard.writeText(source.value);
          const old = button.innerHTML;
          button.innerHTML = '✓ Copiado';
          button.classList.add('copied');
          showCopyToast();
          setTimeout(() => {
            button.innerHTML = old;
            button.classList.remove('copied');
          }, 1600);
        } catch (e) {
          source.style.display = 'block';
          source.select();
          document.execCommand('copy');
          source.style.display = 'none';
          showCopyToast();
        }
      }

      function showCopyToast() {
        const toast = document.getElementById('copyToast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1600);
      }

      const rcoSearch = document.getElementById('rcoSearch');
      if (rcoSearch) {
        rcoSearch.addEventListener('input', () => {
          const term = rcoSearch.value.trim().toLowerCase();

          document.querySelectorAll('.rco-school-card').forEach(school => {
            const schoolText = school.innerText.toLowerCase();
            school.style.display = !term || schoolText.includes(term) ? '' : 'none';
          });
        });
      }
    </script>
  `);
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

  await ensureQuestionImageTable(env);

  await env.DB.prepare(`
    DELETE FROM question_images
    WHERE NOT EXISTS (
      SELECT 1
      FROM questions q
      WHERE q.id=question_images.question_id
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


async function ensureQuestionImageTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS question_images (
      question_id INTEGER PRIMARY KEY,
      mime_type TEXT NOT NULL,
      image_data BLOB NOT NULL,
      alt_text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )
  `).run();
}

function questionImageMime(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();

  if (type === 'image/jpeg' || /\.jpe?g$/.test(name)) return 'image/jpeg';
  if (type === 'image/png' || /\.png$/.test(name)) return 'image/png';
  if (type === 'image/webp' || /\.webp$/.test(name)) return 'image/webp';

  return '';
}

async function readQuestionImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || Number(file.size || 0) === 0) {
    return null;
  }

  const mimeType = questionImageMime(file);

  if (!mimeType) {
    throw new Error('Use uma imagem JPG, PNG ou WebP.');
  }

  const maxBytes = 1500000;

  if (Number(file.size || 0) > maxBytes) {
    throw new Error('A imagem deve ter no máximo 1,5 MB.');
  }

  const buffer = await file.arrayBuffer();

  if (buffer.byteLength > maxBytes) {
    throw new Error('A imagem deve ter no máximo 1,5 MB.');
  }

  return {
    mimeType,
    bytes: new Uint8Array(buffer)
  };
}

async function upsertQuestionImage(env, questionId, image, altText = '') {
  await ensureQuestionImageTable(env);

  await env.DB.prepare(`
    INSERT INTO question_images
      (question_id,mime_type,image_data,alt_text,updated_at)
    VALUES
      (?,?,?,?,?)
    ON CONFLICT(question_id)
    DO UPDATE SET
      mime_type=excluded.mime_type,
      image_data=excluded.image_data,
      alt_text=excluded.alt_text,
      updated_at=excluded.updated_at
  `).bind(
    Number(questionId),
    image.mimeType,
    image.bytes,
    String(altText || '').trim(),
    Math.floor(Date.now() / 1000)
  ).run();
}

async function questionImageResponse(env, questionId) {
  await ensureQuestionImageTable(env);

  const image = await env.DB.prepare(`
    SELECT mime_type,image_data,updated_at
    FROM question_images
    WHERE question_id=?
  `).bind(questionId).first();

  if (!image) {
    return new Response('Imagem não encontrada.', { status: 404 });
  }

  const bytes = image.image_data instanceof Uint8Array
    ? image.image_data
    : new Uint8Array(image.image_data || []);

  return new Response(bytes, {
    headers: {
      'Content-Type': image.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=120, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function questionImageEditor(env, questionId, message = '', isError = false) {
  await ensureQuestionImageTable(env);

  const q = await env.DB.prepare(`
    SELECT id,grade,trimester,topic,statement
    FROM questions
    WHERE id=?
  `).bind(questionId).first();

  if (!q) {
    return page(
      'Questão não encontrada',
      nav() + '<main><div class="card"><h2>Questão não encontrada.</h2><a class="btn" href="/banco">Voltar</a></div></main>',
      404
    );
  }

  const image = await env.DB.prepare(`
    SELECT mime_type,alt_text,LENGTH(image_data) AS image_bytes,updated_at
    FROM question_images
    WHERE question_id=?
  `).bind(questionId).first();

  const kb = image?.image_bytes
    ? Math.round(Number(image.image_bytes) / 1024)
    : 0;

  return page(
    'Imagem da questão',
    nav() + `
      <main class="question-image-page">
        <div class="hero">
          <div>
            <span class="eyebrow white">QUESTÃO #${q.id}</span>
            <h1>Imagem da questão</h1>
            <p>${esc(q.grade)} · ${q.trimester ? q.trimester + 'º trimestre' : 'Geral'} · ${esc(q.topic)}</p>
          </div>
          <a class="btn light" href="/banco">← Banco de questões</a>
        </div>

        ${message ? `
          <div class="${isError ? 'alert' : 'question-image-success'}">
            ${esc(message)}
          </div>` : ''}

        <section class="question-image-editor-grid">
          <div class="card">
            <span class="eyebrow blue">ENUNCIADO</span>
            <h2>${esc(q.statement)}</h2>

            <div class="question-image-current">
              ${image ? `
                <img src="/imagem/q/${q.id}?v=${image.updated_at || 0}"
                     alt="${attr(image.alt_text || 'Imagem relacionada à questão')}">
                <div>
                  <b>Imagem atual</b>
                  <small>${esc(image.mime_type)} · aproximadamente ${kb} KB</small>
                  ${image.alt_text ? `<p>${esc(image.alt_text)}</p>` : ''}
                </div>
              ` : `
                <div class="question-image-placeholder">
                  <span>🖼️</span>
                  <b>Esta questão ainda não tem imagem</b>
                  <small>A imagem é opcional.</small>
                </div>
              `}
            </div>
          </div>

          <div class="card">
            <span class="eyebrow blue">${image ? 'TROCAR IMAGEM' : 'ADICIONAR IMAGEM'}</span>
            <h2>Deixar a questão mais visual</h2>
            <p class="muted">Aceita JPG, PNG ou WebP, com até 1,5 MB.</p>

            <form method="post" enctype="multipart/form-data" class="question-image-form">
              <input type="hidden" name="action" value="save">

              <label class="question-image-drop">
                <span>🖼️</span>
                <b>Escolher imagem do celular</b>
                <small>Toque aqui para selecionar</small>
                <input id="imageEditorFile"
                       type="file"
                       name="question_image"
                       accept="image/jpeg,image/png,image/webp"
                       required>
              </label>

              <div id="imageEditorPreview" class="question-image-preview" style="display:none">
                <img id="imageEditorPreviewImg" alt="Pré-visualização">
              </div>

              <label>
                Descrição da imagem
                <input name="image_alt"
                       value="${attr(image?.alt_text || '')}"
                       placeholder="Ex.: jogador de voleibol realizando um bloqueio">
                <small>Ajuda a identificar o conteúdo da imagem e melhora a acessibilidade.</small>
              </label>

              <button>✓ Salvar imagem</button>
            </form>

            ${image ? `
              <form method="post"
                    class="question-image-remove"
                    onsubmit="return confirm('Remover a imagem desta questão? A questão continuará no banco.');">
                <input type="hidden" name="action" value="remove">
                <button class="delete-exam-button">🗑 Remover imagem</button>
              </form>
            ` : ''}
          </div>
        </section>
      </main>

      <script>
        const fileInput = document.getElementById('imageEditorFile');
        const preview = document.getElementById('imageEditorPreview');
        const previewImg = document.getElementById('imageEditorPreviewImg');

        if (fileInput) {
          fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];

            if (!file) {
              preview.style.display = 'none';
              return;
            }

            if (file.size > 1500000) {
              alert('A imagem deve ter no máximo 1,5 MB.');
              fileInput.value = '';
              preview.style.display = 'none';
              return;
            }

            previewImg.src = URL.createObjectURL(file);
            preview.style.display = 'block';
          });
        }
      </script>
    `
  );
}

async function saveQuestionImage(request, env, questionId) {
  await ensureQuestionImageTable(env);

  const q = await env.DB.prepare(
    'SELECT id FROM questions WHERE id=?'
  ).bind(questionId).first();

  if (!q) {
    return page(
      'Questão não encontrada',
      nav() + '<main><div class="card"><h2>Questão não encontrada.</h2><a class="btn" href="/banco">Voltar</a></div></main>',
      404
    );
  }

  const f = await request.formData();
  const action = String(f.get('action') || 'save');

  if (action === 'remove') {
    await env.DB.prepare(
      'DELETE FROM question_images WHERE question_id=?'
    ).bind(questionId).run();

    return questionImageEditor(env, questionId, 'Imagem removida com sucesso.');
  }

  try {
    const image = await readQuestionImage(f.get('question_image'));

    if (!image) {
      return questionImageEditor(env, questionId, 'Selecione uma imagem.', true);
    }

    await upsertQuestionImage(
      env,
      questionId,
      image,
      f.get('image_alt') || ''
    );

    return questionImageEditor(env, questionId, 'Imagem salva com sucesso.');
  } catch (e) {
    return questionImageEditor(
      env,
      questionId,
      e.message || 'Não foi possível salvar a imagem.',
      true
    );
  }
}

async function bank(env) {
  await ensureQuestionImageTable(env);

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
    SELECT
      q.*,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM questions q
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE q.active=1
    ORDER BY q.id DESC
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
    <tr id="q-${q.id}">
      <td>${q.id}</td>
      <td>${esc(q.grade)}</td>
      <td>${esc(q.trimester ? q.trimester + 'º' : 'Geral')}</td>
      <td>${esc(q.source || 'Autoral')}</td>
      <td>${esc(q.topic)}</td>
      <td>${esc(q.difficulty || 'Média')}</td>
      <td class="bank-question-cell">
        <span>${esc(q.statement)}</span>
        ${q.has_image ? `<small class="bank-image-tag">🖼️ Com imagem</small>` : ''}
      </td>
      <td class="bank-image-cell">
        ${q.has_image ? `
          <a href="/banco/imagem/${q.id}" class="bank-image-link">
            <img class="bank-thumb"
                 src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
                 alt="${attr(q.image_alt || 'Imagem da questão')}">
            <span>Trocar</span>
          </a>
        ` : `
          <a href="/banco/imagem/${q.id}" class="bank-add-image">＋ Imagem</a>
        `}
      </td>
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

          <form method="post" class="grid" enctype="multipart/form-data">
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

            <div class="span bank-new-image-box">
              <div>
                <span class="eyebrow blue">IMAGEM OPCIONAL</span>
                <b>Adicionar uma imagem relacionada à questão</b>
                <small>Ex.: foto de um esporte, diagrama tático, gráfico, postura corporal ou situação para análise.</small>
              </div>

              <label class="bank-image-upload">
                <span>🖼️ Escolher imagem</span>
                <input id="newQuestionImage"
                       type="file"
                       name="question_image"
                       accept="image/jpeg,image/png,image/webp">
              </label>

              <div id="newQuestionImagePreview" class="bank-new-image-preview" style="display:none">
                <img id="newQuestionImagePreviewImg" alt="Pré-visualização">
              </div>

              <label>
                Descrição da imagem
                <input name="image_alt"
                       placeholder="Ex.: atleta correndo com gráfico de frequência cardíaca">
              </label>

              <small>JPG, PNG ou WebP · máximo 1,5 MB.</small>
            </div>

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
                  <th>Imagem</th>
                  <th>Gab.</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </main>

      <script>
        const newImage = document.getElementById('newQuestionImage');
        const newPreview = document.getElementById('newQuestionImagePreview');
        const newPreviewImg = document.getElementById('newQuestionImagePreviewImg');

        if (newImage) {
          newImage.addEventListener('change', () => {
            const file = newImage.files && newImage.files[0];

            if (!file) {
              newPreview.style.display = 'none';
              return;
            }

            if (file.size > 1500000) {
              alert('A imagem deve ter no máximo 1,5 MB.');
              newImage.value = '';
              newPreview.style.display = 'none';
              return;
            }

            newPreviewImg.src = URL.createObjectURL(file);
            newPreview.style.display = 'block';
          });
        }
      </script>
    `
  );
}

async function addQuestion(request, env) {
  await ensureQuestionImageTable(env);

  const f = await request.formData();

  let image = null;

  try {
    image = await readQuestionImage(f.get('question_image'));
  } catch (e) {
    return page(
      'Imagem inválida',
      nav() + `
        <main>
          <div class="card">
            <h2>Não foi possível salvar a questão.</h2>
            <p>${esc(e.message || 'Imagem inválida.')}</p>
            <a class="btn" href="/banco">Voltar ao banco</a>
          </div>
        </main>
      `,
      400
    );
  }

  const inserted = await env.DB.prepare(`
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

  const questionId = Number(inserted.meta.last_row_id);

  if (image) {
    await upsertQuestionImage(
      env,
      questionId,
      image,
      f.get('image_alt') || ''
    );
  }

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
  await ensureQuestionImageTable(env);

  const schools = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE active=1
    ORDER BY name
  `).all();

  const sources = await env.DB.prepare(`
    SELECT DISTINCT source AS name
    FROM questions
    WHERE active=1
      AND source IS NOT NULL
      AND TRIM(source)<>''
    ORDER BY source
  `).all();

  const topicCounts = await env.DB.prepare(`
    SELECT
      grade,
      topic,
      COALESCE(trimester,0) AS trimester,
      COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND topic IS NOT NULL
      AND TRIM(topic)<>''
    GROUP BY grade,topic,COALESCE(trimester,0)
    ORDER BY topic,grade,trimester
  `).all();

  const topicAvailability = {};

  for (const row of topicCounts.results) {
    const topic = String(row.topic || '').trim();
    const grade = String(row.grade || '').trim();
    const tri = String(Number(row.trimester || 0));

    if (!topicAvailability[topic]) topicAvailability[topic] = {};
    if (!topicAvailability[topic][grade]) {
      topicAvailability[topic][grade] = { '0':0, '1':0, '2':0, '3':0 };
    }

    topicAvailability[topic][grade][tri] =
      Number(topicAvailability[topic][grade][tri] || 0) + Number(row.c || 0);
  }

  const availabilityJson = JSON.stringify(topicAvailability)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');

  const allTopics = Object.keys(topicAvailability)
    .sort((a,b) => a.localeCompare(b, 'pt-BR'));

  const schoolOptions = schools.results.map(s =>
    `<option value="${s.id}">${esc(s.name)}</option>`
  ).join('');

  const preferredSource = sources.results.some(s =>
    s.name === 'Banco Mestre 2026 · Autoral analítico'
  )
    ? 'Banco Mestre 2026 · Autoral analítico'
    : sources.results.some(s => s.name === 'Banco Humanizado 2026 · CREP/RCO+')
      ? 'Banco Humanizado 2026 · CREP/RCO+'
      : '';

  const sourceOptions = sources.results.map(s => {
    const selected = s.name === preferredSource ? ' selected' : '';
    return `<option value="${attr(s.name)}"${selected}>${esc(s.name)}${selected ? ' · recomendado' : ''}</option>`;
  }).join('');

  const topicCards = allTopics.map(topic => `
    <label class="topic-multi-card" data-topic="${attr(topic)}">
      <input type="checkbox" name="topic_filters" value="${attr(topic)}">
      <span class="topic-check">✓</span>
      <span class="topic-multi-copy">
        <b>${esc(topic)}</b>
        <small data-topic-count>Escolha a série</small>
      </span>
    </label>
  `).join('');

  return page(
    'Criar prova',
    nav() + `
      <main class="create-exam-v18">
        <div class="hero create-hero-v18">
          <div>
            <span class="eyebrow white">NOVA AVALIAÇÃO</span>
            <h1>Criar prova</h1>
            <p>Escolha uma escola, turma e um ou vários assuntos. O sistema monta versões individuais para os alunos.</p>
          </div>
          <a class="btn light" href="/">← Painel</a>
        </div>

        <form method="post" id="examCreateForm">
          <div class="card grid">
            <label class="span">
              Título
              <input name="title" placeholder="Ex.: Avaliação de Educação Física" required>
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

            <div class="span batch-class-section">
              <div class="batch-class-head">
                <div>
                  <span class="eyebrow blue">TURMAS DA MESMA SÉRIE</span>
                  <b>Selecione uma ou várias turmas</b>
                  <small>Ex.: marque A, B e C e o sistema criará três provas de uma única vez.</small>
                </div>
                <div class="batch-class-tools">
                  <button type="button" class="btn small secondary" id="selectCommonClasses">A–D</button>
                  <button type="button" class="btn small secondary" id="selectAllClasses">Todas</button>
                  <button type="button" class="btn small secondary" id="clearClasses">Limpar</button>
                </div>
              </div>

              <div class="batch-class-grid" id="batchClassGrid">
                ${['A','B','C','D','E','F','G','H','T'].map(letter => `
                  <label class="batch-class-card">
                    <input type="checkbox" name="class_letters" value="${letter}">
                    <span class="batch-class-check">✓</span>
                    <b data-class-letter="${letter}">${letter}</b>
                  </label>
                `).join('')}
              </div>

              <div class="batch-class-status" id="batchClassStatus">
                Selecione pelo menos uma turma.
              </div>

              <label class="batch-custom-class">
                Outra turma (opcional)
                <input name="custom_class" id="customClass"
                       placeholder="Ex.: 1T, 2ADM, EJA A">
                <small>Você pode adicionar uma turma personalizada junto com A, B, C...</small>
              </label>
            </div>

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
              <input name="total_points" type="number" step="0.1" value="100" required>
            </label>
          </div>

          <div class="card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">ASSUNTOS / TEMAS</span>
                <h2>Selecione de 2 a 10 assuntos</h2>
                <p>Escolha no mínimo 2 e no máximo 10 assuntos. O número ao lado mostra quantas questões existem para a série escolhida.</p>
              </div>

              <div class="topic-multi-tools">
                <button type="button" class="btn small secondary" id="selectAllTopics">Selecionar disponíveis</button>
                <button type="button" class="btn small secondary" id="clearTopics">Limpar</button>
              </div>
            </div>

            <div class="topic-multi-status" id="topicMultiStatus">
              Selecione pelo menos 2 assuntos para criar a prova.
            </div>

            <div class="topic-multi-grid" id="topicMultiGrid">
              ${topicCards}
            </div>
          </div>

          <div class="card">
            <h2>Como você quer montar?</h2>

            <div class="mode-grid">
              <label class="mode-card">
                <input type="radio" name="generation_mode" value="auto" checked>
                <span>
                  <b>🎲 Gerar automaticamente</b><br>
                  <small>Sorteia questões dos assuntos selecionados e cria versões diferentes por aluno.</small>
                </span>
              </label>

              <label class="mode-card">
                <input type="radio" name="generation_mode" value="manual">
                <span>
                  <b>☑️ Selecionar manualmente</b><br>
                  <small>Carrega apenas as questões compatíveis com a série, trimestre e assuntos escolhidos.</small>
                </span>
              </label>
            </div>
          </div>

          <div class="card" id="autoBox">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">GERADOR AUTOMÁTICO</span>
                <h2>Quantidade e dificuldade</h2>
              </div>
            </div>

            <div class="grid">
              <label>
                Fonte / Referência
                <select name="source_filter">
                  <option value="">Todas as fontes</option>
                  ${sourceOptions}
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
                Número de questões por aluno
                <input id="questionCount"
                       name="question_count"
                       type="number"
                       min="1"
                       max="100"
                       value="10"
                       inputmode="numeric">
                <small>De 1 a 100 questões, conforme o banco disponível.</small>
              </label>
            </div>

            <div class="count-picker" aria-label="Atalhos de quantidade">
              <span>Quantidade rápida:</span>
              ${[5,10,15,20,25,30,40,50,60,80,100].map(n =>
                `<button type="button"
                         class="count-chip${n===10?' active':''}"
                         data-count="${n}">${n}</button>`
              ).join('')}
            </div>

            <div class="info-box v18-info-box">
              <b>Como será a prova:</b> se você marcar várias turmas, o sistema cria
              <b>um link diferente para cada turma</b> de uma única vez. O banco de questões
              é sorteado novamente para cada turma. Dentro de cada turma, cada aluno também
              recebe uma versão individual com questões e alternativas embaralhadas.
            </div>

            <button style="margin-top:15px">🎲 Gerar prova</button>
          </div>

          <div class="card" id="manualBox" style="display:none">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">SELEÇÃO MANUAL</span>
                <h2>Escolha as questões</h2>
                <p>Para manter a página rápida, as questões são carregadas somente quando você abre este modo.</p>
              </div>

              <button type="button" class="btn small secondary" id="reloadManual">
                ↻ Atualizar lista
              </button>
            </div>

            <div class="filter-note" id="manualStatus">Carregando...</div>
            <div class="question-list manual-ajax-list" id="manualQuestionList"></div>
            <button style="margin-top:15px">Criar com questões selecionadas</button>
          </div>
        </form>
      </main>

      <script>
        const topicAvailability = ${availabilityJson};

        const educationLevel = document.getElementById('educationLevel');
        const grade = document.getElementById('grade');
        const classInputs = [...document.querySelectorAll('input[name="class_letters"]')];
        const customClass = document.getElementById('customClass');
        const batchClassStatus = document.getElementById('batchClassStatus');
        const selectCommonClasses = document.getElementById('selectCommonClasses');
        const selectAllClasses = document.getElementById('selectAllClasses');
        const clearClasses = document.getElementById('clearClasses');
        const trimester = document.getElementById('trimester');
        const questionCount = document.getElementById('questionCount');
        const countChips = document.querySelectorAll('.count-chip');
        const topicCards = [...document.querySelectorAll('.topic-multi-card')];
        const selectAllTopics = document.getElementById('selectAllTopics');
        const clearTopics = document.getElementById('clearTopics');
        const topicMultiStatus = document.getElementById('topicMultiStatus');
        const manualQuestionList = document.getElementById('manualQuestionList');
        const manualStatus = document.getElementById('manualStatus');
        const reloadManual = document.getElementById('reloadManual');

        const gradesByLevel = {
          'Fundamental': ['6º ano','7º ano','8º ano','9º ano'],
          'Médio': ['1ª série','2ª série','3ª série']
        };

        function currentTopicCount(topic) {
          const selectedGrade = grade.value;
          const tri = String(Number(trimester.value || 0));
          const data = topicAvailability[topic]?.[selectedGrade];

          if (!data) return 0;

          return Number(data['0'] || 0) + Number(data[tri] || 0);
        }

        function selectedTopics() {
          return topicCards
            .filter(card => card.style.display !== 'none')
            .map(card => card.querySelector('input'))
            .filter(input => input.checked)
            .map(input => input.value);
        }

        function updateTopicCards() {
          let available = 0;

          topicCards.forEach(card => {
            const topic = card.dataset.topic;
            const count = currentTopicCount(topic);
            const countEl = card.querySelector('[data-topic-count]');
            const input = card.querySelector('input');

            card.style.display = count > 0 ? 'flex' : 'none';

            if (countEl) {
              countEl.textContent = count > 0
                ? count + ' questão(ões) disponíveis'
                : 'Sem questões nesta série';
            }

            if (count <= 0) input.checked = false;
            if (count > 0) available += 1;
          });

          updateTopicStatus(available);
        }

        function updateTopicStatus(availableCount = null) {
          const selected = selectedTopics();
          const visible = availableCount == null
            ? topicCards.filter(card => card.style.display !== 'none').length
            : availableCount;

          const total = selected.reduce(
            (sum, topic) => sum + currentTopicCount(topic),
            0
          );

          topicCards.forEach(card => {
            const input = card.querySelector('input');
            const locked = selected.length >= 10 && !input.checked;
            input.disabled = locked;
            card.classList.toggle('topic-limit-disabled', locked);
          });

          if (selected.length < 2) {
            topicMultiStatus.className =
              'topic-multi-status topic-status-warning';
            topicMultiStatus.innerHTML =
              '<b>Escolha pelo menos 2 assuntos.</b> ' +
              selected.length + ' selecionado(s) · ' +
              visible + ' disponível(is) para esta série.';
          } else if (selected.length === 10) {
            topicMultiStatus.className =
              'topic-multi-status topic-status-ok';
            topicMultiStatus.innerHTML =
              '<b>10 assuntos selecionados — máximo atingido.</b> · ' +
              total + ' questão(ões) disponíveis.';
          } else {
            topicMultiStatus.className =
              'topic-multi-status topic-status-ok';
            topicMultiStatus.innerHTML =
              '<b>' + selected.length + ' assuntos selecionados</b> · ' +
              total + ' questão(ões) disponíveis · máximo 10.';
          }

          return selected.length >= 2 && selected.length <= 10;
        }

        function fillGrades() {
          const values = gradesByLevel[educationLevel.value] || [];
          grade.innerHTML = values
            .map(v => '<option value="' + v + '">' + v + '</option>')
            .join('');

          updateTopicCards();
          if (currentMode() === 'manual') loadManualQuestions();
        }

        function gradePrefix() {
          const value = grade.value || '';
          if (value.startsWith('1ª')) return '1';
          if (value.startsWith('2ª')) return '2';
          if (value.startsWith('3ª')) return '3';
          if (value.startsWith('6º')) return '6';
          if (value.startsWith('7º')) return '7';
          if (value.startsWith('8º')) return '8';
          if (value.startsWith('9º')) return '9';
          return '';
        }

        function selectedClasses() {
          const regular = classInputs
            .filter(input => input.checked)
            .map(input => input.value);

          const custom = String(customClass.value || '').trim();

          return custom ? [...regular, custom] : regular;
        }

        function updateClassLabels() {
          const prefix = gradePrefix();

          document.querySelectorAll('[data-class-letter]').forEach(el => {
            const letter = el.dataset.classLetter;
            el.textContent = prefix ? prefix + letter : letter;
          });

          updateClassStatus();
        }

        function updateClassStatus() {
          const selected = selectedClasses();

          document.querySelectorAll('.batch-class-card').forEach(card => {
            const input = card.querySelector('input');
            card.classList.toggle('selected', input.checked);
          });

          if (!selected.length) {
            batchClassStatus.className = 'batch-class-status warning';
            batchClassStatus.innerHTML =
              '<b>Nenhuma turma selecionada.</b> Marque pelo menos uma.';
          } else if (selected.length === 1) {
            batchClassStatus.className = 'batch-class-status ok';
            batchClassStatus.innerHTML =
              '<b>1 turma selecionada.</b> Será criado 1 link.';
          } else {
            batchClassStatus.className = 'batch-class-status ok';
            batchClassStatus.innerHTML =
              '<b>' + selected.length + ' turmas selecionadas.</b> Serão criados ' +
              selected.length + ' links de uma única vez.';
          }

          return selected.length > 0 && selected.length <= 10;
        }

        countChips.forEach(chip => chip.addEventListener('click', () => {
          questionCount.value = chip.dataset.count;
          countChips.forEach(c => c.classList.toggle('active', c === chip));
        }));

        questionCount.addEventListener('input', () => {
          let n = Number(questionCount.value || 1);
          if (n > 100) questionCount.value = 100;
          if (n < 1) questionCount.value = 1;

          countChips.forEach(c =>
            c.classList.toggle(
              'active',
              Number(c.dataset.count) === Number(questionCount.value)
            )
          );
        });

        topicCards.forEach(card => {
          const input = card.querySelector('input');

          input.addEventListener('change', () => {
            const selected = selectedTopics();

            if (selected.length > 10) {
              input.checked = false;
              alert('Você pode selecionar no máximo 10 assuntos.');
            }

            updateTopicStatus();

            if (currentMode() === 'manual') {
              loadManualQuestions();
            }
          });
        });

        selectAllTopics.addEventListener('click', () => {
          let selectedCount = 0;

          topicCards.forEach(card => {
            const input = card.querySelector('input');

            if (card.style.display !== 'none' && selectedCount < 10) {
              input.checked = true;
              selectedCount += 1;
            } else {
              input.checked = false;
            }
          });

          updateTopicStatus();

          if (currentMode() === 'manual') {
            loadManualQuestions();
          }
        });

        clearTopics.addEventListener('click', () => {
          topicCards.forEach(card => {
            card.querySelector('input').checked = false;
          });
          updateTopicStatus();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        educationLevel.addEventListener('change', fillGrades);

        grade.addEventListener('change', () => {
          updateTopicCards();
          updateClassLabels();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        trimester.addEventListener('change', () => {
          updateTopicCards();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        classInputs.forEach(input => {
          input.addEventListener('change', updateClassStatus);
        });

        customClass.addEventListener('input', updateClassStatus);

        selectCommonClasses.addEventListener('click', () => {
          classInputs.forEach(input => {
            input.checked = ['A','B','C','D'].includes(input.value);
          });
          updateClassStatus();
        });

        selectAllClasses.addEventListener('click', () => {
          classInputs.forEach(input => input.checked = true);
          updateClassStatus();
        });

        clearClasses.addEventListener('click', () => {
          classInputs.forEach(input => input.checked = false);
          customClass.value = '';
          updateClassStatus();
        });

        const autoBox = document.getElementById('autoBox');
        const manualBox = document.getElementById('manualBox');
        const modes = document.querySelectorAll('input[name="generation_mode"]');

        function currentMode() {
          return document.querySelector('input[name="generation_mode"]:checked')?.value || 'auto';
        }

        function updateMode() {
          const mode = currentMode();
          autoBox.style.display = mode === 'auto' ? 'block' : 'none';
          manualBox.style.display = mode === 'manual' ? 'block' : 'none';

          if (mode === 'manual') loadManualQuestions();
        }

        async function loadManualQuestions() {
          manualStatus.textContent = 'Carregando questões...';
          manualQuestionList.innerHTML =
            '<div class="manual-loading">⏳ Buscando questões compatíveis...</div>';

          const params = new URLSearchParams({
            grade: grade.value,
            trimester: trimester.value
          });

          const topics = selectedTopics();
          topics.forEach(topic => params.append('topic', topic));

          try {
            const response = await fetch('/api/questoes?' + params.toString(), {
              credentials: 'same-origin'
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.error || 'Falha ao carregar questões.');
            }

            manualStatus.textContent =
              data.total + ' questão(ões) compatíveis. ' +
              (data.limited ? 'Mostrando as primeiras ' + data.items.length + '.' : '');

            if (!data.items.length) {
              manualQuestionList.innerHTML =
                '<div class="manual-loading">Nenhuma questão encontrada para estes filtros.</div>';
              return;
            }

            manualQuestionList.innerHTML = data.items.map(q => {
              const image = q.has_image
                ? '<img class="manual-question-thumb" src="/imagem/q/' + q.id + '?v=' + (q.image_updated_at || 0) + '" alt="">'
                : '';

              return (
                '<label class="pick manual-question">' +
                  '<input type="checkbox" name="question_ids" value="' + q.id + '">' +
                  image +
                  '<span>' +
                    '<b>' + escapeHtml(q.grade) + ' · ' + escapeHtml(q.topic) + '</b>' +
                    (q.has_image ? '<small class="manual-image-badge">🖼️ visual</small>' : '') +
                    '<br><small>' +
                      escapeHtml(q.source || 'Autoral') + ' · ' +
                      (q.trimester ? q.trimester + 'º tri' : 'Geral') + ' · ' +
                      escapeHtml(q.difficulty || 'Média') +
                    '</small><br>' +
                    escapeHtml(q.statement) +
                  '</span>' +
                '</label>'
              );
            }).join('');
          } catch (e) {
            manualStatus.textContent = 'Não foi possível carregar.';
            manualQuestionList.innerHTML =
              '<div class="manual-loading">' + escapeHtml(e.message || String(e)) + '</div>';
          }
        }

        function escapeHtml(value) {
          return String(value ?? '')
            .replaceAll('&','&amp;')
            .replaceAll('<','&lt;')
            .replaceAll('>','&gt;')
            .replaceAll('"','&quot;')
            .replaceAll("'",'&#039;');
        }

        reloadManual.addEventListener('click', loadManualQuestions);
        modes.forEach(m => m.addEventListener('change', updateMode));

        document.getElementById('examCreateForm').addEventListener(
          'submit',
          event => {
            const selected = selectedTopics();
            const classes = selectedClasses();

            if (!classes.length) {
              event.preventDefault();
              alert('Selecione pelo menos uma turma.');
              document.getElementById('batchClassGrid').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              return;
            }

            if (classes.length > 10) {
              event.preventDefault();
              alert('Você pode criar no máximo 10 turmas por vez.');
              return;
            }

            if (selected.length < 2) {
              event.preventDefault();
              alert('Selecione pelo menos 2 assuntos para criar a prova.');
              document.getElementById('topicMultiGrid').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              return;
            }

            if (selected.length > 10) {
              event.preventDefault();
              alert('Você pode selecionar no máximo 10 assuntos.');
              return;
            }

            if (classes.length > 1 && currentMode() === 'manual') {
              event.preventDefault();
              alert(
                'Para criar várias turmas com bancos de questões diferentes, use “Gerar automaticamente”.'
              );
            }
          }
        );

        fillGrades();
        updateClassLabels();
        updateMode();
      </script>
    `
  );
}

async function manualQuestionsApi(url, env) {
  await ensureQuestionImageTable(env);

  const grade = String(url.searchParams.get('grade') || '').trim();
  const trimester = Number(url.searchParams.get('trimester') || 0);
  const topics = url.searchParams
    .getAll('topic')
    .map(x => String(x || '').trim())
    .filter(Boolean);

  if (!grade) {
    return jsonResponse({ error: 'Série não informada.' }, 400);
  }

  const clauses = [
    'q.active=1',
    'q.grade=?',
    '(q.trimester=0 OR q.trimester=?)'
  ];

  const binds = [grade, trimester];

  if (topics.length) {
    clauses.push(`q.topic IN (${topics.map(() => '?').join(',')})`);
    binds.push(...topics);
  }

  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions q
    WHERE ${clauses.join(' AND ')}
  `).bind(...binds).first();

  const total = Number(countRow?.c || 0);
  const maxItems = 250;

  const rows = await env.DB.prepare(`
    SELECT
      q.id,
      q.grade,
      q.trimester,
      q.source,
      q.topic,
      q.difficulty,
      q.statement,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      qi.updated_at AS image_updated_at
    FROM questions q
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY q.topic, q.difficulty, q.id DESC
    LIMIT ?
  `).bind(...binds, maxItems).all();

  return jsonResponse({
    total,
    limited: total > maxItems,
    items: rows.results
  });
}

async function createExam(request, env) {
  const f = await request.formData();

  const schoolId = Number(f.get('school_id'));
  const shift = String(f.get('shift') || '').trim();
  const educationLevel = String(f.get('education_level') || '').trim();
  const grade = String(f.get('grade') || '').trim();
  const modality = String(f.get('modality') || 'Regular').trim();
  const customClass = String(f.get('custom_class') || '').trim();

  const classLetters = [...new Set(
    f.getAll('class_letters')
      .map(x => String(x || '').trim().toUpperCase())
      .filter(x => ['A','B','C','D','E','F','G','H','T'].includes(x))
  )];

  const school = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE id=? AND active=1
  `).bind(schoolId).first();

  if (!school || !shift || !grade) {
    return page(
      'Atenção',
      '<div class="login"><h2>Preencha escola, turno e série.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
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

  const rawClassNames = classLetters.map(letter => `${prefix}${letter}`);

  if (customClass) {
    rawClassNames.push(customClass);
  }

  const uniqueRawClasses = [...new Set(
    rawClassNames.map(x => String(x || '').trim()).filter(Boolean)
  )];

  if (!uniqueRawClasses.length) {
    return page(
      'Atenção',
      '<div class="login"><h2>Selecione pelo menos uma turma.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  if (uniqueRawClasses.length > 10) {
    return page(
      'Atenção',
      '<div class="login"><h2>Você pode criar no máximo 10 turmas por vez.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const classNames = uniqueRawClasses.map(base =>
    modality === 'Técnico' ? `${base} (Técnico)` : base
  );

  const mode = String(f.get('generation_mode') || 'auto');
  const trimester = Number(f.get('trimester') || 1);

  const selectedTopics = f.getAll('topic_filters')
    .map(x => String(x || '').trim())
    .filter(Boolean);

  if (selectedTopics.length < 2 || selectedTopics.length > 10) {
    return page(
      'Seleção de assuntos',
      `
        <div class="login">
          <h2>Escolha de 2 a 10 assuntos.</h2>
          <p>Você selecionou <b>${selectedTopics.length}</b> assunto(s).</p>
          <a class="btn" href="/provas/nova">Voltar e escolher</a>
        </div>
      `,
      400
    );
  }

  if (classNames.length > 1 && mode === 'manual') {
    return page(
      'Criação em lote',
      `
        <div class="login">
          <h2>Para várias turmas, use o gerador automático.</h2>
          <p>Assim o sistema consegue criar um banco de questões diferente para cada turma.</p>
          <a class="btn" href="/provas/nova">Voltar</a>
        </div>
      `,
      400
    );
  }

  const totalPoints = Number(f.get('total_points') || 100);
  const baseTitle = String(f.get('title') || 'Avaliação de Educação Física').trim();
  const createdExamIds = [];
  const usedPoolSignatures = new Set();

  let studentQuestionCount = 0;
  let manualIds = [];

  // Critérios do automático ficam prontos uma vez, mas o sorteio é repetido por turma.
  const source = String(f.get('source_filter') || '').trim();
  const difficulty = String(f.get('difficulty_filter') || '').trim();
  const automaticCount = Math.max(
    1,
    Math.min(100, Number(f.get('question_count') || 10))
  );

  const autoClauses = [
    'active=1',
    'grade=?',
    '(trimester=0 OR trimester=?)'
  ];

  const autoBinds = [grade, trimester];

  if (source) {
    autoClauses.push('source=?');
    autoBinds.push(source);
  }

  if (selectedTopics.length) {
    autoClauses.push(
      `topic IN (${selectedTopics.map(() => '?').join(',')})`
    );
    autoBinds.push(...selectedTopics);
  }

  if (difficulty) {
    autoClauses.push('difficulty=?');
    autoBinds.push(difficulty);
  }

  let candidateTotal = 0;
  let perClassPoolLimit = 0;

  if (mode === 'manual') {
    manualIds = f.getAll('question_ids').map(Number).filter(Boolean);
    studentQuestionCount = manualIds.length;

    if (!manualIds.length) {
      return page(
        'Atenção',
        '<div class="login"><h2>Selecione pelo menos uma questão.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }

    const placeholders = manualIds.map(() => '?').join(',');
    const topicPlaceholders = selectedTopics.map(() => '?').join(',');

    const validManual = await env.DB.prepare(`
      SELECT COUNT(*) AS c
      FROM questions
      WHERE id IN (${placeholders})
        AND topic IN (${topicPlaceholders})
        AND grade=?
        AND (trimester=0 OR trimester=?)
        AND active=1
    `).bind(
      ...manualIds,
      ...selectedTopics,
      grade,
      trimester
    ).first();

    if (Number(validManual?.c || 0) !== manualIds.length) {
      return page(
        'Seleção inválida',
        '<div class="login"><h2>Alguma questão não corresponde aos filtros escolhidos.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }
  } else {
    studentQuestionCount = automaticCount;

    const totalRow = await env.DB.prepare(`
      SELECT COUNT(*) AS c
      FROM questions
      WHERE ${autoClauses.join(' AND ')}
    `).bind(...autoBinds).first();

    candidateTotal = Number(totalRow?.c || 0);

    if (candidateTotal < automaticCount) {
      return page(
        'Banco insuficiente',
        `
          <div class="login">
            <h2>Não há questões suficientes para esse filtro.</h2>
            <p>Encontradas: <b>${candidateTotal}</b> de <b>${automaticCount}</b>.</p>
            <p>Escolha mais assuntos, dificuldade mista ou importe mais questões.</p>
            <a class="btn" href="/provas/nova">Voltar</a>
          </div>
        `,
        400
      );
    }

    // Mantém um pool individual por turma.
    // Se houver bastante banco, cada turma usa apenas parte dele para os conjuntos ficarem diferentes.
    const desiredPool = Math.max(
      automaticCount,
      Math.min(220, Math.max(automaticCount * 3, selectedTopics.length * 35))
    );

    perClassPoolLimit = Math.min(
      candidateTotal,
      Math.max(
        automaticCount,
        candidateTotal > automaticCount
          ? Math.min(desiredPool, Math.max(automaticCount, Math.floor(candidateTotal * 0.72)))
          : automaticCount
      )
    );
  }

  for (let classIndex = 0; classIndex < classNames.length; classIndex++) {
    const className = classNames[classIndex];

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
        INSERT INTO school_classes
          (school_id, shift, class_name, grade, active)
        VALUES
          (?,?,?,?,1)
      `).bind(schoolId, shift, className, grade).run();

      classInfo = {
        id: inserted.meta.last_row_id,
        school_id: schoolId,
        shift,
        class_name: className,
        grade
      };
    }

    let ids = [];

    if (mode === 'manual') {
      ids = [...manualIds];
    } else {
      // Novo sorteio para CADA turma.
      // Se, por acaso, sair um conjunto idêntico ao de outra turma, tenta novamente.
      let attempts = 0;
      let signature = '';

      do {
        const picked = await env.DB.prepare(`
          SELECT id
          FROM questions
          WHERE ${autoClauses.join(' AND ')}
          ORDER BY RANDOM()
          LIMIT ?
        `).bind(...autoBinds, perClassPoolLimit).all();

        ids = picked.results.map(x => Number(x.id));
        signature = [...ids].sort((a,b) => a-b).join(',');
        attempts += 1;
      } while (
        classNames.length > 1 &&
        candidateTotal > automaticCount &&
        usedPoolSignatures.has(signature) &&
        attempts < 6
      );

      usedPoolSignatures.add(signature);
    }

    const token = await uniqueExamToken(env);
    const finalTitle = classNames.length > 1
      ? `${baseTitle} · ${className}`
      : baseTitle;

    const r = await env.DB.prepare(`
      INSERT INTO exams
        (token,title,level,grade,class_name,total_points,active)
      VALUES
        (?,?,?,?,?,?,1)
    `).bind(
      token,
      finalTitle,
      educationLevel === 'Médio' ? 'Médio' : 'Fundamental',
      grade,
      className,
      totalPoints
    ).run();

    const examId = Number(r.meta.last_row_id);

    await env.DB.batch(
      ids.map((id, i) =>
        env.DB
          .prepare(`
            INSERT INTO exam_questions
              (exam_id,question_id,position)
            VALUES
              (?,?,?)
          `)
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
      VALUES
        (?,?,1,1)
    `).bind(
      examId,
      Math.max(
        1,
        Math.min(studentQuestionCount || ids.length, ids.length)
      )
    ).run();

    createdExamIds.push(examId);
  }

  if (createdExamIds.length === 1) {
    return redirect(`/provas/${createdExamIds[0]}`);
  }

  return redirect(
    `/provas/lote?ids=${encodeURIComponent(createdExamIds.join(','))}`
  );
}

async function examBatchPage(url, env, requestUrl) {
  const ids = String(url.searchParams.get('ids') || '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
    .filter(id => id > 0)
    .slice(0, 10);

  if (!ids.length) {
    return redirect('/');
  }

  const placeholders = ids.map(() => '?').join(',');

  const rows = await env.DB.prepare(`
    SELECT
      e.id,
      e.token,
      e.title,
      e.grade,
      e.class_name,
      e.active,
      sc.name AS school_name,
      cl.shift AS shift,
      ec.trimester AS trimester,
      COUNT(eq.question_id) AS pool_size,
      evs.question_count AS question_count
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    LEFT JOIN exam_questions eq ON eq.exam_id=e.id
    LEFT JOIN exam_variant_settings evs ON evs.exam_id=e.id
    WHERE e.id IN (${placeholders})
    GROUP BY e.id
    ORDER BY cl.class_name
  `).bind(...ids).all();

  if (!rows.results.length) {
    return redirect('/');
  }

  const origin = new URL(requestUrl).origin;

  const copyAllText = rows.results.map(e =>
    `${e.class_name}: ${origin}/e/${e.token}`
  ).join('\\n');

  const cards = rows.results.map((e, index) => {
    const link = `${origin}/e/${e.token}`;
    const qrUrl =
      `https://quickchart.io/qr?text=${encodeURIComponent(link)}` +
      `&size=220&margin=2&ecLevel=M&format=svg`;

    return `
      <article class="batch-created-card">
        <div class="batch-created-top">
          <span class="batch-created-number">${index + 1}</span>
          <div>
            <span class="eyebrow blue">TURMA</span>
            <h2>${esc(e.class_name)}</h2>
            <p>${esc(e.school_name || '')} · ${esc(e.shift || '')} · ${e.trimester || ''}º trimestre</p>
          </div>
          <span class="batch-created-ok">✓ CRIADA</span>
        </div>

        <div class="batch-created-info">
          <span><b>${Number(e.question_count || 0)}</b><small>questões por aluno</small></span>
          <span><b>${Number(e.pool_size || 0)}</b><small>questões no banco da turma</small></span>
        </div>

        <div class="batch-created-share">
          <div class="batch-created-link">
            <label>Link para esta turma</label>
            <div>
              <input id="batchLink${e.id}" value="${attr(link)}" readonly>
              <button type="button"
                onclick="copyBatchLink('batchLink${e.id}',this)">Copiar</button>
            </div>

            <div class="batch-created-actions">
              <a class="btn small secondary" href="/provas/${e.id}">Abrir prova</a>
              <a class="btn small secondary" href="/provas/${e.id}/resultados">Notas</a>
            </div>
          </div>

          <div class="batch-created-qr">
            <img src="${attr(qrUrl)}" width="170" height="170"
                 alt="QR Code da turma ${attr(e.class_name)}">
            <small>QR Code · ${esc(e.class_name)}</small>
          </div>
        </div>
      </article>`;
  }).join('');

  return page(
    'Provas criadas',
    nav() + `
      <main class="batch-result-page">
        <section class="batch-result-hero">
          <div>
            <span class="eyebrow white">CRIAÇÃO EM LOTE CONCLUÍDA</span>
            <h1>${rows.results.length} provas criadas de uma vez</h1>
            <p>Cada turma recebeu um link próprio e um banco de questões sorteado separadamente.</p>
          </div>
          <a class="btn light" href="/">Ir ao painel</a>
        </section>

        <section class="card batch-copy-all">
          <div>
            <span class="eyebrow blue">CLASSROOM / WHATSAPP</span>
            <h2>Copiar todos os links</h2>
            <p>Os links já ficam identificados pela turma.</p>
          </div>

          <textarea id="batchAllLinks" readonly>${esc(copyAllText)}</textarea>

          <button type="button" onclick="copyBatchAll(this)">
            📋 Copiar todas as turmas
          </button>
        </section>

        <div class="batch-difference-note">
          <span>🔀</span>
          <div>
            <b>As provas não são cópias umas das outras.</b>
            <p>O banco foi sorteado separadamente para cada turma. Além disso, quando o aluno abre o link, o sistema faz nova randomização individual de questões e alternativas.</p>
          </div>
        </div>

        <section class="batch-created-grid">
          ${cards}
        </section>

        <div class="batch-result-footer">
          <a class="btn" href="/provas/nova">＋ Criar outro lote</a>
          <a class="btn secondary" href="/">Voltar ao painel</a>
        </div>
      </main>

      <div id="batchToast" class="copy-toast">✓ Copiado</div>

      <script>
        async function copyBatchLink(id, button) {
          const input = document.getElementById(id);
          if (!input) return;

          try {
            await navigator.clipboard.writeText(input.value);
            const old = button.textContent;
            button.textContent = '✓ Copiado';
            showBatchToast();
            setTimeout(() => button.textContent = old, 1500);
          } catch (e) {
            input.select();
            document.execCommand('copy');
            showBatchToast();
          }
        }

        async function copyBatchAll(button) {
          const area = document.getElementById('batchAllLinks');
          if (!area) return;

          try {
            await navigator.clipboard.writeText(area.value);
            const old = button.innerHTML;
            button.innerHTML = '✓ Todos os links copiados';
            showBatchToast();
            setTimeout(() => button.innerHTML = old, 1700);
          } catch (e) {
            area.select();
            document.execCommand('copy');
            showBatchToast();
          }
        }

        function showBatchToast() {
          const toast = document.getElementById('batchToast');
          if (!toast) return;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1500);
        }
      </script>
    `
  );
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
  await ensureQuestionImageTable(env);

  const variantSettings = await env.DB.prepare(`
    SELECT question_count, randomize_questions, randomize_options
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(id).first();

  const qs = await env.DB.prepare(`
    SELECT
      q.*,
      eq.position,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    LEFT JOIN question_images qi ON qi.question_id=q.id
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
  const list = qs.results.map(q => `
    <li class="exam-question-list-item">
      ${q.has_image ? `
        <img src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
             alt="${attr(q.image_alt || 'Imagem da questão')}">
      ` : ''}
      <span><b>${q.position}. ${esc(q.topic)}</b> — ${esc(q.statement)}</span>
    </li>
  `).join('');

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
          <form method="post" action="/provas/${id}/excluir"
                onsubmit="return confirm('Excluir esta prova e todos os resultados dos alunos? Esta ação não pode ser desfeita.');">
            <button class="delete-exam-button">🗑 Excluir prova</button>
          </form>
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


async function deleteExam(env, id) {
  const exam = await env.DB.prepare(
    'SELECT id,title FROM exams WHERE id=?'
  ).bind(id).first();

  if (!exam) return redirect('/');

  await ensureExamVariantTables(env);

  // Remove apenas dados pertencentes a esta prova.
  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM attempt_questions
      WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM attempt_answers
      WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_attempts
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM answers
      WHERE submission_id IN (
        SELECT id FROM submissions WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM submissions
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_questions
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_context
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_variant_settings
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exams
      WHERE id=?
    `).bind(id)
  ]);

  return redirect('/?msg=deleted');
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
  await ensureQuestionImageTable(env);

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
      aq.option_order,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM attempt_questions aq
    JOIN questions q ON q.id=aq.question_id
    LEFT JOIN question_images qi ON qi.question_id=q.id
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
      @media(max-width:650px){.batch-class-head{align-items:flex-start;flex-direction:column}.batch-class-grid{grid-template-columns:repeat(3,1fr)}.batch-created-share{grid-template-columns:1fr}.batch-created-qr{max-width:220px;margin:auto}.batch-created-top{grid-template-columns:34px 1fr}.batch-created-ok{grid-column:1/-1;width:max-content}.batch-result-footer{flex-direction:column}.batch-result-footer .btn{width:100%}.topic-multi-grid{grid-template-columns:1fr}.topic-multi-tools{width:100%}.topic-multi-tools .btn{flex:1}.manual-question-thumb{width:72px;height:54px}.bank-thumb{width:64px;height:46px}.exam-rules-card{grid-template-columns:1fr}.rule-list{grid-template-columns:1fr}.rules-icon{width:52px;height:52px}}
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
          <section class="card question-card ${q.has_image ? 'question-has-image' : ''}">
            <div class="qnum">Questão ${q.position}</div>

            ${q.has_image ? `
              <figure class="question-visual">
                <img src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
                     alt="${attr(q.image_alt || 'Imagem relacionada à questão')}">
                ${q.image_alt ? `<figcaption>${esc(q.image_alt)}</figcaption>` : ''}
              </figure>
            ` : ''}

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
      .question-visual{margin:10px 0 16px;border-radius:17px;overflow:hidden;background:#f4f7fb;border:1px solid #e0e6ef}
      .question-visual img{display:block;width:100%;max-height:430px;object-fit:contain;background:#eef2f7}
      .question-visual figcaption{padding:8px 11px;font-size:10px;color:#65738a;background:white;border-top:1px solid #e7ecf2}
      .question-has-image>h2{margin-top:12px}
      @media(max-width:650px){.question-visual img{max-height:300px}}
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
      <a href="/caderno">▦ <span>Caderno</span></a>
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
    .quick-actions{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:16px 0 18px}.quick-card{background:white;border:1px solid var(--line);border-radius:17px;padding:15px;display:flex;align-items:center;gap:11px;color:var(--ink);box-shadow:0 6px 18px rgba(24,48,82,.05);transition:.15s}.quick-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.quick-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex:none}.quick-icon.blue{background:#e9f1ff;color:var(--primary)}.quick-icon.purple{background:#f0ecff;color:var(--purple)}.quick-icon.green{background:#e7f8ef;color:var(--green)}.quick-icon.orange{background:#fff2e6;color:var(--orange)}.quick-icon.red{background:#ffeded;color:var(--red)}.danger-card{border-color:#ffd7d7}.danger-card:hover{border-color:#f1a8a8}.quick-card>div{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.quick-card b{font-size:14px}.quick-card small{font-size:11px}.quick-card i{font-style:normal;font-size:22px;color:#a2aec0}
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
    .batch-class-section{border:1px solid #d9e3f0;border-radius:17px;background:#f8fbff;padding:14px}.batch-class-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:10px}.batch-class-head>div:first-child{display:flex;flex-direction:column;gap:3px}.batch-class-head b{font-size:14px}.batch-class-head small{font-size:10px;color:var(--muted)}.batch-class-tools{display:flex;gap:5px;flex-wrap:wrap}.batch-class-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:7px}.batch-class-card{position:relative;min-height:58px;border:1px solid var(--line);border-radius:12px;background:white;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;padding:7px}.batch-class-card input{position:absolute;opacity:0;pointer-events:none}.batch-class-card b{font-size:15px}.batch-class-check{width:21px;height:21px;border-radius:7px;border:1px solid #d7e0ec;background:#edf1f6;color:transparent;display:grid;place-items:center;font-size:11px;font-weight:950}.batch-class-card:has(input:checked),.batch-class-card.selected{background:#edf5ff;border-color:#8fb7f4;box-shadow:0 0 0 1px rgba(35,103,242,.08)}.batch-class-card:has(input:checked) .batch-class-check,.batch-class-card.selected .batch-class-check{background:#2367f2;border-color:#2367f2;color:white}.batch-class-status{margin-top:9px;border-radius:10px;padding:8px 10px;font-size:10px}.batch-class-status.warning{background:#fff7e8;border:1px solid #efd89c;color:#755b17}.batch-class-status.ok{background:#eaf8f1;border:1px solid #c5e6d4;color:#176d49}.batch-custom-class{display:block;margin-top:10px}.batch-custom-class small{display:block;margin-top:4px;color:var(--muted)}.batch-result-page{max-width:1180px}.batch-result-hero{background:linear-gradient(120deg,#173d7e,#2367f2 56%,#20aa77 135%);border-radius:27px;padding:27px 29px;color:white;display:flex;justify-content:space-between;align-items:center;gap:18px;box-shadow:0 18px 42px rgba(35,103,242,.18)}.batch-result-hero h1{font-size:clamp(29px,5vw,44px);margin:4px 0 6px}.batch-result-hero p{margin:0;color:rgba(255,255,255,.82)}.batch-copy-all{display:grid;grid-template-columns:1fr minmax(260px,1.2fr) auto;gap:13px;align-items:center;margin:14px 0}.batch-copy-all h2{margin:3px 0}.batch-copy-all p{margin:0;color:var(--muted);font-size:10px}.batch-copy-all textarea{min-height:74px;resize:vertical;font-size:11px}.batch-difference-note{display:flex;gap:11px;align-items:flex-start;background:#edf5ff;border:1px solid #cfe0fb;color:#24568f;border-radius:15px;padding:12px 14px;margin-bottom:13px}.batch-difference-note>span{font-size:24px}.batch-difference-note b{font-size:12px}.batch-difference-note p{margin:3px 0 0;font-size:10px;line-height:1.5}.batch-created-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.batch-created-card{background:white;border:1px solid var(--line);border-radius:20px;padding:15px;box-shadow:0 7px 20px rgba(24,48,82,.055)}.batch-created-top{display:grid;grid-template-columns:38px 1fr auto;gap:9px;align-items:center}.batch-created-number{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf4ff;color:#2367f2;font-weight:950}.batch-created-top h2{margin:0;font-size:21px}.batch-created-top p{margin:2px 0 0;font-size:9px;color:var(--muted)}.batch-created-ok{font-size:8px;font-weight:900;color:#18855c;background:#e8f8ef;padding:5px 7px;border-radius:999px}.batch-created-info{display:grid;grid-template-columns:1fr 1fr;margin:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.batch-created-info>span{display:flex;flex-direction:column;align-items:center;padding:9px}.batch-created-info>span+span{border-left:1px solid var(--line)}.batch-created-info b{font-size:18px}.batch-created-info small{font-size:8px;color:var(--muted)}.batch-created-share{display:grid;grid-template-columns:1fr 180px;gap:12px;align-items:center}.batch-created-link label{font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:900}.batch-created-link>div:nth-child(2){display:grid;grid-template-columns:1fr auto;gap:5px;margin-top:4px}.batch-created-link input{font-size:10px}.batch-created-link button{min-height:0;padding:9px 10px}.batch-created-actions{display:flex;gap:5px;margin-top:7px}.batch-created-qr{text-align:center;background:#f8fbff;border:1px solid var(--line);border-radius:13px;padding:8px}.batch-created-qr img{display:block;width:100%;height:auto;background:white;border-radius:8px}.batch-created-qr small{font-size:8px;color:var(--muted)}.batch-result-footer{display:flex;justify-content:center;gap:8px;margin:16px 0 5px}
    .create-exam-v18{max-width:1180px}.create-hero-v18 h1{margin:5px 0}.compact-heading{margin:0 0 12px}.compact-heading h2{margin:3px 0 4px}.compact-heading p{margin:0;color:var(--muted);font-size:11px}.topic-multi-tools{display:flex;gap:6px;flex-wrap:wrap}.topic-status-warning{background:#fff7e8!important;border-color:#efd89c!important;color:#755b17!important}.topic-status-ok{background:#eaf8f1!important;border-color:#c5e6d4!important;color:#176d49!important}.topic-limit-disabled{opacity:.38;cursor:not-allowed!important;filter:grayscale(.15)}.topic-limit-disabled:hover{background:white!important;border-color:var(--line)!important}.topic-multi-status{padding:10px 12px;border-radius:12px;background:#f4f7fb;border:1px solid var(--line);font-size:11px;color:#59677d;margin-bottom:11px}.topic-multi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:390px;overflow:auto;padding:2px}.topic-multi-card{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:13px;padding:10px 11px;background:white;cursor:pointer;transition:.15s}.topic-multi-card:hover{border-color:#b8cbec;background:#f9fbff}.topic-multi-card input{position:absolute;opacity:0;pointer-events:none}.topic-check{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;background:#edf1f6;color:transparent;border:1px solid #d8e0eb;flex:0 0 auto;font-weight:950}.topic-multi-card:has(input:checked){border-color:#9bbcf3;background:#f3f7ff;box-shadow:0 0 0 1px rgba(35,103,242,.06)}.topic-multi-card:has(input:checked) .topic-check{background:#2367f2;color:white;border-color:#2367f2}.topic-multi-copy{display:flex;flex-direction:column;min-width:0;gap:2px}.topic-multi-copy b{font-size:11px;line-height:1.2}.topic-multi-copy small{font-size:8px;color:var(--muted)}.manual-ajax-list{max-height:560px;overflow:auto}.manual-loading{padding:28px;text-align:center;color:var(--muted);border:1px dashed #ccd6e4;border-radius:13px}.v18-info-box{line-height:1.55}
    .bank-question-cell{min-width:300px}.bank-image-tag{display:inline-flex;margin-top:6px;padding:4px 7px;border-radius:999px;background:#eaf3ff;color:#1764d8;font-weight:800}.bank-image-cell{min-width:96px}.bank-image-link{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:9px;font-weight:850}.bank-thumb{width:76px;height:52px;object-fit:cover;border-radius:9px;border:1px solid var(--line);background:#eef2f6}.bank-add-image{display:inline-flex;align-items:center;justify-content:center;padding:7px 9px;border-radius:9px;background:#edf4ff;color:#1764d8;font-size:10px;font-weight:850;white-space:nowrap}.bank-new-image-box{border:1px dashed #bfcce0;border-radius:16px;padding:15px;background:#f8fbff;display:grid;gap:10px}.bank-new-image-box>div:first-child{display:flex;flex-direction:column;gap:4px}.bank-new-image-box>div:first-child>b{font-size:14px}.bank-new-image-box>div:first-child>small{font-size:10px;color:var(--muted)}.bank-image-upload{border:1px solid #cfe0fb;background:white;border-radius:12px;padding:12px;cursor:pointer;text-align:center;color:#1764d8;font-weight:850}.bank-image-upload input{margin-top:8px}.bank-new-image-preview{max-width:430px;border:1px solid var(--line);border-radius:13px;overflow:hidden;background:white}.bank-new-image-preview img{display:block;width:100%;max-height:270px;object-fit:contain}.question-image-page{max-width:1120px}.question-image-success{background:#e7f8ef;color:#177d50;border:1px solid #c1e7d0;padding:11px 14px;border-radius:12px;margin:12px 0}.question-image-editor-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}.question-image-current{margin-top:14px}.question-image-current>img{display:block;width:100%;max-height:480px;object-fit:contain;border:1px solid var(--line);border-radius:15px;background:#eef2f7}.question-image-current>div:not(.question-image-placeholder){padding-top:9px;display:flex;flex-direction:column;gap:3px}.question-image-current small{color:var(--muted)}.question-image-current p{margin:4px 0;color:#57667c}.question-image-placeholder{min-height:280px;border:2px dashed #cbd5e3;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;color:#738197;background:#f8fafc}.question-image-placeholder>span{font-size:46px}.question-image-form{display:grid;gap:12px;margin-top:14px}.question-image-drop{border:2px dashed #b9c9df;border-radius:15px;background:#f8fbff;min-height:150px;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:5px;cursor:pointer}.question-image-drop>span{font-size:34px}.question-image-drop>small{color:var(--muted)}.question-image-drop input{margin-top:8px}.question-image-preview{border:1px solid var(--line);border-radius:13px;overflow:hidden}.question-image-preview img{display:block;width:100%;max-height:280px;object-fit:contain;background:#eef2f7}.question-image-remove{margin-top:12px}.manual-question-thumb{width:88px;height:65px;object-fit:cover;border-radius:9px;border:1px solid var(--line);flex:0 0 auto;margin-left:6px}.manual-image-badge{display:inline-flex;margin-left:6px;padding:2px 5px;background:#eaf3ff;color:#1764d8;border-radius:999px;font-size:8px!important}.exam-question-list-item{display:flex;gap:10px;align-items:flex-start;margin:9px 0}.exam-question-list-item>img{width:94px;height:65px;object-fit:cover;border-radius:9px;border:1px solid var(--line);flex:0 0 auto}
    .dashboard-v16{max-width:1240px}.dashboard-toast-success{position:sticky;top:82px;z-index:45;margin:0 auto 12px;max-width:520px;background:#e8f8ef;border:1px solid #bfe8cf;color:#167a4d;border-radius:13px;padding:11px 14px;text-align:center;font-weight:850;box-shadow:var(--shadow)}.dash-hero{background:linear-gradient(120deg,#193c7b,#2367f2 58%,#24a879 135%);color:white;border-radius:27px;padding:27px 29px;display:flex;align-items:center;justify-content:space-between;gap:20px;box-shadow:0 18px 42px rgba(35,103,242,.2)}.dash-hero h1{font-size:clamp(29px,5vw,45px);margin:5px 0 5px;letter-spacing:-1.2px}.dash-hero p{margin:0;color:rgba(255,255,255,.82)}.dash-hero-actions{display:flex;gap:8px;flex-wrap:wrap}.dash-primary-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin:14px 0}.dash-primary-actions>a{background:white;border:1px solid var(--line);border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:10px;color:var(--ink);box-shadow:0 5px 16px rgba(24,48,82,.05)}.dash-primary-actions>a>span{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#edf4ff;color:var(--primary);font-size:20px}.dash-primary-actions>a:nth-child(2)>span{background:#e9f9f2;color:#18855c}.dash-primary-actions>a:nth-child(3)>span{background:#f1edff;color:#7459df}.dash-primary-actions>a:nth-child(4)>span{background:#fff1e5;color:#d77929}.dash-primary-actions>a>div{display:flex;flex-direction:column;gap:2px}.dash-primary-actions b{font-size:13px}.dash-primary-actions small{font-size:10px}.dash-summary-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 16px}.dash-summary-card{background:white;border:1px solid var(--line);border-radius:17px;padding:13px 14px;display:grid;grid-template-columns:35px 1fr;align-items:center;box-shadow:0 5px 16px rgba(24,48,82,.045)}.dash-summary-card>span{grid-row:1/3;font-size:23px}.dash-summary-card>b{font-size:24px;line-height:1}.dash-summary-card>small{font-size:9px;text-transform:uppercase;letter-spacing:.4px}.dash-summary-card.blue b{color:#2367f2}.dash-summary-card.green b{color:#18855c}.dash-summary-card.purple b{color:#7459df}.dash-summary-card.orange b{color:#d77929}.dash-tabs{display:flex;gap:8px;padding:5px;background:#e9eef6;border-radius:15px;margin:0 0 16px}.dash-tab{flex:1;background:transparent!important;color:#65738a!important;box-shadow:none!important;border:0!important;border-radius:11px!important;padding:11px!important}.dash-tab.active{background:white!important;color:var(--primary)!important;box-shadow:0 3px 10px rgba(24,48,82,.08)!important}.dash-tab-panel{display:none}.dash-tab-panel.active{display:block}.dash-section-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin:0 0 13px}.dash-section-head h2{margin:4px 0 4px;font-size:25px}.dash-section-head p{margin:0;color:var(--muted);max-width:680px;font-size:12px;line-height:1.5}.dash-search{min-width:320px}.dash-school{background:white;border:1px solid var(--line);border-radius:21px;overflow:hidden;margin-bottom:13px;box-shadow:0 7px 20px rgba(24,48,82,.05)}.dash-school>summary{list-style:none;cursor:pointer;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;color:white}.dash-school>summary::-webkit-details-marker{display:none}.school-color-1>summary{background:linear-gradient(105deg,#2465dc,#4a8cff)}.school-color-2>summary{background:linear-gradient(105deg,#684fd2,#9477e9)}.school-color-3>summary{background:linear-gradient(105deg,#178b68,#35b887)}.school-color-4>summary{background:linear-gradient(105deg,#c66d27,#ee9c45)}.school-color-5>summary{background:linear-gradient(105deg,#30455f,#5a718e)}.dash-school-main{display:flex;align-items:center;gap:11px}.dash-school-icon{width:44px;height:44px;border-radius:13px;background:rgba(255,255,255,.15);display:grid;place-items:center;font-size:23px}.dash-school-main .eyebrow{color:rgba(255,255,255,.72)}.dash-school-main h2{margin:1px 0;font-size:20px}.dash-school-main p{margin:1px 0 0;font-size:10px;opacity:.8}.dash-school-content{padding:12px;background:#f8fafd}.dash-shift{margin:0 0 12px}.dash-shift:last-child{margin-bottom:0}.dash-shift-title{display:flex;align-items:center;gap:8px;padding:3px 2px 8px}.dash-shift-title h3{font-size:16px;margin:0}.dash-class-card{border:1px solid var(--line);background:white;border-radius:16px;overflow:hidden;margin-bottom:9px}.dash-class-card>summary{list-style:none;cursor:pointer;padding:11px 13px;display:flex;align-items:center;justify-content:space-between}.dash-class-card>summary::-webkit-details-marker{display:none}.dash-class-summary{display:flex;align-items:center;gap:9px}.dash-class-avatar{min-width:45px;height:45px;padding:0 7px;border-radius:12px;display:grid;place-items:center;background:#edf4ff;color:#2367f2;font-weight:950}.dash-class-summary h3{margin:0;font-size:18px}.dash-class-summary p{margin:2px 0 0;color:var(--muted);font-size:9px}.dash-trimester-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 10px 10px}.dash-trimester{border:1px solid var(--line);border-radius:14px;background:#fbfcfe;overflow:hidden;min-width:0}.dash-trimester.tri-0{grid-column:1/-1}.dash-trimester.tri-1{border-top:3px solid #2367f2}.dash-trimester.tri-2{border-top:3px solid #7459df}.dash-trimester.tri-3{border-top:3px solid #20ae68}.dash-trimester-head{display:flex;align-items:center;gap:7px;padding:9px 10px;border-bottom:1px solid var(--line);background:white}.dash-trimester-head>span{font-size:20px}.dash-trimester-head>div{display:flex;flex-direction:column}.dash-trimester-head b{font-size:11px}.dash-trimester-head small{font-size:8px}.dash-trimester-body{padding:7px;display:grid;gap:7px}.dash-exam-card{background:white;border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0;box-shadow:0 3px 10px rgba(24,48,82,.035)}.dash-exam-top{display:flex;align-items:center;justify-content:space-between}.dash-exam-top>div{display:flex;align-items:center;gap:5px}.dash-exam-top small{font-size:7px;font-weight:900;letter-spacing:.5px}.status-dot{width:7px;height:7px;border-radius:50%}.status-dot.is-open{background:#20ae68;box-shadow:0 0 0 3px rgba(32,174,104,.1)}.status-dot.is-closed{background:#9ba7b8}.dash-exam-id{font-size:8px;color:#9aa6b6}.dash-exam-card h4{margin:7px 0 2px;font-size:13px;line-height:1.25}.dash-exam-card>p{margin:0 0 7px;font-size:9px;color:var(--muted)}.dash-exam-numbers{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #edf1f6;border-bottom:1px solid #edf1f6;margin:7px 0}.dash-exam-numbers>span{padding:7px 2px;display:flex;flex-direction:column;align-items:center}.dash-exam-numbers>span+span{border-left:1px solid #edf1f6}.dash-exam-numbers b{font-size:15px}.dash-exam-numbers small{font-size:7px;text-transform:uppercase}.dash-exam-actions{display:grid;grid-template-columns:1fr 1fr auto auto;gap:4px}.dash-exam-actions form{margin:0}.dash-action{min-height:30px!important;padding:6px 7px!important;border-radius:8px!important;background:#f1f5fb!important;color:#43516a!important;border:1px solid #dfe6ef!important;box-shadow:none!important;font-size:9px!important;font-weight:850!important;width:100%!important}.dash-action.primary{background:#eaf2ff!important;color:#2367f2!important;border-color:#cfe0fb!important}.dash-action.link-action{width:31px!important}.dash-action.delete-action{width:31px!important;background:#ffeded!important;color:#c93636!important;border-color:#ffd3d3!important}.dash-action.copied{background:#e8f8ef!important;color:#18855c!important}.dash-no-exam{min-height:91px;border:1px dashed #dce4ef;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a1acbb}.dash-no-exam span{font-size:18px}.dash-no-exam small{font-size:8px}.dash-tools{margin-top:13px;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 15px}.dash-tools>div:first-child{display:flex;flex-direction:column;gap:2px}.dash-tools>div:last-child{display:flex;gap:6px;flex-wrap:wrap}.dash-tools b{font-size:12px}.dash-tools small{font-size:9px}.danger-soft{color:#b53232!important;background:#fff3f3!important;border-color:#ffd3d3!important}.dash-notes-top{display:grid;grid-template-columns:230px 1fr;gap:12px;margin-bottom:12px}.dash-general-average{background:linear-gradient(135deg,#153b79,#2367f2);color:white;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:150px;box-shadow:0 10px 28px rgba(35,103,242,.17)}.dash-general-average small{color:rgba(255,255,255,.72);font-size:9px;font-weight:900;letter-spacing:1px}.dash-general-average b{font-size:58px;line-height:.95;margin:6px 0}.dash-general-average span{font-size:10px;opacity:.75}.dash-rco-callout{margin:0;display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center}.rco-callout-icon{width:48px;height:48px;border-radius:14px;background:#e9f9f2;color:#18855c;display:grid;place-items:center;font-size:25px}.dash-rco-callout h3{margin:2px 0 3px}.dash-rco-callout p{margin:0;color:var(--muted);font-size:11px}.dash-average-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dash-average-panel{margin:0}.dash-average-panel.wide{grid-column:1/-1}.dash-average-title{display:flex;align-items:center;gap:9px;margin-bottom:10px}.dash-average-title>span{width:38px;height:38px;border-radius:11px;background:#f1f5fb;display:grid;place-items:center}.dash-average-title>div{display:flex;flex-direction:column}.dash-average-title b{font-size:13px}.dash-average-title small{font-size:9px}.dash-mean-list{display:grid;gap:6px}.dash-mean-list.scroll{grid-template-columns:repeat(2,1fr);max-height:330px;overflow:auto}.dash-mean-card{display:grid;grid-template-columns:32px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:#f8fafd;border:1px solid var(--line)}.dash-mean-icon{font-size:17px}.dash-mean-copy{display:flex;flex-direction:column;min-width:0}.dash-mean-copy b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dash-mean-copy small{font-size:8px}.dash-mean-card strong{font-size:17px}.dash-note-good strong{color:#1764d8}.dash-note-low strong{color:#c93636}.dash-students-panel{margin-top:12px!important}.delete-exam-button{background:#c93636!important;color:white!important;box-shadow:none!important}.copy-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,25px);opacity:0;pointer-events:none;background:#173c31;color:white;padding:11px 16px;border-radius:999px;font-size:12px;font-weight:850;box-shadow:var(--shadow2);transition:.2s;z-index:9999}.copy-toast.show{opacity:1;transform:translate(-50%,0)}
    .quick-icon.teal{background:#e6fbf6;color:#11977d}.rco-quick-card{border-color:#ccefe7}.rco-page{max-width:1320px}.rco-hero{background:linear-gradient(125deg,#13233d 0%,#1f5fc9 55%,#20a77a 125%);border-radius:28px;padding:28px 30px;color:white;display:flex;justify-content:space-between;align-items:center;gap:22px;box-shadow:var(--shadow2);position:relative;overflow:hidden}.rco-hero:after{content:"";position:absolute;width:260px;height:260px;border-radius:50%;right:-90px;top:-110px;background:rgba(255,255,255,.08)}.rco-hero h1{font-size:clamp(30px,5vw,48px);margin:5px 0 7px;letter-spacing:-1.3px}.rco-hero p{margin:0;opacity:.86;max-width:700px}.rco-hero-actions{display:flex;gap:8px;position:relative;z-index:2}.rco-help-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.rco-help-strip>div{background:white;border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:grid;grid-template-columns:36px 1fr;column-gap:8px;align-items:center;box-shadow:0 5px 16px rgba(24,48,82,.04)}.rco-help-strip>div>span{grid-row:1/3;font-size:24px}.rco-help-strip b{font-size:13px}.rco-help-strip small{font-size:10px;color:var(--muted)}.rco-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 18px}.rco-toolbar h2{margin:3px 0 0}.rco-search{min-width:330px}.rco-school-card{background:white;border:1px solid var(--line);border-radius:24px;overflow:hidden;margin:0 0 18px;box-shadow:var(--shadow)}.rco-school-card>summary{list-style:none;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:white}.rco-school-card>summary::-webkit-details-marker{display:none}.school-theme-1>summary{background:linear-gradient(110deg,#2367f2,#4a8cff)}.school-theme-2>summary{background:linear-gradient(110deg,#7459df,#9c80ef)}.school-theme-3>summary{background:linear-gradient(110deg,#159a72,#36bd8e)}.school-theme-4>summary{background:linear-gradient(110deg,#d9782d,#f0a24d)}.school-theme-5>summary{background:linear-gradient(110deg,#344a67,#59718f)}.rco-school-main{display:flex;align-items:center;gap:13px;min-width:0}.rco-school-main .eyebrow{color:rgba(255,255,255,.78)}.rco-school-main h2{margin:2px 0;font-size:23px}.rco-school-main p{margin:0;font-size:11px;opacity:.82}.rco-school-icon{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:rgba(255,255,255,.16);font-size:25px}.rco-school-content{padding:17px;background:#f8fafd}.rco-shift-block{margin-bottom:16px}.rco-shift-block:last-child{margin-bottom:0}.rco-shift-head{display:flex;align-items:center;gap:9px;padding:2px 2px 10px}.rco-shift-icon{width:38px;height:38px;border-radius:11px;background:white;border:1px solid var(--line);display:grid;place-items:center}.rco-shift-head h3{margin:1px 0;font-size:18px}.rco-class-card{background:white;border:1px solid var(--line);border-radius:19px;overflow:hidden;margin:0 0 12px}.rco-class-card>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff}.rco-class-card>summary::-webkit-details-marker{display:none}.rco-class-left{display:flex;align-items:center;gap:11px}.rco-class-badge{min-width:48px;height:48px;padding:0 8px;border-radius:14px;background:linear-gradient(135deg,#edf4ff,#e9f9f2);color:var(--primary);display:grid;place-items:center;font-weight:950}.rco-class-left h3{margin:0;font-size:20px}.rco-class-left p{margin:2px 0 0;font-size:10px;color:var(--muted)}.rco-class-content{padding:0 13px 13px}.rco-trimester{border:1px solid var(--line);border-radius:17px;margin:0 0 12px;overflow:hidden;background:white}.rco-trimester:last-child{margin-bottom:0}.rco-trimester.tri-1{border-top:4px solid #2367f2}.rco-trimester.tri-2{border-top:4px solid #7459df}.rco-trimester.tri-3{border-top:4px solid #20ae68}.rco-tri-head{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fbfcfe}.rco-tri-head>div:first-child{display:flex;align-items:center;gap:9px}.rco-tri-number{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-size:23px;font-weight:900}.tri-1 .rco-tri-number{background:#eaf3ff;color:#2367f2}.tri-2 .rco-tri-number{background:#f1edff;color:#7459df}.tri-3 .rco-tri-number{background:#eaf9f1;color:#159a72}.rco-tri-head h4{margin:0;font-size:16px}.rco-tri-head p{margin:2px 0 0;font-size:10px;color:var(--muted)}.rco-tri-head small{font-size:8px;color:var(--muted);font-weight:900;letter-spacing:1px}.rco-main-copy{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.rco-copy-primary{background:#1c73dd!important}.rco-exam-copy-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}.rco-exam-copy-row>span{font-size:10px;color:var(--muted);font-weight:800;margin-right:3px}.rco-copy-chip{width:auto!important;min-height:0!important;padding:6px 9px!important;background:#f1f5fb!important;color:#42516a!important;box-shadow:none!important;border:1px solid #dce4ef!important;border-radius:999px!important;font-size:10px!important}.rco-copy-chip:hover{background:#e9f1ff!important;color:#2367f2!important}.rco-copy-chip.copied,.rco-main-copy .copied{background:#e7f8ef!important;color:#168252!important;border-color:#bce6cf!important}.copy-source{position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;opacity:0!important}.rco-table-wrap{overflow:auto;max-height:560px}.rco-table{width:100%;border-collapse:separate;border-spacing:0;min-width:660px}.rco-table th{position:sticky;top:0;z-index:2;background:#f5f8fc;color:#536176;font-size:10px;text-transform:uppercase;letter-spacing:.4px;padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}.rco-table th span{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;text-transform:none;color:var(--ink);font-size:11px}.rco-table th small{display:block;font-size:8px;margin-top:2px}.rco-table td{padding:9px 10px;border-bottom:1px solid #edf1f6;background:white;text-align:center}.rco-table tbody tr:hover td{background:#fafcff}.rco-table td.rco-student-name{text-align:left;font-weight:800;white-space:nowrap;position:sticky;left:42px;z-index:1}.rco-table th:nth-child(2){position:sticky;left:42px;z-index:4}.rco-student-number{width:42px;color:#99a4b5;font-size:11px;position:sticky;left:0;z-index:2}.rco-table th:first-child{left:0;z-index:5}.rco-note{display:inline-flex;min-width:48px;justify-content:center;padding:6px 8px;border-radius:10px;font-weight:950;font-size:14px}.rco-note-blue{background:#eaf3ff;color:#1764d8}.rco-note-red{background:#ffeded;color:#c93636}.rco-average-head{background:#edf7f3!important;color:#177858!important}.rco-average-cell{background:#fbfefa!important}.rco-average-note{min-width:54px}.rco-missing{color:#b6bfcc}.rco-no-data{font-size:10px;color:#9aa5b5;background:#f1f4f8;border-radius:999px;padding:6px 9px}.rco-empty-tri{opacity:.78}.copy-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,25px);opacity:0;pointer-events:none;background:#173c31;color:white;padding:11px 16px;border-radius:999px;font-size:12px;font-weight:850;box-shadow:var(--shadow2);transition:.2s;z-index:9999}.copy-toast.show{opacity:1;transform:translate(-50%,0)}
    .student-grades-panel{margin:0 0 28px;padding:0;overflow:hidden}.student-grades-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 20px 14px}.student-grades-head h2{margin:4px 0 3px;font-size:25px}.student-grades-head p{margin:0;color:var(--muted);font-size:13px}.student-grade-search{display:flex;align-items:center;gap:8px;min-width:300px;background:#f7f9fc;border:1px solid var(--line);border-radius:12px;padding:0 10px}.student-grade-search input{border:0;background:transparent;box-shadow:none;padding:11px 4px}.student-grade-legend{display:flex;align-items:center;gap:15px;padding:10px 20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fbfcfe;font-size:11px;color:var(--muted)}.student-grade-legend span{display:flex;align-items:center;gap:5px}.student-grade-legend a{margin-left:auto;font-weight:800}.legend-note-blue,.legend-note-red{display:inline-block;width:9px;height:9px;border-radius:50%}.legend-note-blue{background:#2367f2}.legend-note-red{background:#d84848}.student-grade-list{max-height:520px;overflow:auto}.student-grade-row{display:grid;grid-template-columns:48px 1fr 82px;gap:12px;align-items:center;padding:13px 20px;border-bottom:1px solid var(--line);color:var(--ink);transition:.15s}.student-grade-row:hover{background:#f7faff}.student-grade-avatar{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#edf4ff;color:var(--primary);font-size:12px;font-weight:900}.student-grade-info{min-width:0;display:flex;flex-direction:column;gap:2px}.student-grade-info>b{font-size:15px}.student-grade-info small{font-size:11px;color:#68758c}.student-grade-info small strong{color:var(--ink)}.student-grade-info em{font-style:normal;font-size:11px;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.student-note{height:58px;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.student-note small{font-size:8px;font-weight:900;letter-spacing:1px;color:inherit}.student-note b{font-size:25px;margin:3px 0}.student-note i{font-style:normal;font-size:9px;font-weight:800;opacity:.75}.student-note-blue{background:#eaf3ff;color:#1764d8}.student-note-red{background:#ffeded;color:#c93636}.student-grade-empty{padding:34px 20px;text-align:center;display:flex;flex-direction:column;gap:5px}.student-grade-empty>span{font-size:34px}.result-student-cell{display:flex;align-items:center;gap:7px;white-space:nowrap}.class-table-chip{display:inline-flex;padding:6px 9px;border-radius:999px;background:#f1f4f8;color:#42516a;font-weight:850;font-size:12px}.table-note{display:inline-flex;align-items:baseline;gap:2px;min-width:72px;justify-content:center;border-radius:10px;padding:7px 9px;font-size:18px;font-weight:950}.table-note small{font-size:9px;color:inherit}.table-note-blue{background:#eaf3ff;color:#1764d8}.table-note-red{background:#ffeded;color:#c93636}
    .dashboard-means{display:grid;grid-template-columns:.8fr 1.2fr;gap:16px;margin:18px 0 28px}.mean-panel{margin:0}.mean-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.mean-panel-head h2{margin:3px 0}.mean-scale{font-size:11px;font-weight:900;color:var(--muted);background:#f1f4f8;border-radius:999px;padding:6px 9px}.mean-list{display:grid;gap:8px}.mean-scroll{max-height:330px;overflow:auto;padding-right:4px}.mean-row{display:flex;justify-content:space-between;gap:13px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fbfcfe}.mean-row strong{font-size:23px;min-width:52px;text-align:right}.mean-label{display:flex;flex-direction:column;gap:2px}.mean-label small{font-size:10px;color:var(--muted)}.mean-good strong{color:#1764d8}.mean-low strong{color:#c93636}.muted{color:var(--muted)}.result-shift-title{display:flex;align-items:center}.shift-average{margin-left:auto;text-align:right;display:flex;flex-direction:column}.shift-average small{font-size:9px;color:var(--muted)}.shift-average b{font-size:21px;color:var(--primary)}.cleanup-bank-card{border-color:#ffd3d3;background:linear-gradient(135deg,#fff,#fff8f8)}.cleanup-bank-main{display:flex;justify-content:space-between;gap:18px;align-items:center}.cleanup-bank-main h2{margin:4px 0 7px}.danger-link{background:#c93636!important;color:white!important}.share-exam-card{display:grid;grid-template-columns:1fr 250px;gap:24px;align-items:center}.share-exam-copy h2{margin:4px 0 13px}.short-link-box{display:grid;grid-template-columns:1fr auto;gap:8px}.short-link-box button{white-space:nowrap}.qr-box{background:#f8fbff;border:1px solid var(--line);border-radius:18px;padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px}.qr-box img{max-width:100%;height:auto;border-radius:10px;background:white}.qr-box small{font-size:10px;color:var(--muted);line-height:1.35}
    .count-picker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 14px}.count-picker>span{font-size:12px;font-weight:850;color:var(--muted);margin-right:3px}.count-chip{width:auto!important;min-width:42px!important;padding:9px 12px!important;border-radius:999px!important;background:#f4f7fb!important;color:#40506a!important;border:1px solid var(--line)!important;box-shadow:none!important;font-size:13px!important}.count-chip.active,.count-chip:hover{background:#eaf2ff!important;color:var(--primary)!important;border-color:#a9c7f7!important;transform:none!important}
    @media(max-width:900px){.batch-class-grid{grid-template-columns:repeat(5,1fr)}.batch-created-grid{grid-template-columns:1fr}.batch-copy-all{grid-template-columns:1fr}.batch-result-hero{align-items:flex-start;flex-direction:column}.topic-multi-grid{grid-template-columns:1fr 1fr}.question-image-editor-grid{grid-template-columns:1fr}.dash-primary-actions{grid-template-columns:1fr 1fr}.dash-trimester-grid{grid-template-columns:1fr}.dash-notes-top{grid-template-columns:1fr}.dash-average-grid{grid-template-columns:1fr}.dash-average-panel.wide{grid-column:auto}.dash-mean-list.scroll{grid-template-columns:1fr}.dash-hero{align-items:flex-start;flex-direction:column}.rco-help-strip{grid-template-columns:1fr 1fr}.rco-hero{align-items:flex-start;flex-direction:column}.rco-toolbar{align-items:flex-start;flex-direction:column}.rco-search{min-width:0;width:100%}.dashboard-means{grid-template-columns:1fr}.share-exam-card{grid-template-columns:1fr}.qr-box{max-width:300px}.quick-actions{grid-template-columns:1fr 1fr}.navlinks a span{display:none}.navlinks a{font-size:18px;padding:9px}.navlinks .logout-link{font-size:12px}.welcome-mark{width:105px;height:105px}.exam-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.dash-section-head{align-items:flex-start;flex-direction:column}.dash-search{min-width:0;width:100%}.dash-summary-strip{grid-template-columns:1fr 1fr}.dash-rco-callout{grid-template-columns:45px 1fr}.dash-rco-callout>.btn{grid-column:1/-1}.dash-tools{align-items:flex-start;flex-direction:column}.dash-exam-actions{grid-template-columns:1fr 1fr auto auto}.rco-school-content{padding:10px}.rco-tri-head{align-items:flex-start;flex-direction:column}.rco-main-copy{justify-content:flex-start}.rco-hero-actions{flex-wrap:wrap}.rco-table td.rco-student-name,.rco-table th:nth-child(2){position:static}.rco-student-number,.rco-table th:first-child{position:static}.rco-help-strip{grid-template-columns:1fr 1fr}.student-grades-head{flex-direction:column;align-items:stretch}.student-grade-search{min-width:0;width:100%}.student-grade-row{grid-template-columns:40px 1fr 70px;padding:12px 13px}.student-grade-avatar{width:36px;height:36px}.student-note{height:54px}.student-note b{font-size:22px}.student-grade-legend{flex-wrap:wrap;padding:9px 13px}.student-grade-legend a{width:100%;margin-left:0}.cleanup-bank-main{flex-direction:column;align-items:flex-start}.short-link-box{grid-template-columns:1fr}.topbar{height:64px;padding:0 13px}.brand-mark{width:36px;height:36px}.navlinks{gap:0}.navlinks a{padding:8px}.navlinks .logout-link{display:none}main{padding:0 12px;margin-top:16px}.hero,.results-header,.welcome-panel{align-items:flex-start;flex-direction:column}.v7-welcome{padding:25px;min-height:auto}.welcome-mark{display:none}.quick-actions{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.span{grid-column:auto}.section-heading.split{align-items:flex-start;flex-direction:column}.search-box{min-width:0;width:100%}.student-id-card{grid-template-columns:1fr}.card-heading-row{align-items:flex-start;flex-direction:column}.school-average{gap:7px}.school-average b{font-size:18px}.result-exam-row{align-items:flex-start}.result-numbers{gap:9px}.mode-grid{grid-template-columns:1fr}}
    @media(max-width:440px){.dash-primary-actions{grid-template-columns:1fr 1fr}.dash-primary-actions>a{padding:10px}.dash-summary-card{padding:10px}.dash-summary-card>b{font-size:20px}.dash-tabs{position:sticky;top:68px;z-index:30}.dash-school-content{padding:8px}.dash-trimester-grid{padding:0 7px 7px}.dash-hero{padding:22px 18px}.dash-hero-actions{width:100%}.dash-hero-actions .btn{flex:1}.dash-action{font-size:8px!important}.rco-help-strip{grid-template-columns:1fr}.rco-hero{padding:22px 18px}.rco-school-card>summary{padding:16px}.rco-school-main h2{font-size:18px}.rco-exam-copy-row{align-items:flex-start}.rco-main-copy .btn{width:100%}.reset-card{padding:22px 15px}.reset-summary{grid-template-columns:1fr}.result-student-card{padding:22px 15px}.result-details-grid{grid-template-columns:1fr}.student-grade-number{letter-spacing:-2px}.brand>span:last-child{display:none}.quick-actions{grid-template-columns:1fr}.quick-card{padding:13px}.v7-welcome h1{font-size:31px}.v7-welcome p{font-size:14px}.cards{grid-template-columns:1fr 1fr}.dashboard-stats .stat{min-height:116px;padding:14px}.dashboard-stats .stat b{font-size:27px}.school-group>summary,.school-result-group>summary{padding:13px}.school-icon{width:43px;height:43px}.school-content{padding:0 11px 11px}.result-numbers span:first-child{display:none}.exam-grid{padding:0 9px 9px}}
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
