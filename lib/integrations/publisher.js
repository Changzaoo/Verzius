// =====================================================================
// PUBLICACAO + METRICAS — postagem automatica nas redes.
//
// Em producao real, Instagram (Graph API) e TikTok (Content Posting API)
// exigem OAuth + revisao de app. Aqui ha uma abstracao com:
//   - provider DEMO: simula a postagem e gera metricas (views/likes/...)
//     com uma curva viral realista ao longo do tempo;
//   - ganchos para tokens reais (IG_ACCESS_TOKEN / TIKTOK_ACCESS_TOKEN).
// =====================================================================

import { ayrshareConfigured, post as ayrPost } from "./ayrshare.js";

export const PLATFORMS = {
  instagram: { label: "Instagram Reels", env: "IG_ACCESS_TOKEN" },
  tiktok: { label: "TikTok", env: "TIKTOK_ACCESS_TOKEN" },
  youtube: { label: "YouTube Shorts", env: "YT_ACCESS_TOKEN" },
};

export { ayrshareConfigured };

export function platformConfigured(platform) {
  const p = PLATFORMS[platform];
  return Boolean(p && process.env[p.env]);
}

export function anyPlatformConfigured() {
  return Object.keys(PLATFORMS).some(platformConfigured);
}

// Numero pseudo-aleatorio estavel a partir de uma string (sem Math.random,
// para que as metricas nao "pulem" a cada refresh).
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Publica o video. Dispatcher: Ayrshare (real, multi-tenant) se configurado,
// senao provider DEMO (postId/permalink simulado).
//   profileKey: Profile Key da agencia (ownerId) no Ayrshare.
//   publicUrl: URL publica do MP4 (exigida pelo upload real).
export async function publishVideo({ platform, caption, videoUrl, publicUrl, profileKey }) {
  if (!PLATFORMS[platform]) throw new Error("Plataforma invalida");

  // 1) Ayrshare (real) — precisa de URL publica do video.
  if (ayrshareConfigured() && publicUrl) {
    const r = await ayrPost({ caption, platforms: [platform], mediaUrls: [publicUrl], profileKey });
    return { demo: false, provider: "ayrshare", postId: r.postId, permalink: r.permalink, platform };
  }

  // 2) Provider DEMO (sem chave, ou sem URL publica ainda) — comportamento atual.
  const id = `demo_${platform}_${Date.now().toString(36)}`;
  return {
    demo: true,
    postId: id,
    permalink: `https://example.com/${platform}/${id}`,
    platform,
  };
}

// Calcula metricas para um post. DEMO: curva viral em funcao do tempo
// desde a publicacao. LIVE: substituir por leitura real de insights.
export function computeMetrics(post, nowMs) {
  const base = seed(post.id);
  const created = new Date(post.createdAt).getTime();
  const hours = Math.max(0, (nowMs - created) / 3.6e6);

  // potencial de pico influenciado pela retencao estimada do roteiro
  const retention = Number(post.retention || 70);
  const ceiling = Math.round((2000 + base * 60000) * (0.5 + retention / 100));

  // curva de saturacao: ja nasce com um burst (o +0.7 evita zero em t=0),
  // cresce rapido nas primeiras horas e estabiliza.
  const growth = 1 - Math.exp(-(hours + 0.7) / (12 + base * 24));
  const views = Math.round(ceiling * growth);
  const likes = Math.round(views * (0.04 + base * 0.05));
  const comments = Math.round(likes * (0.05 + base * 0.08));
  const shares = Math.round(likes * (0.03 + base * 0.06));
  const saves = Math.round(views * (0.03 + base * 0.04));

  // Metricas que os algoritmos 2025-2026 realmente premiam:
  // hook rate (3s), watch %, saves e sends/reach. hookRate/avgWatchPct vem
  // do roteiro quando disponivel (post.retencao3s/post.completion).
  const hookRate = Math.round(Number(post.retencao3s || retention));
  const avgWatchPct = Math.round(Number(post.completion || retention * 0.85));
  const sendsPerReach = views ? Number(((shares + saves) / views * 100).toFixed(1)) : 0;

  return { views, likes, comments, shares, saves, hookRate, avgWatchPct, sendsPerReach };
}
