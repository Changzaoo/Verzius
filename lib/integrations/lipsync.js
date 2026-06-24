// =====================================================================
// LIPSYNC — avatar falante de baixo custo via Replicate (SadTalker).
//
// Mesmo contrato do heygen.js (registerAvatar/generateAvatarVideo/
// getVideoStatus), para o server escolher o provider de avatar sem mudar
// o pipeline. Reaproveita o audio JA gerado pela ElevenLabs (audio-driven),
// custando ~$0.07/clipe contra HeyGen premium / D-ID.
// Sem REPLICATE_API_TOKEN, fica desligado e o app usa voz+legendas.
// Docs: https://replicate.com/cjwbw/sadtalker
// =====================================================================

const BASE = "https://api.replicate.com/v1";

export function lipsyncConfigured() {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Resolve a versao do modelo: env fixo > ultima versao publica (cacheada).
// Evita quebrar quando o hash do modelo muda na Replicate.
let _ver = null;
async function sadtalkerVersion() {
  if (process.env.REPLICATE_SADTALKER_VERSION) return process.env.REPLICATE_SADTALKER_VERSION;
  if (_ver) return _ver;
  const res = await fetch(`${BASE}/models/cjwbw/sadtalker`, { headers: headers() });
  if (!res.ok) throw new Error(`Replicate model ${res.status}: ${await res.text()}`);
  const data = await res.json();
  _ver = data.latest_version?.id;
  if (!_ver) throw new Error("Nao foi possivel resolver a versao do SadTalker");
  return _ver;
}

// Mantem a mesma assinatura do heygen: aqui so guardamos a referencia da foto.
export async function registerAvatar({ name, photoUrl }) {
  if (!lipsyncConfigured()) {
    return { avatarId: `demo_avatar_${Date.now().toString(36)}`, demo: true };
  }
  // SadTalker usa a imagem direto na geracao; nao ha "registro" previo.
  return { avatarId: null, photoUrl, note: "SadTalker usa a foto na hora da geracao." };
}

// Cria a prediction de lip-sync. sourceImage = URL publica da foto do cliente;
// drivenAudioUrl = URL publica do mp3 (TTS). Retorna { videoId } para polling.
export async function generateAvatarVideo({ sourceImage, drivenAudioUrl }) {
  if (!lipsyncConfigured()) {
    return { videoId: `demo_video_${Date.now().toString(36)}`, demo: true };
  }
  if (!sourceImage || !drivenAudioUrl) {
    throw new Error("SadTalker exige sourceImage (foto) e drivenAudioUrl (audio) publicos");
  }
  const version = await sadtalkerVersion();
  const res = await fetch(`${BASE}/predictions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      version,
      input: {
        source_image: sourceImage,
        driven_audio: drivenAudioUrl,
        preprocess: "full",
        still: true,
        enhancer: "gfpgan",
      },
    }),
  });
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { videoId: data.id };
}

// Consulta a prediction. Retorna { status, url }.
//   status Replicate: starting | processing | succeeded | failed | canceled
export async function getVideoStatus(videoId) {
  if (!lipsyncConfigured() || String(videoId).startsWith("demo_")) {
    return { status: "completed", url: null, demo: true };
  }
  const res = await fetch(`${BASE}/predictions/${videoId}`, { headers: headers() });
  if (!res.ok) throw new Error(`Replicate status ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const map = { succeeded: "completed", failed: "failed", canceled: "failed" };
  const url = typeof data.output === "string" ? data.output : (Array.isArray(data.output) ? data.output[0] : null);
  return { status: map[data.status] || "processing", url: url || null };
}
