const express = require('express');
const router = express.Router();
const Posao = require('../models/posao');
const Ponuda = require('../models/ponuda');
const Komitent = require('../models/komitent');
const db = require('../db/db');
const { zahtevajLogin, MOZE_PONUDE, MOZE_MENJATI } = require('../middleware/auth');

router.use(zahtevajLogin);

// Forma za novi posao pod komitentom
router.get('/komitenti/:komitentId/poslovi/novi', MOZE_PONUDE, (req, res) => {
  const komitent = Komitent.poId(req.params.komitentId);
  if (!komitent) return res.status(404).render('greska', { poruka: 'Komitent nije pronađen.' });
  res.render('poslovi/forma', { komitent, predlogNaziva: Posao.predlogNaziva(komitent.id) });
});

router.post('/komitenti/:komitentId/poslovi', MOZE_PONUDE, (req, res) => {
  const posao = Posao.kreiraj(req.params.komitentId, req.body.naziv);
  res.redirect(`/poslovi/${posao.id}`);
});

// Detalji posla — ponude i radni nalozi
router.get('/poslovi/:id', (req, res) => {
  const posao = Posao.poId(req.params.id);
  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });

  const komitent = Komitent.poId(posao.komitent_id);
  const ponude = Ponuda.poPosaoId(posao.id);
  const radniNalozi = db.prepare('SELECT * FROM radni_nalog WHERE posao_id = ? ORDER BY datum DESC').all(posao.id);

  res.render('poslovi/detalji', { posao, komitent, ponude, radniNalozi });
});

// Ručna promena statusa (završen / odbijen)
router.post('/poslovi/:id/status', MOZE_MENJATI, (req, res) => {
  Posao.azurirajStatus(req.params.id, req.body.status);
  res.redirect(`/poslovi/${req.params.id}`);
});

module.exports = router;
