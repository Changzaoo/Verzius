// =====================================================================
// CORTES AI — servidor principal
// Plataforma de agencia para videos curtos virais com avatar de IA.
// =====================================================================

import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import * as db from "./lib/db.js";
import { hashPassword, verifyPassword, newToken, hashToken } from "./lib/auth.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  demoScripts,
  NICHE_PRESETS,
  HOOK_FORMULAS,
} from "./lib/viral-engine.js";
import { llmConfigured, llmProvider, generateWithLLM } from "./lib/integrations/llm.js";
import { elevenConfigured, cloneVoice } from "./lib/integrations/elevenlabs.js";
import {
  heygenConfigured,
  registerAvatar,
  generateAvatarVideo,
  getVideoStatus,
} from "./lib/integrations/heygen.js";
import { editorConfigured, renderEditedVideo, wordsFromAlignment } from "./lib/integrations/editor.js";
import { textToSpeech, resolveVoiceId } from "./lib/integrations/elevenlabs.js";
import { brollConfigured, fetchBrollClips } from "./lib/integrations/broll.js";
import {
  PLATFORMS,
  anyPlatformConfigured,
  platformConfigured,
  publishVideo,
  computeMetrics,
} from "./lib/integrations/publisher.js";
import { ayrshareConfigured, createProfile, generateJwtUrl } from "./lib/integrations/ayrshare.js";
import {
  lipsyncConfigured,
  generateAvatarVideo as sadtalkerGenerate,
  getVideoStatus as sadtalkerStatus,
} from "./lib/integrations/lipsync.js";

// URL publica base (tunel) — necessaria p/ Ayrshare e SadTalker baixarem arquivos.
const publicBase = () => process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");

// Provider de avatar: heygen | replicate-sadtalker | none (voz+legendas)
function avatarProvider() {
  const p = (process.env.AVATAR_PROVIDER || "").toLowerCase();
  if (p === "heygen" && heygenConfigured()) return "heygen";
  if (p === "replicate-sadtalker" && lipsyncConfigured()) return "replicate-sadtalker";
  if (!p) { // auto: usa o que estiver configurado
    if (heygenConfigured()) return "heygen";
    if (lipsyncConfigured()) return "replicate-sadtalker";
  }
  return "none";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// Em serverless o disco do projeto e read-only; usa /tmp e ignora falha.
const UPLOAD_DIR = process.env.VERCEL ? "/tmp/uploads" : path.join(__dirname, "uploads");
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

// --- helper de resposta ---
const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, code = 500) =>
  res.status(code).json({ ok: false, error: String(err?.message || err) });

// ---------------------------------------------------------------------
// MULTIUSUARIO — middleware de escopo por dono (ownerId).
// Modo aberto (DEMO) enquanto nao houver usuarios cadastrados.
// ---------------------------------------------------------------------
const authActive = () => db.list("users").length > 0;
const OPEN_PATHS = ["/status", "/signup", "/login", "/auth", "/me"];

app.use("/api", (req, res, next) => {
  if (!authActive()) { req.userId = null; return next(); }      // DEMO aberto
  if (OPEN_PATHS.includes(req.path)) return next();             // rotas publicas
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return fail(res, "Nao autenticado", 401);
  const ht = hashToken(token);
  const user = db.list("users").find((u) => (u.tokens || []).includes(ht));
  if (!user) return fail(res, "Sessao invalida", 401);
  req.userId = user.id;
  next();
});

// filtro que combina escopo do dono com um filtro extra opcional
const owned = (req, extra) => (x) =>
  x.ownerId === req.userId && (extra ? extra(x) : true);
// confere se um registro pertence ao usuario atual
const isOwner = (req, rec) => rec && rec.ownerId === req.userId;

