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

module.exports = { poId, poKomitentu, predlogNaziva, kreiraj, azurirajStatus, oznaciUIzradi };
