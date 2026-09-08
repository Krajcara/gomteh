// Konekcija ka enkriptovanoj SQLite bazi (SQLCipher preko better-sqlite3-multiple-ciphers)
// Ključ za enkripciju dolazi isključivo iz .env (DB_ENCRYPTION_KEY), koji se generiše
// pri instalaciji i NIKAD ne ide u git repozitorijum (vidi .gitignore).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/gomteh.db');
const DB_KEY = process.env.DB_ENCRYPTION_KEY;

if (!DB_KEY) {
  throw new Error(
    'DB_ENCRYPTION_KEY nije podešen u .env fajlu. Pokreni install.sh da generišeš ključ pre prvog starta.'
  );
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma(`cipher='sqlcipher'`);
db.pragma(`key='${DB_KEY}'`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Primeni šemu (idempotentno — CREATE TABLE IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