// ---------------------------------------------------------------------
// STATUS / CONFIG
// ---------------------------------------------------------------------
app.get("/api/status", (req, res) => {
  ok(res, {
    mode: llmConfigured() ? "live" : "demo",
    integrations: {
      llm: { configured: llmConfigured(), provider: llmProvider() },
      voice: { configured: elevenConfigured(), provider: "elevenlabs" },
      avatar: { configured: heygenConfigured() || lipsyncConfigured(), provider: avatarProvider() },
      editor: { configured: editorConfigured(), provider: "ffmpeg" },
      broll: { configured: brollConfigured(), provider: "pexels" },
      publish: { configured: anyPlatformConfigured() || ayrshareConfigured(), real: ayrshareConfigured(), provider: ayrshareConfigured() ? "ayrshare" : "demo", platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, { label: v.label, configured: platformConfigured(k) }])) },
    },
    niches: NICHE_PRESETS,
    hookFormulas: HOOK_FORMULAS,
    multiuser: authActive(),
    passwordRequired: Boolean(process.env.APP_PASSWORD),
  });
});

// ---------------------------------------------------------------------
// AUTENTICACAO (multiusuario / agencia)
// ---------------------------------------------------------------------
app.post("/api/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return fail(res, "E-mail e senha obrigatorios", 400);
  if (String(password).length < 6) return fail(res, "Senha de no minimo 6 caracteres", 400);
  const exists = db.list("users").find((u) => u.email === String(email).toLowerCase());
  if (exists) return fail(res, "Ja existe uma conta com esse e-mail", 409);
  const { salt, hash } = hashPassword(password);
  const token = newToken();
  const user = db.insert("users", {
    name: name || String(email).split("@")[0],
    email: String(email).toLowerCase(),
    salt,
    hash,
    tokens: [hashToken(token)],
  });
  ok(res, { token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.list("users").find((u) => u.email === String(email || "").toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.hash))
    return fail(res, "E-mail ou senha incorretos", 401);
  const token = newToken();
  db.update("users", user.id, { tokens: [...(user.tokens || []), hashToken(token)].slice(-10) });
  ok(res, { token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/logout", (req, res) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = req.userId && db.find("users", req.userId);
  if (user) db.update("users", user.id, { tokens: (user.tokens || []).filter((t) => t !== hashToken(token)) });
  ok(res, {});
});

app.get("/api/me", (req, res) => {
  if (!authActive()) return ok(res, { user: null, open: true });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = db.list("users").find((u) => (u.tokens || []).includes(hashToken(token)));
  if (!user) return ok(res, { user: null });
  ok(res, { user: { id: user.id, name: user.name, email: user.email } });
});

// compatibilidade com o login simples por senha (APP_PASSWORD)
app.post("/api/auth", (req, res) => {
  const required = process.env.APP_PASSWORD;
  if (!required) return ok(res, { authed: true });
  ok(res, { authed: req.body?.password === required });
});

// ---------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------
app.get("/api/clients", (req, res) => ok(res, { clients: db.list("clients", owned(req)) }));

app.get("/api/clients/:id", (req, res) => {
  const client = db.find("clients", req.params.id);
  if (!isOwner(req, client)) return fail(res, "Cliente nao encontrado", 404);
  const scripts = db.list("scripts", (s) => s.clientId === client.id);
  const videos = db.list("videos", (v) => v.clientId === client.id);
  ok(res, { client, scripts, videos });
});

app.post("/api/clients", (req, res) => {
  const { name, niche, tone, audience, goal, handle, avatarId, voiceId } = req.body || {};
  if (!name) return fail(res, "Nome obrigatorio", 400);
  const client = db.insert("clients", {
    ownerId: req.userId,
    name,
    niche: niche || "generico",
    tone: tone || "",
    audience: audience || "",
    goal: goal || "",
    handle: handle || "",
    avatarId: avatarId || null,
    voiceId: voiceId || null,
    photoUrl: null,
    status: "ativo",
    stats: { videos: 0, views: 0 },
  });
  ok(res, { client });
});

app.put("/api/clients/:id", (req, res) => {
  if (!isOwner(req, db.find("clients", req.params.id))) return fail(res, "Cliente nao encontrado", 404);
  const { ownerId, ...patch } = req.body || {}; // nao deixa reescrever o dono
  const updated = db.update("clients", req.params.id, patch);
  ok(res, { client: updated });
});

app.delete("/api/clients/:id", (req, res) => {
  if (!isOwner(req, db.find("clients", req.params.id))) return fail(res, "Cliente nao encontrado", 404);
  db.remove("clients", req.params.id);
  ok(res, {});
});

// Upload de foto (avatar) -> registra no HeyGen
app.post("/api/clients/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    const client = db.find("clients", req.params.id);
    if (!isOwner(req, client)) return fail(res, "Cliente nao encontrado", 404);
    if (!req.file) return fail(res, "Envie um arquivo de imagem", 400);
    // preserva a extensao (.jpg/.png) p/ a URL servir como imagem valida (SadTalker)
    let fname = req.file.filename;
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (ext && !fname.endsWith(ext)) {
      try { fs.renameSync(path.join(UPLOAD_DIR, fname), path.join(UPLOAD_DIR, fname + ext)); fname += ext; } catch {}
    }
    const photoUrl = `/uploads/${fname}`;
    const result = await registerAvatar({ name: client.name, photoUrl });
    const updated = db.update("clients", client.id, {
      photoUrl,
      avatarId: result.avatarId || client.avatarId,
      avatarNote: result.note || null,
      avatarDemo: Boolean(result.demo),
    });
    ok(res, { client: updated, integration: result });
  } catch (e) {
    fail(res, e);
  }
});

