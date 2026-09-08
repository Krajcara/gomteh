// Proverava da li postoji novija verzija koda na GitHub-u tako što poredi
// lokalni git commit sa najnovijim commit-om na glavnoj grani udaljenog repozitorijuma.
// Ne zahteva tagovane release-ove — radi na osnovu commit istorije.

const { execSync } = require('child_process');
const path = require('path');

const REPO = process.env.GITHUB_REPO || 'Krajcara/gomteh';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const PROJECT_ROOT = path.join(__dirname, '../..');

function lokalniCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
  } catch (e) {
    return null; // nije git repo, ili git nije dostupan
  }
}

async function udaljeniCommit() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
    headers: { 'User-Agent': 'GOMTEH-update-checker' },
  });
  if (!res.ok) throw new Error(`GitHub API vratio grešku: ${res.status}`);
  const data = await res.json();
  return data.sha;
}

let poslednjaProvera = null; // { updateDostupan, lokalni, udaljeni, vreme, greska }

async function proveriAzuriranje() {
  const lokalni = lokalniCommit();
  try {
    const udaljeni = await udaljeniCommit();
    poslednjaProvera = {
      updateDostupan: Boolean(lokalni && udaljeni && lokalni !== udaljeni),
      lokalni,
      udaljeni,
      vreme: new Date(),
      greska: null,
    };
  } catch (e) {
    poslednjaProvera = {
      updateDostupan: false,
      lokalni,
      udaljeni: null,
      vreme: new Date(),
      greska: e.message,
    };
  }
  return poslednjaProvera;
}

function poslednjiRezultat() {
  return poslednjaProvera;
}

function pokreniPeriodicnuProveru(intervalMs = 6 * 60 * 60 * 1000) {
  proveriAzuriranje().catch(() => {}); // odmah pri startu servera
  setInterval(() => proveriAzuriranje().catch(() => {}), intervalMs);
}

module.exports = { proveriAzuriranje, poslednjiRezultat, pokreniPeriodicnuProveru, REPO, BRANCH };
