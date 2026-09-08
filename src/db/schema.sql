-- GOMTEH — šema baze podataka
-- Napomena: sama datoteka baze se enkriptuje na nivou SQLCipher-a (ključ u .env, van git-a)

PRAGMA foreign_keys = ON;

-- Podaci firme izdavaoca (singleton — samo jedan red)
CREATE TABLE IF NOT EXISTS firma (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  naziv TEXT NOT NULL,
  adresa TEXT,
  mesto TEXT,
  email TEXT,
  kontakt_telefon TEXT,
  maticni_broj TEXT,
  pib TEXT,
  sifra_delatnosti TEXT,
  tekuci_racun TEXT,
  logo_putanja TEXT              -- putanja do uploadovanog logo fajla, koristi se na ponudama/nalozima i na prevedenom planu sečenja
);

-- Podešavanja obračuna
CREATE TABLE IF NOT EXISTS podesavanja (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cena_po_kg REAL NOT NULL DEFAULT 0,
  procenat_rada REAL NOT NULL DEFAULT 22.5 CHECK (procenat_rada BETWEEN 20 AND 25)
);

-- Cena po dužnom metru, po debljini materijala
CREATE TABLE IF NOT EXISTS cena_po_debljini (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debljina_mm REAL NOT NULL UNIQUE,
  cena_po_m REAL NOT NULL
);

-- Interni korisnici (staff)
CREATE TABLE IF NOT EXISTS korisnik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ime TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  lozinka_hash TEXT NOT NULL,
  uloga TEXT NOT NULL CHECK (uloga IN ('administrator', 'referent_ponude', 'referent_proizvodnja', 'pregled')),
  mora_promeniti_lozinku INTEGER NOT NULL DEFAULT 1,
  aktivan INTEGER NOT NULL DEFAULT 1,
  kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Komitenti (klijenti)
CREATE TABLE IF NOT EXISTS komitent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv TEXT NOT NULL,
  tip TEXT NOT NULL CHECK (tip IN ('firma', 'fizicko_lice')),
  adresa TEXT,
  mesto TEXT,
  kontakt_osoba TEXT,
  kontakt_telefon TEXT,
  pib TEXT,
  email TEXT UNIQUE,               -- korisničko ime za portal
  lozinka_hash TEXT,                -- inicijalnu postavlja referent
  mora_promeniti_lozinku INTEGER NOT NULL DEFAULT 1,
  kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Poslovi (job)
CREATE TABLE IF NOT EXISTS posao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  komitent_id INTEGER NOT NULL REFERENCES komitent(id),
  naziv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'poslata_ponuda'
    CHECK (status IN ('poslata_ponuda', 'u_izradi', 'zavrsen', 'odbijen')),
  kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Brojači za ponude i radne naloge (odvojeni, po godini)
CREATE TABLE IF NOT EXISTS brojac (
  tip TEXT NOT NULL CHECK (tip IN ('ponuda', 'radni_nalog')),
  godina INTEGER NOT NULL,
  poslednji_broj INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tip, godina)
);

-- Ponude
CREATE TABLE IF NOT EXISTS ponuda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posao_id INTEGER NOT NULL REFERENCES posao(id),
  broj TEXT NOT NULL UNIQUE,          -- npr. "09/2026"
  datum TEXT NOT NULL DEFAULT (datetime('now')),
  primio_mesto TEXT,
  sastavio_korisnik_id INTEGER REFERENCES korisnik(id),
  naslov_posla TEXT,
  propratni_tekst TEXT,
  tehnicki_opis TEXT,
  rok_isporuke TEXT,
  placanje TEXT,
  garancija TEXT,
  napomena TEXT,
  rok_vazenja TEXT,
  status TEXT NOT NULL DEFAULT 'poslata' CHECK (status IN ('poslata', 'prihvacena', 'odbijena')),
  komentar_odbijanja TEXT,
  dokument_odbijanja_putanja TEXT,
  je_automatska_za_visak INTEGER NOT NULL DEFAULT 0,
  ukupno REAL,
  kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stavke cene ponude (rad, transport, materijal, itd.)
