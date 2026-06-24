// ============================ Verzius — SPA ============================
const TOKEN_KEY = "verzius_token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
const authHeaders = (extra = {}) => { const t = getToken(); return t ? { ...extra, Authorization: `Bearer ${t}` } : extra; };
const api = {
  async get(p) { return (await fetch(p, { headers: authHeaders() })).json(); },
  async post(p, body) { return (await fetch(p, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })).json(); },
  async put(p, body) { return (await fetch(p, { method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })).json(); },
  async del(p) { return (await fetch(p, { method: "DELETE", headers: authHeaders() })).json(); },
  async upload(p, formData) { return (await fetch(p, { method: "POST", headers: authHeaders(), body: formData })).json(); },
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
async function boot() {
  STATE.status = await api.get("/api/status");
  if (STATE.status.multiuser) {
    // exige sessao: valida o token guardado
    const me = await api.get("/api/me");
    if (me.user) { STATE.user = me.user; $("login").classList.add("hidden"); showApp(); }
    else { setToken(""); renderAuthScreen(); }
  } else {
    // modo aberto (DEMO) — sem login
    showApp();
  }
}
function renderAuthScreen() {
  const signup = AUTH_MODE === "signup";
  $("login").classList.remove("hidden");
  $("login").innerHTML = `
    <div class="login-card">
      <div class="logo-big">▶ Verz<span>ius</span></div>
      <p class="muted">${signup ? "Crie a conta da sua agência" : "Entre na sua conta"}</p>
      ${signup ? `<input id="au_name" placeholder="Seu nome / agência" />` : ""}
      <input id="au_email" type="email" placeholder="E-mail" />
      <input id="au_pass" type="password" placeholder="Senha (mín. 6)" onkeydown="if(event.key==='Enter')doAuth()" />
      <button class="btn primary" onclick="doAuth()">${signup ? "Criar conta" : "Entrar"}</button>
      <p id="loginErr" class="err hidden"></p>
      <p class="muted" style="font-size:13px;margin-top:12px;cursor:pointer" onclick="toggleAuthMode()">
        ${signup ? "Já tem conta? <b>Entrar</b>" : "Ainda não tem conta? <b>Criar agência</b>"}
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
      ? `<span class="muted" style="font-size:12px">👤 ${STATE.user.name}</span><button class="btn sm ghost" onclick="doLogout()">Sair</button>`
      : `<button class="btn sm ghost" onclick="renderAuthScreen()">Criar agência / Entrar</button>`;
  }
  document.querySelectorAll(".sidebar nav a").forEach(a => {
    a.onclick = () => navigate(a.dataset.view);
  });
  navigate("dashboard");
  // primeira visita: abre o tutorial guiado automaticamente
  if (!localStorage.getItem("verzius_tut_seen")) setTimeout(startTutorial, 700);
}
function navigate(view) {
  STATE.currentView = view;
  document.querySelectorAll(".sidebar nav a").forEach(a => a.classList.toggle("active", a.dataset.view === view));
  ({ dashboard: viewDashboard, clients: viewClients, studio: viewStudio, videos: viewVideos, posts: viewPosts, calendar: viewCalendar, settings: viewSettings }[view])();
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
    <h1>Dashboard</h1>
    <p class="page-sub">Visão geral da sua agência de conteúdo com IA.</p>
    <div class="grid cols-4">
      <div class="card stat"><div class="num brand">${clients.length}</div><div class="lbl">Clientes ativos</div></div>
      <div class="card stat"><div class="num">${videos.length}</div><div class="lbl">Vídeos gerados</div></div>
      <div class="card stat"><div class="num">${scripts.length}</div><div class="lbl">Roteiros salvos</div></div>
      <div class="card stat"><div class="num">${totalViews.toLocaleString("pt-BR")}</div><div class="lbl">Views (registradas)</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:24px">
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
    </div>`;
  const box = $("dashClients");
  clients.slice(0, 5).forEach(c => box.appendChild(clientRow(c)));
}

