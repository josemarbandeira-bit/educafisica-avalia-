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
      if (path.startsWith('/p/')) return publicExam(request, env, path.split('/')[2]);

      if (!(await isTeacher(request, env))) return redirect('/login');

      if (path === '/') return dashboard(env);
      if (path === '/banco') return method === 'POST' ? addQuestion(request, env) : bank(env);
      if (path === '/banco/importar' && method === 'POST') return importQuestions(request, env);
      if (path === '/provas/nova') return method === 'POST' ? createExam(request, env) : newExam(env);
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
      ROUND(AVG(su.score),2) AS avg_score,
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
  const avg = await env.DB.prepare('SELECT ROUND(AVG(score),2) AS a FROM submissions').first();
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
        </section>

        <div class="cards dashboard-stats v7-stats">
          <div class="card stat stat-blue"><span class="stat-icon">❓</span><b>${q.c}</b><span>Questões ativas</span></div>
          <div class="card stat stat-purple"><span class="stat-icon">📝</span><b>${exams.results.length}</b><span>Provas criadas</span></div>
          <div class="card stat stat-green"><span class="stat-icon">✓</span><b>${s.c}</b><span>Respostas</span></div>
          <div class="card stat stat-orange"><span class="stat-icon">📊</span><b>${avg.a ?? '—'}</b><span>Média geral</span></div>
        </div>

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
      ROUND(AVG(su.score),2) AS avg_score,
      COALESCE(SUM(su.score),0) AS score_sum
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
    if (!groups.has(school)) groups.set(school,{submissions:0,scoreSum:0,exams:0,shifts:new Map()});
    const sg=groups.get(school);
    sg.submissions += Number(r.submissions||0);
    sg.scoreSum += Number(r.score_sum||0);
    sg.exams += 1;
    if (!sg.shifts.has(shift)) sg.shifts.set(shift,new Map());
    if (!sg.shifts.get(shift).has(cls)) sg.shifts.get(shift).set(cls,[]);
    sg.shifts.get(shift).get(cls).push(r);
  }

  const blocks=[...groups.entries()].map(([schoolName,sg])=>{
    const schoolAvg=sg.submissions ? (sg.scoreSum/sg.submissions).toFixed(2) : '—';
    const shiftBlocks=[...sg.shifts.entries()].map(([shift,classes])=>{
      const classCards=[...classes.entries()].map(([cls,exams])=>{
        const total=exams.reduce((n,e)=>n+Number(e.submissions||0),0);
        const sum=exams.reduce((n,e)=>n+Number(e.score_sum||0),0);
        const classAvg=total ? (sum/total).toFixed(2) : '—';
        const examRows=exams.map(e=>`
          <a class="result-exam-row" href="/provas/${e.id}/resultados">
            <div><span class="mini-chip">${e.trimester ? e.trimester+'º TRI' : 'PROVA'}</span><b>${esc(e.title)}</b><small>${esc(e.grade||'')}</small></div>
            <div class="result-numbers"><span><b>${e.submissions||0}</b><small>respostas</small></span><span><b>${e.avg_score ?? '—'}</b><small>média</small></span><i>›</i></div>
          </a>`).join('');
        return `<section class="result-class-card"><div class="result-class-head"><div><span class="class-avatar">${esc(cls).slice(0,3)}</span><div><b>Turma ${esc(cls)}</b><small>${esc(shift)} · ${exams.length} prova(s)</small></div></div><div class="class-average"><small>Média</small><b>${classAvg}</b></div></div>${examRows}</section>`;
      }).join('');
      return `<div class="result-shift"><div class="shift-title"><span class="shift-icon">${shift==='Noturno'?'🌙':shift==='Tarde'?'☀️':'🌤️'}</span><div><span class="eyebrow">TURNO</span><h3>${esc(shift)}</h3></div></div>${classCards}</div>`;
    }).join('');
    return `<details class="school-result-group" open><summary><div class="school-summary-main"><div class="school-icon v7"><span>🏫</span></div><div><span class="eyebrow blue">ESCOLA</span><h2>${esc(schoolName)}</h2><p>${sg.exams} prova(s) · ${sg.submissions} resposta(s)</p></div></div><div class="school-average"><small>Média geral</small><b>${schoolAvg}</b><span class="summary-chevron">›</span></div></summary><div class="school-content">${shiftBlocks}</div></details>`;
  }).join('');

  return page('Resultados gerais', nav()+`
    <main>
      <section class="results-header v7-results-hero">
        <div><span class="eyebrow white">RESULTADOS PEDAGÓGICOS</span><h1>Resultados por escola</h1><p>Abra a escola, o turno e a turma para acompanhar cada prova sem misturar os dados.</p></div>
        <a class="btn light" href="/">← Voltar ao painel</a>
      </section>
      <div class="section-heading"><span class="eyebrow blue">VISÃO ORGANIZADA</span><h2>Escola → turno → turma → prova</h2><p>O sorteio das questões não altera a organização dos resultados.</p></div>
      <div class="school-list">${blocks || '<div class="card empty-state"><h2>Ainda não há resultados</h2><p>Os resultados aparecerão aqui quando os alunos enviarem as provas.</p></div>'}</div>
    </main>`);
}

