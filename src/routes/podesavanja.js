const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Firma = require('../models/firma');
const db = require('../db/db');
const updateChecker = require('../services/updateChecker');
const { brojIzForme } = require('../utils');
const { SAMO_ADMIN } = require('../middleware/auth');

const upload = multer({
  storage: multer.diskStorage({
    destination: Firma.LOGO_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `logo-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const dozvoljeno = ['.png', '.jpg', '.jpeg', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!dozvoljeno.includes(ext)) {
      return cb(new Error('Dozvoljeni formati logoa su PNG, JPG i SVG.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.use(SAMO_ADMIN); // podešavanja menja samo administrator

router.get('/', (req, res) => {
  const firma = Firma.preuzmi();
  const podesavanja = db.prepare('SELECT * FROM podesavanja WHERE id = 1').get();
  const cenePoDebljini = db.prepare('SELECT * FROM cena_po_debljini ORDER BY debljina_mm').all();
  res.render('podesavanja/index', { firma, podesavanja, cenePoDebljini });
});

// Podaci firme (bez logoa)
router.post('/firma', (req, res) => {
  Firma.sacuvaj(req.body);
  res.redirect('/podesavanja#firma');
});

// Upload / zamena logoa
router.post('/firma/logo', (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (err) {
      return res.status(400).render('greska', { poruka: `Greška pri uploadu logoa: ${err.message}` });
    }
    if (!req.file) {
      return res.status(400).render('greska', { poruka: 'Fajl logoa nije poslat.' });
    }
    Firma.azurirajLogo(req.file.path);
    res.redirect('/podesavanja#logo');
  });
});

// Obračun — cena/kg i procenat rada
router.post('/obracun', (req, res) => {
  const { cenaPoKg, procenatRada } = req.body;
  const procenat = Math.min(25, Math.max(20, brojIzForme(procenatRada)));

  const postoji = db.prepare('SELECT 1 FROM podesavanja WHERE id = 1').get();
  if (postoji) {
    db.prepare('UPDATE podesavanja SET cena_po_kg = ?, procenat_rada = ? WHERE id = 1').run(
      brojIzForme(cenaPoKg),
      procenat
    );
  } else {
    db.prepare('INSERT INTO podesavanja (id, cena_po_kg, procenat_rada) VALUES (1, ?, ?)').run(
      brojIzForme(cenaPoKg),
      procenat
    );
  }
  res.redirect('/podesavanja#obracun');
});

// Cena po dužnom metru, po debljini — dodavanje/izmena reda
router.post('/cena-po-debljini', (req, res) => {
  const { debljinaMm, cenaPoM } = req.body;
  db.prepare(
    `INSERT INTO cena_po_debljini (debljina_mm, cena_po_m) VALUES (?, ?)
     ON CONFLICT(debljina_mm) DO UPDATE SET cena_po_m = excluded.cena_po_m`
  ).run(brojIzForme(debljinaMm), brojIzForme(cenaPoM));
  res.redirect('/podesavanja#cene');
});

router.post('/cena-po-debljini/:id/obrisi', (req, res) => {
  db.prepare('DELETE FROM cena_po_debljini WHERE id = ?').run(req.params.id);
  res.redirect('/podesavanja#cene');
});

// Ažuriranje aplikacije — status i ručna provera
router.get('/azuriranja', (req, res) => {
  res.render('podesavanja/azuriranja', {
    rezultat: updateChecker.poslednjiRezultat(),
    repo: updateChecker.REPO,
    grana: updateChecker.BRANCH,
  });
});

router.post('/azuriranja/proveri', async (req, res) => {
  await updateChecker.proveriAzuriranje();
  res.redirect('/podesavanja/azuriranja');
});

// Pravo pokretanje ažuriranja: git pull + npm install, pa restart procesa
router.post('/azuriranja/pokreni', (req, res) => {
  const rezultat = updateChecker.pokreniAzuriranje();

  if (!rezultat.uspeh) {
    return res.render('podesavanja/azuriranja-rezultat', {
      uspeh: false,
      log: rezultat.log,
    });
  }

  res.render('podesavanja/azuriranja-rezultat', {
    uspeh: true,
    log: rezultat.log,
  });

  // Odgovor je poslat — sad gasimo proces. Ako aplikacija radi kao systemd
  // servis sa Restart=always, systemd će je odmah podići nazad sa novim kodom.
  setTimeout(() => process.exit(0), 800);
});

module.exports = router;
