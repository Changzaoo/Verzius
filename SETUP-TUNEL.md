# 🌐 Hospedagem pública do Verzius (túnel nomeado)

Para a **publicação real (Ayrshare)** e o **avatar SadTalker (Replicate)** funcionarem,
os serviços precisam **baixar os arquivos** (MP4, foto, áudio) por uma URL pública.
Como o Verzius roda neste Windows, o caminho mais estável é um **Cloudflare Tunnel nomeado**
nesta máquina, apontando para `localhost:4000`.

> O `.env` já está configurado: `PUBLIC_BASE_URL=https://verzius-api.nexusholding.xyz`
> O `cloudflared` já está instalado (winget). O script abaixo faz **todo** o resto.

## ✅ Jeito fácil (1 passo)

**Dê duplo-clique em `setup-tunel.bat`** (ou rode no terminal):
```powershell
powershell -ExecutionPolicy Bypass -File .\setup-tunel.ps1
```

O script faz tudo sozinho:
1. acha o `cloudflared` (mesmo sem estar no PATH);
2. faz o **login** (abre o navegador **1 vez** — escolha **nexusholding.xyz** e clique em Authorize);
3. cria o túnel `verzius` (se não existir);
4. roteia o DNS `verzius-api.nexusholding.xyz`;
5. escreve o `config.yml`;
6. sobe o túnel apontando para `localhost:4000` (deixe a janela aberta).

> Na **primeira vez** ele para no login do navegador — autorize e ele continua sozinho.
> Nas próximas, já pula direto para subir o túnel.

## Validar

Com o Verzius no ar (`npm start`) e o túnel rodando, em outra janela:
```powershell
curl https://verzius-api.nexusholding.xyz/api/status
```
Deve responder o JSON de status com HTTPS válido (cadeado).

## Rodar no boot (opcional)

Para o túnel subir sozinho com o Windows, depois do primeiro setup:
```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe" service install
```

---

## ⚠️ Ainda faltam 2 ações suas (fora do túnel)

1. **Replicate (avatar SadTalker):** a conta está **sem crédito** (HTTP 402).
   Adicione billing em https://replicate.com/account/billing (uso ~$0.07/clipe).

2. **Ayrshare (publicação):** **nenhuma rede social vinculada** ainda.
   Entre em https://app.ayrshare.com → conecte Instagram/TikTok/YouTube.
   - O plano atual é **base** (cota 20 posts/mês): publica numa **única conta** vinculada.
   - O modo **multiusuário por agência** (um perfil por cliente) exige o **plano Business**
     (https://www.ayrshare.com/business-plan-for-multiple-users/). Sem ele, o Verzius
     posta na conta principal vinculada (single-tenant) — o código já lida com os dois casos.

Assim que o túnel estiver no ar + crédito no Replicate + 1 rede vinculada no Ayrshare,
o pipeline publica de verdade e gera avatar falante — sem mais mudanças de código.
