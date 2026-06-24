// Geracao de roteiro via LLM. Suporta o Claude local (NXS), OpenAI e Anthropic.
// Se nenhuma chave estiver configurada, o chamador usa o gerador demo.

import { nxsConfigured, generateWithNxs } from "./nxs.js";
import { extractJson } from "../utils.js";

export function llmConfigured() {
  return Boolean(nxsConfigured() || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export function llmProvider() {
  // NXS (nosso Claude via assinatura) tem prioridade — custo zero de API.
  if (nxsConfigured()) return "nxs";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export async function generateWithLLM({ system, user }) {
  const provider = llmProvider();
  if (!provider) throw new Error("Nenhum provedor LLM configurado");

  if (provider === "nxs") {
    return generateWithNxs({ system, user });
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.9,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content);
  }

  // anthropic
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 2000,
      temperature: 0.9,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.content?.[0]?.text);
}
