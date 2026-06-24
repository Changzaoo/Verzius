// =====================================================================
// MOTOR DE ROTEIRO VIRAL  — o "ouro" da plataforma.
// Codifica os padroes de retencao de video curto orgaico em um
// system prompt + estrutura, para que QUALQUER LLM gere roteiros
// consistentes (nao depende de "sorte").
//
// Principios usados (validados em short-form: TikTok / Reels / Shorts):
//   1. Hook nos primeiros 1-3s: tensao, curiosidade ou contradicao.
//   2. Especificidade > generalidade (numeros, nomes, exemplos).
//   3. Densidade de valor: cada frase precisa "pagar" o tempo do viewer.
//   4. Loop aberto: prometer no inicio o que so entrega no fim (retencao).
//   5. Pattern interrupt: quebra de ritmo a cada ~5-8s.
//   6. Sem trends/dancinha: conteudo tecnico que agrega (autoridade).
//   7. CTA suave alinhado ao objetivo (seguir / comentar / salvar).
//   8. Linguagem falada, frases curtas, zero "encheção".
// =====================================================================

export const NICHE_PRESETS = {
  medico: { label: "Saúde / Médico", tone: "autoridade acessível, sem jargão", cta: "salvar para não esquecer" },
  advogado: { label: "Direito / Advogado", tone: "didático, revela o que ninguém conta", cta: "comentar a dúvida" },
  dentista: { label: "Odontologia", tone: "prático, quebra mitos", cta: "marcar quem precisa ver" },
  imoveis: { label: "Imóveis / Corretor", tone: "urgência informada, dados de mercado", cta: "seguir para mais" },
  financas: { label: "Finanças / Investimentos", tone: "direto, contra-intuitivo", cta: "salvar o passo a passo" },
  fitness: { label: "Fitness / Nutrição", tone: "mito vs verdade, prático", cta: "salvar o treino/dica" },
  beleza: { label: "Beleza / Estética", tone: "antes-depois, alerta de erro comum", cta: "marcar uma amiga" },
  infoproduto: { label: "Infoproduto / Mentor", tone: "história + framework, prova", cta: "comentar 'EU' para receber" },
  ecommerce: { label: "E-commerce / Produto", tone: "demonstração de benefício, objeção quebrada", cta: "link na bio" },
  generico: { label: "Genérico / Empresa", tone: "claro, útil, humano", cta: "seguir para mais conteúdo" },
};

export const HOOK_FORMULAS = [
  "Contradição: \"Todo mundo acha que X, mas a verdade é Y.\"",
  "Erro caro: \"Pare de fazer X — isso está te custando Y.\"",
  "Segredo de bastidor: \"O que ninguém te conta sobre X.\"",
  "Número específico: \"X coisas que mudam Y em Z dias.\"",
  "Pergunta de tensão: \"Você sabia que X pode causar Y?\"",
  "Promessa rápida: \"Em 30 segundos eu te mostro como X.\"",
  "Autoridade + alerta: \"Como [profissional], eu nunca faria X.\"",
  "História curta: \"Um cliente meu fez X e o resultado foi Y.\"",
  "Proof-First / Resultado-primeiro: \"Cresci de 0 a 50k em 90 dias — e aqui esta o que ninguem mostra.\"",
];

