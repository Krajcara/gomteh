const db = require('../db/db');
const { sledeciBrojNaloga } = require('../services/numbering');

function poId(id) {
  return db.prepare('SELECT * FROM radni_nalog WHERE id = ?').get(id);
}

function poPosaoId(posaoId) {
  return db.prepare('SELECT * FROM radni_nalog WHERE posao_id = ? ORDER BY datum DESC').all(posaoId);
}

function stavke(radniNalogId) {
  return db.prepare('SELECT * FROM stavka_naloga WHERE radni_nalog_id = ?').all(radniNalogId);
}

// Delovi dostupni za raspoređivanje: iz svih planova sečenja PRIHVAĆENE ponude tog posla
function deloviDostupniZaPosao(posaoId) {
  return db
    .prepare(
      `SELECT deo_iz_plana.*, plan_secenja.ponuda_id
       FROM deo_iz_plana
       JOIN plan_secenja ON plan_secenja.id = deo_iz_plana.plan_secenja_id
       JOIN ponuda ON ponuda.id = plan_secenja.ponuda_id
       WHERE ponuda.posao_id = ? AND ponuda.status = 'prihvacena'`
    )
    .all(posaoId);
}

// Suma već dodeljenih količina za dati deo_iz_plana_id, preko SVIH radnih naloga tog posla
function vecDodeljenoZaDeo(deoIzPlanaId) {
  const rezultat = db
    .prepare('SELECT COALESCE(SUM(kolicina_dodeljena), 0) as suma FROM stavka_naloga WHERE deo_iz_plana_id = ?')
    .get(deoIzPlanaId);
  return rezultat.suma;
}

// Proverava da li predložena količina prelazi plan; vraća { prekoracenje: bool, visak: broj }
function proveriKolicinu(deoIzPlanaId, novaKolicina) {
  const deo = db.prepare('SELECT * FROM deo_iz_plana WHERE id = ?').get(deoIzPlanaId);
  if (!deo) throw new Error('Deo iz plana nije pronađen.');

  const vecDodeljeno = vecDodeljenoZaDeo(deoIzPlanaId);
  const ukupnoNakon = vecDodeljeno + novaKolicina;

  if (ukupnoNakon > deo.kolicina_plan) {
    return { prekoracenje: true, visak: ukupnoNakon - deo.kolicina_plan, deo };
  }
  return { prekoracenje: false, visak: 0, deo };
}

function kreiraj({ posaoId, ponudaId, kreiraoKorisnikId, stavkeInput }) {
  const broj = sledeciBrojNaloga();

  const rezultat = db
    .prepare('INSERT INTO radni_nalog (posao_id, ponuda_id, broj, kreirao_korisnik_id) VALUES (?, ?, ?, ?)')
    .run(posaoId, ponudaId, broj, kreiraoKorisnikId);

  const nalogId = rezultat.lastInsertRowid;

  const insertStavka = db.prepare(
    'INSERT INTO stavka_naloga (radni_nalog_id, deo_iz_plana_id, part_name, kolicina_dodeljena) VALUES (?, ?, ?, ?)'
  );
  for (const s of stavkeInput) {
    insertStavka.run(nalogId, s.deoIzPlanaId, s.partName, s.kolicina);
  }

  return poId(nalogId);
}

function azurirajStatus(id, noviStatus) {
  const dozvoljeni = ['otvoren', 'u_izradi', 'zavrsen', 'storniran'];
  if (!dozvoljeni.includes(noviStatus)) throw new Error('Nevažeći status radnog naloga.');
  db.prepare('UPDATE radni_nalog SET status = ? WHERE id = ?').run(noviStatus, id);
  return poId(id);
}

function azurirajRealizovanuKolicinu(stavkaId, kolicinaZavrsena) {
  db.prepare('UPDATE stavka_naloga SET kolicina_zavrsena = ? WHERE id = ?').run(kolicinaZavrsena, stavkaId);
}

// Šta će nestati ako se radni nalog obriše — za prikaz u upozorenju pre potvrde
function izracunajUticajBrisanja(radniNalogId) {
  const stavkeReda = stavke(radniNalogId);
  const brojStavki = stavkeReda.length;
  const ukupnoDodeljeno = stavkeReda.reduce((zbir, s) => zbir + s.kolicina_dodeljena, 0);
  const ukupnoRealizovano = stavkeReda.reduce((zbir, s) => zbir + s.kolicina_zavrsena, 0);
  return { brojStavki, ukupnoDodeljeno, ukupnoRealizovano };
}

// Briše radni nalog i njegove stavke (kaskadno). Dodeljene količine se time
// oslobađaju — deo_iz_plana ponovo postaje "dostupan" za novi radni nalog.
function obrisi(radniNalogId) {
  db.prepare('DELETE FROM radni_nalog WHERE id = ?').run(radniNalogId); // kaskadno briše stavka_naloga
}

module.exports = {
  poId, poPosaoId, stavke, deloviDostupniZaPosao, vecDodeljenoZaDeo,
  proveriKolicinu, kreiraj, azurirajStatus, azurirajRealizovanuKolicinu,
  izracunajUticajBrisanja, obrisi,
};
