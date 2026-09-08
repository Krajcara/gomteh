const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { zahtevajKomitentLogin } = require('../middleware/auth');

router.use(zahtevajKomitentLogin);

// Lista poslova ovog komitenta
router.get('/', (req, res) => {
  const poslovi = db
    .prepare('SELECT * FROM posao WHERE komitent_id = ? ORDER BY kreiran_at DESC')
    .all(req.session.komitent.id);
  res.render('portal/poslovi', { poslovi, komitent: req.session.komitent });
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

  res.render('portal/posao-detalji', { posao, ponude, radniNalozi, stavkeNaloga });
});

module.exports = router;