CREATE TABLE IF NOT EXISTS stavka_ponude (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ponuda_id INTEGER NOT NULL REFERENCES ponuda(id) ON DELETE CASCADE,
  opis TEXT NOT NULL,
  iznos REAL NOT NULL,
  je_iz_plana_secenja INTEGER NOT NULL DEFAULT 0,
  redosled INTEGER NOT NULL DEFAULT 0
);

-- Plan sečenja (PDF upload, vezan za ponudu)
CREATE TABLE IF NOT EXISTS plan_secenja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ponuda_id INTEGER NOT NULL REFERENCES ponuda(id) ON DELETE CASCADE,
  originalni_fajl_putanja TEXT NOT NULL,
  preveden_fajl_putanja TEXT,
  naziv_fajla TEXT,
  materijal TEXT,
  debljina_mm REAL,
  tezina_delova_kg REAL,
  duzina_reza_mm REAL,
  metod_1_iznos REAL,               -- (težina × cena/kg) + rad
  metod_2_iznos REAL,               -- dužina × cena/m
  izabrani_metod INTEGER CHECK (izabrani_metod IN (1, 2)),
  kreiran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Delovi iz plana sečenja (Part Name / Qnty iz PDF tabele)
CREATE TABLE IF NOT EXISTS deo_iz_plana (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_secenja_id INTEGER NOT NULL REFERENCES plan_secenja(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_size TEXT,
  kolicina_plan INTEGER NOT NULL
);

-- Radni nalozi
CREATE TABLE IF NOT EXISTS radni_nalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posao_id INTEGER NOT NULL REFERENCES posao(id),
  ponuda_id INTEGER NOT NULL REFERENCES ponuda(id),
  broj TEXT NOT NULL UNIQUE,          -- npr. "45/2026"
  status TEXT NOT NULL DEFAULT 'otvoren'
    CHECK (status IN ('otvoren', 'u_izradi', 'zavrsen', 'storniran')),
  datum TEXT NOT NULL DEFAULT (datetime('now')),
  kreirao_korisnik_id INTEGER REFERENCES korisnik(id)
);

-- Stavke radnog naloga (deo + dodeljena/realizovana količina)
CREATE TABLE IF NOT EXISTS stavka_naloga (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radni_nalog_id INTEGER NOT NULL REFERENCES radni_nalog(id) ON DELETE CASCADE,
  deo_iz_plana_id INTEGER REFERENCES deo_iz_plana(id),
  part_name TEXT NOT NULL,
  kolicina_dodeljena INTEGER NOT NULL,
  kolicina_zavrsena INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posao_komitent ON posao(komitent_id);
CREATE INDEX IF NOT EXISTS idx_ponuda_posao ON ponuda(posao_id);
CREATE INDEX IF NOT EXISTS idx_ponuda_broj ON ponuda(broj);
CREATE INDEX IF NOT EXISTS idx_ponuda_datum ON ponuda(datum);
CREATE INDEX IF NOT EXISTS idx_nalog_posao ON radni_nalog(posao_id);
CREATE INDEX IF NOT EXISTS idx_nalog_broj ON radni_nalog(broj);

-- Uplate po ponudi (jedna ponuda može imati više parcijalnih uplata)
CREATE TABLE IF NOT EXISTS uplata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ponuda_id INTEGER NOT NULL REFERENCES ponuda(id) ON DELETE CASCADE,
  iznos REAL NOT NULL,
  datum TEXT NOT NULL DEFAULT (datetime('now')),
  napomena TEXT,
  kreirao_korisnik_id INTEGER REFERENCES korisnik(id)
);

CREATE INDEX IF NOT EXISTS idx_uplata_ponuda ON uplata(ponuda_id);
