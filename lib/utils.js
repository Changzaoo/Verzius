// Utilidades compartilhadas entre integracoes.

// Extrai o primeiro objeto JSON ({ ... }) de um texto livre (resposta de LLM).
// Procura do primeiro "{" ate o ultimo "}" e tenta fazer o parse.
// Devolve null se nao houver JSON valido.
export function extractJson(text) {
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
