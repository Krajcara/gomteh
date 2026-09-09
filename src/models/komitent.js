const db = require('../db/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

function generisiLozinku() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
}

const svi = () => db.prepare('SELECT * FROM komitent ORDER BY naziv').all();

const poId = (id) => db.prepare('SELECT * FROM komitent WHERE id = ?').get(id);

const poEmailu = (email) =>
  db.prepare('SELECT * FROM komitent WHERE email = ?').get(email);

const pretraga = (tekst) =>
  db
    .prepare(
      `SELECT * FROM komitent WHERE naziv LIKE ? OR email LIKE ? ORDER BY naziv`
    )
    .all(`%${tekst}%`, `%${tekst}%`);

function kreiraj({ naziv, tip, adresa, mesto, kontaktOsoba, kontaktTelefon, pib, email, inicijalnaLozinka }) {
  const lozinkaHash = inicijalnaLozinka
    ? bcrypt.hashSync(inicijalnaLozinka, 12)
    : null;

  const rezultat = db
    .prepare(
      `INSERT INTO komitent
        (naziv, tip, adresa, mesto, kontakt_osoba, kontakt_telefon, pib, email, lozinka_hash, mora_promeniti_lozinku)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(naziv, tip, adresa, mesto, kontaktOsoba, kontaktTelefon, pib, email, lozinkaHash);

  return poId(rezultat.lastInsertRowid);
}

function azuriraj(id, polja) {
  const dozvoljena = ['naziv', 'tip', 'adresa', 'mesto', 'kontakt_osoba', 'kontakt_telefon', 'pib', 'email'];
  const setovi = [];
  const vrednosti = [];
  for (const [kljuc, vrednost] of Object.entries(polja)) {
    if (dozvoljena.includes(kljuc)) {
      setovi.push(`${kljuc} = ?`);
      vrednosti.push(vrednost);
    }
  }
  if (!setovi.length) return poId(id);
  vrednosti.push(id);
  db.prepare(`UPDATE komitent SET ${setovi.join(', ')} WHERE id = ?`).run(...vrednosti);
  return poId(id);
}

function postaviLozinku(id, novaLozinka, mustChange = false) {
  const hash = bcrypt.hashSync(novaLozinka, 12);
  db.prepare(
    'UPDATE komitent SET lozinka_hash = ?, mora_promeniti_lozinku = ? WHERE id = ?'
  ).run(hash, mustChange ? 1 : 0, id);
}

function resetujLozinku(id) {
  const lozinka = generisiLozinku();
  postaviLozinku(id, lozinka, true);
  return lozinka;
}

function proveriLozinku(email, lozinka) {
  const komitent = poEmailu(email);
  if (!komitent || !komitent.lozinka_hash) return null;
  return bcrypt.compareSync(lozinka, komitent.lozinka_hash) ? komitent : null;
}

module.exports = {
  svi,
  poId,
  poEmailu,
  pretraga,
  kreiraj,
  azuriraj,
  postaviLozinku,
  resetujLozinku,
  proveriLozinku,
};
