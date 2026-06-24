// =====================================================================
// NXS — Nexus Claude Gateway (nosso Claude local, via assinatura).
//
// Em vez de pagar API da OpenAI/Anthropic, geramos os roteiros usando o
// gateway de agentes que roda no servidor Linux de casa (nxs-agents),
// autenticado por uma chave nxsC_.
//
// Fluxo ASSINCRONO: POST /v1/jobs devolve { jobId } na hora (202) e o
// agente roda em background no gateway; consultamos GET /v1/jobs/:id ate
// status 'done'/'error'. Cada request e CURTA, entao runs longos nao
// estouram o timeout 524 da Cloudflare (o /v1/run sincrono estourava em
// runs > ~100s).
//
// O gateway devolve o "result" como texto livre, entao instruimos o
// agente a responder SOMENTE com JSON e extraimos.
// =====================================================================

import { extractJson } from "../utils.js";

const DEFAULT_BASE = "https://agents-api.nexusholding.xyz";

export function nxsConfigured() {
  return Boolean(process.env.NXS_API_KEY);
}

export function nxsBase() {
  return (process.env.NXS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch ao gateway com timeout POR REQUEST (cada chamada do fluxo de jobs e curta).
async function nxsFetch(pathname, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${nxsBase()}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NXS_API_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Gera os roteiros via gateway. Recebe os prompts ja montados (system+user)
// pelo viral-engine e os funde numa unica "task", pedindo JSON puro.
// totalTimeoutMs limita a espera TOTAL do polling (o agente roda em background).
export async function generateWithNxs({ system, user, totalTimeoutMs = 240000, pollMs = 2500 }) {
  if (!nxsConfigured()) throw new Error("NXS_API_KEY ausente");

  const task =
    `${system}\n\n${user}\n\n` +
    `IMPORTANTE: responda EXCLUSIVAMENTE com o JSON pedido (comecando em "{" e terminando em "}"). ` +
    `Nao crie arquivos, nao escreva explicacoes, nao use blocos de codigo markdown.`;

  // 1) Submete o job — resposta imediata (202 { jobId, poll }).
  const sub = await nxsFetch("/v1/jobs", { method: "POST", body: { task, agent: "general", app: "verzius" } });
  if (!sub.ok) throw new Error(`NXS ${sub.status}: ${await sub.text()}`);
  const { jobId } = await sub.json();
  if (!jobId) throw new Error("NXS nao retornou jobId");

  // 2) Polling curto ate done/error/interrupted (cada request curta -> sem 524).
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const r = await nxsFetch(`/v1/jobs/${jobId}`);
    if (!r.ok) throw new Error(`NXS status ${r.status}: ${await r.text()}`);
    const job = await r.json();
    if (job.status === "done") return extractJson(job.result);
    if (job.status === "error" || job.status === "interrupted")
      throw new Error(`NXS job ${job.status}: ${job.error || "desconhecido"}`);
    // queued | running -> segue aguardando
  }
  throw new Error("NXS timeout: o job nao concluiu no tempo esperado");
}
