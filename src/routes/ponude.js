const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Ponuda = require('../models/ponuda');
const Posao = require('../models/posao');
const Komitent = require('../models/komitent');
const Uplata = require('../models/uplata');
const PlanSecenja = require('../models/planSecenja');
const { generisiPonudaPdf } = require('../services/pdfGenerator');
const { zahtevajLogin, MOZE_PONUDE, SAMO_ADMIN } = require('../middleware/auth');

const ODBIJANJE_DIR = path.join(__dirname, '../../data/uploads/odbijanja');
fs.mkdirSync(ODBIJANJE_DIR, { recursive: true });

const uploadOdbijanje = multer({
  storage: multer.diskStorage({
    destination: ODBIJANJE_DIR,
    filename: (req, file, cb) => cb(null, `odbijanje-${Date.now()}-${file.originalname}`),
  }),
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

// Nova ponuda pod poslom — nudi izbor već uploadovanih (nepovezanih) planova sečenja tog posla
router.get('/poslovi/:posaoId/ponude/nova', MOZE_PONUDE, (req, res) => {
  const posao = Posao.poId(req.params.posaoId);
  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });
  const komitent = Komitent.poId(posao.komitent_id);
  const dostupniPlanovi = PlanSecenja.dostupniZaPosao(posao.id);
  res.render('ponude/forma', { posao, komitent, dostupniPlanovi });
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

  const izabraniPlanovi = [].concat(req.body.planoviIds || []);
  if (izabraniPlanovi.length) {
    PlanSecenja.povezisaPonudom(izabraniPlanovi, ponuda.id);
  }

  res.redirect(`/ponude/${ponuda.id}`);
});

// Detalji ponude
router.get('/ponude/:id', (req, res) => {
  const ponuda = Ponuda.poId(req.params.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });

  const posao = Posao.poId(ponuda.posao_id);
  const komitent = Komitent.poId(posao.komitent_id);
  const stavke = Ponuda.stavke(ponuda.id);
  const planovi = PlanSecenja.poPonudi(ponuda.id);
  const dostupniPlanovi = PlanSecenja.dostupniZaPosao(posao.id);
  const uplate = Uplata.poPonudi(ponuda.id);
  const placeno = Uplata.ukupnoPlaceno(ponuda.id);
  const preostalo = (ponuda.ukupno || 0) - placeno;
  const uticajBrisanja = Ponuda.izracunajUticajBrisanja(ponuda.id);

  res.render('ponude/detalji', {
    ponuda, posao, komitent, stavke, planovi, dostupniPlanovi, uplate, placeno, preostalo, uticajBrisanja,
  });
});

// Izmena tekstualnih polja ponude (propratni tekst, tehnički opis, rokovi, plaćanje...)
router.post('/ponude/:id/tekst', MOZE_PONUDE, (req, res) => {
  Ponuda.azurirajTekstualnaPolja(req.params.id, {
    propratniTekst: req.body.propratniTekst,
    tehnickiOpis: req.body.tehnickiOpis,
    rokIsporuke: req.body.rokIsporuke,
    placanje: req.body.placanje,
    garancija: req.body.garancija,
    napomena: req.body.napomena,
    rokVazenja: req.body.rokVazenja,
  });
  res.redirect(`/ponude/${req.params.id}`);
});

router.post('/ponude/:id/obrisi', SAMO_ADMIN, (req, res) => {
  const ponuda = Ponuda.poId(req.params.id);
  if (!ponuda) return res.status(404).render('greska', { poruka: 'Ponuda nije pronađena.' });
  Ponuda.obrisi(req.params.id);
  res.redirect(`/poslovi/${ponuda.posao_id}`);
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

// Povezivanje već uploadovanog (na nivou posla) plana sa OVOM ponudom, naknadno
router.post('/ponude/:id/planovi/poveznica', MOZE_PONUDE, (req, res) => {
  const izabrani = [].concat(req.body.planId || []);
  if (izabrani.length) PlanSecenja.povezisaPonudom(izabrani, req.params.id);
  res.redirect(`/ponude/${req.params.id}`);
});

// Otkačinjanje plana sa ponude (vraća ga u "dostupno" na nivou posla)
router.post('/ponude/:id/planovi/:planId/otkaci', MOZE_PONUDE, (req, res) => {
  PlanSecenja.otkaciOdPonude(req.params.planId);
  res.redirect(`/ponude/${req.params.id}`);
});

// Izbor metoda obračuna za dati plan sečenja -> dodaje stavku
router.post('/ponude/:id/planovi/:planId/izaberi-metod', MOZE_PONUDE, (req, res) => {
  Ponuda.izaberiMetodIDodajStavku(req.params.planId, parseInt(req.body.metod, 10));
  res.redirect(`/ponude/${req.params.id}`);
});

// Ponovni obračun (npr. ako je cena po debljini dodata NAKON uploada plana)
router.post('/ponude/:id/planovi/:planId/ponovo-izracunaj', MOZE_PONUDE, (req, res) => {
  PlanSecenja.ponovoIzracunajMetode(req.params.planId);
  res.redirect(`/ponude/${req.params.id}`);
});

router.get('/ponude/:id/planovi/:planId/preuzmi', (req, res) => {
  const plan = PlanSecenja.poId(req.params.planId);
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
