// Avatar / clone de rosto via HeyGen.
// Docs: https://docs.heygen.com/
// Fluxo real: criar Photo Avatar a partir de foto -> gerar video com voz.

export function heygenConfigured() {
  return Boolean(process.env.HEYGEN_API_KEY);
}

const BASE = "https://api.heygen.com";

async function hg(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      "X-Api-Key": process.env.HEYGEN_API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HeyGen ${res.status}: ${await res.text()}`);
  return res.json();
}

// Registra um avatar a partir de uma foto ja enviada (asset id) ou url.
// No MVP guardamos a referencia; a criacao real do "photo avatar group"
// pode ser feita aqui quando a conta tiver o recurso habilitado.
export async function registerAvatar({ name, photoUrl }) {
  if (!heygenConfigured()) {
    return { avatarId: `demo_avatar_${Date.now().toString(36)}`, demo: true };
  }
  // Placeholder: muitas contas usam avatar_id pre-criado no painel HeyGen.
  // Retornamos a referencia da foto para uso posterior.
  return { avatarId: null, photoUrl, note: "Configure o avatar_id no painel HeyGen e cole no cliente." };
}

// Gera o video falando o roteiro. voiceId pode ser ElevenLabs externo
// ou uma voz HeyGen. Retorna { videoId } para polling.
export async function generateAvatarVideo({ avatarId, voiceId, script, useElevenVoice = false }) {
  if (!heygenConfigured()) {
    return { videoId: `demo_video_${Date.now().toString(36)}`, demo: true };
  }
  const voicePayload = useElevenVoice
    ? { type: "audio", audio_url: voiceId } // se for usar audio externo
    : { type: "text", input_text: script, voice_id: voiceId };

  const data = await hg("/v2/video/generate", {
    method: "POST",
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: voicePayload,
        },
      ],
      dimension: { width: 720, height: 1280 }, // vertical
    }),
  });
  return { videoId: data.data?.video_id || data.video_id };
}

// Consulta status do video. Retorna { status, url }.
export async function getVideoStatus(videoId) {
  if (!heygenConfigured() || String(videoId).startsWith("demo_")) {
    return { status: "completed", url: null, demo: true };
  }
  const data = await hg(`/v1/video_status.get?video_id=${videoId}`, { method: "GET" });
  return {
    status: data.data?.status, // pending | processing | completed | failed
    url: data.data?.video_url || null,
  };
}
