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

  // VAŽNO: "DROP TABLE" u SQLite-u, kad je foreign_keys uključen, ponaša se kao da su prvo
  // ručno obrisani svi redovi te tabele — što OKIDA "ON DELETE CASCADE" kod svake druge tabele
  // koja je (privremeno, zbog preimenovanja) referencira. Bez ovoga bi se, npr., prilikom
  // brisanja privremene "plan_secenja_stara" tabele, kaskadno obrisali SVI redovi u
  // deo_iz_plana (jer njihova FK definicija u tom trenutku pokazuje na tu privremenu tabelu).
  // Zato se FK provera OBAVEZNO isključuje pre migracije i vraća tek posle.
  db.pragma('foreign_keys = OFF');
  try {
    transakcija();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

try {
  migrirajPlanSecenja();
} catch (e) {
  console.error('GREŠKA pri migraciji baze (plan_secenja):', e.message);
  console.error('Aplikacija nastavlja da se pokreće, ali planovi sečenja možda neće raditi ispravno.');
  console.error('Javi se za pomoć oko ručnog popravljanja baze ako se ovo ponavlja.');
}

// SQLite pri "ALTER TABLE ... RENAME" automatski prepravlja definicije stranih ključeva
// (foreign key) u DRUGIM tabelama da pokazuju na novo (privremeno) ime. Migracija iznad je
// preimenovala plan_secenja -> plan_secenja_stara, što je "zarazilo" deo_iz_plana (njena FK
// definicija je počela da pokazuje na plan_secenja_stara); AKO se deo_iz_plana ikad popravlja
// istom tehnikom (preimenuj-pa-vrati), to "zarazi" SLEDEĆU tabelu koja nju referencira
// (stavka_naloga), i tako dalje lančano. Ova funkcija radi opštu proveru: za svaku tabelu u bazi,
// ako njena sačuvana CREATE TABLE definicija referencira tabelu koja trenutno ne postoji
// (očigledan trag ovakvog privremenog preimenovanja), tabela se bezbedno rekonstruiše
// sa ispravnom definicijom iz schema.sql — bez gubitka podataka.
function popraviPokvareneReferenceSvuda() {
  const svePostojeceTabele = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );

  const definicijeIzSeme = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Redosled je bitan: prvo tabele koje NIŠTA ne referencira njih (da ne "zarazimo" ništa
  // dalje kad ih preimenujemo), zato idemo u obrnutom redosledu zavisnosti kad god je poznato.
  const REDOSLED_PROVERE = [
    'deo_iz_plana', 'stavka_naloga', 'stavka_ponude', 'uplata',
    'plan_secenja', 'radni_nalog', 'ponuda', 'posao',
  ];

  for (const naziv of REDOSLED_PROVERE) {
    if (!svePostojeceTabele.has(naziv)) continue;

    const tabela = db.prepare('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name = ?').get(naziv);
    if (!tabela) continue;

    // Izvuci sva imena tabela na koje ova tabela ima REFERENCES i proveri da li stvarno postoje
    const reference = [...tabela.sql.matchAll(/REFERENCES\s+"?(\w+)"?\s*\(/gi)].map((m) => m[1]);
    const imaPokvarenu = reference.some((ref) => !svePostojeceTabele.has(ref));
    if (!imaPokvarenu) continue;

    // Izvuci originalnu (ispravnu) definiciju iz schema.sql da rebuild bude tačno po šemi
    const regex = new RegExp(`CREATE TABLE IF NOT EXISTS ${naziv} \\([\\s\\S]*?\\n\\);`, 'm');
    const match = definicijeIzSeme.match(regex);
    if (!match) {
      console.error(`Popravka: ne mogu da nađem definiciju za ${naziv} u schema.sql — preskačem.`);
      continue;
    }
    const ispravnaDefinicija = match[0].replace('IF NOT EXISTS ', '');

    console.log(`Popravka baze: ${naziv} referencira nepostojeću tabelu (${reference.join(', ')}) — rekonstruišem...`);

    const privremenoIme = `${naziv}_popravka_privremeno`;
    db.pragma('foreign_keys = OFF');
    try {
      const transakcija = db.transaction(() => {
        db.exec(`ALTER TABLE ${naziv} RENAME TO ${privremenoIme}`);
        db.exec(ispravnaDefinicija);
        db.exec(`INSERT INTO ${naziv} SELECT * FROM ${privremenoIme}`);
        db.exec(`DROP TABLE ${privremenoIme}`);
      });
      transakcija();
      console.log(`Popravka ${naziv} završena — podaci sačuvani.`);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

try {
  popraviPokvareneReferenceSvuda();
} catch (e) {
  console.error('GREŠKA pri opštoj popravci referenci:', e.message);
  console.error(e.stack);
}

// Primeni šemu (idempotentno — CREATE TABLE IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
