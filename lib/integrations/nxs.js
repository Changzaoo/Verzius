// =====================================================================
// NXS — Nexus Claude Gateway (nosso Claude local, via assinatura).
//
// Em vez de pagar API da OpenAI/Anthropic, geramos os roteiros usando o
// gateway de agentes que roda no servidor Linux de casa (nxs-agents),
// autenticado por uma chave nxsC_. Endpoint: POST /v1/run { task, agent }.
//
// O gateway devolve { ok, result, usage, ms }. O "result" e texto livre,
// entao instruimos o agente a responder SOMENTE com JSON e extraimos.
// =====================================================================

const DEFAULT_BASE = "https://agents-api.nexusholding.xyz";

export function nxsConfigured() {
  return Boolean(process.env.NXS_API_KEY);
}

export function nxsBase() {
  return (process.env.NXS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Gera os roteiros via gateway. Recebe os prompts ja montados (system+user)
// pelo viral-engine e os funde numa unica "task", pedindo JSON puro.
export async function generateWithNxs({ system, user, timeoutMs = 120000 }) {
  if (!nxsConfigured()) throw new Error("NXS_API_KEY ausente");

  const task =
    `${system}\n\n${user}\n\n` +
    `IMPORTANTE: responda EXCLUSIVAMENTE com o JSON pedido (comecando em "{" e terminando em "}"). ` +
    `Nao crie arquivos, nao escreva explicacoes, nao use blocos de codigo markdown.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${nxsBase()}/v1/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NXS_API_KEY}`,
      },
      body: JSON.stringify({ task, agent: "general", app: "verzius" }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`NXS ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`NXS agente retornou erro: ${data.error || "desconhecido"}`);
    return extractJson(data.result);
  } finally {
    clearTimeout(timer);
  }
}
