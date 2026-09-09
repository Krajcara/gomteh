const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');
const db = require('../db/db');
const { parsirajPlanSecenja } = require('./pdfParser');

const OUTPUT_DIR = path.join(__dirname, '../../data/generated');
const TEMP_DIR = path.join(__dirname, '../../data/temp');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

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

// Izvlači dijagram raspireda delova sa DRUGE strane originalnog AJAN PDF-a kao sliku
// (fiksna pozicija na stranici, isti template za svaki izveštaj — vidi napomenu ispod).
// Vraća putanju do isečene PNG slike, ili null ako izvlačenje ne uspe (npr. plan bez 2. strane).
function izvuciDijagramSlike(originalniFajlPutanja, izlazniPrefiks) {
  try {
    const DPI = 200;
    const renderPrefiks = path.join(TEMP_DIR, izlazniPrefiks);
    execSync(
      `pdftoppm -png -r ${DPI} -f 2 -l 2 "${originalniFajlPutanja}" "${renderPrefiks}"`,
      { stdio: 'pipe' }
    );

    const renderovanaSlika = `${renderPrefiks}-2.png`;
    if (!fs.existsSync(renderovanaSlika)) return null;

    // Koordinate su izmerene na stvarnom AJAN PDF-u (A4, fiksan MigraDoc template —
    // ista relativna pozicija dijagrama bez obzira na sadržaj konkretnog posla)
    const ptToPx = DPI / 72;
    const top = Math.round(88 * ptToPx);
    const bottom = Math.round(352 * ptToPx);
    const left = Math.round(10 * ptToPx);
    const right = Math.round(585 * ptToPx);

    const izlaznaPutanja = path.join(TEMP_DIR, `${izlazniPrefiks}-dijagram.png`);

    return { renderovanaSlika, izlaznaPutanja, left, top, sirina: right - left, visina: bottom - top };
  } catch (e) {
    return null;
  }
}

async function izvuciDijagramSlikeAsync(originalniFajlPutanja, izlazniPrefiks) {
  const info = izvuciDijagramSlike(originalniFajlPutanja, izlazniPrefiks);
  if (!info) return null;

  try {
    await sharp(info.renderovanaSlika)
      .extract({ left: info.left, top: info.top, width: info.sirina, height: info.visina })
      .toFile(info.izlaznaPutanja);
    return info.izlaznaPutanja;
  } catch (e) {
    return null;
  }
}

// Jednostavna tabela: crta re='divove' oko svake ćelije. Redovi su niz ćelija
// [{ tekst, sirina, bold }], sve ćelije u redu dele istu visinu.
function nacrtajTabelu(doc, x, y, redovi, visinaReda = 20) {
  let trenutnoY = y;
  for (const red of redovi) {
    let trenutnoX = x;
    const maxSirina = red.reduce((z, c) => z + c.sirina, 0);
    doc.lineWidth(0.5).rect(x, trenutnoY, maxSirina, visinaReda).stroke('#999999');
    for (const celija of red) {
      doc.rect(trenutnoX, trenutnoY, celija.sirina, visinaReda).stroke('#999999');
      if (celija.pozadina) {
        doc.save().rect(trenutnoX, trenutnoY, celija.sirina, visinaReda).fill(celija.pozadina).restore();
      }
      doc.font(celija.bold ? 'Bold' : 'Regular').fontSize(celija.velicina || 8.5).fillColor('#000000');
      doc.text(celija.tekst ?? '', trenutnoX + 4, trenutnoY + visinaReda / 2 - 5, {
        width: celija.sirina - 8,
        align: celija.align || 'left',
      });
      trenutnoX += celija.sirina;
    }
    trenutnoY += visinaReda;
  }
  return trenutnoY;
}

