// Ekstrakcija podataka iz AJAN CNC "Total Job List" PDF-a.
// Format je fiksan (isti software generiše svaki fajl), pa se koristi
// parsiranje po poznatim labelama umesto opšteg NLP/heurističkog pristupa.

const pdf = require('pdf-parse');
const fs = require('fs');

// Rečnik prevoda fiksnih labela (englesko polje -> srpski prikaz)
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

async function parsirajPlanSecenja(putanjaDoFajla) {
  const buffer = fs.readFileSync(putanjaDoFajla);
  const podaci = await pdf(buffer);
  const tekst = podaci.text;

  const izvuci = (regex) => {
    const match = tekst.match(regex);
    return match ? match[1].trim() : null;
  };

  const tezinaDelova = parseFloat(
    izvuci(/Total Parts Weight \(Kg\)\s*=?\s*([\d.]+)/i)
  );
  const duzinaReza = parseFloat(
    izvuci(/Total Cutting Path Length \(mm\)\s*=?\s*([\d.]+)/i)
  );
  const debljina = parseFloat(izvuci(/Thickness\s*\(mm\)\s*([\d.]+)/i));
  const materijal = izvuci(/Material\s+(\S+)/i);
  const nazivFajla = izvuci(/File Name\s+(\S+\.\w+)/i);

  // NAPOMENA: "Customer Name" iz originalnog PDF-a se NE koristi.
  // Pri generisanju prevedenog dokumenta, ovo polje se popunjava nazivom
  // komitenta pod kojim je otvoren posao u aplikaciji (vidi pdfGenerator.js).

  // Lista delova: red oblika "1  1001  951X311  1.949  0:01:45  2  3311.09"
  const deloviRegex = /(\d+)\s+.*?\s+(\d{3,4})\s+(\d+X\d+)\s+([\d.]+)\s+[\d:]+\s+(\d+)\s+([\d.]+)/g;
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
    delovi,
  };
}

module.exports = { parsirajPlanSecenja, PREVODI_LABELA };