// Upload de amostras de voz -> clona no ElevenLabs
app.post("/api/clients/:id/voice", upload.array("samples", 5), async (req, res) => {
  try {
    const client = db.find("clients", req.params.id);
    if (!isOwner(req, client)) return fail(res, "Cliente nao encontrado", 404);
    const files = req.files || [];
    if (!files.length) return fail(res, "Envie ao menos 1 audio (ideal: 1 a 5 min)", 400);
    const samples = files.map((f) => ({
      filename: f.originalname,
      buffer: fs.readFileSync(f.path),
    }));
    const result = await cloneVoice({ name: `${client.name} - voz`, samples });
    const updated = db.update("clients", client.id, {
      voiceId: result.voiceId,
      voiceDemo: Boolean(result.demo),
    });
    ok(res, { client: updated, integration: result });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------
// ROTEIROS (o core)
// ---------------------------------------------------------------------
app.post("/api/scripts/generate", async (req, res) => {
  try {
    // durationSec opcional: se vazio, o motor escolhe pela plataforma (sub-30s).
    const { clientId, theme, count = 3, durationSec, platform, storytelling = false } = req.body || {};
    if (!theme) return fail(res, "Informe o tema do video", 400);
    const client = clientId ? db.find("clients", clientId) : null;
    const niche = client?.niche || req.body?.niche || "generico";

    let result;
    if (llmConfigured()) {
      const system = buildSystemPrompt(client || { niche });
      const user = buildUserPrompt({ theme, count, durationSec, platform, storytelling });
      const parsed = await generateWithLLM({ system, user });
      result = parsed?.variations
        ? parsed
        : demoScripts({ theme, niche, count, durationSec });
    } else {
      result = demoScripts({ theme, niche, count, durationSec });
    }
    ok(res, { theme, niche, ...result });
  } catch (e) {
    // se a API falhar, cai no demo para nao quebrar o fluxo
    const { theme, count = 3, durationSec, niche = "generico" } = req.body || {};
    ok(res, { theme, niche, ...demoScripts({ theme, niche, count, durationSec }), warning: String(e.message) });
  }
});

// Salvar roteiro escolhido
app.post("/api/scripts", (req, res) => {
  const { clientId, theme, variation } = req.body || {};
  if (!variation) return fail(res, "Roteiro vazio", 400);
  if (clientId && !isOwner(req, db.find("clients", clientId)))
    return fail(res, "Cliente nao encontrado", 404);
  const script = db.insert("scripts", {
    ownerId: req.userId,
    clientId: clientId || null,
    theme: theme || "",
    ...variation,
    status: "salvo",
  });
  ok(res, { script });
});

app.get("/api/scripts", (req, res) => {
  const { clientId } = req.query;
  ok(res, { scripts: db.list("scripts", owned(req, clientId ? (s) => s.clientId === clientId : null)) });
});

app.delete("/api/scripts/:id", (req, res) => {
  if (!isOwner(req, db.find("scripts", req.params.id))) return fail(res, "Roteiro nao encontrado", 404);
  db.remove("scripts", req.params.id);
  ok(res, {});
});

// ---------------------------------------------------------------------
// VIDEOS
// ---------------------------------------------------------------------
app.post("/api/videos/generate", async (req, res) => {
  try {
    const { clientId, scriptId } = req.body || {};
    const client = db.find("clients", clientId);
    const script = db.find("scripts", scriptId);
    if (!isOwner(req, client)) return fail(res, "Cliente nao encontrado", 404);
    if (!isOwner(req, script)) return fail(res, "Roteiro nao encontrado", 404);

    const gen = await generateAvatarVideo({
      avatarId: client.avatarId,
      voiceId: client.voiceId,
      script: script.script,
    });

    const video = db.insert("videos", {
      ownerId: req.userId,
      clientId,
      scriptId,
      title: script.title || script.theme,
      videoId: gen.videoId,
      status: gen.demo ? "completed" : "processing",
      url: null,
      demo: Boolean(gen.demo),
    });
    db.update("clients", clientId, {
      stats: { ...client.stats, videos: (client.stats?.videos || 0) + 1 },
    });
    ok(res, { video, integration: gen });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/videos", (req, res) => {
  const { clientId } = req.query;
  ok(res, { videos: db.list("videos", owned(req, clientId ? (v) => v.clientId === clientId : null)) });
});

app.get("/api/videos/:id/status", async (req, res) => {
  try {
    const video = db.find("videos", req.params.id);
    if (!isOwner(req, video)) return fail(res, "Video nao encontrado", 404);
    const st = await getVideoStatus(video.videoId);
    const updated = db.update("videos", video.id, {
      status: st.status || video.status,
      url: st.url || video.url,
    });
    ok(res, { video: updated });
  } catch (e) {
    fail(res, e);
  }
});

// Edicao automatica: legendas queimadas + formato vertical (FFmpeg).
app.post("/api/videos/:id/edit", async (req, res) => {
  try {
    const video = db.find("videos", req.params.id);
    if (!isOwner(req, video)) return fail(res, "Video nao encontrado", 404);
    const script = db.find("scripts", video.scriptId);
    if (!script) return fail(res, "Roteiro do video nao encontrado", 404);
    const client = db.find("clients", video.clientId);

    // fonte do video, em ordem de prioridade:
    //   1) avatar falante (SadTalker/HeyGen) ja gerado para este video
    //   2) video real do HeyGen legado
    //   senao: modo voz+legendas (fundo/b-roll gerado)
    let sourceVideoUrl = null;
    if (video.avatarVideoUrl && /^https?:/i.test(video.avatarVideoUrl)) {
      sourceVideoUrl = video.avatarVideoUrl;
    } else if (video.url && !video.demo && /^https?:/i.test(video.url)) {
      sourceVideoUrl = video.url;
    }

    // audio: narra o roteiro com voz real da ElevenLabs (ALTERNATIVA AO AVATAR).
    // Usa a voz clonada do cliente se houver; senao uma voz padrao da conta.
    let audioBuffer = null;
    let voiceUsed = null;
    let wordTimings = null;
    if (!sourceVideoUrl && elevenConfigured()) {
      try {
        const voiceId = await resolveVoiceId(client?.voiceId);
        if (voiceId) {
          const tts = await textToSpeech({ voiceId, text: script.script });
          audioBuffer = tts.buffer || null;
          voiceUsed = voiceId;
          // timestamps reais -> legendas karaoke sincronizadas ao audio
          if (tts.alignment) wordTimings = wordsFromAlignment(tts.alignment);
        }
      } catch (_) { /* segue sem audio se o TTS falhar */ }
    }

    // B-roll real (Pexels) quando configurado — senao, fundo gerado
    let brollPaths = [];
    if (!sourceVideoUrl && brollConfigured()) {
      try { brollPaths = await fetchBrollClips(script.broll_suggestions || []); }
      catch (_) { /* segue sem b-roll */ }
    }

    const result = await renderEditedVideo({ script, sourceVideoUrl, audioBuffer, brollPaths, wordTimings });
    const updated = db.update("videos", video.id, {
      editedUrl: result.url,
      editedDemo: Boolean(result.demo),
      editedDurationSec: result.durationSec,
      narrated: Boolean(audioBuffer),
      status: "edited",
    });
    ok(res, { video: updated, edit: { ...result, narrated: Boolean(audioBuffer), voiceUsed } });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------
// AVATAR FALANTE (SadTalker via Replicate) — fluxo ASSINCRONO.
// 1) POST /avatar inicia a geracao (TTS publico + prediction) e volta na hora;
// 2) o front faz polling em GET /avatar-status ate ficar pronto;
// 3) ao concluir, o video ganha avatarVideoUrl e a edicao usa como fonte.
// ---------------------------------------------------------------------
app.post("/api/videos/:id/avatar", async (req, res) => {
  try {
    const video = db.find("videos", req.params.id);
    if (!isOwner(req, video)) return fail(res, "Video nao encontrado", 404);
    if (!lipsyncConfigured()) return fail(res, "Configure REPLICATE_API_TOKEN para gerar avatar", 400);
    const base = publicBase();
    if (!base) return fail(res, "Configure PUBLIC_BASE_URL (tunel) — o Replicate precisa baixar a foto e o audio", 400);
    const client = db.find("clients", video.clientId);
    if (!client?.photoUrl) return fail(res, "O cliente precisa de uma foto (avatar) para o lip-sync", 400);
    const script = db.find("scripts", video.scriptId);
    if (!script) return fail(res, "Roteiro do video nao encontrado", 404);
    if (!elevenConfigured()) return fail(res, "Configure ElevenLabs para narrar o avatar", 400);

    // 1) gera o audio (TTS) e salva em /uploads para ter URL publica
    const voiceId = await resolveVoiceId(client.voiceId);
    const tts = await textToSpeech({ voiceId, text: script.script });
    if (!tts.buffer) return fail(res, "Falha ao gerar o audio do avatar", 500);
    const audioName = `voz_${video.id}.mp3`;
    fs.writeFileSync(path.join(UPLOAD_DIR, audioName), tts.buffer);

    const photoUrl = `${base}${client.photoUrl}`;
    const drivenAudioUrl = `${base}/uploads/${audioName}`;

    // 2) inicia a prediction (SadTalker) — retorna na hora, processa em background
    const gen = await sadtalkerGenerate({ sourceImage: photoUrl, drivenAudioUrl });
    const updated = db.update("videos", video.id, {
      avatarJobId: gen.videoId,
      avatarStatus: "processing",
      avatarVideoUrl: null,
    });
    ok(res, { video: updated, jobId: gen.videoId, status: "processing" });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/videos/:id/avatar-status", async (req, res) => {
  try {
    const video = db.find("videos", req.params.id);
    if (!isOwner(req, video)) return fail(res, "Video nao encontrado", 404);
    if (!video.avatarJobId) return ok(res, { status: "none" });
    if (video.avatarVideoUrl) return ok(res, { status: "completed", url: video.avatarVideoUrl });

    const st = await sadtalkerStatus(video.avatarJobId);
    const patch = { avatarStatus: st.status };
    if (st.status === "completed" && st.url) patch.avatarVideoUrl = st.url;
    const updated = db.update("videos", video.id, patch);
    ok(res, { status: st.status, url: updated.avatarVideoUrl || null });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------
// PUBLICACAO + METRICAS
// ---------------------------------------------------------------------

// Helper: recalcula metricas de um post e devolve o objeto enriquecido.
function withMetrics(post, now = Date.now()) {
  return { ...post, metrics: computeMetrics(post, now) };
}

app.post("/api/videos/:id/publish", async (req, res) => {
  try {
    const { platform = "instagram", caption } = req.body || {};
    if (!PLATFORMS[platform]) return fail(res, "Plataforma invalida", 400);
    const video = db.find("videos", req.params.id);
    if (!isOwner(req, video)) return fail(res, "Video nao encontrado", 404);
    const videoUrl = video.editedUrl || video.url;
    if (!videoUrl) return fail(res, "Edite o video antes de publicar", 400);
    const script = db.find("scripts", video.scriptId);

    // URL publica do MP4 (exigida pela publicacao real). Usa PUBLIC_BASE_URL
    // se definido; senao fica null e o publisher cai no modo demo.
    const base = process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
    const publicUrl = base ? `${base}${videoUrl}` : null;
    const owner = req.userId && db.find("users", req.userId);

    const pub = await publishVideo({
      platform,
      caption: caption || script?.title || video.title,
      videoUrl,
      publicUrl,
      profileKey: owner?.ayrshareProfileKey || null,
    });

    const post = db.insert("posts", {
      ownerId: req.userId,
      clientId: video.clientId,
      videoId: video.id,
      platform,
      caption: caption || script?.title || video.title || "",
      permalink: pub.permalink,
      postId: pub.postId,
      retention: script?.estimated_retention?.score || script?.estimated_retention || 70,
      retencao3s: Number(script?.retencao_3s) || null,
      completion: Number(script?.completion_estimada) || null,
      verziusScore: Number(script?.verzius_score) || null,
      demo: Boolean(pub.demo),
    });
    db.update("videos", video.id, { status: "published" });
    ok(res, { post: withMetrics(post) });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/posts", (req, res) => {
  const { clientId } = req.query;
  const now = Date.now();
  const posts = db
    .list("posts", owned(req, clientId ? (p) => p.clientId === clientId : null))
    .map((p) => withMetrics(p, now));
  const totals = posts.reduce(
    (t, p) => ({
      views: t.views + p.metrics.views,
      likes: t.likes + p.metrics.likes,
      comments: t.comments + p.metrics.comments,
      shares: t.shares + p.metrics.shares,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0 }
  );
  ok(res, { posts, totals });
});

// Atualiza (persiste) as metricas e propaga as views para o cliente.
app.post("/api/posts/:id/refresh", (req, res) => {
  const post = db.find("posts", req.params.id);
  if (!isOwner(req, post)) return fail(res, "Post nao encontrado", 404);
  const metrics = computeMetrics(post, Date.now());
  db.update("posts", post.id, { metrics, lastSync: new Date().toISOString() });
  // recomputa as views totais do cliente a partir de todos os seus posts
  if (post.clientId) {
    const client = db.find("clients", post.clientId);
    if (client) {
      const views = db
        .list("posts", (p) => p.clientId === post.clientId)
        .reduce((s, p) => s + computeMetrics(p, Date.now()).views, 0);
      db.update("clients", client.id, { stats: { ...client.stats, views } });
    }
  }
  ok(res, { post: { ...post, metrics } });
});

app.delete("/api/posts/:id", (req, res) => {
  if (!isOwner(req, db.find("posts", req.params.id))) return fail(res, "Post nao encontrado", 404);
  db.remove("posts", req.params.id);
  ok(res, {});
});

// --- Conexao de redes via Ayrshare (perfil por agencia/ownerId) ---
app.post("/api/social/profile", async (req, res) => {
  try {
    if (!ayrshareConfigured()) return fail(res, "Ayrshare nao configurado (defina AYRSHARE_API_KEY)", 400);
    const owner = req.userId ? db.find("users", req.userId) : null;
    if (req.userId && owner?.ayrshareProfileKey) return ok(res, { profileKey: owner.ayrshareProfileKey, existing: true });
    const prof = await createProfile(owner?.name || "Verzius");
    if (owner) db.update("users", owner.id, { ayrshareProfileKey: prof.profileKey });
    ok(res, { profileKey: prof.profileKey });
  } catch (e) { fail(res, e); }
});

app.get("/api/social/connect-url", async (req, res) => {
  try {
    if (!ayrshareConfigured()) return fail(res, "Ayrshare nao configurado", 400);
    const owner = req.userId ? db.find("users", req.userId) : null;
    const key = owner?.ayrshareProfileKey;
    if (!key) return fail(res, "Crie o perfil social primeiro", 400);
    const { url } = await generateJwtUrl(key);
    ok(res, { url });
  } catch (e) { fail(res, e); }
});

// ---------------------------------------------------------------------
// CALENDARIO (plano 60 videos / 3 meses)
// ---------------------------------------------------------------------
app.get("/api/calendar", (req, res) => {
  const { clientId } = req.query;
  ok(res, { calendar: db.list("calendar", owned(req, clientId ? (c) => c.clientId === clientId : null)) });
});

app.post("/api/calendar", (req, res) => {
  const { clientId, date, theme, status } = req.body || {};
  if (clientId && !isOwner(req, db.find("clients", clientId)))
    return fail(res, "Cliente nao encontrado", 404);
  const item = db.insert("calendar", {
    ownerId: req.userId,
    clientId: clientId || null,
    date: date || new Date().toISOString().slice(0, 10),
    theme: theme || "",
    status: status || "planejado",
  });
  ok(res, { item });
});

app.put("/api/calendar/:id", (req, res) => {
  if (!isOwner(req, db.find("calendar", req.params.id))) return fail(res, "Item nao encontrado", 404);
  const { ownerId, ...patch } = req.body || {};
  const updated = db.update("calendar", req.params.id, patch);
  ok(res, { item: updated });
});

app.delete("/api/calendar/:id", (req, res) => {
  if (!isOwner(req, db.find("calendar", req.params.id))) return fail(res, "Item nao encontrado", 404);
  db.remove("calendar", req.params.id);
  ok(res, {});
});

// Gera um plano automatico de N videos para o cliente
app.post("/api/calendar/plan", (req, res) => {
  const { clientId, count = 60, perWeek = 5, themes = [] } = req.body || {};
  const client = db.find("clients", clientId);
  if (!isOwner(req, client)) return fail(res, "Cliente nao encontrado", 404);
  const baseThemes = themes.length
    ? themes
    : [
        "erro mais comum no seu nicho",
        "mito que todo mundo acredita",
        "passo a passo rapido",
        "o que ninguem te conta",
        "antes e depois / caso real",
      ];
  const items = [];
  let d = new Date();
  for (let i = 0; i < count; i++) {
    // pula fim de semana se perWeek<=5
    if (perWeek <= 5) {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
    const item = db.insert("calendar", {
      ownerId: req.userId,
      clientId,
      date: d.toISOString().slice(0, 10),
      theme: `${baseThemes[i % baseThemes.length]} (#${i + 1})`,
      status: "planejado",
    });
    items.push(item);
    d.setDate(d.getDate() + 1);
  }
  ok(res, { items });
});

// SPA fallback
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Em ambiente serverless (Vercel) nao damos listen — exportamos o app.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  VERZIUS rodando em http://localhost:${PORT}`);
    console.log(`  Modo: ${llmConfigured() ? "LIVE (APIs conectadas)" : "DEMO (sem chaves)"}\n`);
  });
}

export default app;
