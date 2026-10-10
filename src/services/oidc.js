// Prijava preko Keycloak-a (OpenID Connect, Authorization Code + PKCE).
//
// Uključuje se samo ako su OIDC_* promenljive podešene u .env. Bez njih aplikacija
// radi kao i do sada, samo sa lokalnim nalozima. Lokalna prijava uvek ostaje
// dostupna kao rezerva (npr. kad Keycloak ne radi).
//
// openid-client v6 je ESM paket, a GomTeh je CommonJS, pa se učitava preko import().

const ULOGE_PO_PRIORITETU = ['administrator', 'referent_ponude', 'referent_proizvodnja', 'pregled'];

function ukljucen() {
  return Boolean(
    process.env.OIDC_ISSUER &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET &&
      process.env.OIDC_REDIRECT_URI
  );
}

// Greška čija se poruka sme prikazati korisniku (ostale idu samo u log).
class OidcGreska extends Error {
  constructor(poruka) {
    super(poruka);
    this.javna = true;
  }
}

let biblioteka;
async function oc() {
  if (!biblioteka) biblioteka = await import('openid-client');
  return biblioteka;
}

// Podaci o Keycloak-u (.well-known/openid-configuration) se čitaju jednom i pamte.
// Ako Keycloak u tom trenutku ne radi, ništa se ne pamti, pa sledeći pokušaj čita ponovo.
let konfiguracija;
async function config() {
  if (konfiguracija) return konfiguracija;
  const client = await oc();
  konfiguracija = await client.discovery(
    new URL(process.env.OIDC_ISSUER),
    process.env.OIDC_CLIENT_ID,
    process.env.OIDC_CLIENT_SECRET
  );
  return konfiguracija;
}

/**
 * Korak 1: pravi adresu Keycloak login strane. Nasumične vrednosti (state, nonce,
 * PKCE verifier) se čuvaju u sesiji da bi se u koraku 2 proverilo da je odgovor
 * stigao baš za ovaj zahtev.
 */
async function zapocniPrijavu(req) {
  const client = await oc();
  const cfg = await config();

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  req.session.oidc = { codeVerifier, state, nonce };

  return client.buildAuthorizationUrl(cfg, {
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  }).href;
}

/**
 * Korak 2: Keycloak je vratio korisnika sa ?code=...; backend menja kod za tokene
 * (direktno, server-server) i proverava potpis, state, nonce i issuer.
 */
async function zavrsiPrijavu(req) {
  const client = await oc();
  const cfg = await config();

  const ocekivano = req.session.oidc;
  delete req.session.oidc;
  if (!ocekivano) throw new OidcGreska('Prijava je istekla ili je otvorena u drugom prozoru. Pokušaj ponovo.');

  // Adresa se gradi iz OIDC_REDIRECT_URI, a ne iz zaglavlja zahteva, pa ne zavisi
  // od toga kako NPMplus prosleđuje Host i protokol.
  const trenutniUrl = new URL(req.originalUrl, process.env.OIDC_REDIRECT_URI);

  const tokeni = await client.authorizationCodeGrant(cfg, trenutniUrl, {
    pkceCodeVerifier: ocekivano.codeVerifier,
    expectedState: ocekivano.state,
    expectedNonce: ocekivano.nonce,
    idTokenExpected: true,
  });

  return { claims: tokeni.claims(), idToken: tokeni.id_token };
}

/** Iz tokena bira najjaču GomTeh ulogu; sve ostalo (npr. Keycloak account role) se ignoriše. */
function izaberiUlogu(claims) {
  const nazivClaima = process.env.OIDC_ROLES_CLAIM || 'gomteh_roles';
  const uloge = Array.isArray(claims[nazivClaima]) ? claims[nazivClaima] : [];
  return ULOGE_PO_PRIORITETU.find((u) => uloge.includes(u)) || null;
}

/** Adresa za odjavu i iz Keycloak-a (inače bi sledeći klik na "Prijavi se" prošao bez lozinke). */
async function adresaOdjave(idToken) {
  const client = await oc();
  const cfg = await config();
  const parametri = { id_token_hint: idToken };
  if (process.env.OIDC_POST_LOGOUT_REDIRECT_URI) {
    parametri.post_logout_redirect_uri = process.env.OIDC_POST_LOGOUT_REDIRECT_URI;
  }
  return client.buildEndSessionUrl(cfg, parametri).href;
}

module.exports = {
  ukljucen,
  zapocniPrijavu,
  zavrsiPrijavu,
  izaberiUlogu,
  adresaOdjave,
  OidcGreska,
};