// Constroi o system prompt que vira a "personalidade" do gerador.
export function buildSystemPrompt(client) {
  const niche = NICHE_PRESETS[client?.niche] || NICHE_PRESETS.generico;
  return `Voce e um roteirista especialista em VIDEOS CURTOS ORGANICOS (TikTok, Reels, YouTube Shorts) que viralizam SEM trends e SEM dancinha — apenas conteudo tecnico que agrega valor real e constroi autoridade.

CLIENTE:
- Nome/Marca: ${client?.name || "(nao informado)"}
- Nicho: ${niche.label}
- Tom de voz desejado: ${client?.tone || niche.tone}
- Publico: ${client?.audience || "publico geral interessado no tema"}
- Objetivo do conteudo: ${client?.goal || "ganhar autoridade e atrair clientes"}

REGRAS DE OURO (siga TODAS):
1. HOOK nos primeiros 3 segundos. Tem que gerar tensao, curiosidade ou contradizer o senso comum. Nada de "Oi, hoje eu vou falar sobre...".
2. Densidade de valor: cada frase paga o tempo do espectador. Corte qualquer enrolacao.
3. Frases curtas, linguagem FALADA (e pra ser lido em voz alta por um avatar).
4. Especificidade: use numeros, exemplos concretos, nomes de situacoes reais.
5. Abra um LOOP no inicio e so feche no fim (retencao ate o ultimo segundo).
6. Pattern interrupt: mude o ritmo/angulo a cada ~6 segundos.
7. CTA final suave e alinhado ao objetivo (ex: ${niche.cta}).
8. PROIBIDO: clickbait que nao entrega, promessa falsa, jargao tecnico sem explicacao, emojis no roteiro.
9. Duracao alvo: 18 a 30 segundos (aprox. 55 a 85 palavras). Cada roteiro deve poder ser falado em <=30s; corte tudo que nao for essencial para o completion.

BENCHMARK OBJETIVO DE RETENCAO (criterio de auto-correcao, nao negociavel):
- Retencao nos primeiros 3s abaixo de 60% = video morto (nao recebe push do algoritmo). Alvo: 70 a 85%.
- Reescreva qualquer hook cuja retencao_3s estimada seja <70% antes de devolver o roteiro. Nao entregue ganchos fracos.
- Use no maximo 2 formulas de gancho combinadas (mais que isso confunde e derruba o hook).

Responda SEMPRE em JSON valido, sem texto fora do JSON.`;
}

// Faixas de duracao alvo por plataforma (em segundos).
// Sub-30s tem completion rate ~92% e ate 3x mais distribuicao.
export const PLATFORM_DURATIONS = {
  shorts: 25,
  tiktok: 25,
  reels: 22,
};

// Constroi o prompt do usuario (a tarefa concreta).
// platform: ajusta a duracao alvo padrao (shorts/tiktok/reels).
// storytelling: modo opcional para conteudo voltado a seguidores (>=40s).
export function buildUserPrompt({ theme, count = 3, durationSec, platform, storytelling = false }) {
  // Define a duracao alvo: explicita > modo storytelling > plataforma > default 25s.
  let target = durationSec;
  if (target == null) {
    if (storytelling) target = 45;
    else target = PLATFORM_DURATIONS[platform] || 25;
  }
  // No modo storytelling garante pelo menos 40s.
  if (storytelling && target < 40) target = 40;

  const guideline = storytelling
    ? `Duracao alvo: ~${target}s (modo storytelling para fidelizar seguidores). Conte uma historia com inicio, tensao e virada, mas mantenha cada frase pagando o tempo do espectador.`
    : `Duracao alvo: ~${target}s (corte agressivo: o video tem que ser falado em <=30s para maximizar completion).`;

  return `Gere ${count} variacoes de roteiro para um video sobre: "${theme}".
${guideline}

Para CADA variacao retorne um objeto com os campos:
- "hook": a primeira frase (o gancho de 3s)
- "hook_formula": qual formula de gancho usou
- "visual_hook": 3 a 6 palavras em CAIXA ALTA que comunicam o valor do video SEM audio (a maioria assiste mudo nos primeiros 1.5s)
- "script": o roteiro completo pronto para ler em voz alta (texto corrido, sem marcacao de cena). Termine no PAYOFF; nao alongue com "se isso te ajudou".
- "onscreen_text": 3 a 5 textos curtos que aparecem na tela (legendas de destaque)
- "loop_line": frase final curtissima que conecta de volta ao hook (incentiva rever o video)
- "cta": chamada para acao CURTA e opcional (prefira texto na tela; nao alongue o fim)
- "broll_suggestions": 3 sugestoes de imagem/video de fundo (a primeira deve casar com o tema da frase de abertura)
- "keywords": lista das 2 a 4 palavras de impacto que aparecem no script e devem ser destacadas na legenda (so palavras que existem no texto, sem frases)
- "retencao_3s": % (0 a 100) que NAO desliza nos primeiros 3s — quanto mais forte o hook, maior; com 1 frase justificando. Alvo 70-85%; abaixo de 70 reescreva o hook.
- "completion_estimada": % (0 a 100) que assiste ate o fim do video, com 1 frase justificando
- "estimated_retention": media de retencao_3s e completion_estimada (nota 0 a 100, mantida para compatibilidade)
- "verzius_score": nota 0 a 100 de potencial viral, ponderando forca do hook, clareza do CTA e gancho emocional, com 1 frase justificando
- "title": titulo/legenda do post com no maximo 1 hashtag estrategica

Formato de resposta (JSON estrito):
{ "variations": [ { ...campos acima... } ] }`;
}

