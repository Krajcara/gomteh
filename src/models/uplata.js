const db = require('../db/db');

function poPonudi(ponudaId) {
  return db.prepare('SELECT * FROM uplata WHERE ponuda_id = ? ORDER BY datum DESC').all(ponudaId);
}

function ukupnoPlaceno(ponudaId) {
  return db.prepare('SELECT COALESCE(SUM(iznos), 0) as suma FROM uplata WHERE ponuda_id = ?').get(ponudaId).suma;
}

function dodaj(ponudaId, { iznos, napomena, korisnikId }) {
  db.prepare(
    'INSERT INTO uplata (ponuda_id, iznos, napomena, kreirao_korisnik_id) VALUES (?, ?, ?, ?)'
  ).run(ponudaId, iznos, napomena || null, korisnikId || null);
}

function obrisi(id) {
  db.prepare('DELETE FROM uplata WHERE id = ?').run(id);
}

module.exports = { poPonudi, ukupnoPlaceno, dodaj, obrisi };
