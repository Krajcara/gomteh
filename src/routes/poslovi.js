const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Posao = require('../models/posao');
const Ponuda = require('../models/ponuda');
const Komitent = require('../models/komitent');
const PlanSecenja = require('../models/planSecenja');
const db = require('../db/db');
const { parsirajPlanSecenja } = require('../services/pdfParser');
const { izracunajMetode } = require('../services/obracun');
const { generisiPrevedeniPlan } = require('../services/pdfGenerator');
const { zahtevajLogin, MOZE_PONUDE, MOZE_MENJATI, SAMO_ADMIN } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '../../data/uploads/planovi');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

// Globalna lista svih poslova (svi komitenti)
router.get('/poslovi', (req, res) => {
  const poslovi = db.prepare(`
    SELECT posao.*, komitent.naziv as komitent_naziv
    FROM posao
    JOIN komitent ON komitent.id = posao.komitent_id
    ORDER BY posao.kreiran_at DESC
  `).all();
  res.render('poslovi/lista', { poslovi });
});

// Biranje komitenta pre otvaranja novog posla
router.get('/poslovi/novi', MOZE_PONUDE, (req, res) => {
  const komitenti = Komitent.svi();
  res.render('poslovi/izaberi-komitenta', { komitenti });
});

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

// Detalji posla — planovi sečenja, ponude i radni nalozi
router.get('/poslovi/:id', (req, res) => {
  const posao = Posao.poId(req.params.id);
  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });

  const komitent = Komitent.poId(posao.komitent_id);
  const ponude = Ponuda.poPosaoId(posao.id);
  const radniNalozi = db.prepare('SELECT * FROM radni_nalog WHERE posao_id = ? ORDER BY datum DESC').all(posao.id);
  const planovi = PlanSecenja.poPosaoId(posao.id);
  const uticajBrisanja = Posao.izracunajUticajBrisanja(posao.id);

  // Broj ponude po ponuda_id, za prikaz "povezan sa ponudom X" pored svakog plana
  const ponudeMape = {};
  ponude.forEach((p) => { ponudeMape[p.id] = p.broj; });

  res.render('poslovi/detalji', { posao, komitent, ponude, radniNalozi, planovi, ponudeMape, uticajBrisanja });
});

// Uticaj brisanja (za prikaz u potvrdi) + samo brisanje
router.post('/poslovi/:id/obrisi', SAMO_ADMIN, (req, res) => {
  Posao.obrisi(req.params.id);
  res.redirect('/poslovi');
});

// Ručna promena statusa (završen / odbijen)
router.post('/poslovi/:id/status', MOZE_MENJATI, (req, res) => {
  Posao.azurirajStatus(req.params.id, req.body.status);
  res.redirect(`/poslovi/${req.params.id}`);
});

// Upload plana sečenja na nivou posla (pre nego što ponuda uopšte postoji)
router.post('/poslovi/:id/planovi', MOZE_PONUDE, upload.single('plan'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Fajl plana sečenja nije poslat.');

    const izvuceno = await parsirajPlanSecenja(req.file.path);
    const { metod1, metod2 } = izracunajMetode({
      tezinaDelovaKg: izvuceno.tezinaDelovaKg,
      duzinaRezaMm: izvuceno.duzinaRezaMm,
      debljinaMm: izvuceno.debljinaMm,
    });

    const plan = PlanSecenja.sacuvaj(req.params.id, {
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

    res.redirect(`/poslovi/${req.params.id}`);
  } catch (greska) {
    res.status(400).render('greska', { poruka: `Greška pri obradi plana sečenja: ${greska.message}` });
  }
});

router.get('/poslovi/:posaoId/planovi/:planId/preuzmi', (req, res) => {
  const plan = PlanSecenja.poId(req.params.planId);
  if (!plan || !plan.preveden_fajl_putanja) {
    return res.status(404).render('greska', { poruka: 'Prevedeni plan nije pronađen.' });
  }
  res.download(plan.preveden_fajl_putanja, 'plan-secenja-prevod.pdf');
});

router.post('/poslovi/:posaoId/planovi/:planId/obrisi', SAMO_ADMIN, (req, res) => {
  try {
    PlanSecenja.obrisi(req.params.planId);
    res.redirect(`/poslovi/${req.params.posaoId}`);
  } catch (greska) {
    res.status(400).render('greska', { poruka: greska.message });
  }
});

module.exports = router;
