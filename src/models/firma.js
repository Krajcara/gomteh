const db = require('../db/db');
const fs = require('fs');
const path = require('path');

const LOGO_DIR = path.join(__dirname, '../../data/uploads/logo');
fs.mkdirSync(LOGO_DIR, { recursive: true });

function preuzmi() {
  return db.prepare('SELECT * FROM firma WHERE id = 1').get();
}

function sacuvaj(polja) {
  const postojeca = preuzmi();
  const {
    naziv, adresa, mesto, email, kontaktTelefon,
    maticniBroj, pib, sifraDelatnosti, tekuciRacun,
  } = polja;

  if (postojeca) {
    db.prepare(
      `UPDATE firma SET naziv=?, adresa=?, mesto=?, email=?, kontakt_telefon=?,
       maticni_broj=?, pib=?, sifra_delatnosti=?, tekuci_racun=? WHERE id = 1`
    ).run(naziv, adresa, mesto, email, kontaktTelefon, maticniBroj, pib, sifraDelatnosti, tekuciRacun);
  } else {
    db.prepare(
      `INSERT INTO firma (id, naziv, adresa, mesto, email, kontakt_telefon,
       maticni_broj, pib, sifra_delatnosti, tekuci_racun)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(naziv, adresa, mesto, email, kontaktTelefon, maticniBroj, pib, sifraDelatnosti, tekuciRacun);
  }
  return preuzmi();
}

// putanjaNovogFajla — apsolutna putanja fajla koji je multer već sačuvao u LOGO_DIR
function azurirajLogo(putanjaNovogFajla) {
  const postojeca = preuzmi();

  // obriši stari logo fajl ako postoji, da se ne gomilaju
  if (postojeca && postojeca.logo_putanja && fs.existsSync(postojeca.logo_putanja)) {
    fs.unlinkSync(postojeca.logo_putanja);
  }

  db.prepare('UPDATE firma SET logo_putanja = ? WHERE id = 1').run(putanjaNovogFajla);
  return preuzmi();
}

module.exports = { preuzmi, sacuvaj, azurirajLogo, LOGO_DIR };
