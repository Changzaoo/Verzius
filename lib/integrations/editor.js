// =====================================================================
// EDITOR AUTOMATICO — legendas (ASS/karaoke) + edicao vertical via FFmpeg.
//
// Transforma um roteiro (e, no LIVE, o video do avatar) em um .mp4
// vertical 1080x1920 PRONTO PARA POSTAR:
//   - legendas ASS estilo TikTok: fonte pesada, contorno grosso, safe area,
//     realce de keyword e KARAOKE word-level quando ha timestamps reais;
//   - visual_hook mudo no topo nos primeiros segundos;
//   - audio normalizado (-14 LUFS); B-roll com slow zoom (Ken Burns);
//   - encoding padronizado p/ shorts (crf 20, +faststart, 30fps).
//   - fallback automatico para drawtext se o pipeline ASS falhar.
//
// Usa o binario embarcado (ffmpeg-static) — nao exige instalacao manual.
// =====================================================================

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "..", "uploads");

// Formato vertical (Reels/TikTok/Shorts) e fps de saida.
const W = 1080;
const H = 1920;
const FPS = 30;

// Cor da marca em BGR (ASS): 0x6C5CE7 (roxo) -> &H00E75C6C&.
const BRAND_ASS = "&H00E75C6C&";

export function editorConfigured() {
  return Boolean(ffmpegPath) && fs.existsSync(ffmpegPath);
}

