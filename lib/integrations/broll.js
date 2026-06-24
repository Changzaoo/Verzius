// =====================================================================
// B-ROLL — busca clipes de fundo para a edicao automatica.
//
// Provedor: Pexels Videos (gratuito). Se PEXELS_API_KEY estiver setada,
// baixa clipes verticais reais a partir das sugestoes de B-roll do
// roteiro. Sem chave, retorna vazio e o editor usa um fundo gerado.
// Docs: https://www.pexels.com/api/documentation/#videos
// =====================================================================

import fs from "fs";
import path from "path";
import os from "os";

export function brollConfigured() {
  return Boolean(process.env.PEXELS_API_KEY);
}

async function searchOne(query) {
  const url = `https://api.pexels.com/videos/search?per_page=1&orientation=portrait&size=medium&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const video = data.videos?.[0];
  if (!video) return null;
  // escolhe o arquivo vertical de menor resolucao suficiente (rapido de baixar)
  const files = (video.video_files || [])
    .filter((f) => f.height >= f.width)
    .sort((a, b) => (a.height || 0) - (b.height || 0));
  const pick = files.find((f) => (f.height || 0) >= 960) || files[files.length - 1];
  return pick?.link || null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download broll ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// Recebe as sugestoes de B-roll e devolve caminhos locais de clipes .mp4.
// Best-effort: ignora as buscas que falharem para nao quebrar a edicao.
export async function fetchBrollClips(suggestions = [], max = 4) {
  if (!brollConfigured() || !suggestions.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verzius-broll-"));
  const queries = suggestions.slice(0, max);
  const paths = [];
  for (let i = 0; i < queries.length; i++) {
    try {
      const link = await searchOne(queries[i]);
      if (!link) continue;
      const dest = path.join(dir, `broll${i}.mp4`);
      await download(link, dest);
      paths.push(dest);
    } catch (_) { /* ignora esta sugestao */ }
  }
  return paths;
}
