// Armazenamento simples em arquivo JSON.
// Para o MVP nao exigimos banco de dados: tudo fica em data/db.json.
// Migrar para Postgres/SQLite depois e trivial (mesma interface).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_DB = {
  clients: [],
  scripts: [],
  videos: [],
  calendar: [],
  posts: [],
  users: [],
  meta: { createdAt: new Date().toISOString() },
};

// Em serverless (Vercel) o disco e somente-leitura/efemero: usamos um store
// em memoria (por instancia) para o app funcionar como demo ao vivo.
const SERVERLESS = Boolean(process.env.VERCEL);
let mem = null;

function ensure() {
  if (SERVERLESS) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

export function read() {
  if (SERVERLESS) {
    if (!mem) mem = structuredClone(DEFAULT_DB);
    return mem;
  }
  ensure();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

export function write(db) {
  if (SERVERLESS) { mem = db; return db; }
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  return db;
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

// Helpers de colecao -------------------------------------------------
export function insert(collection, item) {
  const db = read();
  const record = { id: uid(collection.slice(0, 3)), createdAt: new Date().toISOString(), ...item };
  db[collection].unshift(record);
  write(db);
  return record;
}

export function list(collection, filterFn) {
  const db = read();
  const items = db[collection] || [];
  return filterFn ? items.filter(filterFn) : items;
}

export function find(collection, id) {
  return (read()[collection] || []).find((x) => x.id === id);
}

export function update(collection, id, patch) {
  const db = read();
  const idx = (db[collection] || []).findIndex((x) => x.id === id);
  if (idx === -1) return null;
  db[collection][idx] = { ...db[collection][idx], ...patch, updatedAt: new Date().toISOString() };
  write(db);
  return db[collection][idx];
}

export function remove(collection, id) {
  const db = read();
  const before = (db[collection] || []).length;
  db[collection] = (db[collection] || []).filter((x) => x.id !== id);
  write(db);
  return before !== db[collection].length;
}
