// =====================================================================
// FIREBASE AUTH (Admin SDK) — autenticacao de login do Verzius.
//
// Fluxo: o frontend faz login/registro com Firebase Auth (email/senha) e
// manda o ID token. Aqui verificamos o token e controlamos a APROVACAO
// manual: o admin (ADMIN_EMAIL) e sempre aprovado; os demais so passam
// quando recebem o custom claim { approved: true } (setado pelo admin).
//
// Sem a chave do service account, o Firebase fica desligado e o app cai
// no login local (scrypt) — nada quebra.
// =====================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@verzius.com").toLowerCase();

// Config WEB (publica) enviada ao frontend para inicializar o SDK do cliente.
export const FIREBASE_WEB_CONFIG = {
  apiKey: "AIzaSyAZrWpDHvzf2p8jMFf2rxAFo1nPTbmmFo4",
  authDomain: "verzius-9987c.firebaseapp.com",
  projectId: "verzius-9987c",
  storageBucket: "verzius-9987c.firebasestorage.app",
  messagingSenderId: "622904101648",
  appId: "1:622904101648:web:6fc32fbcab7b221440b395",
  measurementId: "G-YN181GJJ4G",
};

// Localiza a chave do service account: env (path ou JSON) ou arquivo padrao.
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  // 1) conteudo JSON direto na env (ideal p/ hosts como Render/Railway)
  if (raw && raw.trim().startsWith("{")) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  // 2) caminho apontado pela env, ou 3) arquivo padrao no projeto
  const candidates = [
    raw,
    path.join(__dirname, "..", "firebase-service-account.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* tenta proximo */ }
  }
  return null;
}

let _auth = null;
let _ready = false;

// Inicializa o Admin SDK (modular, ESM-friendly) uma unica vez. Retorna a
// instancia de Auth ou null.
async function getAuthInstance() {
  if (_ready) return _auth;
  _ready = true;
  const sa = loadServiceAccount();
  if (!sa) return (_auth = null);
  try {
    const appMod = await import("firebase-admin/app");
    const authMod = await import("firebase-admin/auth");
    if (!appMod.getApps().length) {
      appMod.initializeApp({ credential: appMod.cert(sa) });
    }
    _auth = authMod.getAuth();
  } catch (e) {
    console.error("[firebase] falha ao inicializar:", e.message);
    _auth = null;
  }
  return _auth;
}

export function firebaseConfigured() {
  return Boolean(loadServiceAccount());
}

// Verifica o ID token e devolve { uid, email, approved, isAdmin }.
export async function verifyIdToken(token) {
  const auth = await getAuthInstance();
  if (!auth) throw new Error("Firebase nao inicializado");
  const decoded = await auth.verifyIdToken(token);
  const email = (decoded.email || "").toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;
  return { uid: decoded.uid, email, approved: isAdmin || decoded.approved === true, isAdmin };
}

// Lista os usuarios (para o painel do admin), com status de aprovacao.
export async function listUsers() {
  const auth = await getAuthInstance();
  if (!auth) return [];
  const out = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      const email = (u.email || "").toLowerCase();
      out.push({
        uid: u.uid,
        email,
        approved: email === ADMIN_EMAIL || u.customClaims?.approved === true,
        isAdmin: email === ADMIN_EMAIL,
        disabled: u.disabled,
        createdAt: u.metadata?.creationTime || null,
        lastSignIn: u.metadata?.lastSignInTime || null,
      });
    }
    pageToken = res.pageToken;
  } while (pageToken);
  // pendentes primeiro
  return out.sort((a, b) => Number(a.approved) - Number(b.approved));
}

// Aprova (ou revoga) um usuario via custom claim.
export async function setApproved(uid, approved) {
  const auth = await getAuthInstance();
  if (!auth) throw new Error("Firebase nao inicializado");
  await auth.setCustomUserClaims(uid, { approved: Boolean(approved) });
  return { uid, approved: Boolean(approved) };
}
