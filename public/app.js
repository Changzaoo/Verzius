// ============================ Verzius — SPA ============================
const TOKEN_KEY = "verzius_token";
let AUTH_TOKEN = "";  // token do Firebase (tem prioridade quando logado via Firebase)
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
const authHeaders = (extra = {}) => { const t = AUTH_TOKEN || getToken(); return t ? { ...extra, Authorization: `Bearer ${t}` } : extra; };
// Backend de dados (Render) — CRUD, auth, configurações.
const api = {
  async get(p) { return (await fetch(p, { headers: authHeaders() })).json(); },
  async post(p, body) { return (await fetch(p, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })).json(); },
  async put(p, body) { return (await fetch(p, { method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })).json(); },
  async del(p) { return (await fetch(p, { method: "DELETE", headers: authHeaders() })).json(); },
  async upload(p, formData) { return (await fetch(p, { method: "POST", headers: authHeaders(), body: formData })).json(); },
};

// Backend de IA (servidor local via Cloudflare Tunnel) — geração de conteúdo, voz, avatar.
const AI_BASE = "https://verzius-api.nexusholding.xyz";
const aiApi = {
  async get(p) { return (await fetch(AI_BASE + p, { headers: authHeaders() })).json(); },
  async post(p, body) { return (await fetch(AI_BASE + p, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })).json(); },
  async upload(p, formData) { return (await fetch(AI_BASE + p, { method: "POST", headers: authHeaders(), body: formData })).json(); },
};

let STATE = { status: null, clients: [], currentView: "dashboard" };

