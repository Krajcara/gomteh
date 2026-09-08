const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Ponuda = require('../models/ponuda');
const Posao = require('../models/posao');
const Komitent = require('../models/komitent');
const Uplata = require('../models/uplata');
const { parsirajPlanSecenja } = require('../services/pdfParser');
const { izracunajMetode } = require('../services/obracun');
const { generisiPrevedeniPlan, generisiPonudaPdf } = require('../services/pdfGenerator');
const { zahtevajLogin, MOZE_PONUDE } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '../../data/uploads/planovi');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ODBIJANJE_DIR = path.join(__dirname, '../../data/uploads/odbijanja');
fs.mkdirSync(ODBIJANJE_DIR, { recursive: true });

const uploadOdbijanje = multer({
  storage: multer.diskStorage({
    destination: ODBIJANJE_DIR,
    filename: (req, file, cb) => cb(null, `odbijanje-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `plan-${Date.now()}.pdf`),
  }),
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return cb(new Error('Plan sečenja mora biti PDF fajl.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(zahtevajLogin);

// Pretraga ponuda — po klijentu, datumu, broju
router.get('/ponude/pretraga', (req, res) => {
  const { komitentId, datumOd, datumDo, broj } = req.query;
  const rezultati = (komitentId || datumOd || datumDo || broj)
    ? Ponuda.pretraga({ komitentId, datumOd, datumDo, broj })
    : [];
  res.render('ponude/pretraga', { rezultati, filter: req.query, komitenti: Komitent.svi() });
});

// Nova ponuda pod poslom
router.get('/poslovi/:posaoId/ponude/nova', MOZE_PONUDE, (req, res) => {
  const posao = Posao.poId(req.params.posaoId);
  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });
  res.render('ponude/forma', { posao });
});

router.post('/poslovi/:posaoId/ponude', MOZE_PONUDE, (req, res) => {
  const ponuda = Ponuda.kreiraj({
    posaoId: req.params.posaoId,
    sastavioKorisnikId: req.session.korisnik.id,
    primioMesto: req.body.primioMesto,
    naslovPosla: req.body.naslovPosla,
    propratniTekst: req.body.propratniTekst,
    tehnickiOpis: req.body.tehnickiOpis,
    rokIsporuke: req.body.rokIsporuke,
    placanje: req.body.placanje,
    garancija: req.body.garancija,
    napomena: req.body.napomena,
    rokVazenja: req.body.rokVazenja,
  });
  res.redirect(`/ponude/${ponuda.id}`);
});

// Detalji ponude
router.get('/ponude/:id', (req, res) => {
  const ponuda = Ponuda.poId(req.params.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });

  const posao = Posao.poId(ponuda.posao_id);
  const komitent = Komitent.poId(posao.komitent_id);
  const stavke = Ponuda.stavke(ponuda.id);
  const planovi = Ponuda.planoviSecenja(ponuda.id);
  const uplate = Uplata.poPonudi(ponuda.id);
  const placeno = Uplata.ukupnoPlaceno(ponuda.id);
  const preostalo = (ponuda.ukupno || 0) - placeno;

  res.render('ponude/detalji', { ponuda, posao, komitent, stavke, planovi, uplate, placeno, preostalo });
});

// Ručno dodavanje stavke
router.post('/ponude/:id/stavke', MOZE_PONUDE, (req, res) => {
  Ponuda.dodajStavku(req.params.id, { opis: req.body.opis, iznos: parseFloat(req.body.iznos) });
  res.redirect(`/ponude/${req.params.id}`);
});

router.post('/ponude/:id/stavke/:stavkaId/obrisi', MOZE_PONUDE, (req, res) => {
  Ponuda.obrisiStavku(req.params.id, req.params.stavkaId);
  res.redirect(`/ponude/${req.params.id}`);
});

// Upload plana sečenja + automatska ekstrakcija i obračun oba metoda
router.post('/ponude/:id/plan-secenja', MOZE_PONUDE, upload.single('plan'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Fajl plana sečenja nije poslat.');

    const izvuceno = await parsirajPlanSecenja(req.file.path);
    const { metod1, metod2 } = izracunajMetode({
      tezinaDelovaKg: izvuceno.tezinaDelovaKg,
      duzinaRezaMm: izvuceno.duzinaRezaMm,
      debljinaMm: izvuceno.debljinaMm,
    });

    const plan = Ponuda.sacuvajPlanSecenja(req.params.id, {
      originalnaPutanja: req.file.path,
      prevedenaPutanja: null,
      nazivFajla: izvuceno.nazivFajla,
      materijal: izvuceno.materijal,
      debljinaMm: izvuceno.debljinaMm,
      tezinaDelovaKg: izvuceno.tezinaDelovaKg,
      duzinaRezaMm: izvuceno.duzinaRezaMm,
      metod1Iznos: metod1,
      metod2Iznos: metod2,
      delovi: izvuceno.delovi.map((d) => ({ partName: d.partName, partSize: d.partSize, kolicina: d.kolicina })),
    });

    await generisiPrevedeniPlan(plan.id);

    res.redirect(`/ponude/${req.params.id}`);
  } catch (greska) {
    res.status(400).render('greska', { poruka: `Greška pri obradi plana sečenja: ${greska.message}` });
  }
});

// Izbor metoda obračuna za dati plan sečenja -> dodaje stavku
router.post('/ponude/:id/planovi/:planId/izaberi-metod', MOZE_PONUDE, (req, res) => {
  Ponuda.izaberiMetodIDodajStavku(req.params.planId, parseInt(req.body.metod, 10));
  res.redirect(`/ponude/${req.params.id}`);
});

router.get('/ponude/:id/planovi/:planId/preuzmi', (req, res) => {
  const plan = require('../db/db').prepare('SELECT preveden_fajl_putanja FROM plan_secenja WHERE id = ?').get(req.params.planId);
  if (!plan || !plan.preveden_fajl_putanja) return res.status(404).render('greska', { poruka: 'Prevedeni plan nije pronađen.' });
  res.download(plan.preveden_fajl_putanja, 'plan-secenja-prevod.pdf');
});

// Status ponude — prihvatanje / odbijanje
router.post('/ponude/:id/prihvati', MOZE_PONUDE, (req, res) => {
  Ponuda.promeniStatus(req.params.id, 'prihvacena');
  res.redirect(`/ponude/${req.params.id}`);
});

router.post('/ponude/:id/odbij', MOZE_PONUDE, uploadOdbijanje.single('dokument'), (req, res) => {
  Ponuda.promeniStatus(req.params.id, 'odbijena', {
    komentar: req.body.komentar,
    dokumentPutanja: req.file ? req.file.path : null,
  });
  res.redirect(`/ponude/${req.params.id}`);
});

// Generisanje/preuzimanje PDF-a ponude
router.get('/ponude/:id/pdf', async (req, res) => {
  try {
    const putanja = await generisiPonudaPdf(req.params.id);
    res.download(putanja, path.basename(putanja));
  } catch (greska) {
    res.status(500).render('greska', { poruka: `Greška pri generisanju PDF-a: ${greska.message}` });
  }
});

router.get('/ponude/:id/dokument-odbijanja', (req, res) => {
  const ponuda = Ponuda.poId(req.params.id);
  if (!ponuda || !ponuda.dokument_odbijanja_putanja) {
    return res.status(404).render('greska', { poruka: 'Dokument nije pronađen.' });
  }
  res.download(ponuda.dokument_odbijanja_putanja);
});

// Uplate — samo za prihvaćene ponude
router.post('/ponude/:id/uplate', MOZE_PONUDE, (req, res) => {
  Uplata.dodaj(req.params.id, {
    iznos: parseFloat(req.body.iznos),
    napomena: req.body.napomena,
    korisnikId: req.session.korisnik.id,
  });
  res.redirect(`/ponude/${req.params.id}`);
});

router.post('/ponude/:id/uplate/:uplataId/obrisi', MOZE_PONUDE, (req, res) => {
  Uplata.obrisi(req.params.uplataId);
  res.redirect(`/ponude/${req.params.id}`);
});

module.exports = router;
