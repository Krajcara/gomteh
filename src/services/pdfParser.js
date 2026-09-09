// Ekstrakcija podataka iz AJAN CNC "Total Job List" PDF-a.
// VAŽNA NAPOMENA: ovaj PDF format ne sadrži eksplicitne razmake u tekstualnom sloju
// (reči se "slepe"), zato se koristi prilagođena render funkcija koja rekonstruiše
// razmake na osnovu x/y pozicija teksta pre nego što se primene regex šabloni.

const pdf = require('pdf-parse');
const fs = require('fs');

// Rečnik prevoda fiksnih labela (englesko polje -> srpski prikaz), koristi se
// pri generisanju prevedenog dokumenta (services/pdfGenerator.js)
const PREVODI_LABELA = {
  'Total Number Of Used Sheets': 'Ukupno iskorišćenih tabli',
  'Total Part Cutting Time': 'Ukupno vreme sečenja delova',
  'Total Piercing Time': 'Ukupno vreme probijanja',
  'Total Lead In/Lead Out Time': 'Vreme ulaza/izlaza reza',
  'Total Rapid Traverse Time': 'Vreme brzog pomeraja',
  'Total Cutting Time': 'Ukupno vreme sečenja',
  'Total Piercing Quantity': 'Broj probijanja',
  'Total Parts Weight (Kg)': 'Ukupna težina delova (kg)',
  'Total Reusable Sheet Weight (Kg)': 'Težina table za ponovnu upotrebu (kg)',
  'Total Scrap Metal Weight (Kg)': 'Težina otpadnog metala (kg)',
  'Total Sheet Weight (Kg)': 'Ukupna težina table (kg)',
  'Total Cutting Path Length (mm)': 'Ukupna dužina reza (mm)',
  'Customer Name': 'Naziv kupca',
  'Machine Type': 'Tip mašine',
  'File Name': 'Naziv fajla',
  'Sheet Size': 'Dimenzije table',
  'Thickness (mm)': 'Debljina (mm)',
  'Amperage': 'Jačina struje',
  'Material': 'Materijal',
  'Part No.': 'Broj dela',
  'Part Name': 'Naziv dela',
  'Part Size': 'Dimenzije dela',
  'Part Weight (Kg)': 'Težina dela (kg)',
  'Part Cutting Time': 'Vreme sečenja dela',
  'Qnty.': 'Količina',
  'Part Perimeter (mm)': 'Obim dela (mm)',
};

// Rekonstruiše razmake i prelome linija na osnovu pozicija teksta u PDF-u
// (pdf-parse/pdfjs po default-u ne dodaje razmak kad PDF ne sadrži eksplicitan space glif).
function customPageRender(pageData) {
  return pageData.getTextContent().then((textContent) => {
    let lastY = null;
    let lastEndX = null;
    let text = '';

    for (const item of textContent.items) {
      const x = item.transform[4];
      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        text += '\n';
        lastEndX = null;
      }
      if (lastEndX !== null && x - lastEndX > 1.2) {
        text += ' ';
      }
      text += item.str;
      lastEndX = x + item.width;
      lastY = y;
    }
    return text;
  });
}

async function parsirajPlanSecenja(putanjaDoFajla) {
  const buffer = fs.readFileSync(putanjaDoFajla);
  const podaci = await pdf(buffer, { pagerender: customPageRender });
  const tekst = podaci.text;

  const izvuci = (regex) => {
    const match = tekst.match(regex);
    return match ? match[1].trim() : null;
  };

  const tezinaDelova = parseFloat(
    izvuci(/Total Parts Weight\s*\(Kg\)\s*=\s*([\d.]+)/i)
  );
  const duzinaReza = parseFloat(
    izvuci(/Cutting Path Length\s*\(mm\)\s*=\s*([\d.]+)/i)
  );
  const debljina = parseFloat(izvuci(/Thickness\s*\(mm\)\s*([\d.]+)/i));
  const materijal = izvuci(/Material\s+(\S+)/i);

  // Naziv fajla — sve do sledeće poznate labele (Sheet Size) ili kraja linije
  const nazivFajla = izvuci(/File Name\s+(.+?)(?:\s+Sheet Size|\n)/i);

  // Dodatna polja iz zaglavlja (za verniji prikaz u prevedenom dokumentu)
  const masina = izvuci(/Machine Type\s+(\S+)/i);
  const dimenzijeTable = izvuci(/Sheet Size\s+(\S+\s*X\s*\S+\s*mm)/i);
  const amperaza = izvuci(/Amperage\s+(\S+)/i);
  const brojPloce = izvuci(/Repeat\s*\(Sheet No\)\s+(\S+)/i);

  const ukupnoTabli = izvuci(/Total Number Of Used Sheets\s*=\s*(\d+)/i);
  const ukupnoProbadanja = izvuci(/Total Piercing(?:\s*Quantity)?\s*=\s*(\d+)/i);
  const ukupnoVremeSecenja = izvuci(/Total Cutting Time\s*=\s*([\d:]+)/i);
  const tezinaTable = parseFloat(izvuci(/Total Sheet Weight\s*\(Kg\)\s*=\s*([\d.]+)/i));
  const tezinaOtpada = parseFloat(izvuci(/Total Scrap Metal Weight\s*\(Kg\)\s*=\s*([\d.]+)/i));
  const tezinaZaPonovnuUpotrebu = parseFloat(izvuci(/Total Reusable Sheet Weight\s*\(Kg\)\s*=\s*([\d.]+)/i));

  // Lista delova: red oblika "1 1001 951X311 1.949 0:01:45 2 3311.09"
  const deloviRegex = /^(\d+)\s+(\d{3,5})\s+(\d+X\d+)\s+([\d.]+)\s+\d+:\d{2}:\d{2}\s+(\d+)\s+([\d.]+)\s*$/gm;
  const delovi = [];
  let m;
  while ((m = deloviRegex.exec(tekst)) !== null) {
    delovi.push({
      partNo: m[1],
      partName: m[2],
      partSize: m[3],
      tezinaKg: parseFloat(m[4]),
      kolicina: parseInt(m[5], 10),
      obimMm: parseFloat(m[6]),
    });
  }

  return {
    tezinaDelovaKg: tezinaDelova,
    duzinaRezaMm: duzinaReza,
    debljinaMm: debljina,
    materijal,
    nazivFajla,
    masina,
    dimenzijeTable,
    amperaza,
    brojPloce,
    ukupnoTabli,
    ukupnoProbadanja,
    ukupnoVremeSecenja,
    tezinaTable,
    tezinaOtpada,
    tezinaZaPonovnuUpotrebu,
    delovi,
  };
}

module.exports = { parsirajPlanSecenja, PREVODI_LABELA };
