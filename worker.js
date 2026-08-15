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
      if (path === '/provas/nova') return method === 'POST' ? createExam(request, env) : newExam(env);

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
  const exams = await env.DB.prepare(`SELECT e.*, COUNT(s.id) AS submissions, ROUND(AVG(s.score),2) AS avg_score FROM exams e LEFT JOIN submissions s ON s.exam_id=e.id GROUP BY e.id ORDER BY e.id DESC`).all();
  const q = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions').first();
  const s = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();
  const rows = exams.results.map(e => `<tr><td><b>${esc(e.title)}</b><br><small>${esc(e.grade)} · ${esc(e.class_name || '')}</small></td><td>${e.submissions}</td><td>${e.avg_score ?? '—'}</td><td><a class="btn small" href="/provas/${e.id}">Abrir</a></td></tr>`).join('');
  return page('Painel', nav() + `<main><div class="hero"><div><h1>Olá, Professor Josemar!</h1><p>Provas online, correção automática e gráficos.</p></div><a class="btn" href="/provas/nova">+ Criar Prova</a></div><div class="cards"><div class="card stat"><b>${q.c}</b><span>Questões</span></div><div class="card stat"><b>${exams.results.length}</b><span>Provas</span></div><div class="card stat"><b>${s.c}</b><span>Respostas</span></div></div><div class="card"><h2>Provas recentes</h2><div class="table"><table><thead><tr><th>Prova</th><th>Respostas</th><th>Média</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">Nenhuma prova criada.</td></tr>'}</tbody></table></div></div></main>`);
}

async function bank(env) {
  const qs = await env.DB.prepare('SELECT * FROM questions ORDER BY id DESC').all();
  const rows = qs.results.map(q => `<tr><td>${q.id}</td><td>${esc(q.grade)}</td><td>${esc(q.topic)}</td><td>${esc(q.statement)}</td><td><b>${q.correct}</b></td></tr>`).join('');
  return page('Banco de questões', nav() + `<main><div class="hero"><div><h1>Banco de Questões</h1><p>Cadastre e reutilize questões.</p></div><a class="btn secondary" href="/">← Painel</a></div><div class="card"><h2>Adicionar questão</h2><form method="post" class="grid"><label>Nível<select name="level"><option>Fundamental</option><option>Médio</option></select></label><label>Ano/Série<input name="grade" placeholder="8º ano" required></label><label class="span">Conteúdo<input name="topic" placeholder="Futsal" required></label><label class="span">Enunciado<textarea name="statement" required></textarea></label><label>A<input name="option_a" required></label><label>B<input name="option_b" required></label><label>C<input name="option_c" required></label><label>D<input name="option_d" required></label><label>Gabarito<select name="correct"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><div><button>Salvar questão</button></div></form></div><div class="card"><h2>Questões cadastradas</h2><div class="table"><table><thead><tr><th>#</th><th>Ano</th><th>Conteúdo</th><th>Questão</th><th>Gabarito</th></tr></thead><tbody>${rows}</tbody></table></div></div></main>`);
}

async function addQuestion(request, env) {
  const f = await request.formData();
  await env.DB.prepare(`INSERT INTO questions (level,grade,topic,statement,option_a,option_b,option_c,option_d,correct) VALUES (?,?,?,?,?,?,?,?,?)`).bind(f.get('level'), f.get('grade'), f.get('topic'), f.get('statement'), f.get('option_a'), f.get('option_b'), f.get('option_c'), f.get('option_d'), f.get('correct')).run();
  return redirect('/banco');
}

async function newExam(env) {
  const qs = await env.DB.prepare('SELECT * FROM questions ORDER BY level,grade,topic,id').all();
  const items = qs.results.map(q => `<label class="pick"><input type="checkbox" name="question_ids" value="${q.id}"><span><b>${esc(q.grade)} · ${esc(q.topic)}</b><br>${esc(q.statement)}</span></label>`).join('');
  return page('Criar prova', nav() + `<main><div class="hero"><div><h1>Criar Prova</h1><p>Preencha os dados e marque as questões.</p></div><a class="btn secondary" href="/">← Painel</a></div><form method="post"><div class="card grid"><label class="span">Título<input name="title" placeholder="Prova do 2º trimestre" required></label><label>Nível<select name="level"><option>Fundamental</option><option>Médio</option></select></label><label>Ano/Série<input name="grade" placeholder="8º ano" required></label><label>Turma<input name="class_name" placeholder="8º A"></label><label>Valor<input name="total_points" type="number" step="0.1" value="10" required></label></div><div class="card"><h2>Selecione as questões</h2><div class="question-list">${items}</div><button style="margin-top:15px">Criar e gerar link</button></div></form></main>`);
}

