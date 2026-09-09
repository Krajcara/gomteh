const db = require('../db/db');

function poId(id) {
  return db.prepare('SELECT * FROM posao WHERE id = ?').get(id);
}

function poKomitentu(komitentId) {
  return db
    .prepare('SELECT * FROM posao WHERE komitent_id = ? ORDER BY kreiran_at DESC')
    .all(komitentId);
}

function predlogNaziva(komitentId) {
  const komitent = db.prepare('SELECT naziv FROM komitent WHERE id = ?').get(komitentId);
  const brojPoslova = db.prepare('SELECT COUNT(*) as n FROM posao').get().n;
  const redniBroj = String(brojPoslova + 1).padStart(4, '0');
  const datum = new Date().toLocaleDateString('sr-RS');
  return `#${redniBroj} — ${komitent ? komitent.naziv : ''} — ${datum}`;
}

function kreiraj(komitentId, naziv) {
  const rezultat = db
    .prepare('INSERT INTO posao (komitent_id, naziv) VALUES (?, ?)')
    .run(komitentId, naziv);
  return poId(rezultat.lastInsertRowid);
}

function azurirajStatus(id, noviStatus) {
  const dozvoljeni = ['poslata_ponuda', 'u_izradi', 'zavrsen', 'odbijen'];
  if (!dozvoljeni.includes(noviStatus)) throw new Error('Nevažeći status posla.');
  db.prepare('UPDATE posao SET status = ? WHERE id = ?').run(noviStatus, id);
  return poId(id);
}

// Poziva se automatski kad se ponuda prihvati (routes/ponude.js)
function oznaciUIzradi(id) {
  db.prepare("UPDATE posao SET status = 'u_izradi' WHERE id = ?").run(id);
}

// Šta će sve nestati ako se posao obriše — za prikaz u upozorenju pre potvrde
function izracunajUticajBrisanja(posaoId) {
  const brojPonuda = db.prepare('SELECT COUNT(*) as n FROM ponuda WHERE posao_id = ?').get(posaoId).n;
  const brojNaloga = db.prepare('SELECT COUNT(*) as n FROM radni_nalog WHERE posao_id = ?').get(posaoId).n;
  const brojPlanova = db.prepare('SELECT COUNT(*) as n FROM plan_secenja WHERE posao_id = ?').get(posaoId).n;
  const uplate = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(u.iznos), 0) as suma
    FROM uplata u JOIN ponuda p ON p.id = u.ponuda_id
    WHERE p.posao_id = ?
  `).get(posaoId);
  return { brojPonuda, brojNaloga, brojPlanova, brojUplata: uplate.n, ukupnoUplata: uplate.suma };
}

// Briše posao i SVE što je pod njim (ponude, radne naloge, planove sečenja, uplate).
// Nepovratno — koristiti tek nakon potvrde na osnovu izracunajUticajBrisanja().
function obrisi(posaoId) {
  const fs = require('fs');
  const putanjeFajlova = db
    .prepare('SELECT originalni_fajl_putanja, preveden_fajl_putanja FROM plan_secenja WHERE posao_id = ?')
    .all(posaoId);

  const transakcija = db.transaction(() => {
    db.prepare(`
      DELETE FROM stavka_naloga
      WHERE radni_nalog_id IN (SELECT id FROM radni_nalog WHERE posao_id = ?)
    `).run(posaoId);
    db.prepare('DELETE FROM radni_nalog WHERE posao_id = ?').run(posaoId);
    db.prepare(`
      DELETE FROM uplata WHERE ponuda_id IN (SELECT id FROM ponuda WHERE posao_id = ?)
    `).run(posaoId);
    db.prepare(`
      DELETE FROM stavka_ponude WHERE ponuda_id IN (SELECT id FROM ponuda WHERE posao_id = ?)
    `).run(posaoId);
    db.prepare('DELETE FROM ponuda WHERE posao_id = ?').run(posaoId);
    db.prepare('DELETE FROM posao WHERE id = ?').run(posaoId); // kaskadno briše plan_secenja + deo_iz_plana
  });
  transakcija();

  putanjeFajlova.forEach(({ originalni_fajl_putanja, preveden_fajl_putanja }) => {
    [originalni_fajl_putanja, preveden_fajl_putanja].forEach((p) => {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    });
  });
}

module.exports = {
  poId, poKomitentu, predlogNaziva, kreiraj, azurirajStatus, oznaciUIzradi,
  izracunajUticajBrisanja, obrisi,
};
