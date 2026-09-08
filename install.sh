#!/bin/bash
# GOMTEH — instalacioni skript
# Pokreće se JEDNOM, pri prvoj instalaciji na server.
# Generiše .env sa tajnim ključevima (koji NIKAD ne idu na GitHub) i admin nalog.

set -e

echo "=== GOMTEH instalacija ==="

if [ "$EUID" -eq 0 ]; then
  echo "GREŠKA: Ne pokreći ovu skriptu sa 'sudo'."
  echo "Skripta sama poziva sudo interno, samo za instalaciju Node.js-a na sistem."
  echo "Ako je pokreneš celu kao root, baza i .env fajl će pripadati root korisniku,"
  echo "što pravi probleme kasnije kad budeš pokretao 'npm start' kao obično korisnik."
  echo ""
  echo "Pokreni je ovako: bash install.sh"
  exit 1
fi


if [ -f .env ]; then
  echo "Fajl .env već postoji — instalacija je verovatno već urađena."
  echo "Ako želiš da ponoviš instalaciju, obriši .env i data/gomteh.db ručno."
  exit 1
fi

# Proveri da li Node.js/npm postoje, instaliraj ako ne postoje (samo Debian/Ubuntu)
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
  echo "Node.js nije pronađen na sistemu."
  if command -v apt-get &> /dev/null; then
    echo "Instaliram Node.js 20 (LTS) preko NodeSource repozitorijuma..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    echo "Instaliram alate za kompajliranje (potrebni ako neki npm paket nema gotovu binarnu verziju)..."
    sudo apt-get install -y build-essential python3
  else
    echo "Automatska instalacija Node.js-a je podržana samo na Debian/Ubuntu (apt)."
    echo "Instaliraj Node.js 20+ ručno (https://nodejs.org) pa ponovo pokreni ovu skriptu."
    exit 1
  fi
fi

echo "Node.js verzija: $(node -v), npm verzija: $(npm -v)"
echo ""

echo "Instaliram zavisnosti..."
npm install

echo "Generišem tajne ključeve..."
DB_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g,''))")

cat > .env << EOF
DB_PATH=./data/gomteh.db
DB_ENCRYPTION_KEY=${DB_KEY}
SESSION_SECRET=${SESSION_SECRET}
PORT=3000
EOF

echo "Kreiram bazu i admin nalog..."
ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/seed-admin.js

echo ""
echo "Podešavam automatsko pokretanje (systemd)..."

INSTALL_USER=$(whoami)
INSTALL_DIR=$(pwd)
NPM_PATH=$(command -v npm)

sudo tee /etc/systemd/system/gomteh.service > /dev/null << EOF
[Unit]
Description=GOMTEH - aplikacija za ponude i radne naloge
After=network.target

[Service]
Type=simple
User=${INSTALL_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NPM_PATH} start
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gomteh
sudo systemctl start gomteh

sleep 1
if sudo systemctl is-active --quiet gomteh; then
  SERVIS_STATUS="Servis radi (active)."
else
  SERVIS_STATUS="UPOZORENJE: servis nije aktivan — proveri 'sudo systemctl status gomteh' i 'sudo journalctl -u gomteh -n 50'."
fi

echo ""
echo "=== Instalacija završena ==="
echo "Admin korisničko ime: admin@gomteh.local"
echo "Admin lozinka (zapiši je odmah, neće biti ponovo prikazana): $ADMIN_PASSWORD"
echo ""
echo "Lozinka će morati da se promeni pri prvom logovanju."
echo ""
echo "$SERVIS_STATUS"
echo "Aplikacija je dostupna na: http://$(hostname -I 2>/dev/null | awk '{print $1}'):3000 (ili http://localhost:3000 sa samog servera)"
echo "Sama će se pokrenuti pri svakom restartu servera, i restartovati ako se sruši."
echo ""
echo "Korisne komande:"
echo "  sudo systemctl status gomteh    — proveri status"
echo "  sudo journalctl -u gomteh -f    — prati logove uživo"
echo "  sudo systemctl restart gomteh   — ručni restart"
