const db = require('../db/db');
const { sledeciBrojPonude } = require('../services/numbering');

function poId(id) {
  return db.prepare('SELECT * FROM ponuda WHERE id = ?').get(id);
}

function poPosaoId(posaoId) {
  return db.prepare('SELECT * FROM ponuda WHERE posao_id = ? ORDER BY kreiran_at DESC').all(posaoId);
}

function stavke(ponudaId) {
  return db
    .prepare('SELECT * FROM stavka_ponude WHERE ponuda_id = ? ORDER BY redosled, id')
    .all(ponudaId);
}

function kreiraj({ posaoId, sastavioKorisnikId, primioMesto, naslovPosla, propratniTekst, tehnickiOpis, rokIsporuke, placanje, garancija, napomena, rokVazenja }, jeAutomatskaZaVisak = false) {
  const broj = sledeciBrojPonude();
  const rezultat = db
    .prepare(
      `INSERT INTO ponuda
        (posao_id, broj, primio_mesto, sastavio_korisnik_id, naslov_posla, propratni_tekst,
         tehnicki_opis, rok_isporuke, placanje, garancija, napomena, rok_vazenja, je_automatska_za_visak)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(posaoId, broj, primioMesto, sastavioKorisnikId, naslovPosla, propratniTekst,
      tehnickiOpis, rokIsporuke, placanje, garancija, napomena, rokVazenja, jeAutomatskaZaVisak ? 1 : 0);
  return poId(rezultat.lastInsertRowid);
}

function dodajStavku(ponudaId, { opis, iznos, jeIzPlanaSecenja = false }) {
  const redosled = db.prepare('SELECT COALESCE(MAX(redosled), 0) + 1 as r FROM stavka_ponude WHERE ponuda_id = ?').get(ponudaId).r;
  db.prepare(
    'INSERT INTO stavka_ponude (ponuda_id, opis, iznos, je_iz_plana_secenja, redosled) VALUES (?, ?, ?, ?, ?)'
  ).run(ponudaId, opis, iznos, jeIzPlanaSecenja ? 1 : 0, redosled);
  preracunajUkupno(ponudaId);
}

function obrisiStavku(ponudaId, stavkaId) {
  db.prepare('DELETE FROM stavka_ponude WHERE id = ? AND ponuda_id = ?').run(stavkaId, ponudaId);
  preracunajUkupno(ponudaId);
}

function preracunajUkupno(ponudaId) {
  const zbir = db.prepare('SELECT COALESCE(SUM(iznos), 0) as ukupno FROM stavka_ponude WHERE ponuda_id = ?').get(ponudaId).ukupno;
  db.prepare('UPDATE ponuda SET ukupno = ? WHERE id = ?').run(zbir, ponudaId);
  return zbir;
}

// Bira metod obračuna za plan sečenja (koji je već povezan sa ovom ponudom) i dodaje stavku
function izaberiMetodIDodajStavku(planSecenjaId, metod) {
  const plan = db.prepare('SELECT * FROM plan_secenja WHERE id = ?').get(planSecenjaId);
  if (!plan) throw new Error('Plan sečenja nije pronađen.');
  if (!plan.ponuda_id) throw new Error('Plan sečenja još nije povezan ni sa jednom ponudom.');

  const iznos = metod === 1 ? plan.metod_1_iznos : plan.metod_2_iznos;
  db.prepare('UPDATE plan_secenja SET izabrani_metod = ? WHERE id = ?').run(metod, planSecenjaId);

  dodajStavku(plan.ponuda_id, {
    opis: `Materijal — ${plan.naziv_fajla || 'plan sečenja'} (${metod === 1 ? 'obračun po težini' : 'obračun po dužini reza'})`,
    iznos,
    jeIzPlanaSecenja: true,
  });
}

function promeniStatus(id, noviStatus, { komentar, dokumentPutanja } = {}) {
  const ponuda = poId(id);
  if (!ponuda) throw new Error('Ponuda nije pronađena.');

  if (noviStatus === 'prihvacena') {
    db.prepare("UPDATE ponuda SET status = 'prihvacena' WHERE id = ?").run(id);
    const Posao = require('./posao');
    Posao.oznaciUIzradi(ponuda.posao_id);
  } else if (noviStatus === 'odbijena') {
    db.prepare(
      `UPDATE ponuda SET status = 'odbijena', komentar_odbijanja = ?, dokument_odbijanja_putanja = ? WHERE id = ?`
    ).run(komentar || null, dokumentPutanja || null, id);
  } else {
    throw new Error('Nevažeći status ponude.');
  }
  return poId(id);
}

function pretraga({ komitentId, datumOd, datumDo, broj }) {
  let upit = `
    SELECT ponuda.*, posao.naziv as posao_naziv, komitent.naziv as komitent_naziv
    FROM ponuda
    JOIN posao ON posao.id = ponuda.posao_id
    JOIN komitent ON komitent.id = posao.komitent_id
    WHERE 1=1
  `;
  const uslovi = [];

  if (komitentId) { upit += ' AND komitent.id = ?'; uslovi.push(komitentId); }
  if (datumOd) { upit += ' AND ponuda.datum >= ?'; uslovi.push(datumOd); }
  if (datumDo) { upit += ' AND ponuda.datum <= ?'; uslovi.push(datumDo); }
  if (broj) { upit += ' AND ponuda.broj LIKE ?'; uslovi.push(`%${broj}%`); }

  upit += ' ORDER BY ponuda.datum DESC';
  return db.prepare(upit).all(...uslovi);
}

// Šta će sve nestati ako se ponuda obriše
function izracunajUticajBrisanja(ponudaId) {
  const brojNaloga = db.prepare('SELECT COUNT(*) as n FROM radni_nalog WHERE ponuda_id = ?').get(ponudaId).n;
  const brojPlanova = db.prepare('SELECT COUNT(*) as n FROM plan_secenja WHERE ponuda_id = ?').get(ponudaId).n;
  const uplate = db
    .prepare('SELECT COUNT(*) as n, COALESCE(SUM(iznos), 0) as suma FROM uplata WHERE ponuda_id = ?')
    .get(ponudaId);
  return { brojNaloga, brojPlanova, brojUplata: uplate.n, ukupnoUplata: uplate.suma };
}

// Briše ponudu i sve pod njom (radne naloge, stavke, uplate). Planovi sečenja se
// NE brišu — samo se otkače (postaju opet dostupni na nivou posla).
function obrisi(ponudaId) {
  const transakcija = db.transaction(() => {
    db.prepare(`
      DELETE FROM stavka_naloga
      WHERE radni_nalog_id IN (SELECT id FROM radni_nalog WHERE ponuda_id = ?)
    `).run(ponudaId);
    db.prepare('DELETE FROM radni_nalog WHERE ponuda_id = ?').run(ponudaId);
    db.prepare('DELETE FROM ponuda WHERE id = ?').run(ponudaId); // kaskadno briše stavka_ponude, uplata; oslobađa planove
  });
  transakcija();
}

module.exports = {
  poId, poPosaoId, stavke,
  kreiraj, dodajStavku, obrisiStavku, preracunajUkupno,
  izaberiMetodIDodajStavku, promeniStatus, pretraga,
  izracunajUticajBrisanja, obrisi,
};
