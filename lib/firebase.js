// =====================================================================
// FIREBASE AUTH — login do Verzius (verificacao leve, serverless-friendly).
//
// O gate (toda requisicao) verifica o ID token do Firebase com `jose` +
// os certificados publicos do Google — SEM o firebase-admin pesado, entao
// funciona em qualquer host (incl. Vercel). A aprovacao manual e lida do
// custom claim { approved: true } embutido no proprio token.
//
// O firebase-admin so e usado no PAINEL do admin (listar/aprovar contas),
// carregado sob demanda; se nao estiver disponivel no host, o painel avisa.
// =====================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importX509, jwtVerify, decodeProtectedHeader } from "jose";

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

const PROJECT_ID = FIREBASE_WEB_CONFIG.projectId;

// Login via Firebase fica sempre ligado (config do projeto embarcada).
// Para desligar e voltar ao login local, defina FIREBASE_DISABLED=1.
export function firebaseConfigured() {
  return process.env.FIREBASE_DISABLED !== "1";
}

// ---------- verificacao do ID token (jose + certs do Google) ----------
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let _certs = { keys: null, exp: 0 };

async function certFor(kid) {
  if (!_certs.keys || Date.now() > _certs.exp) {
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error(`certs Google ${res.status}`);
    const keys = await res.json();
    const cc = res.headers.get("cache-control") || "";
    const m = cc.match(/max-age=(\d+)/);
    _certs = { keys, exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  }
  return _certs.keys[kid];
}

// Verifica o token e devolve { uid, email, approved, isAdmin }.
export async function verifyIdToken(token) {
  const { kid } = decodeProtectedHeader(token);
  const pem = kid && (await certFor(kid));
  if (!pem) throw new Error("Certificado (kid) nao encontrado");
  const key = await importX509(pem, "RS256");
  const { payload } = await jwtVerify(token, key, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  const email = String(payload.email || "").toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;
  return { uid: payload.user_id || payload.sub, email, approved: isAdmin || payload.approved === true, isAdmin };
}

// ---------- admin (firebase-admin sob demanda) ----------
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith("{")) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  const candidates = [raw, path.join(__dirname, "..", "firebase-service-account.json")].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* tenta proximo */ }
  }
  return null;
}

export function adminConfigured() {
  return Boolean(loadServiceAccount());
}

let _auth = null;
let _ready = false;
async function getAuthInstance() {
  if (_ready) return _auth;
  _ready = true;
  const sa = loadServiceAccount();
  if (!sa) return (_auth = null);
  try {
    const appMod = await import("firebase-admin/app");
    const authMod = await import("firebase-admin/auth");
    if (!appMod.getApps().length) appMod.initializeApp({ credential: appMod.cert(sa) });
    _auth = authMod.getAuth();
  } catch (e) {
    console.error("[firebase] admin indisponivel:", e.message);
    _auth = null;
  }
  return _auth;
}

// Lista os usuarios (painel do admin), com status de aprovacao.
export async function listUsers() {
  const auth = await getAuthInstance();
  if (!auth) throw new Error("Painel do admin indisponivel neste host (use o host local).");
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
  return out.sort((a, b) => Number(a.approved) - Number(b.approved));
}

// Aprova (ou revoga) um usuario via custom claim.
export async function setApproved(uid, approved) {
  const auth = await getAuthInstance();
  if (!auth) throw new Error("Painel do admin indisponivel neste host (use o host local).");
  await auth.setCustomUserClaims(uid, { approved: Boolean(approved) });
  return { uid, approved: Boolean(approved) };
}
