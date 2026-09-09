const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const Ponuda = require('../models/ponuda');
const { generisiPonudaPdf } = require('../services/pdfGenerator');
const { zahtevajKomitentLogin } = require('../middleware/auth');

const ODBIJANJE_DIR = path.join(__dirname, '../../data/uploads/odbijanja');
fs.mkdirSync(ODBIJANJE_DIR, { recursive: true });

const uploadOdbijanje = multer({
  storage: multer.diskStorage({
    destination: ODBIJANJE_DIR,
    filename: (req, file, cb) => cb(null, `odbijanje-portal-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(zahtevajKomitentLogin);

// Nalazi ponudu i proverava da PRIPADA ovom ulogovanom komitentu — vraća null ako ne pripada
function ponudaKomitentaIliNull(ponudaId, komitentId) {
  const red = db.prepare(`
    SELECT ponuda.* FROM ponuda
    JOIN posao ON posao.id = ponuda.posao_id
    WHERE ponuda.id = ? AND posao.komitent_id = ?
  `).get(ponudaId, komitentId);
  return red || null;
}

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

// Preuzimanje PDF-a ponude — samo ako pripada ovom komitentu
router.get('/ponude/:id/pdf', async (req, res) => {
  const ponuda = ponudaKomitentaIliNull(req.params.id, req.session.komitent.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });

  try {
    const putanja = await generisiPonudaPdf(req.params.id);
    res.download(putanja, path.basename(putanja));
  } catch (greska) {
    res.status(500).render('greska', { poruka: `Greška pri generisanju PDF-a: ${greska.message}` });
  }
});

// Klijent sam prihvata ponudu
router.post('/ponude/:id/prihvati', (req, res) => {
  const ponuda = ponudaKomitentaIliNull(req.params.id, req.session.komitent.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });
  if (ponuda.status !== 'poslata') {
    return res.status(400).render('greska', { poruka: 'Ova ponuda više nije u statusu "poslata" — ne može se prihvatiti.' });
  }

  Ponuda.promeniStatus(req.params.id, 'prihvacena');
  res.redirect(`/portal/poslovi/${ponuda.posao_id}`);
});

// Klijent sam odbija ponudu, uz komentar i opcioni prateći dokument
router.post('/ponude/:id/odbij', uploadOdbijanje.single('dokument'), (req, res) => {
  const ponuda = ponudaKomitentaIliNull(req.params.id, req.session.komitent.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });
  if (ponuda.status !== 'poslata') {
    return res.status(400).render('greska', { poruka: 'Ova ponuda više nije u statusu "poslata" — ne može se odbiti.' });
  }

  Ponuda.promeniStatus(req.params.id, 'odbijena', {
    komentar: req.body.komentar,
    dokumentPutanja: req.file ? req.file.path : null,
  });
  res.redirect(`/portal/poslovi/${ponuda.posao_id}`);
});

module.exports = router;
