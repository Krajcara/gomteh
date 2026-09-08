// Poziva se JEDNOM iz install.sh, nakon što je .env već generisan.
// Kreira bazu (preko db.js koji primenjuje schema.sql) i admin nalog
// sa lozinkom prosleđenom kroz env promenljivu ADMIN_PASSWORD.

const bcrypt = require('bcrypt');
const db = require('../src/db/db');

const ADMIN_EMAIL = 'admin@gomteh.local';
const lozinka = process.env.ADMIN_PASSWORD;

if (!lozinka) {
  console.error('ADMIN_PASSWORD nije prosleđena skripti.');
  process.exit(1);
}

const postojeci = db.prepare('SELECT id FROM korisnik WHERE email = ?').get(ADMIN_EMAIL);
if (postojeci) {
  console.log('Admin nalog već postoji, preskačem kreiranje.');
  process.exit(0);
}

const hash = bcrypt.hashSync(lozinka, 12);

db.prepare(
  `INSERT INTO korisnik (ime, email, lozinka_hash, uloga, mora_promeniti_lozinku)
   VALUES (?, ?, ?, 'administrator', 1)`
).run('Administrator', ADMIN_EMAIL, hash);

console.log('Admin nalog kreiran.');