async function createExam(request, env) {
  const f = await request.formData();
  const ids = f.getAll('question_ids').map(Number).filter(Boolean);
  if (!ids.length) return page('Atenção', '<div class="login"><h2>Selecione pelo menos uma questão.</h2><a class="btn" href="/provas/nova">Voltar</a></div>', 400);
  const token = randomToken();
  const r = await env.DB.prepare(`INSERT INTO exams (token,title,level,grade,class_name,total_points,active) VALUES (?,?,?,?,?,?,1)`).bind(token, f.get('title'), f.get('level'), f.get('grade'), f.get('class_name') || '', Number(f.get('total_points') || 10)).run();
  const examId = r.meta.last_row_id;
  await env.DB.batch(ids.map((id, i) => env.DB.prepare('INSERT INTO exam_questions (exam_id,question_id,position) VALUES (?,?,?)').bind(examId, id, i + 1)));
  return redirect(`/provas/${examId}`);
}

async function examDetail(env, id, origin) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);
  const qs = await env.DB.prepare(`SELECT q.*,eq.position FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position`).bind(id).all();
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions WHERE exam_id=?').bind(id).first();
  const link = `${origin}/p/${e.token}`;
  const list = qs.results.map(q => `<li><b>${q.position}. ${esc(q.topic)}</b> — ${esc(q.statement)}</li>`).join('');
  return page(e.title, nav() + `<main><div class="hero"><div><h1>${esc(e.title)}</h1><p>${esc(e.grade)} · ${esc(e.class_name || '')}</p></div><a class="btn secondary" href="/">← Painel</a></div><div class="cards"><div class="card stat"><b>${count.c}</b><span>Respostas</span></div><div class="card stat"><b>${qs.results.length}</b><span>Questões</span></div><div class="card stat"><b>${e.active ? 'Aberta' : 'Encerrada'}</b><span>Status</span></div></div><div class="card"><h2>Link para os alunos</h2><input id="link" value="${attr(link)}" readonly><button onclick="navigator.clipboard.writeText(document.getElementById('link').value);this.textContent='Copiado!'" style="margin-top:10px">Copiar link</button><p><small>Envie pelo Classroom ou WhatsApp.</small></p></div><div class="card actions"><a class="btn" href="/provas/${id}/resultados">Notas e gráficos</a><form method="post" action="/provas/${id}/toggle"><button class="secondary">${e.active ? 'Encerrar prova' : 'Reabrir prova'}</button></form><a class="btn secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a></div><div class="card"><h2>Questões</h2><ol>${list}</ol></div></main>`);
}

async function toggleExam(env, id) {
  await env.DB.prepare('UPDATE exams SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run();
  return redirect(`/provas/${id}`);
}

async function publicExam(request, env, token) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE token=?').bind(token).first();
  if (!e) return page('Link inválido', '<div class="login"><h2>Prova não encontrada.</h2></div>', 404);
  if (!e.active) return page('Prova encerrada', '<div class="login"><h2>O professor encerrou esta prova.</h2></div>', 403);
  const qs = await env.DB.prepare(`SELECT q.*,eq.position FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position`).bind(e.id).all();

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

  const r = await env.DB.prepare(`INSERT INTO submissions (exam_id,student_name,student_class,score,percent,duration_seconds) VALUES (?,?,?,?,?,?)`).bind(e.id, name, String(f.get('student_class') || ''), score, percent, duration).run();
  const sid = r.meta.last_row_id;
  if (answers.length) await env.DB.batch(answers.map(x => env.DB.prepare('INSERT INTO answers (submission_id,question_id,answer,is_correct) VALUES (?,?,?,?)').bind(sid, x.q, x.a, x.ok)));

  return page('Resultado', `<div class="login"><div class="success">✓</div><h1>Prova enviada!</h1><p>${esc(name)}, sua resposta foi registrada.</p><div class="grade"><small>Sua nota</small><b>${score}</b><span>${percent}% de acertos</span></div><p><b>${correct}/${qs.results.length}</b> questões corretas</p><p><small>Tempo: ${formatDuration(duration)}</small></p></div>`);
}