// ---------- utils ----------
const $ = (id) => document.getElementById(id);
const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
function toast(msg, type = "ok") {
  const t = $("toast"); t.textContent = msg; t.className = `toast ${type}`;
  setTimeout(() => (t.className = "toast hidden"), 2800);
}
function initials(name) { return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
function openModal(html) { $("modalBody").innerHTML = html; $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }
function nicheLabel(n) { return STATE.status?.niches?.[n]?.label || n; }

// ---------- auth (multiusuario) ----------
let AUTH_MODE = "login"; // "login" | "signup"
let FB = null;           // instancia firebase.auth() quando ativo
async function boot() {
  STATE.status = await api.get("/api/status");
  if (STATE.status.firebase?.enabled) return bootFirebase();
  if (STATE.status.multiuser) {
    const me = await api.get("/api/me");
    if (me.user) { STATE.user = me.user; $("login").classList.add("hidden"); showApp(); }
    else { setToken(""); renderAuthScreen(); }
  } else {
    showApp(); // modo aberto (DEMO)
  }
}

// ===== Firebase Auth =====
function bootFirebase() {
  if (!window.firebase) { renderAuthScreen(); return toast("SDK do Firebase nao carregou", "err"); }
  if (!firebase.apps.length) firebase.initializeApp(STATE.status.firebase.config);
  FB = firebase.auth();
  FB.onIdTokenChanged(async (user) => {
    if (!user) { AUTH_TOKEN = ""; STATE.fbUser = null; renderAuthScreen(); return; }
    AUTH_TOKEN = await user.getIdToken();
    const me = await api.get("/api/fb/me");
    STATE.fbUser = me.user;
    STATE.user = me.user ? { name: (me.user.email || "").split("@")[0], email: me.user.email } : null;
    if (me.user && me.user.approved) { $("login").classList.add("hidden"); showApp(); }
    else renderPendingScreen(me.user);
  });
}
async function fbAuth() {
  const email = $("au_email").value.trim();
  const password = $("au_pass").value;
  const errEl = $("loginErr"); errEl.classList.add("hidden");
  const btn = $("authBtn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    if (AUTH_MODE === "signup") await FB.createUserWithEmailAndPassword(email, password);
    else await FB.signInWithEmailAndPassword(email, password);
    // onIdTokenChanged cuida do resto (approved -> app, senao -> pendente)
  } catch (e) {
    errEl.textContent = fbErr(e.code) || e.message; errEl.classList.remove("hidden");
    btn.disabled = false; btn.textContent = AUTH_MODE === "signup" ? "Criar conta" : "Entrar";
  }
}
function fbErr(code) {
  return ({
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/user-not-found": "Conta nao encontrada.",
    "auth/email-already-in-use": "Ja existe conta com esse e-mail. Faca login.",
    "auth/weak-password": "Senha fraca (minimo 6 caracteres).",
    "auth/invalid-email": "E-mail invalido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco.",
  })[code];
}
function renderPendingScreen(user) {
  $("login").classList.remove("hidden");
  $("login").innerHTML = `
    <div class="login-card">
      <div class="logo-big">▶ Verz<span>ius</span></div>
      <div style="font-size:40px;margin:8px 0">⏳</div>
      <h2 style="margin-bottom:8px">Conta aguardando aprovação</h2>
      <p class="muted" style="font-size:14px;line-height:1.6">Sua conta (<b>${user?.email || ""}</b>) foi criada e está <b>pendente de aprovação</b> do administrador. Você receberá acesso assim que for liberado.</p>
      <button class="btn primary" style="margin-top:18px" onclick="recheckApproval()">Já fui aprovado — atualizar</button>
      <button class="btn ghost" style="margin-top:8px" onclick="doLogout()">Sair</button>
    </div>`;
}
async function recheckApproval() {
  if (FB?.currentUser) { await FB.currentUser.getIdToken(true); AUTH_TOKEN = await FB.currentUser.getIdToken(); }
  const me = await api.get("/api/fb/me");
  if (me.user?.approved) { STATE.fbUser = me.user; $("login").classList.add("hidden"); showApp(); }
  else toast("Ainda pendente — aguarde a aprovação.", "err");
}

function renderAuthScreen() {
  const fb = STATE.status?.firebase?.enabled;
  const signup = AUTH_MODE === "signup";
  $("login").classList.remove("hidden");
  $("login").innerHTML = `
    <div class="login-card">
      <div class="logo-big">▶ Verz<span>ius</span></div>
      <p class="muted">${signup ? "Crie sua conta (precisa de aprovação)" : "Entre na sua conta"}</p>
      ${(!fb && signup) ? `<input id="au_name" placeholder="Seu nome / agência" />` : ""}
      <input id="au_email" type="email" placeholder="E-mail" />
      <input id="au_pass" type="password" placeholder="Senha (mín. 6)" onkeydown="if(event.key==='Enter')${fb ? "fbAuth()" : "doAuth()"}" />
      <button class="btn primary" id="authBtn" onclick="${fb ? "fbAuth()" : "doAuth()"}">${signup ? "Criar conta" : "Entrar"}</button>
      <p id="loginErr" class="err hidden"></p>
      <p class="muted" style="font-size:13px;margin-top:12px;cursor:pointer" onclick="toggleAuthMode()">
        ${signup ? "Já tem conta? <b>Entrar</b>" : "Ainda não tem conta? <b>Criar conta</b>"}
      </p>
    </div>`;
}
function toggleAuthMode() { AUTH_MODE = AUTH_MODE === "login" ? "signup" : "login"; renderAuthScreen(); }
async function doAuth() {
  const email = $("au_email").value.trim();
  const password = $("au_pass").value;
  const body = AUTH_MODE === "signup" ? { name: $("au_name")?.value.trim(), email, password } : { email, password };
  const r = await api.post(AUTH_MODE === "signup" ? "/api/signup" : "/api/login", body);
  if (r.ok && r.token) {
    setToken(r.token); STATE.user = r.user;
    STATE.status = await api.get("/api/status");
    $("login").classList.add("hidden"); showApp();
  } else {
    const e = $("loginErr"); e.textContent = r.error || "Falha na autenticação"; e.classList.remove("hidden");
  }
}
async function doLogout() {
  if (FB) { await FB.signOut(); AUTH_TOKEN = ""; location.reload(); return; }
  await api.post("/api/logout", {});
  setToken(""); STATE.user = null; location.reload();
}
function showApp() {
  $("app").classList.remove("hidden");
  const badge = $("modeBadge");
  badge.textContent = STATE.status.mode === "live" ? "● Modo LIVE" : "● Modo DEMO";
  badge.className = `mode-badge ${STATE.status.mode}`;
  const ub = $("userBox");
  if (ub) {
    ub.innerHTML = STATE.user
      ? `<span class="muted" style="font-size:12px">👤 ${STATE.user.name}${STATE.fbUser?.isAdmin ? " (admin)" : ""}</span><button class="btn sm ghost" onclick="doLogout()">Sair</button>`
      : `<button class="btn sm ghost" onclick="renderAuthScreen()">Criar agência / Entrar</button>`;
  }
  // item de Aprovações só para o admin
  const navAdmin = $("navAdmin");
  if (navAdmin) navAdmin.classList.toggle("hidden", !STATE.fbUser?.isAdmin);
  document.querySelectorAll(".sidebar nav a").forEach(a => {
    a.onclick = () => navigate(a.dataset.view);
  });
  // rota por hash: restaura a view da URL ou vai para dashboard
  window.addEventListener("popstate", () => {
    const v = location.hash.slice(1);
    if (v) navigate(v);
  });
  const initView = location.hash.slice(1) || "dashboard";
  navigate(initView);
  // primeira visita: abre o tutorial guiado automaticamente
  if (!localStorage.getItem("verzius_tut_seen")) setTimeout(startTutorial, 700);
}
function navigate(view) {
  STATE.currentView = view;
  if (location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  document.querySelectorAll(".sidebar nav a").forEach(a => a.classList.toggle("active", a.dataset.view === view));
  const fn = { dashboard: viewDashboard, clients: viewClients, studio: viewStudio, videos: viewVideos, posts: viewPosts, calendar: viewCalendar, admin: viewAdmin, settings: viewSettings, profile: viewProfile }[view];
  if (fn) fn();
}

// ============================ DASHBOARD ============================
async function viewDashboard() {
  const { clients } = await api.get("/api/clients");
  const { videos } = await api.get("/api/videos");
  const { scripts } = await api.get("/api/scripts");
  const { totals } = await api.get("/api/posts");
  STATE.clients = clients;
  const totalViews = totals?.views || 0;
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>Dashboard</h1>
        <p class="page-sub">Visão geral da sua agência de conteúdo com IA.</p>
        <div class="grid cols-4" style="margin-bottom:20px">
          <div class="card stat"><div class="num brand">${clients.length}</div><div class="lbl">Clientes ativos</div></div>
          <div class="card stat"><div class="num">${videos.length}</div><div class="lbl">Vídeos gerados</div></div>
          <div class="card stat"><div class="num">${scripts.length}</div><div class="lbl">Roteiros salvos</div></div>
          <div class="card stat"><div class="num">${totalViews.toLocaleString("pt-BR")}</div><div class="lbl">Views (registradas)</div></div>
        </div>
      </div>
      <div class="view-body">
        <div class="grid cols-2">
          <div class="card">
            <div class="row between"><h2>Clientes recentes</h2><button class="btn sm" onclick="navigate('clients')">Ver todos</button></div>
            <div id="dashClients">${clients.length ? "" : '<p class="empty">Nenhum cliente ainda. Cadastre o primeiro!</p>'}</div>
          </div>
          <div class="card">
            <h2>⚡ Começo rápido</h2>
            <ol style="line-height:2;color:#cfd3e0;padding-left:18px;font-size:14px">
              <li>Cadastre um cliente (nicho + tom de voz)</li>
              <li>Suba a foto (avatar) e o áudio (voz)</li>
              <li>Gere roteiros virais no Estúdio</li>
              <li>Produza o vídeo e poste o plano de 60 dias</li>
            </ol>
            <button class="btn primary" style="margin-top:10px" onclick="openClientForm()">+ Novo cliente</button>
          </div>
        </div>
      </div>
    </div>`;
  const box = $("dashClients");
  clients.slice(0, 5).forEach(c => box.appendChild(clientRow(c)));
}

// ============================ CLIENTES ============================
async function viewClients() {
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <div class="row between">
          <div><h1>Clientes</h1><p class="page-sub">Cada cliente tem seu avatar, voz e estilo de conteúdo.</p></div>
          <button class="btn primary" onclick="openClientForm()">+ Novo cliente</button>
        </div>
      </div>
      <div class="view-body">
        <div id="clientsList">${clients.length ? "" : '<p class="empty">Nenhum cliente cadastrado.</p>'}</div>
      </div>
    </div>`;
  const list = $("clientsList");
  clients.forEach(c => list.appendChild(clientRow(c, true)));
}

function clientRow(c, full) {
  const photo = c.photoUrl ? `style="background-image:url('${c.photoUrl}')"` : "";
  const node = el(`
    <div class="list-item">
      <div class="avatar-circle" ${photo}>${c.photoUrl ? "" : initials(c.name)}</div>
      <div style="flex:1">
        <div style="font-weight:600">${c.name} ${c.handle ? `<span class="muted">@${c.handle}</span>` : ""}</div>
        <div class="row" style="margin-top:4px">
          <span class="tag brand">${nicheLabel(c.niche)}</span>
          <span class="tag ${c.avatarId || c.avatarDemo ? "green" : "amber"}">${c.avatarId || c.avatarDemo ? "avatar ✓" : "sem avatar"}</span>
          <span class="tag ${c.voiceId ? "green" : "amber"}">${c.voiceId ? "voz ✓" : "sem voz"}</span>
          <span class="muted" style="font-size:12px">${c.stats?.videos || 0} vídeos</span>
        </div>
      </div>
      ${full ? `<button class="btn sm" data-act="open">Abrir</button>` : `<button class="btn sm" data-act="open">→</button>`}
    </div>`);
  node.querySelector('[data-act="open"]').onclick = () => openClient(c.id);
  return node;
}

function openClientForm(existing) {
  const c = existing || {};
  const niches = STATE.status.niches;
  const opts = Object.entries(niches).map(([k, v]) => `<option value="${k}" ${c.niche === k ? "selected" : ""}>${v.label}</option>`).join("");
  openModal(`
    <h2>${existing ? "Editar" : "Novo"} cliente</h2>
    <div class="field"><label>Nome / Marca *</label><input id="f_name" value="${c.name || ""}"></div>
    <div class="field"><label>@ handle</label><input id="f_handle" value="${c.handle || ""}"></div>
    <div class="field"><label>Nicho</label><select id="f_niche">${opts}</select></div>
    <div class="field"><label>Tom de voz</label><input id="f_tone" placeholder="ex: didático, direto, autoridade acessível" value="${c.tone || ""}"></div>
    <div class="field"><label>Público-alvo</label><input id="f_audience" placeholder="ex: empresários 30-50 anos" value="${c.audience || ""}"></div>
    <div class="field"><label>Objetivo do conteúdo</label><input id="f_goal" placeholder="ex: gerar autoridade e atrair pacientes" value="${c.goal || ""}"></div>
    <div class="row"><button class="btn primary" onclick="saveClient('${existing?.id || ""}')">Salvar</button><button class="btn ghost" onclick="closeModal()">Cancelar</button></div>`);
}

async function saveClient(id) {
  const body = {
    name: $("f_name").value.trim(), handle: $("f_handle").value.trim(),
    niche: $("f_niche").value, tone: $("f_tone").value.trim(),
    audience: $("f_audience").value.trim(), goal: $("f_goal").value.trim(),
  };
  if (!body.name) return toast("Informe o nome", "err");
  const r = id ? await api.put(`/api/clients/${id}`, body) : await api.post("/api/clients", body);
  if (r.ok) { toast("Cliente salvo"); closeModal(); navigate("clients"); }
  else toast(r.error || "Erro", "err");
}

async function openClient(id) {
  const r = await api.get(`/api/clients/${id}`);
  if (!r.ok) return toast("Erro", "err");
  const c = r.client;
  const photo = c.photoUrl ? `style="background-image:url('${c.photoUrl}')"` : "";
  openModal(`
    <div class="row" style="gap:14px;margin-bottom:16px">
      <div class="avatar-circle" ${photo}>${c.photoUrl ? "" : initials(c.name)}</div>
      <div><h2 style="margin:0">${c.name}</h2><span class="tag brand">${nicheLabel(c.niche)}</span></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <label style="margin-bottom:10px">📸 Foto do avatar (HeyGen) — sorrindo, ângulo frontal, sem boné</label>
      <div class="row" style="flex-wrap:nowrap">
        <label class="file-btn" onclick="void(0)">
          <span class="material-icons-round" style="font-size:15px">image</span>
          <span class="file-name" id="up_photo_name">Escolher foto</span>
          <input type="file" class="file-input-hidden" id="up_photo" accept="image/*" onchange="updateFileName('up_photo','up_photo_name')">
        </label>
        <button class="btn sm primary" onclick="uploadPhoto('${c.id}')">Enviar</button>
      </div>
      ${c.avatarNote ? `<p class="muted" style="font-size:12px;margin-top:8px">${c.avatarNote}</p>` : ""}
    </div>
    <div class="card" style="margin-bottom:12px">
      <label style="margin-bottom:10px">🎙️ Áudio da voz (ElevenLabs) — 1 a 5 min falando naturalmente</label>
      <div class="row" style="flex-wrap:nowrap">
        <label class="file-btn" onclick="void(0)">
          <span class="material-icons-round" style="font-size:15px">graphic_eq</span>
          <span class="file-name" id="up_voice_name">Escolher áudio</span>
          <input type="file" class="file-input-hidden" id="up_voice" accept="audio/*" multiple onchange="updateFileName('up_voice','up_voice_name')">
        </label>
        <button class="btn sm primary" onclick="uploadVoice('${c.id}')">Enviar</button>
      </div>
    </div>
    <div class="field"><label>avatar_id (HeyGen) — cole se já tiver criado no painel</label>
      <input id="f_avatarId" value="${c.avatarId || ""}" placeholder="ex: Daisy-inskirt-20220818">
      <button class="btn sm" style="margin-top:8px" onclick="setAvatarId('${c.id}')">Salvar avatar_id</button></div>
    <div class="row between" style="margin-top:14px">
      <div class="row">
        <button class="btn primary sm" onclick="closeModal();navigate('studio');setStudioClient('${c.id}')">✍️ Gerar roteiro</button>
        <button class="btn sm" onclick="openClientForm(${JSON.stringify(c).replace(/"/g, "&quot;")})">Editar</button>
      </div>
      <button class="btn danger sm" onclick="deleteClient('${c.id}')">Excluir</button>
    </div>`);
}

async function uploadPhoto(id) {
  const f = $("up_photo").files[0];
  if (!f) return toast("Selecione uma imagem", "err");
  const fd = new FormData(); fd.append("photo", f);
  toast("Enviando...");
  const r = await aiApi.upload(`/api/clients/${id}/photo`, fd);
  if (r.ok) { toast(r.integration?.demo ? "Foto salva (demo)" : "Avatar registrado"); openClient(id); }
  else toast(r.error || "Erro", "err");
}
async function uploadVoice(id) {
  const files = $("up_voice").files;
  if (!files.length) return toast("Selecione o áudio", "err");
  const fd = new FormData(); [...files].forEach(f => fd.append("samples", f));
  toast("Clonando voz...");
  const r = await aiApi.upload(`/api/clients/${id}/voice`, fd);
  if (r.ok) { toast(r.integration?.demo ? "Voz salva (demo)" : "Voz clonada"); openClient(id); }
  else toast(r.error || "Erro", "err");
}
async function setAvatarId(id) {
  const r = await api.put(`/api/clients/${id}`, { avatarId: $("f_avatarId").value.trim() });
  if (r.ok) { toast("avatar_id salvo"); openClient(id); }
}
async function deleteClient(id) {
  if (!confirm("Excluir este cliente?")) return;
  await api.del(`/api/clients/${id}`); closeModal(); toast("Cliente excluído"); navigate("clients");
}

// ============================ ESTÚDIO DE ROTEIRO ============================
let STUDIO = { clientId: "", variations: [], theme: "" };
function setStudioClient(id) { STUDIO.clientId = id; const sel = $("st_client"); if (sel) sel.value = id; }

async function viewStudio() {
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  const opts = `<option value="">— sem cliente (genérico) —</option>` +
    clients.map(c => `<option value="${c.id}" ${STUDIO.clientId === c.id ? "selected" : ""}>${c.name} · ${nicheLabel(c.niche)}</option>`).join("");
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>✍️ Estúdio de Roteiro</h1>
        <p class="page-sub">O motor de viralização gera roteiros prontos para o avatar ler. Sem trends, foco em autoridade.</p>
        <div class="card" style="margin-bottom:16px">
          <div class="grid cols-2">
            <div class="field"><label>Cliente</label><select id="st_client">${opts}</select></div>
            <div class="field"><label>Variações</label><select id="st_count"><option>3</option><option>5</option><option>1</option></select></div>
          </div>
          <div class="field"><label>Tema do vídeo *</label><input id="st_theme" placeholder="ex: erros que destroem o sono / como economizar imposto legalmente" value="${STUDIO.theme}"></div>
          <button class="btn primary" id="genBtn" onclick="generateScripts()">Gerar roteiros virais</button>
        </div>
      </div>
      <div class="view-body">
        <div id="variations"></div>
      </div>
    </div>`;
  if (STUDIO.variations.length) renderVariations();
}

async function generateScripts() {
  const theme = $("st_theme").value.trim();
  if (!theme) return toast("Informe o tema", "err");
  const btn = $("genBtn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gerando...';
  STUDIO.clientId = $("st_client").value; STUDIO.theme = theme;
  const r = await aiApi.post("/api/scripts/generate", { clientId: STUDIO.clientId || null, theme, count: Number($("st_count").value), niche: STATE.clients.find(c => c.id === STUDIO.clientId)?.niche });
  btn.disabled = false; btn.textContent = "Gerar roteiros virais";
  if (r.ok) { STUDIO.variations = r.variations || []; renderVariations(); if (r.warning) toast("API falhou, usando demo", "err"); }
  else toast(r.error || "Erro", "err");
}

function renderVariations() {
  const box = $("variations");
  box.innerHTML = `<h2>${STUDIO.variations.length} roteiros para "${STUDIO.theme}"</h2>`;
  STUDIO.variations.forEach((v, i) => {
    const node = el(`
      <div class="variation">
        <div class="row between">
          <span class="tag brand">${v.hook_formula || "Hook"}</span>
          <span class="muted" style="font-size:12px">${v.verzius_score ? `Verzius Score: <b style="color:#a99bff">${v.verzius_score}</b> · ` : ""}Força do Hook (3s): <b>${v.retencao_3s || (typeof v.estimated_retention === "object" ? v.estimated_retention.score : v.estimated_retention) || "-"}%</b> <span style="opacity:.6">(70%+ = bom)</span></span>
        </div>
        <div class="hook">${v.hook}</div>
        <div class="retention-bar"><span style="width:${v.retencao_3s || (typeof v.estimated_retention === "object" ? v.estimated_retention.score : v.estimated_retention) || 70}%"></span></div>
        ${v.visual_hook ? `<div class="muted" style="font-size:12px;margin:4px 0">🎬 Hook visual (mudo): <b>${v.visual_hook}</b></div>` : ""}
        <div class="script-body">${v.script}</div>
        <div class="chips" style="margin:10px 0">${(v.onscreen_text || []).map(t => `<span class="chip">📝 ${t}</span>`).join("")}</div>
        <div class="muted" style="font-size:13px;margin-bottom:6px">CTA: ${v.cta || "-"}</div>
        <div class="muted" style="font-size:12px">🎞️ B-roll: ${(v.broll_suggestions || []).join(" · ")}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn sm primary" data-save="${i}">💾 Salvar roteiro</button>
          <button class="btn sm" data-copy="${i}">Copiar</button>
        </div>
      </div>`);
    node.querySelector(`[data-save="${i}"]`).onclick = () => saveScript(i);
    node.querySelector(`[data-copy="${i}"]`).onclick = () => { navigator.clipboard.writeText(v.script); toast("Copiado"); };
    box.appendChild(node);
  });
}

async function saveScript(i) {
  const r = await api.post("/api/scripts", { clientId: STUDIO.clientId || null, theme: STUDIO.theme, variation: STUDIO.variations[i] });
  if (r.ok) toast("Roteiro salvo! Vá em Vídeos para produzir.");
  else toast(r.error || "Erro", "err");
}

// ============================ VÍDEOS ============================
async function viewVideos() {
  const { videos } = await api.get("/api/videos");
  const { scripts } = await api.get("/api/scripts");
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  const cname = (id) => clients.find(c => c.id === id)?.name || "—";
  const cphoto = (id) => clients.find(c => c.id === id)?.photoUrl;
  const avatarOn = STATE.status.integrations.avatar?.provider && STATE.status.integrations.avatar.provider !== "none";
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>🎬 Vídeos</h1>
        <p class="page-sub">Produza vídeos com avatar a partir dos roteiros salvos.</p>
        <div class="card" style="margin-bottom:16px">
          <h2>Produzir novo vídeo</h2>
          <div class="grid cols-2">
            <div class="field"><label>Roteiro salvo</label><select id="v_script">
              ${scripts.length ? scripts.map(s => `<option value="${s.id}|${s.clientId || ""}">${(s.hook || s.theme || "roteiro").slice(0, 50)}… · ${cname(s.clientId)}</option>`).join("") : "<option value=''>Nenhum roteiro salvo</option>"}
            </select></div>
            <div class="field" style="display:flex;align-items:flex-end"><button class="btn primary" onclick="produceVideo()" ${scripts.length ? "" : "disabled"}>▶ Gerar vídeo</button></div>
          </div>
          <p class="muted" style="font-size:12px">${STATE.status.integrations.avatar.configured ? "HeyGen conectado (avatar falante)." : STATE.status.integrations.voice.configured ? "Sem avatar: o vídeo final é gerado com <b>voz real (ElevenLabs)</b> + legendas/B-roll na edição." : "Modo demo: vídeo simulado. Conecte ElevenLabs (voz) ou HeyGen (avatar) para produzir de verdade."}</p>
        </div>
      </div>
      <div class="view-body">
        <h2>Histórico</h2>
        <div id="videosList">${videos.length ? "" : '<p class="empty">Nenhum vídeo ainda.</p>'}</div>
      </div>
    </div>`;
  const list = $("videosList");
  videos.forEach(v => {
    const statusTag = v.status === "completed" || v.status === "edited" ? "green" : v.status === "failed" ? "amber" : "brand";
    const node = el(`
      <div class="list-item">
        <div class="avatar-circle">🎬</div>
        <div style="flex:1">
          <div style="font-weight:600">${v.title || "Vídeo"}</div>
          <div class="row" style="margin-top:4px"><span class="tag">${cname(v.clientId)}</span><span class="tag ${statusTag}">${v.status}</span>${v.demo ? '<span class="tag amber">demo</span>' : ""}${v.avatarVideoUrl ? '<span class="tag green">🧑 avatar</span>' : ""}${v.editedUrl ? '<span class="tag green">✂️ editado</span>' : ""}</div>
        </div>
        <div class="row">
          ${(avatarOn && cphoto(v.clientId) && !v.avatarVideoUrl && !v.editedUrl) ? `<button class="btn sm" data-avatar="${v.id}">🧑 Gerar avatar</button>` : ""}
          ${v.editedUrl ? `<a class="btn sm primary" href="${v.editedUrl}" target="_blank">▶ Vídeo pronto</a>` : `<button class="btn sm primary" data-edit="${v.id}">✂️ Gerar edição</button>`}
          ${v.editedUrl ? `<button class="btn sm" data-publish="${v.id}">🚀 Publicar</button>` : ""}
          ${v.url ? `<a class="btn sm" href="${v.url}" target="_blank">Cru</a>` : `<button class="btn sm" data-refresh="${v.id}">Status</button>`}
        </div>
      </div>`);
    const ab = node.querySelector("[data-avatar]");
    if (ab) ab.onclick = () => generateAvatar(v.id, ab);
    const pb = node.querySelector("[data-publish]");
    if (pb) pb.onclick = () => openPublish(v);
    const rb = node.querySelector("[data-refresh]");
    if (rb) rb.onclick = async () => { const r = await api.get(`/api/videos/${v.id}/status`); if (r.ok) { toast("Status: " + r.video.status); viewVideos(); } };
    const eb = node.querySelector("[data-edit]");
    if (eb) eb.onclick = async () => {
      eb.disabled = true; eb.innerHTML = '<span class="spinner"></span> Editando...';
      const r = await aiApi.post(`/api/videos/${v.id}/edit`, {});
      if (r.ok) { toast(`Edição pronta (${r.edit.segments} legendas, ${r.edit.durationSec}s${r.edit.narrated ? ", com voz 🎙️" : ""})`); viewVideos(); }
      else { toast(r.error || "Erro na edição", "err"); eb.disabled = false; eb.textContent = "✂️ Gerar edição"; }
    };
    list.appendChild(node);
  });
}

async function produceVideo() {
  const val = $("v_script").value;
  if (!val) return toast("Salve um roteiro primeiro", "err");
  const [scriptId, clientId] = val.split("|");
  if (!clientId) return toast("Este roteiro não tem cliente. Gere com um cliente selecionado.", "err");
  toast("Gerando vídeo...");
  const r = await aiApi.post("/api/videos/generate", { scriptId, clientId });
  if (r.ok) { toast(r.video.demo ? "Vídeo simulado (demo)" : "Vídeo em produção"); viewVideos(); }
  else toast(r.error || "Erro", "err");
}

// Gera o avatar falante (SadTalker) de forma assíncrona e faz polling.
async function generateAvatar(id, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Iniciando...';
  const r = await aiApi.post(`/api/videos/${id}/avatar`, {});
  if (!r.ok) { toast(r.error || "Erro ao iniciar avatar", "err"); btn.disabled = false; btn.textContent = "🧑 Gerar avatar"; return; }
  toast("Avatar em geração (lip-sync). Isso leva alguns minutos…");
  let tries = 0;
  const poll = async () => {
    const s = await aiApi.get(`/api/videos/${id}/avatar-status`);
    if (s.status === "completed") { toast("Avatar pronto! Agora gere a edição."); viewVideos(); return; }
    if (s.status === "failed") { toast("Falha na geração do avatar.", "err"); btn.disabled = false; btn.textContent = "🧑 Gerar avatar"; return; }
    btn.innerHTML = `<span class="spinner"></span> Gerando… (${++tries})`;
    if (tries < 60) setTimeout(poll, 8000);
    else { toast("Avatar demorando — confira mais tarde.", "err"); btn.disabled = false; btn.textContent = "🧑 Gerar avatar"; }
  };
  setTimeout(poll, 8000);
}

// ============================ PUBLICAÇÕES + MÉTRICAS ============================
function openPublish(v) {
  const plats = STATE.status.integrations.publish?.platforms || {};
  const opts = Object.entries(plats).map(([k, p]) => `<option value="${k}">${p.label}${p.configured ? "" : " (demo)"}</option>`).join("");
  openModal(`
    <h2>🚀 Publicar vídeo</h2>
    <p class="muted" style="font-size:13px">"${v.title || "Vídeo"}" — formato 9:16 pronto.</p>
    <div class="field"><label>Plataforma</label><select id="pub_platform">${opts}</select></div>
    <div class="field"><label>Legenda do post</label><textarea id="pub_caption" rows="3" placeholder="Escreva a legenda...">${v.title || ""}</textarea></div>
    <div class="row"><button class="btn primary" id="pubBtn" onclick="doPublish('${v.id}')">Publicar agora</button><button class="btn ghost" onclick="closeModal()">Cancelar</button></div>
    <p class="muted" style="font-size:12px;margin-top:8px">${STATE.status.integrations.publish?.configured ? "Conta conectada." : "Modo demo: a publicação é simulada e as métricas crescem ao longo do tempo."}</p>`);
}
async function doPublish(videoId) {
  const platform = $("pub_platform").value;
  const caption = $("pub_caption").value.trim();
  const btn = $("pubBtn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Publicando...';
  const r = await aiApi.post(`/api/videos/${videoId}/publish`, { platform, caption });
  if (r.ok) { toast("Publicado! Veja em Publicações."); closeModal(); navigate("posts"); }
  else { toast(r.error || "Erro", "err"); btn.disabled = false; btn.textContent = "Publicar agora"; }
}

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
async function viewPosts() {
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  const { posts, totals } = await api.get("/api/posts");
  const cname = (id) => clients.find(c => c.id === id)?.name || "—";
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <div class="row between">
          <div><h1>🚀 Publicações</h1><p class="page-sub">Postagens e métricas de desempenho (views, likes, comentários, shares).</p></div>
          <button class="btn sm" onclick="refreshAllPosts()">↻ Atualizar métricas</button>
        </div>
        <div class="grid cols-4" style="margin-bottom:16px">
          <div class="card stat"><div class="num brand">${fmt(totals.views)}</div><div class="lbl">Views totais</div></div>
          <div class="card stat"><div class="num">${fmt(totals.likes)}</div><div class="lbl">Likes</div></div>
          <div class="card stat"><div class="num">${fmt(totals.comments)}</div><div class="lbl">Comentários</div></div>
          <div class="card stat"><div class="num">${fmt(totals.shares)}</div><div class="lbl">Shares</div></div>
        </div>
      </div>
      <div class="view-body">
        <div id="postsList">${posts.length ? "" : '<p class="empty">Nenhuma publicação ainda. Edite um vídeo e clique em 🚀 Publicar.</p>'}</div>
      </div>
    </div>`;
  const list = $("postsList");
  const platLabel = (k) => STATE.status.integrations.publish?.platforms?.[k]?.label || k;
  posts.forEach(p => {
    const node = el(`
      <div class="list-item">
        <div class="avatar-circle">${p.platform === "tiktok" ? "🎵" : p.platform === "youtube" ? "▶️" : "📸"}</div>
        <div style="flex:1">
          <div style="font-weight:600">${p.caption || "(sem legenda)"} </div>
          <div class="row" style="margin-top:4px">
            <span class="tag brand">${platLabel(p.platform)}</span>
            <span class="tag">${cname(p.clientId)}</span>
            ${p.demo ? '<span class="tag amber">demo</span>' : ''}
            <span class="muted" style="font-size:12px">👁️ ${fmt(p.metrics.views)} · 🎯 hook ${p.metrics.hookRate || "-"}% · 🔖 ${fmt(p.metrics.saves)} saves · ❤️ ${fmt(p.metrics.likes)} · 💬 ${fmt(p.metrics.comments)} · ↗️ ${fmt(p.metrics.shares)}</span>
          </div>
        </div>
        <a class="btn sm" href="${p.permalink}" target="_blank">Abrir</a>
        <button class="btn sm danger" data-del="${p.id}">✕</button>
      </div>`);
    node.querySelector("[data-del]").onclick = async () => { await api.del(`/api/posts/${p.id}`); viewPosts(); };
    list.appendChild(node);
  });
}
async function refreshAllPosts() {
  const { posts } = await api.get("/api/posts");
  toast("Atualizando...");
  for (const p of posts) await api.post(`/api/posts/${p.id}/refresh`, {});
  viewPosts();
}

// ============================ CALENDÁRIO ============================
async function viewCalendar() {
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  const opts = clients.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>📅 Calendário de Conteúdo</h1>
        <p class="page-sub">Planeje o ritmo (modelo do vídeo: 60 vídeos em 3 meses, seg–sex).</p>
        <div class="card" style="margin-bottom:16px">
          <div class="row">
            <div class="field" style="flex:1;margin:0"><label>Cliente</label><select id="cal_client">${opts || "<option value=''>Cadastre um cliente</option>"}</select></div>
            <div class="field" style="margin:0"><label>Qtd. vídeos</label><input id="cal_count" type="number" value="60" style="width:90px"></div>
            <div style="display:flex;align-items:flex-end"><button class="btn primary" onclick="genPlan()" ${clients.length ? "" : "disabled"}>Gerar plano</button></div>
          </div>
        </div>
      </div>
      <div class="view-body" id="calList"></div>
    </div>`;
  setTimeout(loadCalendar, 0);
}
async function loadCalendar() {
  const cid = $("cal_client")?.value;
  const { calendar } = await api.get("/api/calendar" + (cid ? `?clientId=${cid}` : ""));
  const list = $("calList");
  if (!calendar.length) { list.innerHTML = '<p class="empty">Nenhum vídeo planejado. Gere um plano acima.</p>'; return; }
  list.innerHTML = "";
  calendar.sort((a, b) => a.date.localeCompare(b.date)).forEach(item => {
    const node = el(`
      <div class="cal-row">
        <span class="muted">${item.date.split("-").reverse().join("/")}</span>
        <span>${item.theme}</span>
        <select data-status="${item.id}">
          ${["planejado", "roteiro pronto", "gravado", "postado"].map(s => `<option ${item.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <button class="btn sm danger" data-del="${item.id}">✕</button>
      </div>`);
    node.querySelector("[data-status]").onchange = (e) => api.put(`/api/calendar/${item.id}`, { status: e.target.value }).then(() => toast("Atualizado"));
    node.querySelector("[data-del]").onclick = () => api.del(`/api/calendar/${item.id}`).then(() => loadCalendar());
    list.appendChild(node);
  });
}
async function genPlan() {
  const clientId = $("cal_client").value;
  const count = Number($("cal_count").value) || 60;
  toast("Gerando plano...");
  const r = await api.post("/api/calendar/plan", { clientId, count });
  if (r.ok) { toast(`${r.items.length} vídeos planejados`); loadCalendar(); }
}

// ============================ CONFIGURAÇÕES ============================
async function viewSettings() {
  const badge = (on) => on
    ? `<span class="tag green"><span class="material-icons-round" style="font-size:12px;vertical-align:middle">check</span> conectado</span>`
    : `<span class="tag amber">não configurado</span>`;

  // Carrega estado atual das chaves do banco
  const kr = await api.get("/api/settings/integrations");
  const keys = kr.keys || {};

  const keyCard = (envKey, icon, color, label) => {
    const info = keys[envKey] || {};
    return `
    <div class="integration-card" id="kcard_${envKey}">
      <div class="integration-info">
        <span class="material-icons-round int-icon ${color}">${icon}</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${label}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;font-family:monospace">
            ${info.configured ? info.masked : "Não configurada"}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${info.configured ? `<span class="tag green" style="font-size:11px">ativa</span>` : `<span class="tag amber" style="font-size:11px">vazia</span>`}
        <button class="btn sm ghost" onclick="editApiKey('${envKey}')">
          <span class="material-icons-round" style="font-size:14px">edit</span>
        </button>
      </div>
    </div>`;
  };

  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>Configurações</h1>
        <p class="page-sub">Integrações de produção e redes sociais da sua agência.</p>
      </div>
      <div class="view-body">
        <h2 style="margin-bottom:10px">Chaves de API</h2>
        <div class="card" style="margin-bottom:24px;padding:16px 20px">
          <p class="muted" style="font-size:13px;margin-bottom:14px">As chaves são salvas de forma segura no banco de dados do servidor. Nenhum arquivo precisa ser editado manualmente.</p>
          ${keyCard("AYRSHARE_API_KEY",    "share",         "indigo", "Ayrshare — Publicação social")}
          ${keyCard("ELEVENLABS_API_KEY",  "mic",           "green",  "ElevenLabs — Clonagem de voz")}
          ${keyCard("HEYGEN_API_KEY",      "face",          "purple", "HeyGen — Avatar (lip-sync)")}
          ${keyCard("PEXELS_API_KEY",      "video_library", "teal",   "Pexels — B-roll automático")}
          ${keyCard("NXS_API_KEY",         "psychology",    "blue",   "NXS / LLM — Geração de roteiro")}
          ${keyCard("REPLICATE_API_TOKEN", "movie_filter",  "orange", "Replicate — SadTalker avatar")}
        </div>

        <h2 style="margin-bottom:10px">Redes sociais</h2>
        <div id="socialSection">
          <div class="card" style="text-align:center;padding:32px">
            <span class="spinner"></span>
            <div class="muted" style="margin-top:10px;font-size:13px">Verificando conexões…</div>
          </div>
        </div>
      </div>
    </div>`;

  loadSocialStatus();
}

function editApiKey(envKey) {
  const labels = {
    AYRSHARE_API_KEY:    "Ayrshare — Publicação social",
    ELEVENLABS_API_KEY:  "ElevenLabs — Clonagem de voz",
    HEYGEN_API_KEY:      "HeyGen — Avatar (lip-sync)",
    PEXELS_API_KEY:      "Pexels — B-roll automático",
    NXS_API_KEY:         "NXS / LLM — Geração de roteiro",
    REPLICATE_API_TOKEN: "Replicate — SadTalker avatar",
  };
  const label = labels[envKey] || envKey;
  openModal(`
    <h2 style="margin-bottom:6px">Chave de API</h2>
    <p class="muted" style="font-size:13px;margin-bottom:18px">${label}</p>
    <div class="field">
      <label>Valor da chave</label>
      <input id="apikey_input" type="password" placeholder="Cole a chave aqui…" autocomplete="off"
             style="font-family:monospace;letter-spacing:.04em"
             onkeydown="if(event.key==='Enter')saveApiKeyModal('${envKey}')">
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <input type="checkbox" id="apikey_show" onchange="toggleApiKeyVisible()" style="width:auto;margin:0">
        <label for="apikey_show" style="font-size:12px;margin:0;cursor:pointer">Mostrar chave</label>
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-bottom:18px">Deixe vazio e salve para remover a chave.</p>
    <div class="row">
      <button class="btn primary" onclick="saveApiKeyModal('${envKey}')">Salvar</button>
      <button class="btn ghost" onclick="closeModal()">Cancelar</button>
    </div>`);
  setTimeout(() => $("apikey_input")?.focus(), 80);
}

function updateFileName(inputId, spanId) {
  const files = $(inputId)?.files;
  if (!files?.length) return;
  const span = $(spanId);
  if (span) span.textContent = files.length > 1 ? `${files.length} arquivos selecionados` : files[0].name;
}

function toggleApiKeyVisible() {
  const inp = $("apikey_input");
  if (inp) inp.type = $("apikey_show").checked ? "text" : "password";
}

async function saveApiKeyModal(envKey) {
  const val = ($("apikey_input")?.value || "").trim();
  const r = await api.post("/api/settings/integrations", { key: envKey, value: val });
  if (r.ok) {
    closeModal();
    toast(val ? "Chave salva com sucesso." : "Chave removida.");
    const st = await api.get("/api/status");
    if (st.integrations) STATE.status.integrations = st.integrations;
    viewSettings();
  } else {
    toast(r.error || "Erro ao salvar", "err");
  }
}

const SOCIAL_PLATFORMS = [
  { key: "instagram", icon: "ig", label: "Instagram", sub: "Reels e feed", svgColor: "#e1306c" },
  { key: "tiktok",   icon: "tt", label: "TikTok",    sub: "Vídeos curtos", svgColor: "#010101" },
  { key: "youtube",  icon: "yt", label: "YouTube",   sub: "Shorts e canal", svgColor: "#ff0000" },
  { key: "linkedin", icon: "li", label: "LinkedIn",  sub: "Vídeos profissionais", svgColor: "#0077b5" },
  { key: "twitter",  icon: "tw", label: "X (Twitter)", sub: "Vídeos e clipes", svgColor: "#14171a" },
  { key: "facebook", icon: "fb", label: "Facebook",  sub: "Reels e feed", svgColor: "#1877f2" },
];

// SVG logos das plataformas (sem emojis)
const SOCIAL_SVG = {
  ig: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`,
  tt: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.3 6.3 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.79 1.53V6.78a4.85 4.85 0 01-1.02-.09z"/></svg>`,
  yt: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>`,
  li: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  tw: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  fb: `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
};

async function loadSocialStatus() {
  const sec = $("socialSection");
  if (!sec) return;
  const r = await api.get("/api/social/status");
  const connected = new Set((r.platforms || []).map(p => p.toLowerCase()));
  const ready = r.configured;

  const cards = SOCIAL_PLATFORMS.map(p => {
    const isOn = connected.has(p.key);
    const svg = SOCIAL_SVG[p.icon] || "";
    return `
      <div class="social-card" style="margin-bottom:8px">
        <div class="social-icon ${p.icon}" style="background:${p.svgColor}">${svg}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${p.label}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${isOn ? "✓ Conta conectada" : p.sub}</div>
        </div>
        <div>
          ${isOn
            ? `<span class="tag green">Ativo</span>`
            : `<button class="btn sm primary" onclick="connectSocial('${p.key}', this)">
                <span class="material-icons-round" style="font-size:15px">add_link</span> Conectar
              </button>`}
        </div>
      </div>`;
  }).join("");

  const foot = `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
    <div class="row" style="gap:8px;margin-bottom:${ready ? "0" : "12px"}">
      ${ready ? `<button class="btn primary" onclick="openAyrshareConnect(null, this)">
          <span class="material-icons-round" style="font-size:16px">open_in_new</span>
          Gerenciar todas as contas
        </button>` : ""}
      <button class="btn ghost sm" onclick="loadSocialStatus()">
        <span class="material-icons-round" style="font-size:16px">refresh</span> Atualizar
      </button>
    </div>
    ${!ready ? `<p class="muted" style="font-size:12px;margin-top:8px">
      <span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:var(--amber)">info</span>
      Para ativar: adicione a chave <b>Ayrshare</b> em <b>Chaves de API</b> acima, depois clique em Conectar em cada rede.
    </p>` : ""}
  </div>`;

  const connectedCount = SOCIAL_PLATFORMS.filter(p => connected.has(p.key)).length;
  sec.innerHTML = `
    <div class="card">
      <div class="row between" style="margin-bottom:16px">
        <div>
          <b style="font-size:14px">Contas nas redes sociais</b>
          <div class="muted" style="font-size:12px;margin-top:2px">Conecte uma vez e publique em todas com um clique</div>
        </div>
        ${ready
          ? `<span class="tag ${connectedCount > 0 ? "green" : "brand"}">${connectedCount > 0 ? connectedCount + " conectada(s)" : "Pronto para conectar"}</span>`
          : `<span class="tag">Aguardando ativação</span>`}
      </div>
      ${cards}
      ${foot}
    </div>`;
}

async function connectSocial(platform, btnEl) {
  const r = await api.get("/api/social/status");
  if (!r.configured) {
    toast("Configure a chave Ayrshare em Chaves de API antes de conectar.", "err");
    // Rola a página até a seção de chaves
    document.querySelector("#kcard_AYRSHARE_API_KEY")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  await openAyrshareConnect(platform, btnEl);
}

async function openAyrshareConnect(platform, btnEl) {
  // Abre o dashboard Ayrshare onde o usuário conecta as redes sociais.
  // Funciona com qualquer plano Ayrshare (sem JWT / Business plan).
  window.open("https://app.ayrshare.com/dashboard/social-networks", "_blank", "width=1100,height=720");
  toast("Conecte suas redes no Ayrshare e clique em Atualizar aqui quando pronto.");
  // Aguarda 8s e atualiza automaticamente o status
  setTimeout(() => loadSocialStatus(), 8000);
}

// ============================ PERFIL DE IA ============================
async function viewProfile() {
  const r = await api.get("/api/profile");
  const p = r.profile || {};
  const hasPhoto = Boolean(p.photoUrl);
  const hasVoice = Boolean(p.voiceId);
  const isComplete = hasPhoto && hasVoice;

  $("view").innerHTML = `
    <div class="view-wrap">
    <div class="view-head">
    <h1>Perfil de IA</h1>
    <p class="page-sub">Configure seu rosto e voz uma vez — gere vídeos com você falando qualquer roteiro.</p>
    </div>
    <div class="view-body">

    ${isComplete ? `
    <div class="profile-complete-banner">
      <span class="material-icons-round" style="font-size:32px;color:var(--green)">verified</span>
      <div>
        <div style="font-weight:700;font-size:15px">Perfil completo!</div>
        <div class="muted" style="font-size:13px">Seu rosto e voz estão prontos. Vá em <b>Estúdio</b> para gerar um roteiro e depois em <b>Vídeos</b> para produzir.</div>
      </div>
      <button class="btn primary" style="margin-left:auto;flex-shrink:0" onclick="navigate('studio')">
        <span class="material-icons-round" style="font-size:16px">edit_note</span> Gerar roteiro
      </button>
    </div>` : ""}

    <!-- PASSO 1: ROSTO -->
    <div class="profile-step" id="stepFace">
      <div class="profile-step-header" onclick="toggleStep('stepFace')">
        <div class="step-num ${hasPhoto ? "done" : "active"}">${hasPhoto ? "✓" : "1"}</div>
        <span class="material-icons-round int-icon purple" style="margin:0">face</span>
        <div style="flex:1">
          <div style="font-weight:600">Seu rosto (foto)</div>
          <div class="muted" style="font-size:12px">${hasPhoto ? "Foto enviada — avatar pronto para lip-sync" : "Envie uma foto sua para criar o avatar falante"}</div>
        </div>
        <span class="material-icons-round" style="color:var(--muted)">expand_more</span>
      </div>
      <div class="profile-step-body" id="stepFaceBody">
        <div style="padding-top:16px">
          ${hasPhoto ? `<img src="${p.photoUrl}" class="profile-preview-img" alt="Sua foto" /><br>` : ""}
          <p class="muted" style="font-size:13px;margin:${hasPhoto ? "12px" : "0"} 0 14px">
            Use uma foto <b>frontal, com boa iluminação</b>, olhando para a câmera. Evite óculos escuros ou bonés.
          </p>
          <div class="field">
            <label>Selecione a foto (JPG/PNG)</label>
            <label class="file-btn" onclick="void(0)">
              <span class="material-icons-round" style="font-size:16px">image</span>
              <span class="file-name" id="prof_photo_name">Nenhum arquivo escolhido</span>
              <input type="file" class="file-input-hidden" id="prof_photo" accept="image/*" onchange="updateFileName('prof_photo','prof_photo_name')">
            </label>
          </div>
          <button class="btn primary" onclick="uploadProfilePhoto(this)">
            <span class="material-icons-round" style="font-size:16px">upload</span>
            ${hasPhoto ? "Trocar foto" : "Enviar foto"}
          </button>
        </div>
      </div>
    </div>

    <!-- PASSO 2: VOZ -->
    <div class="profile-step" id="stepVoice">
      <div class="profile-step-header" onclick="toggleStep('stepVoice')">
        <div class="step-num ${hasVoice ? "done" : hasPhoto ? "active" : ""}">${hasVoice ? "✓" : "2"}</div>
        <span class="material-icons-round int-icon green" style="margin:0">mic</span>
        <div style="flex:1">
          <div style="font-weight:600">Sua voz (clone)</div>
          <div class="muted" style="font-size:12px">${hasVoice ? "Voz clonada — pronta para narrar qualquer roteiro" : "Envie áudio para a IA aprender a imitar sua voz"}</div>
        </div>
        <span class="material-icons-round" style="color:var(--muted)">expand_more</span>
      </div>
      <div class="profile-step-body" id="stepVoiceBody">
        <div style="padding-top:16px">
          <p class="muted" style="font-size:13px;margin-bottom:14px">
            Envie <b>1 a 5 minutos</b> de você falando naturalmente — como uma explicação ou conversa. Qualidade de microfone é importante.
          </p>
          <div class="field">
            <label>Arquivo(s) de áudio (MP3/WAV/M4A)</label>
            <label class="file-btn" onclick="void(0)">
              <span class="material-icons-round" style="font-size:16px">graphic_eq</span>
              <span class="file-name" id="prof_voice_name">Nenhum arquivo escolhido</span>
              <input type="file" class="file-input-hidden" id="prof_voice" accept="audio/*" multiple onchange="updateFileName('prof_voice','prof_voice_name')">
            </label>
          </div>
          <button class="btn primary" onclick="uploadProfileVoice(this)">
            <span class="material-icons-round" style="font-size:16px">graphic_eq</span>
            ${hasVoice ? "Reclone a voz" : "Clonar minha voz"}
          </button>
          ${hasVoice ? `
          <button class="btn" style="margin-left:8px" onclick="testVoice()">
            <span class="material-icons-round" style="font-size:16px">play_arrow</span> Testar voz
          </button>` : ""}
          <div id="voiceTestOut" style="margin-top:10px"></div>
        </div>
      </div>
    </div>

    <!-- PASSO 3: VÍDEO DE TESTE -->
    <div class="profile-step" id="stepVideo">
      <div class="profile-step-header" onclick="toggleStep('stepVideo')">
        <div class="step-num ${isComplete ? "active" : ""}" style="${!isComplete ? "opacity:.4" : ""}">3</div>
        <span class="material-icons-round int-icon orange" style="margin:0;${!isComplete ? "opacity:.4" : ""}">movie_filter</span>
        <div style="flex:1">
          <div style="font-weight:600" style="${!isComplete ? "opacity:.5" : ""}">Vídeo de teste</div>
          <div class="muted" style="font-size:12px">${isComplete ? "Gere um vídeo curto com você falando um roteiro de exemplo" : "Complete os passos 1 e 2 primeiro"}</div>
        </div>
        <span class="material-icons-round" style="color:var(--muted)">expand_more</span>
      </div>
      <div class="profile-step-body" id="stepVideoBody">
        <div style="padding-top:16px">
          ${!isComplete ? `
          <div class="test-video-card">
            <span class="material-icons-round" style="font-size:48px;color:var(--muted-2)">lock</span>
            <p class="muted" style="margin-top:8px">Configure o rosto e a voz primeiro.</p>
          </div>` : `
          <div class="field">
            <label>Tema do vídeo de teste</label>
            <input id="prof_theme" placeholder="ex: como ser mais produtivo de manhã" value="">
          </div>
          <div id="testVideoResult"></div>
          <button class="btn primary" id="testVideoBtn" onclick="generateTestVideo(this)">
            <span class="material-icons-round" style="font-size:16px">auto_awesome</span>
            Gerar vídeo de teste
          </button>`}
        </div>
      </div>
    </div>
    </div></div>`;
}

function toggleStep(id) {
  const body = $(`${id}Body`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "";
}

async function uploadProfilePhoto(btn) {
  const f = $("prof_photo").files[0];
  if (!f) return toast("Selecione uma imagem", "err");
  const fd = new FormData(); fd.append("photo", f);
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando...';
  const r = await aiApi.upload("/api/profile/photo", fd);
  btn.disabled = false;
  if (r.ok) { toast("Foto salva! Seu avatar está pronto."); viewProfile(); }
  else toast(r.error || "Erro ao enviar foto", "err");
}

async function uploadProfileVoice(btn) {
  const files = $("prof_voice").files;
  if (!files.length) return toast("Selecione ao menos um arquivo de áudio", "err");
  const fd = new FormData();
  [...files].forEach(f => fd.append("samples", f));
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Clonando voz...';
  const r = await aiApi.upload("/api/profile/voice", fd);
  btn.disabled = false;
  if (r.ok) { toast("Voz clonada com sucesso!"); viewProfile(); }
  else toast(r.error || "Erro ao clonar voz", "err");
}

async function testVoice() {
  const out = $("voiceTestOut");
  out.innerHTML = '<span class="spinner"></span>';
  const r = await aiApi.post("/api/profile/voice-test", { text: "Olá! Esta é minha voz clonada pela inteligência artificial. Ficou parecida?" });
  if (r.ok && r.audioUrl) {
    out.innerHTML = `<audio controls style="width:100%;margin-top:8px" src="${r.audioUrl}"></audio>`;
  } else {
    out.innerHTML = `<span class="err">${r.error || "Erro ao gerar áudio"}</span>`;
  }
}

async function generateTestVideo(btn) {
  const theme = $("prof_theme")?.value?.trim();
  if (!theme) return toast("Informe o tema do vídeo", "err");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gerando roteiro e vídeo...';
  const out = $("testVideoResult");
  out.innerHTML = "";
  const r = await aiApi.post("/api/profile/test-video", { theme });
  btn.disabled = false;
  btn.innerHTML = '<span class="material-icons-round" style="font-size:16px">auto_awesome</span> Gerar vídeo de teste';
  if (r.ok) {
    out.innerHTML = `
      <div class="card" style="margin-bottom:12px;background:var(--surface-2)">
        <div style="font-weight:600;margin-bottom:6px">Roteiro gerado:</div>
        <p style="font-size:13px;color:var(--text-2);line-height:1.6">${r.hook || ""} ${r.script || ""}</p>
        ${r.videoId ? `<div style="margin-top:10px"><a class="btn sm primary" href="/api/videos/${r.videoId}/status" target="_blank">Ver vídeo</a></div>` : ""}
      </div>`;
    toast("Vídeo em produção! Veja em Vídeos.");
  } else {
    toast(r.error || "Erro ao gerar vídeo", "err");
  }
}

// ============================ ADMIN — APROVAÇÕES ============================
async function viewAdmin() {
  if (!STATE.fbUser?.isAdmin) { $("view").innerHTML = '<div class="view-wrap"><div class="view-head"><h1>🛡️ Aprovações</h1></div><div class="view-body"><p class="empty">Acesso restrito ao administrador.</p></div></div>'; return; }
  const r = await api.get("/api/admin/users");
  const users = r.users || [];
  const pend = users.filter(u => !u.approved).length;
  $("view").innerHTML = `
    <div class="view-wrap">
      <div class="view-head">
        <h1>🛡️ Aprovações de acesso</h1>
        <p class="page-sub">Aprove ou revogue o acesso de cada conta registrada no Firebase. ${pend ? `<b style="color:var(--amber)">${pend} pendente(s)</b>` : "Tudo em dia."}</p>
      </div>
      <div class="view-body">
        <div id="adminList">${users.length ? "" : '<p class="empty">Nenhum usuário registrado ainda.</p>'}</div>
      </div>
    </div>`;
  const list = $("adminList");
  users.forEach(u => {
    const node = el(`
      <div class="list-item">
        <div class="avatar-circle">${u.isAdmin ? "🛡️" : (u.approved ? "✅" : "⏳")}</div>
        <div style="flex:1">
          <div style="font-weight:600">${u.email} ${u.isAdmin ? '<span class="tag brand">admin</span>' : ""}</div>
          <div class="row" style="margin-top:4px">
            <span class="tag ${u.approved ? "green" : "amber"}">${u.approved ? "aprovado" : "pendente"}</span>
            <span class="muted" style="font-size:12px">criado ${u.createdAt ? new Date(u.createdAt).toLocaleDateString("pt-BR") : "—"}${u.lastSignIn ? " · último acesso " + new Date(u.lastSignIn).toLocaleDateString("pt-BR") : ""}</span>
          </div>
        </div>
        ${u.isAdmin ? "" : (u.approved
          ? `<button class="btn sm danger" data-revoke="${u.uid}">Revogar</button>`
          : `<button class="btn sm primary" data-approve="${u.uid}">✓ Aprovar</button>`)}
      </div>`);
    const ap = node.querySelector("[data-approve]");
    if (ap) ap.onclick = async () => { ap.disabled = true; await api.post("/api/admin/approve", { uid: u.uid, approved: true }); toast("Conta aprovada"); viewAdmin(); };
    const rv = node.querySelector("[data-revoke]");
    if (rv) rv.onclick = async () => { if (!confirm("Revogar o acesso desta conta?")) return; await api.post("/api/admin/approve", { uid: u.uid, approved: false }); toast("Acesso revogado"); viewAdmin(); };
    list.appendChild(node);
  });
}

// ============================ TUTORIAL GUIADO ============================
// Passo a passo com FOCO no item explicado: navega até a aba, ilumina o
// menu correspondente e mostra um cartão explicando aquela etapa.
const TUTORIAL = [
  { view: "dashboard", title: "Bem-vindo ao Verzius 👋",
    body: `Esta é sua <b>agência de vídeos curtos com IA</b>. Em poucos cliques: roteiro viral → voz → legendas → vídeo pronto pra postar.<br><br>O <b>Dashboard</b> mostra seus números: clientes, vídeos, roteiros e <b>views reais</b> das publicações.` },
  { view: "clients", title: "1. Cadastre o cliente",
    body: `Cada cliente tem <b>nicho, tom de voz, avatar e voz próprios</b>.<ul><li>Crie o cliente</li><li>Suba <b>1 foto</b> (frontal, sorrindo) → vira o avatar</li><li>Suba <b>1–5 min de áudio</b> → clona a voz</li></ul>O cliente não grava nada — esse é o argumento de venda.` },
  { view: "studio", title: "2. Estúdio de Roteiro (o ouro)",
    body: `O motor de viralização gera roteiros prontos pro avatar ler — sem trends, foco em autoridade.<ul><li><b>Verzius Score</b> e <b>Força do Hook (3s)</b> preveem o potencial</li><li>Gere variações A/B e escolha a melhor</li><li>Hook visual mudo + palavras-chave destacadas</li></ul>` },
  { view: "videos", title: "3. Produza e edite",
    body: `A partir do roteiro salvo, o Verzius gera o vídeo e faz a <b>edição automática</b>:<ul><li>Legendas <b>karaoke</b> sincronizadas à voz real</li><li>B-roll com zoom + áudio normalizado</li><li>Formato vertical 9:16, pronto pra postar</li></ul>Com foto + Replicate, dá pra gerar <b>avatar falante</b> (lip-sync).` },
  { view: "posts", title: "4. Publique e meça",
    body: `Poste direto no Instagram/TikTok/YouTube (via Ayrshare) e acompanhe as <b>métricas que importam</b>:<ul><li><b>Hook rate</b> (retenção em 3s)</li><li><b>Saves</b> e sends/reach</li><li>Views, likes, comentários</li></ul>` },
  { view: "calendar", title: "5. Calendário de conteúdo",
    body: `Consistência > intensidade. Gere um plano de <b>60 vídeos em ~3 meses</b> (seg–sex) com um clique e acompanhe o status de cada um (planejado → postado).` },
  { view: "settings", title: "6. Integrações",
    body: `Aqui você liga o modo <b>LIVE</b>: roteiro (Claude/NXS), voz (ElevenLabs), B-roll (Pexels), edição (FFmpeg), publicação (Ayrshare) e avatar (Replicate).<br><br>Cada peça tem <b>fallback demo</b> — o app funciona mesmo sem chaves.` },
];
let TUT_I = 0;
function startTutorial() { TUT_I = 0; localStorage.setItem("verzius_tut_seen", "1"); tutShow(); }
function tutEnd() {
  document.getElementById("tutOverlay")?.remove();
  document.getElementById("tutCard")?.remove();
}
function tutShow() {
  const step = TUTORIAL[TUT_I];
  navigate(step.view);
  let overlay = document.getElementById("tutOverlay");
  if (!overlay) { overlay = el(`<div id="tutOverlay" class="tut-overlay"></div>`); overlay.onclick = tutEnd; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tut-spot" id="tutSpot"></div>`;
  // posiciona o spotlight sobre o item de menu correspondente
  const target = document.querySelector(`.sidebar nav a[data-view="${step.view}"]`);
  const spot = document.getElementById("tutSpot");
  if (target && spot) {
    const r = target.getBoundingClientRect();
    Object.assign(spot.style, { left: `${r.left - 6}px`, top: `${r.top - 4}px`, width: `${r.width + 12}px`, height: `${r.height + 8}px` });
  }
  let card = document.getElementById("tutCard");
  if (!card) { card = el(`<div id="tutCard" class="tut-card"></div>`); document.body.appendChild(card); }
  const dots = TUTORIAL.map((_, i) => `<span class="tut-dot ${i === TUT_I ? "on" : ""}"></span>`).join("");
  card.innerHTML = `
    <div class="tut-step">Passo ${TUT_I + 1} de ${TUTORIAL.length}</div>
    <h3>${step.title}</h3>
    <p>${step.body}</p>
    <div class="tut-actions">
      <div class="tut-dots">${dots}</div>
      <div class="row" style="gap:8px">
        <button class="btn sm ghost" onclick="tutEnd()">Pular</button>
        ${TUT_I > 0 ? `<button class="btn sm" onclick="tutPrev()">Voltar</button>` : ""}
        <button class="btn sm primary" onclick="tutNext()">${TUT_I === TUTORIAL.length - 1 ? "Concluir ✓" : "Próximo →"}</button>
      </div>
    </div>`;
  // posiciona o cartão ao lado do menu
  const tr = (target || document.body).getBoundingClientRect();
  card.style.left = `${Math.min(tr.right + 18, window.innerWidth - 360)}px`;
  card.style.top = `${Math.max(20, Math.min(tr.top - 10, window.innerHeight - 320))}px`;
}
function tutNext() { if (TUT_I === TUTORIAL.length - 1) return tutEnd(); TUT_I++; tutShow(); }
function tutPrev() { if (TUT_I > 0) { TUT_I--; tutShow(); } }

// start
boot();
window.doAuth = doAuth; window.toggleAuthMode = toggleAuthMode; window.renderAuthScreen = renderAuthScreen; window.doLogout = doLogout;
window.closeModal = closeModal; window.navigate = navigate;
window.openClientForm = openClientForm; window.saveClient = saveClient; window.openClient = openClient;
window.uploadPhoto = uploadPhoto; window.uploadVoice = uploadVoice; window.setAvatarId = setAvatarId; window.deleteClient = deleteClient;
window.generateScripts = generateScripts; window.saveScript = saveScript; window.setStudioClient = setStudioClient;
window.produceVideo = produceVideo; window.genPlan = genPlan; window.generateAvatar = generateAvatar;
window.openPublish = openPublish; window.doPublish = doPublish; window.refreshAllPosts = refreshAllPosts;
window.startTutorial = startTutorial; window.tutNext = tutNext; window.tutPrev = tutPrev; window.tutEnd = tutEnd;
window.fbAuth = fbAuth; window.recheckApproval = recheckApproval;
window.connectSocial = connectSocial; window.openAyrshareConnect = openAyrshareConnect;
window.loadSocialStatus = loadSocialStatus; window.editApiKey = editApiKey;
window.saveApiKeyModal = saveApiKeyModal; window.toggleApiKeyVisible = toggleApiKeyVisible; window.updateFileName = updateFileName;
window.toggleStep = toggleStep;
window.uploadProfilePhoto = uploadProfilePhoto; window.uploadProfileVoice = uploadProfileVoice;
window.testVoice = testVoice; window.generateTestVideo = generateTestVideo;