// Prevedeni plan sečenja — vernu strukturu originala (zaglavlje, dijagram, tabela delova),
// prevedene labele na srpski, logo firme umesto AJAN loga, i naziv komitenta iz posla
// umesto originalnog "Customer Name" polja.
async function generisiPrevedeniPlan(planSecenjaId) {
  const plan = db.prepare('SELECT * FROM plan_secenja WHERE id = ?').get(planSecenjaId);
  if (!plan) throw new Error('Plan sečenja nije pronađen.');

  const posao = db.prepare('SELECT * FROM posao WHERE id = ?').get(plan.posao_id);
  const komitent = db.prepare('SELECT * FROM komitent WHERE id = ?').get(posao.komitent_id);
  const delovi = db.prepare('SELECT * FROM deo_iz_plana WHERE plan_secenja_id = ?').all(planSecenjaId);

  // Ponovo parsiramo originalni fajl da dobijemo i dodatna polja (mašina, dimenzije table,
  // amperaža...) bez potrebe da ih trajno čuvamo u bazi.
  let prosireno = {};
  try {
    prosireno = await parsirajPlanSecenja(plan.originalni_fajl_putanja);
  } catch (e) {
    prosireno = {};
  }

  const dijagramPutanja = await izvuciDijagramSlikeAsync(plan.originalni_fajl_putanja, `plan-${planSecenjaId}`);

  const izlazPutanja = path.join(OUTPUT_DIR, `plan-secenja-${planSecenjaId}.pdf`);
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  const stream = fs.createWriteStream(izlazPutanja);
  doc.pipe(stream);
  registrujFontove(doc);

  const imaLogo = ubaciLogoAkoPostoji(doc, 30, 20, 90);
  doc.font('Bold').fontSize(14).text('Plan sečenja', imaLogo ? 130 : 30, 25);
  doc.font('Regular').fontSize(8).fillColor('#555555')
    .text(new Date().toLocaleDateString('sr-RS'), 450, 25, { width: 115, align: 'right' });
  doc.fillColor('#000000');

  let y = 70;
  const sivaPozadina = '#e8e8e8';
  const punaSirina = 535;

  // Red 1: Naziv kupca | Tip mašine | Naziv fajla
  y = nacrtajTabelu(doc, 30, y, [[
    { tekst: 'Naziv kupca', sirina: 90, bold: true, pozadina: sivaPozadina },
    { tekst: komitent.naziv, sirina: 165 },
    { tekst: 'Tip mašine', sirina: 80, bold: true, pozadina: sivaPozadina },
    { tekst: prosireno.masina || '—', sirina: 60 },
    { tekst: 'Naziv fajla', sirina: 70, bold: true, pozadina: sivaPozadina },
    { tekst: plan.naziv_fajla || '—', sirina: 70 },
  ]]);

  // Red 2: Dimenzije table | Broj ploče | Debljina | Amperaža | Materijal
  y = nacrtajTabelu(doc, 30, y, [[
    { tekst: 'Dimenzije table', sirina: 80, bold: true, pozadina: sivaPozadina, velicina: 8 },
    { tekst: prosireno.dimenzijeTable || '—', sirina: 85, velicina: 8 },
    { tekst: 'Br. ploče', sirina: 50, bold: true, pozadina: sivaPozadina, velicina: 8 },
    { tekst: prosireno.brojPloce || '—', sirina: 25, align: 'center', velicina: 8 },
    { tekst: 'Debljina', sirina: 55, bold: true, pozadina: sivaPozadina, velicina: 8 },
    { tekst: String(plan.debljina_mm ?? '—'), sirina: 35, align: 'center', velicina: 8 },
    { tekst: 'Amper.', sirina: 45, bold: true, pozadina: sivaPozadina, velicina: 8 },
    { tekst: prosireno.amperaza || '—', sirina: 30, align: 'center', velicina: 8 },
    { tekst: 'Materijal', sirina: 50, bold: true, pozadina: sivaPozadina, velicina: 8 },
    { tekst: plan.materijal || '—', sirina: 80, velicina: 8 },
  ]]);

  y += 10;

  // Dijagram (izvučen iz originalnog PDF-a kao slika)
  if (dijagramPutanja && fs.existsSync(dijagramPutanja)) {
    try {
      const dimenzije = await sharp(dijagramPutanja).metadata();
      const razmera = punaSirina / dimenzije.width;
      const visinaSlike = dimenzije.height * razmera;
      doc.image(dijagramPutanja, 30, y, { width: punaSirina });
      y += visinaSlike + 12;
    } catch (e) {
      doc.fontSize(9).fillColor('#888888').text('(dijagram nije dostupan)', 30, y);
      y += 20;
    }
  } else {
    doc.fontSize(9).fillColor('#888888').text('(dijagram nije dostupan za ovaj plan)', 30, y);
    y += 20;
  }
  doc.fillColor('#000000');

  // Ako nema dovoljno mesta do kraja strane za tabelu sažetka + delova, pređi na novu stranu
  if (y > 620) {
    doc.addPage();
    y = 30;
  }

  // Sažetak — dve kolone kao u originalu
  const sazetakLevo = [
    ['Ukupno iskorišćenih tabli', prosireno.ukupnoTabli ?? '—'],
    ['Ukupno vreme sečenja', prosireno.ukupnoVremeSecenja ?? '—'],
  ];
  const sazetakDesno = [
    ['Broj probadanja', prosireno.ukupnoProbadanja ?? '—'],
    ['Ukupna težina delova (kg)', plan.tezina_delova_kg ?? '—'],
    ['Težina table (kg)', prosireno.tezinaTable ?? '—'],
    ['Otpadni metal (kg)', prosireno.tezinaOtpada ?? '—'],
    ['Table za ponovnu upotrebu (kg)', prosireno.tezinaZaPonovnuUpotrebu ?? '—'],
    ['Ukupna dužina reza (mm)', plan.duzina_reza_mm ?? '—'],
  ];

  const pocetakSazetkaY = y;
  let yLevo = y;
  for (const [labela, vrednost] of sazetakLevo) {
    yLevo = nacrtajTabelu(doc, 30, yLevo, [[
      { tekst: labela, sirina: 160, bold: true, pozadina: sivaPozadina },
      { tekst: String(vrednost), sirina: 100 },
    ]], 18);
  }

  let yDesno = pocetakSazetkaY;
  for (const [labela, vrednost] of sazetakDesno) {
    yDesno = nacrtajTabelu(doc, 300, yDesno, [[
      { tekst: labela, sirina: 175, bold: true, pozadina: sivaPozadina },
      { tekst: String(vrednost), sirina: 90 },
    ]], 18);
  }

  y = Math.max(yLevo, yDesno) + 14;

  if (y > 680) {
    doc.addPage();
    y = 30;
  }

  // Tabela delova (prevedena zaglavlja)
  doc.font('Bold').fontSize(11).text('Lista delova', 30, y);
  y += 18;

  const koloneDelova = [
    { naslov: 'Br.', sirina: 30 },
    { naslov: 'Naziv dela', sirina: 90 },
    { naslov: 'Dimenzije', sirina: 90 },
    { naslov: 'Težina (kg)', sirina: 65 },
    { naslov: 'Količina', sirina: 55 },
    { naslov: 'Obim (mm)', sirina: 70 },
    { naslov: 'Napomena', sirina: 135 },
  ];

  y = nacrtajTabelu(doc, 30, y, [
    koloneDelova.map((k) => ({ tekst: k.naslov, sirina: k.sirina, bold: true, pozadina: sivaPozadina, align: 'center' })),
  ], 20);

  delovi.forEach((d, i) => {
    const izvorniDeo = (prosireno.delovi || []).find((p) => p.partName === d.part_name);
    y = nacrtajTabelu(doc, 30, y, [[
      { tekst: String(i + 1), sirina: 30, align: 'center' },
      { tekst: d.part_name, sirina: 90 },
      { tekst: d.part_size || '—', sirina: 90, align: 'center' },
      { tekst: izvorniDeo ? String(izvorniDeo.tezinaKg) : '—', sirina: 65, align: 'center' },
      { tekst: String(d.kolicina_plan), sirina: 55, align: 'center' },
      { tekst: izvorniDeo ? String(izvorniDeo.obimMm) : '—', sirina: 70, align: 'center' },
      { tekst: '', sirina: 135 },
    ]], 20);

    if (y > 780 && i < delovi.length - 1) {
      doc.addPage();
      y = 30;
    }
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

// Radni nalog — za štampu/potpis u pogonu
function generisiRadniNalogPdf(radniNalogId) {
  const nalog = db.prepare('SELECT * FROM radni_nalog WHERE id = ?').get(radniNalogId);
  if (!nalog) throw new Error('Radni nalog nije pronađen.');

  const posao = db.prepare('SELECT * FROM posao WHERE id = ?').get(nalog.posao_id);
  const komitent = db.prepare('SELECT * FROM komitent WHERE id = ?').get(posao.komitent_id);
  const firma = db.prepare('SELECT * FROM firma WHERE id = 1').get();
  const stavke = db.prepare('SELECT * FROM stavka_naloga WHERE radni_nalog_id = ?').all(radniNalogId);
  const kreirao = nalog.kreirao_korisnik_id
    ? db.prepare('SELECT ime FROM korisnik WHERE id = ?').get(nalog.kreirao_korisnik_id)
    : null;

  const statusText = { otvoren: 'Otvoren', u_izradi: 'U izradi', zavrsen: 'Završen', storniran: 'Storniran' }[nalog.status];

  const izlazPutanja = path.join(OUTPUT_DIR, `radni-nalog-${nalog.broj.replace('/', '-')}.pdf`);
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
    if (firma.pib) doc.text(`PIB: ${firma.pib}`);
  }

  doc.moveDown(2);
  doc.font('Bold').fontSize(16).text(`Radni nalog br. ${nalog.broj}`);
  doc.font('Regular').fontSize(10);
  doc.text(`Datum: ${new Date(nalog.datum).toLocaleDateString('sr-RS')}`);
  doc.text(`Status: ${statusText}`);
  if (kreirao) doc.text(`Kreirao: ${kreirao.ime}`);

  doc.moveDown();
  doc.font('Bold').fontSize(11).text('Posao:');
  doc.font('Regular').fontSize(10).text(posao.naziv);

  doc.moveDown();
  doc.font('Bold').fontSize(11).text('Komitent:');
  doc.font('Regular').fontSize(10).text(komitent.naziv);
  if (komitent.adresa) doc.text(komitent.adresa);
  if (komitent.mesto) doc.text(komitent.mesto);

  doc.moveDown();
  doc.font('Bold').fontSize(11).text('Stavke naloga:');
  doc.font('Regular').fontSize(10);
  doc.moveDown(0.3);

  const kolX = [40, 280, 380, 480];
  doc.font('Bold');
  doc.text('Deo', kolX[0], doc.y, { continued: false });
  doc.text('Dodeljeno', kolX[1], doc.y - doc.currentLineHeight());
  doc.text('Realizovano', kolX[2], doc.y - doc.currentLineHeight());
  doc.font('Regular');
  doc.moveDown(0.3);

  stavke.forEach((s) => {
    const y = doc.y;
    doc.text(s.part_name, kolX[0], y);
    doc.text(String(s.kolicina_dodeljena), kolX[1], y);
    doc.text(String(s.kolicina_zavrsena), kolX[2], y);
    doc.moveDown(0.3);
  });

  doc.moveDown(2);
  doc.text('_______________________', 40);
  doc.text('Potpis radnika', 40);
  doc.text('_______________________', 320, doc.y - doc.currentLineHeight() * 2);
  doc.text('Potpis kontrole', 320);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(izlazPutanja));
    stream.on('error', reject);
  });
}

module.exports = { generisiPrevedeniPlan, generisiPonudaPdf, generisiRadniNalogPdf, OUTPUT_DIR };
