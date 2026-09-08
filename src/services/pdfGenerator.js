const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const OUTPUT_DIR = path.join(__dirname, '../../data/generated');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// DejaVu Sans podržava srpsku latinicu (č, ć, š, ž, đ) — PDFKit-ov podrazumevani
// Helvetica font (WinAnsiEncoding) NE podržava č, ć i đ, pa bi ta slova bila iskrivljena.
const FONT_REGULAR = path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');

function registrujFontove(doc) {
  doc.registerFont('Regular', FONT_REGULAR);
  doc.registerFont('Bold', FONT_BOLD);
  doc.font('Regular');
}

function ubaciLogoAkoPostoji(doc, x, y, sirina) {
  const firma = db.prepare('SELECT logo_putanja FROM firma WHERE id = 1').get();
  if (firma && firma.logo_putanja && fs.existsSync(firma.logo_putanja)) {
    try {
      doc.image(firma.logo_putanja, x, y, { width: sirina });
      return true;
    } catch (e) {
      // ako logo fajl nije čitljiv kao slika (npr. SVG — pdfkit ne podržava SVG direktno)
      return false;
    }
  }
  return false;
}

// Prevedeni plan sečenja — pojednostavljen prikaz izvučenih podataka na srpskom,
// sa logom firme i nazivom komitenta umesto originalnog "Customer Name" polja.
function generisiPrevedeniPlan(planSecenjaId) {
  const plan = db.prepare('SELECT * FROM plan_secenja WHERE id = ?').get(planSecenjaId);
  if (!plan) throw new Error('Plan sečenja nije pronađen.');

  const ponuda = db.prepare('SELECT * FROM ponuda WHERE id = ?').get(plan.ponuda_id);
  const posao = db.prepare('SELECT * FROM posao WHERE id = ?').get(ponuda.posao_id);
  const komitent = db.prepare('SELECT * FROM komitent WHERE id = ?').get(posao.komitent_id);
  const delovi = db.prepare('SELECT * FROM deo_iz_plana WHERE plan_secenja_id = ?').all(planSecenjaId);

  const izlazPutanja = path.join(OUTPUT_DIR, `plan-secenja-${planSecenjaId}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  const stream = fs.createWriteStream(izlazPutanja);
  doc.pipe(stream);
  registrujFontove(doc);

  const imaLogo = ubaciLogoAkoPostoji(doc, 40, 30, 100);
  doc.font('Bold').fontSize(16).text('Plan sečenja — prevod', imaLogo ? 160 : 40, 40);
  doc.font('Regular');

  doc.moveDown(imaLogo ? 2 : 1);
  doc.fontSize(11);
  doc.text(`Naziv kupca: ${komitent.naziv}`); // Customer Name -> naziv komitenta iz posla
  doc.text(`Naziv fajla: ${plan.naziv_fajla || '—'}`);
  doc.text(`Materijal: ${plan.materijal || '—'}`);
  doc.text(`Debljina (mm): ${plan.debljina_mm ?? '—'}`);
  doc.moveDown();
  doc.text(`Ukupna težina delova (kg): ${plan.tezina_delova_kg ?? '—'}`);
  doc.text(`Ukupna dužina reza (mm): ${plan.duzina_reza_mm ?? '—'}`);
  doc.moveDown();

  doc.fontSize(13).text('Lista delova', { underline: true });
  doc.fontSize(11);  delovi.forEach((d) => {
    doc.text(`${d.part_name}   ${d.part_size || ''}   količina: ${d.kolicina_plan}`);
  });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      db.prepare('UPDATE plan_secenja SET preveden_fajl_putanja = ? WHERE id = ?').run(izlazPutanja, planSecenjaId);
      resolve(izlazPutanja);
    });
    stream.on('error', reject);
  });
}

// Ponuda — po uzoru na dostavljeni primer (zaglavlje firme, primalac, stavke, tekstualna polja)
function generisiPonudaPdf(ponudaId) {
  const ponuda = db.prepare('SELECT * FROM ponuda WHERE id = ?').get(ponudaId);
  if (!ponuda) throw new Error('Ponuda nije pronađena.');

  const posao = db.prepare('SELECT * FROM posao WHERE id = ?').get(ponuda.posao_id);
  const komitent = db.prepare('SELECT * FROM komitent WHERE id = ?').get(posao.komitent_id);
  const firma = db.prepare('SELECT * FROM firma WHERE id = 1').get();
  const stavke = db.prepare('SELECT * FROM stavka_ponude WHERE ponuda_id = ? ORDER BY redosled').all(ponudaId);
  const sastavio = ponuda.sastavio_korisnik_id
    ? db.prepare('SELECT ime FROM korisnik WHERE id = ?').get(ponuda.sastavio_korisnik_id)
    : null;

  const izlazPutanja = path.join(OUTPUT_DIR, `ponuda-${ponuda.broj.replace('/', '-')}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  const stream = fs.createWriteStream(izlazPutanja);
  doc.pipe(stream);
  registrujFontove(doc);

  const imaLogo = ubaciLogoAkoPostoji(doc, 40, 30, 90);
  const zaglavljeX = imaLogo ? 150 : 40;

  doc.fontSize(10);
  if (firma) {
    doc.text(firma.naziv || '', zaglavljeX, 35);
    doc.text(`${firma.mesto || ''}, ${firma.adresa || ''}`);
    if (firma.email) doc.text(`email: ${firma.email}`);
    if (firma.tekuci_racun) doc.text(`tekući račun: ${firma.tekuci_racun}`);
    if (firma.maticni_broj) doc.text(`MB: ${firma.maticni_broj}`);
    if (firma.pib) doc.text(`PIB: ${firma.pib}`);
    if (firma.sifra_delatnosti) doc.text(`šifra delatnosti: ${firma.sifra_delatnosti}`);
  }

  doc.moveDown(2);
  doc.fontSize(10).text(`Primio: ${ponuda.primio_mesto || ''}`, 40);
  doc.text(`Sastavio: ${sastavio ? sastavio.ime : ''}`);
  doc.text(`Datum: ${new Date(ponuda.datum).toLocaleDateString('sr-RS')}`);

  doc.moveDown();
  doc.font('Bold').fontSize(11).text('PRIMALAC:');
  doc.font('Regular').fontSize(10).text(komitent.naziv);
  if (komitent.kontakt_osoba) doc.text(`N/r ${komitent.kontakt_osoba}`);
  if (komitent.adresa) doc.text(komitent.adresa);
  if (komitent.kontakt_telefon) doc.text(`tel. ${komitent.kontakt_telefon}`);
  if (komitent.mesto) doc.text(komitent.mesto);

  doc.moveDown();
  doc.font('Bold').fontSize(13).text(`Ponuda br. ${ponuda.broj}`);
  doc.font('Regular');
  if (ponuda.naslov_posla) {
    doc.moveDown(0.5);
    doc.fontSize(11).text(ponuda.naslov_posla);
  }

  if (ponuda.propratni_tekst) {
    doc.moveDown();
    doc.fontSize(10).text(ponuda.propratni_tekst);
  }
  if (ponuda.tehnicki_opis) {
    doc.moveDown();
    doc.font('Bold').fontSize(11).text('Tehnički opis:');
    doc.font('Regular').fontSize(10).text(ponuda.tehnicki_opis);
  }
  if (ponuda.rok_isporuke) {
    doc.moveDown();
    doc.fontSize(10).text(`Rok isporuke: ${ponuda.rok_isporuke}`);
  }

  doc.moveDown();
  doc.font('Bold').fontSize(11).text('Cena:');
  doc.font('Regular').fontSize(10);
  stavke.forEach((s) => {
    doc.text(`${s.opis}    ${s.iznos.toLocaleString('sr-RS')} din`);
  });
  doc.moveDown(0.5);
  doc.font('Bold').fontSize(11).text(`Ukupno: ${(ponuda.ukupno || 0).toLocaleString('sr-RS')} din`);
  doc.font('Regular');

  if (ponuda.placanje) { doc.moveDown(); doc.fontSize(10).text(`Plaćanje: ${ponuda.placanje}`); }
  if (ponuda.garancija) { doc.fontSize(10).text(`Garancija: ${ponuda.garancija}`); }
  if (ponuda.napomena) { doc.moveDown(); doc.fontSize(9).text(`NAPOMENA: ${ponuda.napomena}`); }
  if (ponuda.rok_vazenja) { doc.fontSize(9).text(`Rok važenja ponude je ${ponuda.rok_vazenja}`); }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(izlazPutanja));
    stream.on('error', reject);
  });
}

module.exports = { generisiPrevedeniPlan, generisiPonudaPdf, OUTPUT_DIR };