// ----------- Gerador DEMO (sem chave de API) -------------------------
// Produz roteiros plausiveis e uteis para o app funcionar na hora.
export function demoScripts({ theme, niche = "generico", count = 3, durationSec = 25 }) {
  const presets = NICHE_PRESETS[niche] || NICHE_PRESETS.generico;
  const angles = [
    {
      hf: "Contradição",
      hook: `A maioria das pessoas erra feio em "${theme}" — e nem percebe.`,
      body: `E o pior: parece certo. O resultado em ${theme} nao vem do esforco, vem da ordem certa. Primeiro ajusta a base, depois acelera. Quem inverte trava.`,
      keywords: ["erra", "ordem", "base", "trava"],
    },
    {
      hf: "Erro caro",
      hook: `Pare de fazer isso com "${theme}" — esta te custando tempo e dinheiro.`,
      body: `Nao e sorte, e metodo. Identifique o gargalo, corrija UMA coisa por vez e meca. E isso que separa quem cresce de quem fica parado em ${theme}.`,
      keywords: ["metodo", "gargalo", "cresce", "parado"],
    },
    {
      hf: "Segredo de bastidor",
      hook: `O que ninguem te conta sobre "${theme}".`,
      body: `80% do resultado vem de 20% das acoes. O resto e barulho. Foca no que importa em ${theme} e voce passa a maioria. Comeca pequeno, mas consistente.`,
      keywords: ["resultado", "barulho", "foca", "consistente"],
    },
    {
      hf: "Número específico",
      hook: `3 verdades sobre "${theme}" que mudam o jogo em 30 dias.`,
      body: `Uma: o basico bem feito ganha do avancado mal feito. Duas: medir vence adivinhar. Tres: quem comeca hoje passa quem espera. Aplica em ${theme}.`,
      keywords: ["basico", "medir", "comeca", "passa"],
    },
  ];

  const visualHooks = ["O ERRO QUE PARECE CERTO", "PARE DE PERDER TEMPO", "NINGUEM TE CONTA ISSO", "3 VERDADES EM 30 DIAS"];
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const a = angles[i % angles.length];
    // Termina no payoff; CTA fica curto/opcional (texto na tela).
    const script = `${a.hook} ${a.body}`;
    // Benchmarks objetivos: retencao_3s no alvo 70-85%; completion um pouco abaixo.
    const retencao3s = 74 + ((i * 5) % 12);
    const completionEst = 60 + ((i * 7) % 18);
    const estimated = Math.round((retencao3s + completionEst) / 2);
    chosen.push({
      hook: a.hook,
      hook_formula: a.hf,
      visual_hook: visualHooks[i % visualHooks.length],
      script,
      onscreen_text: [
        a.hf.toUpperCase(),
        "o erro que parece certo",
        "faça na ordem certa",
        "consistência > intensidade",
      ],
      loop_line: `Por isso ${theme} trava — e como destravar.`,
      cta: presets.cta,
      broll_suggestions: [
        `pessoa trabalhando em ${theme}`,
        "gráfico de crescimento simples",
        "close no rosto falando (avatar)",
      ],
      retencao_3s: retencao3s,
      completion_estimada: completionEst,
      estimated_retention: estimated,
      verzius_score: Math.min(98, estimated + 8),
      title: `A verdade sobre ${theme} #${niche}`,
      keywords: a.keywords,
      _demo: true,
    });
  }
  return { variations: chosen, demo: true };
}
