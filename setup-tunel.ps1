# =====================================================================
# Verzius - setup do Cloudflare Tunnel (verzius-api.nexusholding.xyz)
# Roda tudo de uma vez: acha o cloudflared, faz login (1x), cria o tunel,
# roteia o DNS, escreve o config e sobe o tunel apontando p/ localhost:4000.
#
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\setup-tunel.ps1
# =====================================================================

# 'Continue' (nao 'Stop'): no PowerShell 5.1 a saida de stderr de um .exe nativo
# vira NativeCommandError; com 'Stop' isso mataria o script. Checamos
# $LASTEXITCODE manualmente nos pontos criticos.
$ErrorActionPreference = "Continue"
$TUNNEL_HOST = "verzius-api.nexusholding.xyz"
$TUNNEL      = "verzius"
$PORT        = 4000
$cfDir       = Join-Path $env:USERPROFILE ".cloudflared"
$cert        = Join-Path $cfDir "cert.pem"

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# --- 1. Localizar o cloudflared (sem depender do PATH da sessao) ---
function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $shim = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  if (Test-Path $shim) { return $shim }
  $wg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wg) { return $wg.FullName }
  return $null
}

$CF = Find-Cloudflared
if (-not $CF) {
  Write-Step "cloudflared nao encontrado — baixando o .exe oficial..."
  $bin = Join-Path $PSScriptRoot "bin"
  New-Item -ItemType Directory -Force $bin | Out-Null
  $CF = Join-Path $bin "cloudflared.exe"
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $CF
}
Write-Host "cloudflared: $CF"
& $CF --version

# --- garante a pasta .cloudflared (e confirma que existe) ---
New-Item -ItemType Directory -Force $cfDir | Out-Null
if (-not (Test-Path $cfDir)) { Write-Error "Nao consegui criar $cfDir"; exit 1 }

# --- 2. Login: testa de VERDADE (nao confia so no arquivo) ---
function Test-Login {
  if (-not (Test-Path $cert)) { return $false }
  & $CF --origincert $cert tunnel list --output json 1>$null 2>$null
  return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Login)) {
  Write-Step "Login na Cloudflare — vai abrir o navegador."
  Write-Host "   Escolha o dominio: nexusholding.xyz e clique em Authorize." -ForegroundColor Yellow
  & $CF tunnel login
  if (-not (Test-Path $cert)) {
    Write-Error "Login nao concluido (cert.pem ausente em $cfDir). Rode de novo e clique em Authorize no navegador."
    exit 1
  }
} else {
  Write-Host "`nLogin ja valido (cert.pem ok)."
}

# --- 3. Criar o tunel (idempotente) ---
Write-Step "Garantindo o tunel '$TUNNEL'..."
function Get-Tunnel {
  $raw = & $CF --origincert $cert tunnel list --output json 2>$null
  if (-not $raw) { return $null }
  $arr = $raw | ConvertFrom-Json
  return ($arr | Where-Object { $_.name -eq $TUNNEL } | Select-Object -First 1)
}
$t = Get-Tunnel
if (-not $t) {
  & $CF --origincert $cert tunnel create $TUNNEL
  $t = Get-Tunnel
}
if (-not $t) { Write-Error "Falha ao criar/encontrar o tunel '$TUNNEL'."; exit 1 }
$uuid  = $t.id
$creds = Join-Path $cfDir "$uuid.json"
Write-Host "tunel: $TUNNEL  id: $uuid"

# --- 4. Rotear o DNS (idempotente) ---
Write-Step "Roteando $TUNNEL_HOST -> tunel..."
& $CF --origincert $cert tunnel route dns $TUNNEL $TUNNEL_HOST 2>$null
Write-Host "DNS apontado para $TUNNEL_HOST (se ja existia, segue ok)."

# --- 5. Escrever o config.yml (garante a pasta antes) ---
Write-Step "Escrevendo config.yml..."
New-Item -ItemType Directory -Force $cfDir | Out-Null
$config = @"
tunnel: $uuid
credentials-file: $creds
origincert: $cert

ingress:
  - hostname: $TUNNEL_HOST
    service: http://localhost:$PORT
  - service: http_status:404
"@
$cfgPath = Join-Path $cfDir "config.yml"
Set-Content -Path $cfgPath -Value $config -Encoding UTF8
Write-Host "config: $cfgPath"

# --- 6. Subir o tunel (foreground; Ctrl+C para parar) ---
Write-Step "Subindo o tunel. Deixe esta janela aberta."
Write-Host "Verifique noutra janela:  curl https://$TUNNEL_HOST/api/status" -ForegroundColor Green
Write-Host "(Para rodar como servico do Windows, no boot: & '$CF' service install)`n" -ForegroundColor DarkGray
& $CF tunnel --config $cfgPath run $TUNNEL
