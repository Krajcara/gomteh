const db = require('../db/db');

// Metod 1: (težina delova × cena/kg) + rad (20-25% od cene materijala)
// Metod 2: (dužina reza u m) × cena po dužnom metru za tu debljinu
function izracunajMetode({ tezinaDelovaKg, duzinaRezaMm, debljinaMm }) {
  const podesavanja = db.prepare('SELECT * FROM podesavanja WHERE id = 1').get();
  if (!podesavanja) {
    throw new Error('Podešavanja obračuna nisu postavljena (cena/kg, % rada). Unesi ih pre nastavka.');
  }

  const cenaMaterijala = tezinaDelovaKg * podesavanja.cena_po_kg;
  const cenaRada = cenaMaterijala * (podesavanja.procenat_rada / 100);
  const metod1 = Math.round((cenaMaterijala + cenaRada) * 100) / 100;

  let metod2 = null;
  const cenaPoDebljini = db
    .prepare('SELECT * FROM cena_po_debljini WHERE debljina_mm = ?')
    .get(debljinaMm);

  if (cenaPoDebljini && duzinaRezaMm) {
    metod2 = Math.round(((duzinaRezaMm / 1000) * cenaPoDebljini.cena_po_m) * 100) / 100;
  }

  return { metod1, metod2, cenaMaterijala, cenaRada };
}

// Za automatski generisanu ponudu za višak — samo metod 1 (nema PDF sa dužinom reza)
function izracunajMetod1ZaVisak(tezinaViskaKg) {
  const podesavanja = db.prepare('SELECT * FROM podesavanja WHERE id = 1').get();
  if (!podesavanja) {
    throw new Error('Podešavanja obračuna nisu postavljena.');
  }
  const cenaMaterijala = tezinaViskaKg * podesavanja.cena_po_kg;
  const cenaRada = cenaMaterijala * (podesavanja.procenat_rada / 100);
  return Math.round((cenaMaterijala + cenaRada) * 100) / 100;
}

module.exports = { izracunajMetode, izracunajMetod1ZaVisak };
