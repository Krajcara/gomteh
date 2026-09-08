const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { zahtevajKomitentLogin } = require('../middleware/auth');

router.use(zahtevajKomitentLogin);

// Lista poslova ovog komitenta
router.get('/', (req, res) => {
  const komitentId = req.session.komitent.id;

  const poslovi = db
    .prepare('SELECT * FROM posao WHERE komitent_id = ? ORDER BY kreiran_at DESC')
    .all(komitentId);

  const ponude = db.prepare(`
    SELECT ponuda.id, ponuda.ukupno
    FROM ponuda
    JOIN posao ON posao.id = ponuda.posao_id
    WHERE posao.komitent_id = ? AND ponuda.status = 'prihvacena'
  `).all(komitentId);

  const uplateSume = db.prepare(`
    SELECT ponuda_id, COALESCE(SUM(iznos), 0) as suma FROM uplata GROUP BY ponuda_id
  `).all();
  const placenoMap = {};
  uplateSume.forEach((u) => { placenoMap[u.ponuda_id] = u.suma; });

  let ukupno = 0;
  let placeno = 0;
  ponude.forEach((p) => {
    ukupno += p.ukupno || 0;
    placeno += placenoMap[p.id] || 0;
  });

  res.render('portal/poslovi', {
    poslovi,
    komitent: req.session.komitent,
    statistika: { ukupno, placeno, preostalo: ukupno - placeno },
  });
});

// Detalji posla — SAMO ako pripada ovom komitentu
router.get('/poslovi/:id', (req, res) => {
  const posao = db
    .prepare('SELECT * FROM posao WHERE id = ? AND komitent_id = ?')
    .get(req.params.id, req.session.komitent.id);

  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });

  const ponude = db
    .prepare('SELECT * FROM ponuda WHERE posao_id = ? ORDER BY kreiran_at DESC')
    .all(posao.id);

  const radniNalozi = db
    .prepare('SELECT * FROM radni_nalog WHERE posao_id = ? ORDER BY datum DESC')
    .all(posao.id);

  const stavkeNaloga = {};
  radniNalozi.forEach((n) => {
    stavkeNaloga[n.id] = db.prepare('SELECT * FROM stavka_naloga WHERE radni_nalog_id = ?').all(n.id);
  });

  // Uplate po svakoj prihvaćenoj ponudi ovog posla
  const uplatePoPonudi = {};
  ponude.forEach((p) => {
    if (p.status === 'prihvacena') {
      const placeno = db.prepare('SELECT COALESCE(SUM(iznos),0) as suma FROM uplata WHERE ponuda_id = ?').get(p.id).suma;
      uplatePoPonudi[p.id] = { placeno, preostalo: (p.ukupno || 0) - placeno };
    }
  });

  res.render('portal/posao-detalji', { posao, ponude, radniNalozi, stavkeNaloga, uplatePoPonudi });
});

module.exports = router;