function studentForm(e, qs, error = '') {
  return `<main class="student"><div class="student-head"><div class="logo-box">EF</div><div><h1>${esc(e.title)}</h1><p>${esc(e.grade)} · ${esc(e.class_name || '')}</p></div></div>${error ? `<div class="alert">${esc(error)}</div>` : ''}<form method="post" id="examForm"><div class="card grid"><label>Nome completo<input name="student_name" required></label><label>Turma<input name="student_class" value="${attr(e.class_name || '')}"></label></div>${qs.map(q => `<section class="card"><div class="qnum">Questão ${q.position}</div><h2>${esc(q.statement)}</h2>${['A','B','C','D'].map(x => `<label class="answer"><input type="radio" name="q_${q.id}" value="${x}" required><span><b>${x}</b> ${esc(q['option_' + x.toLowerCase()])}</span></label>`).join('')}</section>`).join('')}<input type="hidden" name="duration_seconds" id="duration"><button class="big">Enviar prova</button></form></main><script>const started=Date.now();document.getElementById('examForm').addEventListener('submit',()=>document.getElementById('duration').value=Math.round((Date.now()-started)/1000));</script>`;
}

async function examResults(env, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id=?').bind(id).first();
  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);
  const subs = await env.DB.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY submitted_at DESC').bind(id).all();
  const st = await env.DB.prepare('SELECT COUNT(*) AS n, ROUND(AVG(score),2) AS avg_score, ROUND(MAX(score),2) AS max_score, ROUND(MIN(score),2) AS min_score FROM submissions WHERE exam_id=?').bind(id).first();
  const qs = await env.DB.prepare(`SELECT q.id,q.statement,q.topic,eq.position,COUNT(a.submission_id) AS total,COALESCE(SUM(a.is_correct),0) AS correct,CASE WHEN COUNT(a.submission_id)=0 THEN 0 ELSE ROUND(100.0*SUM(a.is_correct)/COUNT(a.submission_id),1) END AS pct FROM exam_questions eq JOIN questions q ON q.id=eq.question_id LEFT JOIN answers a ON a.question_id=q.id AND a.submission_id IN (SELECT id FROM submissions WHERE exam_id=?) WHERE eq.exam_id=? GROUP BY q.id,q.statement,q.topic,eq.position ORDER BY eq.position`).bind(id, id).all();
  const rows = subs.results.map(s => `<tr><td>${esc(s.student_name)}</td><td>${esc(s.student_class || '')}</td><td><b>${s.score}</b></td><td>${s.percent}%</td><td>${formatDuration(s.duration_seconds)}</td></tr>`).join('');
  const bars = qs.results.map(q => `<div class="bar-row"><div class="bar-label"><span>Q${q.position} · ${esc(q.topic)}</span><b>${q.pct}%</b></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, q.pct))}%"></i></div><small>${esc(q.statement)}</small></div>`).join('');
  return page('Resultados', nav() + `<main><div class="hero"><div><h1>Resultados — ${esc(e.title)}</h1><p>${esc(e.grade)} · ${esc(e.class_name || '')}</p></div><a class="btn secondary" href="/provas/${id}">← Voltar</a></div><div class="cards"><div class="card stat"><b>${st.n || 0}</b><span>Respostas</span></div><div class="card stat"><b>${st.avg_score ?? '—'}</b><span>Média</span></div><div class="card stat"><b>${st.max_score ?? '—'}</b><span>Maior nota</span></div><div class="card stat"><b>${st.min_score ?? '—'}</b><span>Menor nota</span></div></div><div class="card"><h2>Desempenho por questão</h2>${bars || '<p>Ainda não há respostas.</p>'}</div><div class="card"><h2>Notas dos alunos</h2><div class="table"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Nota</th><th>Acertos</th><th>Tempo</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Ainda não há respostas.</td></tr>'}</tbody></table></div></div></main>`);
}

