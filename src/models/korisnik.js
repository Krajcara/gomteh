const db = require('../db/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { OidcGreska } = require('../services/oidc');

const svi = () => db.prepare('SELECT id, ime, email, uloga, aktivan, kreiran_at FROM korisnik ORDER BY ime').all();

const poId = (id) => db.prepare('SELECT * FROM korisnik WHERE id = ?').get(id);

const poEmailu = (email) => db.prepare('SELECT * FROM korisnik WHERE email = ?').get(email);

const poOidcSub = (sub) => db.prepare('SELECT * FROM korisnik WHERE oidc_sub = ?').get(sub);

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

/**
 * Prijava preko Keycloak-a. Korisnik se prepoznaje po `sub` iz tokena (trajni ID u
 * Keycloak-u), a ne po emailu, jer se email može promeniti.
 *  - već povezan nalog: ažuriraju se ime i uloga (Keycloak je izvor istine za ulogu)
 *  - postojeći lokalni nalog sa istim, potvrđenim emailom: povezuje se sa Keycloak nalogom
 *  - nema ga: pravi se novi nalog, bez upotrebljive lokalne lozinke
 */
const prijaviIliKreirajOidc = db.transaction(({ sub, email, emailPotvrdjen, ime, uloga }) => {
  let korisnik = poOidcSub(sub);

  if (!korisnik && email) {
    const saIstimEmailom = db.prepare('SELECT * FROM korisnik WHERE LOWER(email) = LOWER(?)').get(email);
    if (saIstimEmailom) {
      if (saIstimEmailom.oidc_sub) {
        throw new OidcGreska('Ovaj email je već povezan sa drugim Keycloak nalogom.');
      }
      if (!emailPotvrdjen) {
        throw new OidcGreska(
          'Lokalni nalog sa ovim emailom već postoji. Da bi se povezali, email mora biti potvrđen u Keycloak-u.'
        );
      }
      db.prepare('UPDATE korisnik SET oidc_sub = ? WHERE id = ?').run(sub, saIstimEmailom.id);
      korisnik = poId(saIstimEmailom.id);
    }
  }

  if (!korisnik) {
    if (!email) throw new OidcGreska('Keycloak nalog nema email adresu, a GomTeh je zahteva.');
    // Nasumična lozinka koju niko ne zna: nalog postoji, ali se prijavljuje samo preko Keycloak-a.
    // Administrator mu po potrebi može resetovati lozinku i tako dati i lokalnu prijavu.
    const neupotrebljivHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
    const rezultat = db
      .prepare(
        `INSERT INTO korisnik (ime, email, lozinka_hash, uloga, mora_promeniti_lozinku, oidc_sub)
         VALUES (?, ?, ?, ?, 0, ?)`
      )
      .run(ime || email, email, neupotrebljivHash, uloga, sub);
    return poId(rezultat.lastInsertRowid);
  }

  db.prepare('UPDATE korisnik SET ime = ?, uloga = ? WHERE id = ?').run(ime || korisnik.ime, uloga, korisnik.id);
  return poId(korisnik.id);
});

function brojAdmina() {
  return db.prepare("SELECT COUNT(*) as n FROM korisnik WHERE uloga = 'administrator' AND aktivan = 1").get().n;
}

module.exports = {
  svi, poId, poEmailu, poOidcSub, prijaviIliKreirajOidc, kreiraj, azurirajUlogu, postaviAktivnost,
  resetujLozinku, promeniSopstvenuLozinku, brojAdmina,
};