async function bank(env) {
  const qs = await env.DB.prepare(`
    SELECT *
    FROM questions
    WHERE active=1
    ORDER BY id DESC
  `).all();

  const sources = await env.DB.prepare(`
    SELECT name
    FROM question_sources
    WHERE active=1
    ORDER BY name
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
    SELECT name
    FROM question_sources
    WHERE active=1
    ORDER BY name
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

  const sourceOptions = sources.results.map(s =>
    `<option value="${attr(s.name)}">${esc(s.name)}</option>`
  ).join('');

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
                <input name="question_count" type="number" min="1" max="50" value="10">
              </label>
            </div>

            <div class="info-box">
              O sistema usa o <b>ano/série</b> e o <b>trimestre</b> escolhidos para localizar as questões correspondentes.
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

  if (mode === 'manual') {
    ids = f.getAll('question_ids').map(Number).filter(Boolean);

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
    const count = Math.max(1, Math.min(50, Number(f.get('question_count') || 10)));

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

    binds.push(count);

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

  const token = randomToken();

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

  const link = `${origin}/p/${e.token}`;
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
          <div class="card stat"><b>${qs.results.length}</b><span>Questões</span></div>
          <div class="card stat"><b>${e.active ? 'Aberta' : 'Encerrada'}</b><span>Status</span></div>
        </div>

        <div class="card">
          <h2>Link para os alunos</h2>
          <input id="link" value="${attr(link)}" readonly>
          <button onclick="navigator.clipboard.writeText(document.getElementById('link').value);this.textContent='Copiado!';" style="margin-top:10px">Copiar link</button>
          <p><small>Envie pelo Classroom ou WhatsApp.</small></p>
        </div>

        <div class="card actions">
          <a class="btn" href="/provas/${id}/resultados">Notas e gráficos</a>
          <form method="post" action="/provas/${id}/toggle">
            <button class="secondary">${e.active ? 'Encerrar prova' : 'Reabrir prova'}</button>
          </form>
          <a class="btn secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a>
        </div>

        <div class="card">
          <h2>Questões</h2>
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

async function publicExam(request, env, token) {
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

  const qs = await env.DB.prepare(`
    SELECT q.*,eq.position
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    WHERE eq.exam_id=?
    ORDER BY eq.position
  `).bind(e.id).all();

  if (request.method === 'GET') return page(e.title, studentForm(e, qs.results));

  const f = await request.formData();
  const name = String(f.get('student_name') || '').trim();
  if (!name) return page(e.title, studentForm(e, qs.results, 'Digite seu nome.'), 400);

  let correct = 0;
  const answers = qs.results.map(q => {
    const a = String(f.get(`q_${q.id}`) || '');
    const ok = a === q.correct ? 1 : 0;
    correct += ok;
    return { q: q.id, a, ok };
  });

  const percent = qs.results.length ? Math.round((correct / qs.results.length) * 1000) / 10 : 0;
  const score = Math.round((percent / 100) * Number(e.total_points) * 100) / 100;
  const duration = Math.max(0, Number(f.get('duration_seconds') || 0) || 0);
  const fixedClass = e.linked_class_name || e.class_name || '';

  const r = await env.DB.prepare(`
    INSERT INTO submissions
      (exam_id,student_name,student_class,score,percent,duration_seconds)
    VALUES (?,?,?,?,?,?)
  `).bind(
    e.id,
    name,
    fixedClass,
    score,
    percent,
    duration
  ).run();

  const sid = r.meta.last_row_id;

  if (answers.length) {
    await env.DB.batch(
      answers.map(x =>
        env.DB.prepare(`
          INSERT INTO answers
            (submission_id,question_id,answer,is_correct)
          VALUES (?,?,?,?)
        `).bind(sid, x.q, x.a, x.ok)
      )
    );
  }

  return page(
    'Resultado',
    `
      <div class="login result-card">
        <div class="success">✓</div>
        <h1>Prova enviada!</h1>
        <p>${esc(name)}, sua resposta foi registrada em <b>${esc(fixedClass)}</b>.</p>
        <div class="grade">
          <small>Sua nota</small>
          <b>${score}</b>
          <span>${percent}% de acertos</span>
        </div>
        <p><b>${correct}/${qs.results.length}</b> questões corretas</p>
        <p><small>Tempo: ${formatDuration(duration)}</small></p>
      </div>
    `
  );
}

function studentForm(e, qs, error = '') {
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

      <form method="post" id="examForm">
        <div class="card student-id-card">
          <label>
            Nome completo
            <input name="student_name" autocomplete="name" required placeholder="Digite seu nome completo">
          </label>
          <div class="fixed-class">
            <span>Turma da prova</span>
            <b>${esc(e.linked_class_name || e.class_name || '')}</b>
            <small>A turma é definida pelo professor e não pode ser alterada.</small>
          </div>
        </div>

        ${qs.map(q => `
          <section class="card question-card">
            <div class="qnum">Questão ${q.position}</div>
            <h2>${esc(q.statement)}</h2>
            ${['A','B','C','D'].map(x => `
              <label class="answer">
                <input type="radio" name="q_${q.id}" value="${x}" required>
                <span><b>${x}</b> ${esc(q['option_' + x.toLowerCase()])}</span>
              </label>
            `).join('')}
          </section>
        `).join('')}

        <input type="hidden" name="duration_seconds" id="duration">
        <button class="big">Enviar prova</button>
      </form>
    </main>
    <script>
      const started=Date.now();
      document.getElementById('examForm').addEventListener('submit',()=>{
        document.getElementById('duration').value=Math.round((Date.now()-started)/1000);
      });
    </script>
  `;
}

async function examResults(env, id) {
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
    SELECT *
    FROM submissions
    WHERE exam_id=?
    ORDER BY student_name COLLATE NOCASE
  `).bind(id).all();

  const st = await env.DB.prepare(`
    SELECT
      COUNT(*) AS n,
      ROUND(AVG(score),2) AS avg_score,
      ROUND(MAX(score),2) AS max_score,
      ROUND(MIN(score),2) AS min_score
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

  const rows = subs.results.map((s, index) => `
    <tr>
      <td><span class="student-number">${index + 1}</span> ${esc(s.student_name)}</td>
      <td>${esc(e.linked_class_name || e.class_name || s.student_class || '')}</td>
      <td><b>${s.score}</b></td>
      <td>${s.percent}%</td>
      <td>${formatDuration(s.duration_seconds)}</td>
    </tr>
  `).join('');

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
          <div class="card stat stat-purple"><span class="stat-icon">📊</span><b>${st.avg_score ?? '—'}</b><span>Média da turma</span></div>
          <div class="card stat stat-green"><span class="stat-icon">🏆</span><b>${st.max_score ?? '—'}</b><span>Maior nota</span></div>
          <div class="card stat stat-orange"><span class="stat-icon">📍</span><b>${st.min_score ?? '—'}</b><span>Menor nota</span></div>
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
                <tr><th>Aluno</th><th>Turma</th><th>Nota</th><th>Acertos</th><th>Tempo</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="5">Ainda não há respostas.</td></tr>'}</tbody>
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
    .quick-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0 18px}.quick-card{background:white;border:1px solid var(--line);border-radius:17px;padding:15px;display:flex;align-items:center;gap:11px;color:var(--ink);box-shadow:0 6px 18px rgba(24,48,82,.05);transition:.15s}.quick-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.quick-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex:none}.quick-icon.blue{background:#e9f1ff;color:var(--primary)}.quick-icon.purple{background:#f0ecff;color:var(--purple)}.quick-icon.green{background:#e7f8ef;color:var(--green)}.quick-icon.orange{background:#fff2e6;color:var(--orange)}.quick-card>div{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.quick-card b{font-size:14px}.quick-card small{font-size:11px}.quick-card i{font-style:normal;font-size:22px;color:#a2aec0}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:19px;margin-bottom:15px;box-shadow:0 7px 22px rgba(24,48,82,.055)}.stat{position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:126px;justify-content:flex-end}.stat:after{content:"";position:absolute;width:95px;height:95px;border-radius:50%;right:-30px;top:-35px;opacity:.07;background:currentColor}.stat b{font-size:31px;line-height:1;margin-top:10px}.stat>span:last-child{color:var(--muted);font-size:12px;margin-top:4px}.stat-icon{font-size:20px}.stat-blue{color:var(--primary)}.stat-purple{color:var(--purple)}.stat-green{color:var(--green)}.stat-orange{color:var(--orange)}
    .section-heading{margin:28px 2px 14px}.section-heading.split{display:flex;justify-content:space-between;gap:14px;align-items:end}.section-heading h2{margin:4px 0;font-size:25px}.section-heading p{margin:0;color:var(--muted);font-size:13px}.search-box{min-width:300px;background:white;border:1px solid var(--line);border-radius:12px;display:flex;align-items:center;gap:7px;padding:0 11px}.search-box span{font-size:20px;color:#8996aa}.search-box input{border:0;box-shadow:none;padding:11px 4px}
    .school-list{display:grid;gap:14px}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}.school-group,.school-result-group{background:white;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}.school-group>summary,.school-result-group>summary{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px;cursor:pointer;background:linear-gradient(135deg,#fff,#f8fbff)}.school-summary-main{display:flex;align-items:center;gap:13px;min-width:0}.school-icon{width:50px;height:50px;border-radius:14px;background:#eaf2ff;display:grid;place-items:center;font-size:23px;flex:none}.school-icon.v7{position:relative}.school-icon.v7 small{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;background:var(--navy);color:white;display:grid;place-items:center;font-size:8px}.school-group h2,.school-result-group h2{margin:3px 0 4px;font-size:17px}.school-group p,.school-result-group p{margin:0;color:var(--muted);font-size:12px}.summary-chevron{font-size:26px;color:#8ba0bc;transition:.2s}details[open]>summary .summary-chevron{transform:rotate(90deg)}.school-content{padding:0 17px 17px}.shift-block,.result-shift{border-top:1px solid var(--line);padding-top:15px;margin-top:2px}.shift-title{display:flex;align-items:center;gap:9px;margin-bottom:10px}.shift-title h3{margin:1px 0 0;font-size:14px}.shift-icon{width:34px;height:34px;border-radius:10px;background:#f2f6fc;display:grid;place-items:center}
    .class-group{border:1px solid var(--line);border-radius:14px;margin:9px 0;background:#fbfcfe;overflow:hidden}.class-group>summary{cursor:pointer;padding:12px 13px;display:flex;align-items:center;gap:10px}.class-group>summary>span:nth-child(2){display:flex;flex-direction:column;gap:2px;flex:1}.class-avatar{min-width:38px;height:38px;padding:0 7px;border-radius:10px;background:#e9f1ff;color:var(--primary);display:grid;place-items:center;font-weight:900;font-size:12px}.exam-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 12px 12px}.exam-card{display:block;border:1px solid var(--line);border-radius:13px;padding:14px;background:white;color:var(--ink);transition:.15s}.exam-card:hover{transform:translateY(-1px);border-color:#bfd2f8;box-shadow:0 9px 20px rgba(35,103,242,.08)}.exam-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.exam-card h4{margin:6px 0 10px;font-size:15px;line-height:1.35}.mini-chip{display:inline-flex;background:#edf4ff;color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.6px;padding:4px 6px;border-radius:6px}.status-pill{white-space:nowrap;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850}.status-pill.open{background:#e8f8ef;color:#16814a}.status-pill.closed{background:#eef1f5;color:#667386}.exam-metrics{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:11px}.exam-metrics b{color:var(--ink)}.card-arrow{border-top:1px solid var(--line);margin-top:11px;padding-top:9px;color:var(--primary);font-size:11px;font-weight:800}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.span{grid-column:1/-1}label{display:flex;flex-direction:column;gap:7px;font-weight:750;font-size:13px}input,select,textarea{width:100%;padding:12px;border:1px solid #cfd8e6;border-radius:11px;font:inherit;background:white;outline:none}input:focus,select:focus,textarea:focus{border-color:#7aa9ff;box-shadow:0 0 0 3px rgba(35,103,242,.1)}textarea{min-height:95px}.question-list{display:grid;gap:9px}.pick,.answer{display:flex;flex-direction:row;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:12px;font-weight:500;background:#fff}.pick input,.answer input{width:auto;margin-top:4px;margin-right:10px}.answer:hover{border-color:#a9c7ff;background:#f8fbff}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions form{margin:0}.mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode-card{display:flex;flex-direction:row;align-items:flex-start;gap:10px;border:1px solid var(--line);border-radius:13px;padding:14px;cursor:pointer;background:#fff}.mode-card input{width:auto;margin-top:4px}.info-box,.filter-note{margin-top:12px;padding:12px;border-radius:11px;background:#f0f6ff;color:#41516b}
    .table{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:11px;border-bottom:1px solid var(--line);text-align:left}th{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.45px;background:#f8faff}tbody tr:hover{background:#f8fbff}
    .login{width:min(440px,calc(100% - 30px));margin:70px auto;background:white;padding:31px;border-radius:24px;box-shadow:var(--shadow2);text-align:center}.login:before{content:"EF";display:grid;place-items:center;margin:0 auto 15px;width:58px;height:58px;border-radius:17px;background:linear-gradient(135deg,var(--primary),var(--green));color:white;font-size:20px;font-weight:900}.login form{display:grid;gap:12px;text-align:left;margin-top:20px}.alert{background:#fff0f0;color:#a42b2b;padding:11px;border-radius:10px;margin:12px 0}.success{width:64px;height:64px;border-radius:50%;background:#e6f8ee;color:var(--green);display:grid;place-items:center;margin:auto;font-size:35px;font-weight:900}.grade{margin:18px 0;background:#f6f8fb;border-radius:15px;padding:19px;display:flex;flex-direction:column}.grade b{font-size:54px}
    .student{max-width:780px}.student-head{display:flex;gap:12px;align-items:center}.student-head.modern{background:white;border:1px solid var(--line);border-radius:20px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}.student-head h1{margin:3px 0 4px}.student-head p{margin:0;color:var(--muted)}.logo-box{min-width:54px;width:54px;height:54px;border-radius:15px;background:linear-gradient(135deg,var(--primary),var(--green));display:grid;place-items:center;color:white;font-weight:900;box-shadow:0 8px 18px rgba(35,103,242,.2)}.student-id-card{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:end}.fixed-class{background:#f5f8fd;border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:3px}.fixed-class span,.fixed-class small{font-size:11px;color:var(--muted)}.fixed-class b{font-size:22px;color:var(--primary)}.question-card h2{font-size:18px;line-height:1.45}.qnum{font-size:10px;color:var(--primary);font-weight:900;text-transform:uppercase;letter-spacing:.7px}
    .results-header{background:white;border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:var(--shadow)}.v7-results-hero{background:linear-gradient(125deg,var(--navy),#235081);color:white}.v7-results-hero p{color:rgba(255,255,255,.76)}.bar-row{margin:18px 0}.bar-label{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px}.bar{height:11px;background:#edf1f6;border-radius:12px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--green))}.bar.good i{background:linear-gradient(90deg,#22a965,#53cc89)}.bar.mid i{background:linear-gradient(90deg,#e6a22d,#f2c760)}.bar.low i{background:linear-gradient(90deg,#df5a5a,#ee8585)}.pct-badge{padding:4px 8px;border-radius:999px;font-size:11px}.pct-badge.good{background:#e8f8ef;color:#16814a}.pct-badge.mid{background:#fff5dc;color:#9b6812}.pct-badge.low{background:#ffeded;color:#a23a3a}.performance-card{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fbfcfe}.performance-card small{display:block;margin-top:8px;line-height:1.4}.student-number{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#edf4ff;color:var(--primary);font-size:11px;font-weight:800;margin-right:5px}.card-heading-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.card-heading-row h2{margin:3px 0}.legend{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);flex-wrap:wrap}.legend i{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:5px}.legend-good{background:#34b874}.legend-mid{background:#e5aa37}.legend-low{background:#df6262}
    .school-result-group>summary{padding:19px}.school-average{display:flex;align-items:center;gap:12px}.school-average small,.class-average small{font-size:10px}.school-average b{font-size:23px;color:var(--primary)}.result-class-card{border:1px solid var(--line);border-radius:15px;overflow:hidden;background:#fbfcfe;margin:10px 0}.result-class-head{padding:12px;display:flex;justify-content:space-between;align-items:center}.result-class-head>div:first-child{display:flex;align-items:center;gap:9px}.result-class-head>div:first-child>div{display:flex;flex-direction:column}.class-average{text-align:right}.class-average b{display:block;color:var(--primary);font-size:19px}.result-exam-row{border-top:1px solid var(--line);padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--ink);background:white}.result-exam-row:hover{background:#f7faff}.result-exam-row>div:first-child{display:flex;flex-direction:column;gap:4px}.result-exam-row>div:first-child b{font-size:13px}.result-exam-row>div:first-child small{font-size:10px}.result-numbers{display:flex;align-items:center;gap:15px}.result-numbers span{display:flex;flex-direction:column;text-align:right}.result-numbers span b{font-size:14px}.result-numbers span small{font-size:9px}.result-numbers i{font-style:normal;font-size:22px;color:#93a3b8}
    .empty-state{text-align:center;padding:35px}.empty-icon{font-size:40px}
    @media(max-width:900px){.quick-actions{grid-template-columns:1fr 1fr}.navlinks a span{display:none}.navlinks a{font-size:18px;padding:9px}.navlinks .logout-link{font-size:12px}.welcome-mark{width:105px;height:105px}.exam-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.topbar{height:64px;padding:0 13px}.brand-mark{width:36px;height:36px}.navlinks{gap:0}.navlinks a{padding:8px}.navlinks .logout-link{display:none}main{padding:0 12px;margin-top:16px}.hero,.results-header,.welcome-panel{align-items:flex-start;flex-direction:column}.v7-welcome{padding:25px;min-height:auto}.welcome-mark{display:none}.quick-actions{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.span{grid-column:auto}.section-heading.split{align-items:flex-start;flex-direction:column}.search-box{min-width:0;width:100%}.student-id-card{grid-template-columns:1fr}.card-heading-row{align-items:flex-start;flex-direction:column}.school-average{gap:7px}.school-average b{font-size:18px}.result-exam-row{align-items:flex-start}.result-numbers{gap:9px}.mode-grid{grid-template-columns:1fr}}
    @media(max-width:440px){.brand>span:last-child{display:none}.quick-actions{grid-template-columns:1fr}.quick-card{padding:13px}.v7-welcome h1{font-size:31px}.v7-welcome p{font-size:14px}.cards{grid-template-columns:1fr 1fr}.dashboard-stats .stat{min-height:116px;padding:14px}.dashboard-stats .stat b{font-size:27px}.school-group>summary,.school-result-group>summary{padding:13px}.school-icon{width:43px;height:43px}.school-content{padding:0 11px 11px}.result-numbers span:first-child{display:none}.exam-grid{padding:0 9px 9px}}
  </style>`;
}

function randomToken() { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14); }
function formatDuration(s) { s = Number(s || 0); const m = Math.floor(s / 60), sec = s % 60; return s ? `${m}m ${sec}s` : '—'; }
function csvSafe(v) { return String(v ?? '').replaceAll(';', ',').replaceAll('\n', ' '); }
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(v) { return esc(v).replaceAll('"', '&quot;'); }
