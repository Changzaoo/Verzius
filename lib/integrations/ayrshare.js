// =====================================================================
// AYRSHARE — publicacao real multi-tenant nas redes (Instagram/TikTok/
// YouTube etc.) sem precisar passar pelas auditorias de cada API.
//
// Modelo "User Profiles": cada agencia/usuario (ownerId) tem um Profile Key
// que mapeia 1:1 no nosso multiusuario. Sem AYRSHARE_API_KEY tudo continua
// no provider demo do publisher.js — nada e exigido para o app subir.
// Docs: https://www.ayrshare.com/docs/multiple-users
// =====================================================================

const BASE = "https://api.ayrshare.com/api";

export function ayrshareConfigured() {
  return Boolean(process.env.AYRSHARE_API_KEY);
}

function headers(profileKey) {
  const h = {
    Authorization: `Bearer ${process.env.AYRSHARE_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (profileKey) h["Profile-Key"] = profileKey;
  return h;
}

// Cria um perfil de usuario (1 por agencia) e devolve o profileKey.
export async function createProfile(title) {
  const res = await fetch(`${BASE}/profiles`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title: title || "Verzius" }),
  });
  if (!res.ok) throw new Error(`Ayrshare ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { profileKey: data.profileKey, refId: data.refId };
}

// Gera a URL SSO (JWT) para o usuario conectar as redes dele.
export async function generateJwtUrl(profileKey) {
  const res = await fetch(`${BASE}/profiles/generateJWT`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ domain: process.env.AYRSHARE_DOMAIN || "id", profileKey }),
  });
  if (!res.ok) throw new Error(`Ayrshare JWT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { url: data.url };
}

// Publica o video. mediaUrls precisa ser URL publica do MP4.
export async function post({ caption, platforms, mediaUrls, profileKey }) {
  const res = await fetch(`${BASE}/post`, {
    method: "POST",
    headers: headers(profileKey),
    body: JSON.stringify({
      post: caption || "",
      platforms: platforms || ["instagram"],
      mediaUrls: mediaUrls || [],
    }),
  });
  if (!res.ok) throw new Error(`Ayrshare post ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // id do post (primeiro retornado) e link, quando houver
  const first = Array.isArray(data.postIds) ? data.postIds[0] : null;
  return { postId: data.id || first?.id || null, permalink: first?.postUrl || null, raw: data };
}

// Le as metricas reais de um post publicado.
export async function analytics(postId, profileKey) {
  const res = await fetch(`${BASE}/analytics/post`, {
    method: "POST",
    headers: headers(profileKey),
    body: JSON.stringify({ id: postId }),
  });
  if (!res.ok) throw new Error(`Ayrshare analytics ${res.status}: ${await res.text()}`);
  return res.json();
}