async function resultsCsv(env, id) {
  const subs = await env.DB.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY student_name').bind(id).all();
  const lines = ['Nome;Turma;Nota;Percentual;Tempo (s);Enviado em'];
  for (const s of subs.results) lines.push([s.student_name, s.student_class, String(s.score).replace('.', ','), String(s.percent).replace('.', ',') + '%', s.duration_seconds || '', s.submitted_at].map(csvSafe).join(';'));
  return new Response('\ufeff' + lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="resultados_prova_${id}.csv"` } });
}

function nav() {
  return `<nav><a class="logo" href="/">EducaFísica <span>Avalia</span></a><div><a href="/">Painel</a><a href="/provas/nova">Criar prova</a><a href="/banco">Banco</a><a href="/logout">Sair</a></div></nav>`;
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · EducaFísica Avalia</title>${css()}</head><body>${body}</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } });
}

function css() {
  return `<style>:root{--blue:#1e73ff;--green:#28b76b;--ink:#172033;--muted:#6f7b91;--bg:#f4f7fb;--line:#e2e8f0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--bg);color:var(--ink)}a{text-decoration:none;color:var(--blue)}nav{background:#10233c;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}nav a{color:white;margin-left:12px}.logo{font-weight:800;font-size:20px;margin:0}.logo span,h1 span{color:#48cf87}main{max-width:1050px;margin:24px auto;padding:0 16px}.hero{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}.hero h1{margin:0 0 5px}.hero p{margin:0;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:white;border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 6px 18px #0000000d}.stat{display:flex;flex-direction:column}.stat b{font-size:32px}.stat span,small{color:var(--muted)}.btn,button{display:inline-block;border:0;border-radius:10px;background:var(--blue);color:white;padding:12px 16px;font-weight:700;font-size:15px;cursor:pointer}.secondary{background:white!important;color:var(--ink)!important;border:1px solid var(--line)!important}.small{padding:7px 10px;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.span{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-weight:700}input,select,textarea{width:100%;padding:11px;border:1px solid #cfd8e6;border-radius:9px;font:inherit}textarea{min-height:90px}.question-list{display:grid;gap:9px}.pick,.answer{display:flex;flex-direction:row;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:11px;font-weight:500}.pick input,.answer input{width:auto;margin-top:4px;margin-right:10px}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions form{margin:0}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--muted);text-transform:uppercase}.login{width:min(430px,calc(100% - 30px));margin:70px auto;background:white;padding:28px;border-radius:18px;box-shadow:0 15px 50px #0002;text-align:center}.login form{display:grid;gap:12px;text-align:left;margin-top:20px}.alert{background:#fff0f0;color:#a42b2b;padding:10px;border-radius:8px;margin:12px 0}.student{max-width:760px}.student-head{display:flex;gap:12px;align-items:center}.logo-box{width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--green));display:grid;place-items:center;color:white;font-weight:900}.qnum{font-size:12px;color:var(--blue);font-weight:800;text-transform:uppercase}.big{width:100%;font-size:17px;padding:15px}.success{width:62px;height:62px;border-radius:50%;background:#e6f8ee;color:var(--green);display:grid;place-items:center;margin:auto;font-size:34px;font-weight:900}.grade{margin:18px 0;background:#f6f8fb;border-radius:14px;padding:18px;display:flex;flex-direction:column}.grade b{font-size:52px}.bar-row{margin:18px 0}.bar-label{display:flex;justify-content:space-between;margin-bottom:6px}.bar{height:12px;background:#edf1f6;border-radius:10px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--green))}@media(max-width:700px){nav{align-items:flex-start}nav div{display:grid;grid-template-columns:1fr 1fr;gap:6px}nav a{margin:0}.hero{align-items:flex-start;flex-direction:column}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.span{grid-column:auto}}@media(max-width:430px){.cards{grid-template-columns:1fr}}</style>`;
}

function randomToken() { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14); }
function formatDuration(s) { s = Number(s || 0); const m = Math.floor(s / 60), sec = s % 60; return s ? `${m}m ${sec}s` : '—'; }
function csvSafe(v) { return String(v ?? '').replaceAll(';', ',').replaceAll('\n', ' '); }
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(v) { return esc(v).replaceAll('"', '&quot;'); }
