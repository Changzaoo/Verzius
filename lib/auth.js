// =====================================================================
// AUTENTICACAO — multiusuario (modo agencia).
//
// Cada agencia/usuario tem login proprio e enxerga apenas os seus dados.
// Senhas com scrypt + salt; sessao via token opaco (hash guardado no DB).
//
// Modo aberto (DEMO): enquanto NAO houver nenhum usuario cadastrado, o
// app funciona sem login (ownerId = null) — pronto para demonstrar.
// Apos o primeiro cadastro, o login passa a ser exigido.
// =====================================================================

import crypto from "crypto";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash: derived };
}

export function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  // comparacao em tempo constante
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Guardamos apenas o hash do token no banco (como uma senha de sessao).
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