// ============================ CLIENTES ============================
async function viewClients() {
  const { clients } = await api.get("/api/clients");
  STATE.clients = clients;
  $("view").innerHTML = `
    <div class="row between"><div><h1>Clientes</h1><p class="page-sub">Cada cliente tem seu avatar, voz e estilo de conteúdo.</p></div>
    <button class="btn primary" onclick="openClientForm()">+ Novo cliente</button></div>
    <div id="clientsList">${clients.length ? "" : '<p class="empty">Nenhum cliente cadastrado.</p>'}</div>`;
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
      <label>📸 Foto do avatar (HeyGen) — sorrindo, ângulo frontal, sem boné</label>
      <input type="file" id="up_photo" accept="image/*" style="margin:8px 0">
      <button class="btn sm" onclick="uploadPhoto('${c.id}')">Enviar foto</button>
      ${c.avatarNote ? `<p class="muted" style="font-size:12px;margin-top:8px">${c.avatarNote}</p>` : ""}
    </div>
    <div class="card" style="margin-bottom:12px">
      <label>🎙️ Áudio da voz (ElevenLabs) — 1 a 5 min falando naturalmente</label>
      <input type="file" id="up_voice" accept="audio/*" multiple style="margin:8px 0">
      <button class="btn sm" onclick="uploadVoice('${c.id}')">Enviar áudio</button>
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
  const r = await api.upload(`/api/clients/${id}/photo`, fd);
  if (r.ok) { toast(r.integration?.demo ? "Foto salva (demo)" : "Avatar registrado"); openClient(id); }
  else toast(r.error || "Erro", "err");
}
async function uploadVoice(id) {
  const files = $("up_voice").files;
  if (!files.length) return toast("Selecione o áudio", "err");
  const fd = new FormData(); [...files].forEach(f => fd.append("samples", f));
  toast("Clonando voz...");
  const r = await api.upload(`/api/clients/${id}/voice`, fd);
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
    <h1>✍️ Estúdio de Roteiro</h1>
    <p class="page-sub">O motor de viralização gera roteiros prontos para o avatar ler. Sem trends, foco em autoridade.</p>
    <div class="card">
      <div class="grid cols-2">
        <div class="field"><label>Cliente</label><select id="st_client">${opts}</select></div>
        <div class="field"><label>Variações</label><select id="st_count"><option>3</option><option>5</option><option>1</option></select></div>
      </div>
      <div class="field"><label>Tema do vídeo *</label><input id="st_theme" placeholder="ex: erros que destroem o sono / como economizar imposto legalmente" value="${STUDIO.theme}"></div>
      <button class="btn primary" id="genBtn" onclick="generateScripts()">Gerar roteiros virais</button>
    </div>
    <div id="variations" style="margin-top:22px"></div>`;
  if (STUDIO.variations.length) renderVariations();
}

async function generateScripts() {
  const theme = $("st_theme").value.trim();
  if (!theme) return toast("Informe o tema", "err");
  const btn = $("genBtn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gerando...';
  STUDIO.clientId = $("st_client").value; STUDIO.theme = theme;
  const r = await api.post("/api/scripts/generate", { clientId: STUDIO.clientId || null, theme, count: Number($("st_count").value), niche: STATE.clients.find(c => c.id === STUDIO.clientId)?.niche });
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
    <h1>🎬 Vídeos</h1>
    <p class="page-sub">Produza vídeos com avatar a partir dos roteiros salvos.</p>
    <div class="card" style="margin-bottom:22px">
      <h2>Produzir novo vídeo</h2>
      <div class="grid cols-2">
        <div class="field"><label>Roteiro salvo</label><select id="v_script">
          ${scripts.length ? scripts.map(s => `<option value="${s.id}|${s.clientId || ""}">${(s.hook || s.theme || "roteiro").slice(0, 50)}… · ${cname(s.clientId)}</option>`).join("") : "<option value=''>Nenhum roteiro salvo</option>"}
        </select></div>
        <div class="field" style="display:flex;align-items:flex-end"><button class="btn primary" onclick="produceVideo()" ${scripts.length ? "" : "disabled"}>▶ Gerar vídeo</button></div>
      </div>
      <p class="muted" style="font-size:12px">${STATE.status.integrations.avatar.configured ? "HeyGen conectado (avatar falante)." : STATE.status.integrations.voice.configured ? "Sem avatar: o vídeo final é gerado com <b>voz real (ElevenLabs)</b> + legendas/B-roll na edição." : "Modo demo: vídeo simulado. Conecte ElevenLabs (voz) ou HeyGen (avatar) para produzir de verdade."}</p>
    </div>
    <h2>Histórico</h2>
    <div id="videosList">${videos.length ? "" : '<p class="empty">Nenhum vídeo ainda.</p>'}</div>`;
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
      const r = await api.post(`/api/videos/${v.id}/edit`, {});
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
  const r = await api.post("/api/videos/generate", { scriptId, clientId });
  if (r.ok) { toast(r.video.demo ? "Vídeo simulado (demo)" : "Vídeo em produção"); viewVideos(); }
  else toast(r.error || "Erro", "err");
}

