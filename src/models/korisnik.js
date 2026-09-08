const db = require('../db/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const svi = () => db.prepare('SELECT id, ime, email, uloga, aktivan, kreiran_at FROM korisnik ORDER BY ime').all();

const poId = (id) => db.prepare('SELECT * FROM korisnik WHERE id = ?').get(id);

const poEmailu = (email) => db.prepare('SELECT * FROM korisnik WHERE email = ?').get(email);

function generisiLozinku() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
}

function kreiraj({ ime, email, uloga }) {
  const postojeci = poEmailu(email);
  if (postojeci) throw new Error('Korisnik sa ovim emailom već postoji.');

  const lozinka = generisiLozinku();
  const hash = bcrypt.hashSync(lozinka, 12);

  const rezultat = db
    .prepare(
      `INSERT INTO korisnik (ime, email, lozinka_hash, uloga, mora_promeniti_lozinku)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(ime, email, hash, uloga);

  return { korisnik: poId(rezultat.lastInsertRowid), inicijalnaLozinka: lozinka };
}

function azurirajUlogu(id, novaUloga) {
  const dozvoljene = ['administrator', 'referent_ponude', 'referent_proizvodnja', 'pregled'];
  if (!dozvoljene.includes(novaUloga)) throw new Error('Nevažeća uloga.');
  db.prepare('UPDATE korisnik SET uloga = ? WHERE id = ?').run(novaUloga, id);
  return poId(id);
}

function postaviAktivnost(id, aktivan) {
  db.prepare('UPDATE korisnik SET aktivan = ? WHERE id = ?').run(aktivan ? 1 : 0, id);
  return poId(id);
}

function resetujLozinku(id) {
  const lozinka = generisiLozinku();
  const hash = bcrypt.hashSync(lozinka, 12);
  db.prepare('UPDATE korisnik SET lozinka_hash = ?, mora_promeniti_lozinku = 1 WHERE id = ?').run(hash, id);
  return lozinka;
}

function promeniSopstvenuLozinku(id, novaLozinka) {
  const hash = bcrypt.hashSync(novaLozinka, 12);
  db.prepare('UPDATE korisnik SET lozinka_hash = ?, mora_promeniti_lozinku = 0 WHERE id = ?').run(hash, id);
}

function brojAdmina() {
  return db.prepare("SELECT COUNT(*) as n FROM korisnik WHERE uloga = 'administrator' AND aktivan = 1").get().n;
}

module.exports = {
  svi, poId, poEmailu, kreiraj, azurirajUlogu, postaviAktivnost,
  resetujLozinku, promeniSopstvenuLozinku, brojAdmina,
};