// --- helpers internos -------------------------------------------------

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { cwd, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg falhou: ${stderr || err.message}`));
      else resolve({ stdout, stderr });
    });
  });
}

// Args de saida de video padronizados p/ shorts (nitidez + preview web).
function videoOut() {
  return [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
    "-profile:v", "high", "-movflags", "+faststart",
  ];
}

// Caminho de fonte para o drawtext, escapado para o filtergraph do ffmpeg.
function fontArg() {
  const candidates = [
    process.env.CAPTION_FONT,
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ].filter(Boolean);
  const found = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) return null;
  return found.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// Quebra um texto em linhas de ~maxChars, respeitando palavras.
function wrap(text, maxChars = 20) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.join("\n");
}

// Monta os "blocos" de legenda a partir do roteiro (fallback sem timestamps).
function buildSegments(script) {
  const blocks = [];
  if (script?.hook) blocks.push({ text: script.hook, kind: "hook" });

  const body = (script?.script || "").replace(script?.hook || "", "").trim();
  const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 2);
  for (const s of sentences) blocks.push({ text: s.trim(), kind: "body" });

  // CTA curto/opcional: so entra como bloco se nao houver loop_line, e curto.
  const closer = script?.loop_line || script?.cta;
  if (closer && closer.split(/\s+/).length <= 10) blocks.push({ text: closer, kind: "cta" });
  if (!blocks.length) blocks.push({ text: script?.theme || "Verzius", kind: "body" });

  let t = 0;
  return blocks.map((b) => {
    const words = b.text.split(/\s+/).length;
    const dur = Math.max(1.6, Math.min(5, words * 0.40));
    const seg = { ...b, start: t, end: t + dur };
    t += dur;
    return seg;
  });
}

// Converte o alignment (char-level) do ElevenLabs em palavras com tempo.
//   alignment: { characters, character_start_times_seconds, character_end_times_seconds }
export function wordsFromAlignment(alignment) {
  if (!alignment || !Array.isArray(alignment.characters)) return [];
  const ch = alignment.characters;
  const st = alignment.character_start_times_seconds || [];
  const en = alignment.character_end_times_seconds || [];
  const words = [];
  let cur = "", start = null, end = null;
  const flush = () => {
    if (cur.trim()) words.push({ word: cur.trim(), start: start ?? 0, end: end ?? (start ?? 0) });
    cur = ""; start = null; end = null;
  };
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (/\s/.test(c)) { flush(); continue; }
    if (start === null) start = st[i] ?? 0;
    end = en[i] ?? start;
    cur += c;
  }
  flush();
  return words;
}

// Agrupa palavras em chunks de ~maxWords para caber na tela.
function chunkWords(words, maxWords = 5) {
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords));
  }
  return chunks;
}

// Normaliza palavra p/ casar keyword: minusculo e sem pontuacao.
function normKey(w) {
  return String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function keywordSet(script) {
  const list = Array.isArray(script?.keywords) ? script.keywords : [];
  const set = new Set();
  for (const k of list) { const n = normKey(k); if (n) set.add(n); }
  return set;
}

// Tempo no formato ASS (h:mm:ss.cc).
function asTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60);
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

// Escapa caracteres especiais do texto ASS.
function assEsc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

// Gera o .ass completo. Suporta:
//   - wordTimings (karaoke word-level \kf, sincronizado ao audio real);
//   - segments (fallback sem timestamps);
//   - realce de keyword (amarelo + escala) sobrepondo o varrer do karaoke;
//   - visual_hook mudo no topo nos primeiros ~2s.
function buildAss({ segments, wordTimings, keys, script }) {
  const L = [];
  L.push("[Script Info]");
  L.push("ScriptType: v4.00+");
  L.push(`PlayResX: ${W}`);
  L.push(`PlayResY: ${H}`);
  L.push("WrapStyle: 0");
  L.push("");
  L.push("[V4+ Styles]");
  L.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  // Default: legenda principal (branco c/ varrer amarelo no karaoke), safe area.
  L.push("Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,2,2,80,80,640,1");
  // Hook: visual_hook mudo no topo, cor da marca.
  L.push(`Style: Hook,Arial,84,${BRAND_ASS},&H0000FFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,5,2,8,80,80,300,1`);
  L.push("");
  L.push("[Events]");
  L.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  // visual_hook mudo no topo (primeiros ~2s).
  const vh = script?.visual_hook || (script?.hook ? script.hook.split(/\s+/).slice(0, 5).join(" ") : "");
  if (vh) {
    L.push(`Dialogue: 0,${asTime(0)},${asTime(2.0)},Hook,,0,0,0,,{\\fad(150,150)}${assEsc(vh).toUpperCase()}`);
  }

  const isKey = (tok) => keys && keys.has(normKey(tok));

  if (Array.isArray(wordTimings) && wordTimings.length) {
    // KARAOKE word-level: chunks de ~5 palavras, \kf por palavra.
    for (const chunk of chunkWords(wordTimings, 5)) {
      const start = Math.max(0, chunk[0].start - 0.08); // acende ~80ms antes
      const end = chunk[chunk.length - 1].end;
      const popIn = "{\\fad(120,0)\\t(0,150,\\fscx112\\fscy112)\\t(150,260,\\fscx100\\fscy100)}";
      const txt = chunk.map((w) => {
        const cs = Math.max(1, Math.round((w.end - w.start) * 100));
        const kf = `{\\kf${cs}}`;
        const word = assEsc(w.word);
        // keyword: forca cor amarela e leve escala (prevalece sobre o varrer).
        return isKey(w.word) ? `${kf}{\\c&H0000FFFF&\\fscx116\\fscy116}${word}{\\r}` : `${kf}${word}`;
      }).join(" ");
      L.push(`Dialogue: 0,${asTime(start)},${asTime(end)},Default,,0,0,0,,${popIn}${txt}`);
    }
  } else {
    // Fallback sem timestamps: 1 Dialogue por bloco, realce de keyword por cor.
    for (const seg of (segments || [])) {
      const txt = String(seg.text).split(/(\s+)/).map((tok) => {
        if (/^\s+$/.test(tok)) return tok;
        return isKey(tok) ? `{\\c&H0000FFFF&\\fscx116\\fscy116}${assEsc(tok)}{\\r}` : assEsc(tok);
      }).join("");
      L.push(`Dialogue: 0,${asTime(seg.start)},${asTime(seg.end)},Default,,0,0,0,,{\\fad(120,0)}${txt}`);
    }
  }
  return L.join("\n");
}

// Realce em CAIXA ALTA p/ o caminho drawtext (sem cor por palavra).
function emphasizeDraw(text, keys) {
  if (!keys || !keys.size) return text;
  return String(text).split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return tok;
    return keys.has(normKey(tok)) ? tok.toUpperCase() : tok;
  }).join("");
}

// Cadeia drawtext (FALLBACK quando o ASS falha).
function buildDrawText(segments, workDir, font, keys) {
  const filters = [];
  segments.forEach((seg, i) => {
    fs.writeFileSync(path.join(workDir, `cap${i}.txt`), wrap(emphasizeDraw(seg.text, keys), seg.kind === "hook" ? 16 : 22), "utf8");
    const isHook = seg.kind === "hook";
    const isCta = seg.kind === "cta";
    const fontsize = isHook ? 78 : isCta ? 60 : 64;
    const color = isHook ? "white" : isCta ? "0xFFE066" : "white";
    const boxcolor = isHook ? "0x6C5CE7@0.85" : "black@0.55";
    filters.push(
      `drawtext=fontfile='${font}':textfile='cap${i}.txt':` +
      `fontcolor=${color}:fontsize=${fontsize}:` +
      `box=1:boxcolor=${boxcolor}:boxborderw=26:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=14:` +
      `enable='between(t,${seg.start.toFixed(2)},${seg.end.toFixed(2)})'`
    );
  });
  return filters;
}

// Loudness -14 LUFS (padrao TikTok/YouTube).
function audioFilter() {
  return "loudnorm=I=-14:TP=-1.5:LRA=11";
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// ---------------------------------------------------------------------
// API principal: renderiza o video editado e devolve { url, demo, file }.
//   opts: { script, sourceVideoUrl?, audioBuffer?, brollPaths?, wordTimings? }
// ---------------------------------------------------------------------
export async function renderEditedVideo({ script, sourceVideoUrl = null, audioBuffer = null, brollPaths = [], wordTimings = null }) {
  if (!editorConfigured()) throw new Error("FFmpeg indisponivel");
  const font = fontArg();
  if (!font) throw new Error("Nenhuma fonte encontrada para as legendas (defina CAPTION_FONT)");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "verzius-edit-"));
  const outName = `edited_${Date.now().toString(36)}.mp4`;
  const outPath = path.join(OUT_DIR, outName);

  try {
    const segments = buildSegments(script);
    const keys = keywordSet(script);
    const hasTimings = Array.isArray(wordTimings) && wordTimings.length > 0;
    // duracao: se ha timestamps reais, usa o fim da ultima palavra; senao blocos.
    const totalDur = hasTimings
      ? wordTimings[wordTimings.length - 1].end + 0.4
      : segments[segments.length - 1].end;

    // escreve o .ass (caminho relativo ao cwd=work evita ":" no Windows).
    fs.writeFileSync(path.join(work, "captions.ass"), buildAss({ segments, wordTimings: hasTimings ? wordTimings : null, keys, script }), "utf8");
    const draw = buildDrawText(segments, work, font, keys);

    let srcPath = null;
    if (sourceVideoUrl) {
      srcPath = path.join(work, "src.mp4");
      await download(sourceVideoUrl, srcPath);
    }
    let audioPath = null;
    if (audioBuffer) {
      audioPath = path.join(work, "voz.mp3");
      fs.writeFileSync(audioPath, audioBuffer);
    }

    const useBroll = !srcPath && Array.isArray(brollPaths) && brollPaths.length > 0;

    // Monta os args; useAss=true tenta o pipeline ASS, false cai no drawtext.
    const buildArgs = (useAss) => {
      const cap = useAss ? "ass=captions.ass" : draw.join(",");
      const args = ["-y"];

      if (srcPath) {
        args.push("-i", srcPath);
        if (audioPath) args.push("-i", audioPath);
        args.push("-vf",
          `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},${cap}`);
        if (audioPath) args.push("-map", "0:v", "-map", "1:a", "-shortest");
        args.push(...videoOut());
        if (audioPath) args.push("-af", audioFilter(), "-c:a", "aac");
      } else if (useBroll) {
        const parts = [];
        segments.forEach((seg, i) => {
          const clip = brollPaths[i % brollPaths.length];
          const dur = (seg.end - seg.start);
          const frames = Math.max(1, Math.round(dur * FPS));
          // slow zoom (Ken Burns) alternando a intensidade por indice.
          const zexpr = (i % 2 === 0) ? "min(zoom+0.0009,1.12)" : "if(eq(on,0),1.12,max(zoom-0.0009,1.0))";
          args.push("-stream_loop", "-1", "-t", dur.toFixed(2), "-i", clip);
          parts.push(
            `[${i}:v]scale=${W * 1.2}:${H * 1.2}:force_original_aspect_ratio=increase,crop=${W * 1.2}:${H * 1.2},` +
            `zoompan=z='${zexpr}':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p,` +
            `trim=duration=${dur.toFixed(2)},setpts=PTS-STARTPTS[bg${i}]`
          );
        });
        const concatIn = segments.map((_, i) => `[bg${i}]`).join("");
        let fc =
          parts.join(";") + ";" +
          `${concatIn}concat=n=${segments.length}:v=1:a=0[cat];` +
          `[cat]drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.38:t=fill,` +
          `drawbox=x=0:y=0:w=${W}:h=14:color=0x6C5CE7:t=fill,${cap}[v]`;
        if (audioPath) {
          const aIdx = segments.length;
          args.push("-i", audioPath);
          fc += `;[${aIdx}:a]${audioFilter()}[aout]`;
          args.push("-filter_complex", fc, "-map", "[v]", "-map", "[aout]", "-shortest", "-c:a", "aac");
        } else {
          args.push("-filter_complex", fc, "-map", "[v]", "-t", totalDur.toFixed(2));
        }
        args.push(...videoOut());
      } else {
        args.push("-f", "lavfi", "-i", `color=c=0x0F1020:s=${W}x${H}:r=${FPS}:d=${totalDur.toFixed(2)}`);
        if (audioPath) args.push("-i", audioPath);
        args.push("-vf", `drawbox=x=0:y=0:w=${W}:h=14:color=0x6C5CE7:t=fill,${cap}`);
        if (audioPath) {
          args.push("-map", "0:v", "-map", "1:a", "-shortest", "-af", audioFilter(), "-c:a", "aac");
        } else {
          args.push("-t", totalDur.toFixed(2));
        }
        args.push(...videoOut());
      }
      args.push(outPath);
      return args;
    };

    // Tenta ASS; se falhar (libass/fonte/filtro), cai no drawtext sem quebrar.
    let usedAss = true;
    try {
      await run(buildArgs(true), work);
    } catch (e) {
      usedAss = false;
      await run(buildArgs(false), work);
    }

    return {
      url: `/uploads/${outName}`,
      file: outPath,
      demo: !sourceVideoUrl,
      broll: useBroll ? brollPaths.length : 0,
      captions: usedAss ? (hasTimings ? "ass-karaoke" : "ass") : "drawtext",
      durationSec: Number(totalDur.toFixed(1)),
      segments: segments.length,
    };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}
