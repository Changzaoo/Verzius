# ▶ Verzius

Plataforma de **agência de vídeos curtos virais com IA** — inspirada no modelo do vídeo do Diogo Guilon.
Faz o pipeline completo: **cadastro de cliente → clone de rosto (HeyGen) → clone de voz (ElevenLabs) → gerador de roteiro viral → produção do vídeo → calendário de conteúdo**.

Roda em **dois modos**:
- **DEMO** (padrão, sem chaves): tudo funciona com dados simulados — ótimo para testar o produto e fazer demonstração para clientes.
- **LIVE**: você pluga as APIs e produz vídeos de verdade.

---

## 🚀 Como rodar

Pré-requisito: [Node.js 18+](https://nodejs.org).

```bash
# dentro da pasta do projeto
npm install
npm start
```

Abra **http://localhost:4000** no navegador.

Pronto — já roda em modo demo, sem precisar de nada.

---

## 🔑 Ativar o modo LIVE (produção real)

1. Copie o arquivo `.env.example` para `.env`
2. Preencha as chaves que tiver:

| Função | Serviço | Onde pegar |
|---|---|---|
| Roteiro | **NXS** (Claude local, assinatura) **ou** OpenAI/Anthropic | gateway `nxs-agents` / platform.openai.com / console.anthropic.com |
| Voz | ElevenLabs | elevenlabs.io |
| B-roll | Pexels | pexels.com/api |
| Avatar/rosto | HeyGen (opcional) | heygen.com |

> **Roteiro com custo zero:** preenchendo `NXS_API_KEY` o app usa o nosso Claude local
> (via assinatura, pelo gateway `agents-api`) em vez de pagar API. Tem prioridade sobre OpenAI/Anthropic.
> **Sem avatar:** sem HeyGen, o vídeo final é gerado com **voz real (ElevenLabs) + legendas + B-roll**.

3. Reinicie (`npm start`). O selo no menu vai mudar de **DEMO** para **LIVE**.

> As chaves ficam só no seu computador (arquivo `.env`) e nunca são enviadas ao navegador.
> Você pode ativar uma de cada vez — ex.: só o roteiro (LLM) já melhora muito o demo.

---

## 🧩 O que cada parte faz

- **Dashboard** — visão geral (clientes, vídeos, roteiros, views).
- **Clientes** — cada cliente tem nicho, tom de voz, avatar e voz próprios.
- **Estúdio de Roteiro** — o coração do produto. Gera roteiros virais (hook + corpo + textos de tela + CTA + sugestões de B-roll + nota de retenção), com variações A/B. A lógica de viralização está em `lib/viral-engine.js`.
- **Vídeos** — produz o vídeo com avatar a partir do roteiro salvo (HeyGen), acompanha o status e faz a **edição automática** (legendas queimadas + formato vertical 9:16 via FFmpeg) gerando o `.mp4` pronto para postar.
- **Publicações** — posta o vídeo editado (Instagram/TikTok/YouTube) e acompanha as **métricas** (views, likes, comentários, shares) com curva de crescimento ao longo do tempo.
- **Calendário** — gera o plano de 60 vídeos em ~3 meses (seg–sex), como no modelo do vídeo.
- **Login/Agência** — cada agência cria sua conta e enxerga apenas os próprios clientes/dados (multiusuário).
- **Configurações** — status das integrações e como ativar o LIVE.

---

## 💼 Como usar como agência (o modelo do vídeo)

1. **Demonstre em modo DEMO** para o cliente fechar na hora (pix de compromisso 😉).
2. Cadastre o cliente, suba **1 foto** (sorrindo, frontal, sem boné) e **1–5 min de áudio**.
3. Gere os roteiros no Estúdio e **escolha o melhor** — você é o "maestro".
4. Produza os vídeos e siga o **calendário** (consistência > intensidade).
5. O cliente **não grava nada** — esse é o argumento de venda: "não te dou trabalho".

---

## 🛠️ Stack

- **Backend:** Node.js + Express (sem build, sem banco — dados em `data/db.json`).
- **Frontend:** HTML/CSS/JS puro (SPA), sem dependências de build.
- **Integrações:** NXS/Claude local + OpenAI/Anthropic (roteiro), ElevenLabs (voz/narração), Pexels (B-roll), FFmpeg (edição), HeyGen (avatar, opcional) — todas com fallback demo.

### Estrutura
```
server.js              API Express (auth + escopo por agencia)
lib/
  db.js                armazenamento JSON
  auth.js              login multiusuario (scrypt + token)
  viral-engine.js      motor de roteiro viral (o "ouro")
  integrations/        llm.js · nxs.js (Claude local) · elevenlabs.js · heygen.js
                       editor.js (FFmpeg) · broll.js (Pexels) · publisher.js (redes)
public/                index.html · styles.css · app.js
```

---

## ⚠️ Observações honestas

- O vídeo original **não mostra código** — ele descreve um produto que **orquestra** ferramentas que já existem (ele cita HeyGen e GPT). Este projeto reconstrói esse **conceito** de forma funcional e aberta.
- O diferencial real de uma agência assim não é a tecnologia, é (a) **saber quais roteiros viralizam** (por isso o motor de roteiro é a peça central) e (b) o **modelo comercial**.
- Uso de clone de voz/rosto exige **consentimento** da pessoa clonada. Use apenas com clientes que autorizaram.

---

## 🔜 Próximos passos sugeridos (roadmap)

- ✅ ~~Edição automática (legendas queimadas + formato vertical) com FFmpeg.~~ **Feito** — `lib/integrations/editor.js` (FFmpeg embutido via `ffmpeg-static`, sem instalação).
- ✅ ~~B-roll real~~ **Feito** — `lib/integrations/broll.js` (clipes de fundo via Pexels; defina `PEXELS_API_KEY`).
- ✅ ~~Postagem automática + métricas de views.~~ **Feito** — `lib/integrations/publisher.js` (publicação Instagram/TikTok/YouTube com provider demo + métricas com curva viral; tokens reais por plataforma).
- ✅ ~~Multiusuário/login por agência.~~ **Feito** — `lib/auth.js` + escopo por `ownerId` (cada agência só enxerga os próprios dados). Falta: cobrança/billing.
- ✅ ~~Legendas ASS + karaoke word-level~~ **Feito** — `editor.js` queima legendas ASS estilo TikTok com **karaoke sincronizado aos timestamps reais** (ElevenLabs `/with-timestamps`), realce de keyword e `visual_hook` mudo no topo; fallback automatico p/ drawtext.
- ✅ ~~Encoding p/ shorts + loudness + B-roll com slow zoom~~ **Feito** — crf 20 / +faststart / 30fps, audio −14 LUFS, Ken Burns no B-roll.
- ✅ ~~Verzius Score + metricas de hook rate/saves/sends~~ **Feito** — score preditivo no Estudio; metricas reposicionadas em `publisher.js`.
- ✅ ~~Publicacao real (Ayrshare) + avatar barato (Replicate/SadTalker)~~ **Feito** (providers + fallback demo) — ativar com `AYRSHARE_API_KEY` / `REPLICATE_API_TOKEN`.
- Banco real (Postgres/SQLite) quando passar de ~algumas centenas de registros; hospedagem publica dos MP4 (p/ a publicacao real).