// Gera o avatar falante (SadTalker) de forma assíncrona e faz polling.
async function generateAvatar(id, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Iniciando...';
  const r = await api.post(`/api/videos/${id}/avatar`, {});
  if (!r.ok) { toast(r.error || "Erro ao iniciar avatar", "err"); btn.disabled = false; btn.textContent = "🧑 Gerar avatar"; return; }
  toast("Avatar em geração (lip-sync). Isso leva alguns minutos…");
  let tries = 0;
  const poll = async () => {
    const s = await api.get(`/api/videos/${id}/avatar-status`);
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
  const r = await api.post(`/api/videos/${videoId}/publish`, { platform, caption });
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
    <div class="row between"><div><h1>🚀 Publicações</h1><p class="page-sub">Postagens e métricas de desempenho (views, likes, comentários, shares).</p></div>
    <button class="btn sm" onclick="refreshAllPosts()">↻ Atualizar métricas</button></div>
    <div class="grid cols-4" style="margin-bottom:22px">
      <div class="card stat"><div class="num brand">${fmt(totals.views)}</div><div class="lbl">Views totais</div></div>
      <div class="card stat"><div class="num">${fmt(totals.likes)}</div><div class="lbl">Likes</div></div>
      <div class="card stat"><div class="num">${fmt(totals.comments)}</div><div class="lbl">Comentários</div></div>
      <div class="card stat"><div class="num">${fmt(totals.shares)}</div><div class="lbl">Shares</div></div>
    </div>
    <div id="postsList">${posts.length ? "" : '<p class="empty">Nenhuma publicação ainda. Edite um vídeo e clique em 🚀 Publicar.</p>'}</div>`;
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
    <h1>📅 Calendário de Conteúdo</h1>
    <p class="page-sub">Planeje o ritmo (modelo do vídeo: 60 vídeos em 3 meses, seg–sex).</p>
    <div class="card" style="margin-bottom:22px">
      <div class="row">
        <div class="field" style="flex:1;margin:0"><label>Cliente</label><select id="cal_client">${opts || "<option value=''>Cadastre um cliente</option>"}</select></div>
        <div class="field" style="margin:0"><label>Qtd. vídeos</label><input id="cal_count" type="number" value="60" style="width:90px"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn primary" onclick="genPlan()" ${clients.length ? "" : "disabled"}>Gerar plano</button></div>
      </div>
    </div>
    <div id="calList"></div>`;
  loadCalendar();
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
function viewSettings() {
  const s = STATE.status.integrations;
  const dot = (ok) => ok ? '<span class="tag green">conectado</span>' : '<span class="tag amber">não configurado</span>';
  $("view").innerHTML = `
    <h1>⚙️ Configurações</h1>
    <p class="page-sub">Conecte as APIs para sair do modo demo e produzir de verdade.</p>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Roteiro (LLM)</b><br><span class="muted" style="font-size:13px">OpenAI ou Anthropic — gera os roteiros virais</span></div>${dot(s.llm.configured)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Voz (ElevenLabs)</b><br><span class="muted" style="font-size:13px">Clona a voz a partir do áudio enviado</span></div>${dot(s.voice.configured)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Avatar (HeyGen)</b><br><span class="muted" style="font-size:13px">Clona o rosto e gera o vídeo</span></div>${dot(s.avatar.configured)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Edição (FFmpeg)</b><br><span class="muted" style="font-size:13px">Queima legendas e formata vertical 9:16 — embutido, sem instalar</span></div>${dot(s.editor?.configured)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>B-roll (Pexels)</b><br><span class="muted" style="font-size:13px">Clipes de fundo reais — defina PEXELS_API_KEY</span></div>${dot(s.broll?.configured)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Publicação (Redes)</b><br><span class="muted" style="font-size:13px">Instagram / TikTok / YouTube — tokens por plataforma</span></div>${dot(s.publish?.configured)}</div></div>
    <div class="card">
      <h2>Como ativar o modo LIVE</h2>
      <ol style="line-height:2;color:#cfd3e0;padding-left:18px;font-size:14px">
        <li>Copie <code>.env.example</code> para <code>.env</code></li>
        <li>Cole suas chaves (OpenAI/Anthropic, ElevenLabs, HeyGen)</li>
        <li>Reinicie o servidor (<code>npm start</code>)</li>
      </ol>
      <p class="muted" style="font-size:13px">As chaves ficam só no seu computador (arquivo .env). Nunca são enviadas ao navegador.</p>
    </div>`;
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
