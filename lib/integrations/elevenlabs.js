// Clone de voz via ElevenLabs.
// Docs: https://elevenlabs.io/docs

export function elevenConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

// Lista as vozes da conta.
export async function listVoices() {
  if (!elevenConfigured()) return [];
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}

// Resolve qual voz usar para narrar:
//   1) voz clonada do cliente (se for um id real, nao "demo_")
//   2) ELEVENLABS_DEFAULT_VOICE do .env
//   3) primeira voz disponivel na conta
let _cachedVoice = null;
export async function resolveVoiceId(clientVoiceId) {
  if (clientVoiceId && !String(clientVoiceId).startsWith("demo_")) return clientVoiceId;
  if (process.env.ELEVENLABS_DEFAULT_VOICE) return process.env.ELEVENLABS_DEFAULT_VOICE;
  if (_cachedVoice) return _cachedVoice;
  const voices = await listVoices();
  _cachedVoice = voices[0]?.id || null;
  return _cachedVoice;
}

// Cria uma voz clonada a partir de amostras de audio (Buffers).
// samples: [{ filename, buffer }]
export async function cloneVoice({ name, samples }) {
  if (!elevenConfigured()) {
    return { voiceId: `demo_voice_${Date.now().toString(36)}`, demo: true };
  }
  const form = new FormData();
  form.append("name", name);
  for (const s of samples) {
    form.append("files", new Blob([s.buffer]), s.filename);
  }
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { voiceId: data.voice_id };
}

// voice_settings parametrizaveis via .env (default afinado p/ Reels PT-BR:
// menos estabilidade = mais expressivo, com style e speaker boost).
function voiceSettings() {
  const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
  return {
    stability: num(process.env.ELEVENLABS_STABILITY, 0.4),
    similarity_boost: num(process.env.ELEVENLABS_SIMILARITY, 0.8),
    style: num(process.env.ELEVENLABS_STYLE, 0.25),
    use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false",
  };
}

function ttsModel() {
  return process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
}

// Gera audio (TTS) COM timestamps por caractere para sincronizar legendas
// karaoke. Retorna { buffer, alignment }. O alignment vem do endpoint
// /with-timestamps; se ele falhar, cai no TTS comum (so buffer).
export async function textToSpeech({ voiceId, text }) {
  if (!elevenConfigured()) return { demo: true, buffer: null, alignment: null };

  const body = JSON.stringify({
    text,
    model_id: ttsModel(),
    voice_settings: voiceSettings(),
  });
  const headers = {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };

  // 1) tenta o endpoint com timestamps (audio_base64 + alignment)
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      { method: "POST", headers, body }
    );
    if (res.ok) {
      const data = await res.json();
      const buffer = data.audio_base64 ? Buffer.from(data.audio_base64, "base64") : null;
      const alignment = data.alignment || data.normalized_alignment || null;
      if (buffer) return { buffer, alignment };
    }
  } catch (_) { /* cai no fallback abaixo */ }

  // 2) fallback: TTS comum (sem timestamps)
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    { method: "POST", headers, body }
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), alignment: null };
}
