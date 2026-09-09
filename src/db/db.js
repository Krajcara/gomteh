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

// Migracije koje se ne mogu rešiti prostim "CREATE TABLE IF NOT EXISTS"
// (npr. promena strukture postojeće tabele). Cela provera + izmena je u JEDNOJ
// transakciji da bi bila atomična — bezbedno i ako se pokrene više puta zaredom,
// i samo-oporavlja se iz bilo kog polu-završenog stanja (npr. server ugašen usred migracije).
function migrirajPlanSecenja() {
  const imaTabelu = (naziv) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(naziv);

  const SEMA_NOVE_TABELE = `
    CREATE TABLE IF NOT EXISTS plan_secenja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      posao_id INTEGER NOT NULL REFERENCES posao(id) ON DELETE CASCADE,
      ponuda_id INTEGER REFERENCES ponuda(id) ON DELETE SET NULL,
      originalni_fajl_putanja TEXT NOT NULL,
      preveden_fajl_putanja TEXT,
      naziv_fajla TEXT,
      materijal TEXT,
      debljina_mm REAL,
      tezina_delova_kg REAL,
      duzina_reza_mm REAL,
      metod_1_iznos REAL,
      metod_2_iznos REAL,
      izabrani_metod INTEGER CHECK (izabrani_metod IN (1, 2)),
      kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  const UPIT_KOPIRANJA = `
    INSERT INTO plan_secenja
      (id, posao_id, ponuda_id, originalni_fajl_putanja, preveden_fajl_putanja, naziv_fajla,
       materijal, debljina_mm, tezina_delova_kg, duzina_reza_mm, metod_1_iznos, metod_2_iznos,
       izabrani_metod, kreiran_at)
    SELECT stara.id, ponuda.posao_id, stara.ponuda_id, stara.originalni_fajl_putanja, stara.preveden_fajl_putanja,
       stara.naziv_fajla, stara.materijal, stara.debljina_mm, stara.tezina_delova_kg, stara.duzina_reza_mm,
       stara.metod_1_iznos, stara.metod_2_iznos, stara.izabrani_metod, stara.kreiran_at
    FROM plan_secenja_stara stara
    JOIN ponuda ON ponuda.id = stara.ponuda_id
    WHERE stara.id NOT IN (SELECT id FROM plan_secenja)
  `;

  const transakcija = db.transaction(() => {
    const novaPostoji = imaTabelu('plan_secenja');
    const staraPostoji = imaTabelu('plan_secenja_stara');

    if (!novaPostoji && !staraPostoji) return; // prva instalacija — schema.sql kreira novu tabelu

    if (novaPostoji) {
      const kolone = db.prepare('PRAGMA table_info(plan_secenja)').all();
      const imaPosaoId = kolone.some((k) => k.name === 'posao_id');

      if (imaPosaoId) {
        // Već migrirano. Ako je nekim ranijim prekidom ostala privremena tabela
        // (npr. server ugašen tačno između koraka), dovrši bezbedno kopiranje pa je ukloni.
        if (staraPostoji) {
          console.log('Migracija: zatečena nedovršena privremena tabela — dovršavam...');
          db.exec(UPIT_KOPIRANJA);
          db.exec('DROP TABLE plan_secenja_stara');
        }
        return;
      }
      // plan_secenja postoji ali je stari oblik (nema posao_id) — preimenuj je
      db.exec('ALTER TABLE plan_secenja RENAME TO plan_secenja_stara');
    }
    // (ako !novaPostoji, znači da je preimenovanje već urađeno u ranijem prekinutom pokušaju —
    // nastavljamo odatle, ne preimenujemo ponovo)

    console.log('Migracija baze: dodajem posao_id u plan_secenja...');
    db.exec(SEMA_NOVE_TABELE);
    db.exec(UPIT_KOPIRANJA);
    db.exec('DROP TABLE plan_secenja_stara');
    console.log('Migracija završena — postojeći planovi sečenja su sačuvani i povezani sa svojim poslovima.');
  });

  transakcija();
}

try {
  migrirajPlanSecenja();
} catch (e) {
  console.error('GREŠKA pri migraciji baze (plan_secenja):', e.message);
  console.error('Aplikacija nastavlja da se pokreće, ali planovi sečenja možda neće raditi ispravno.');
  console.error('Javi se za pomoć oko ručnog popravljanja baze ako se ovo ponavlja.');
}

// Primeni šemu (idempotentno — CREATE TABLE IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
