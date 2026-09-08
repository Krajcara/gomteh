#!/bin/bash
# GOMTEH — instalacioni skript
# Pokreće se JEDNOM, pri prvoj instalaciji na server.
# Generiše .env sa tajnim ključevima (koji NIKAD ne idu na GitHub) i admin nalog.

set -e

echo "=== GOMTEH instalacija ==="

if [ -f .env ]; then
  echo "Fajl .env već postoji — instalacija je verovatno već urađena."
  echo "Ako želiš da ponoviš instalaciju, obriši .env i data/gomteh.db ručno."
  exit 1
fi

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
echo "=== Instalacija završena ==="
echo "Admin korisničko ime: admin@gomteh.local"
echo "Admin lozinka (zapiši je odmah, neće biti ponovo prikazana): $ADMIN_PASSWORD"
echo ""
echo "Lozinka će morati da se promeni pri prvom logovanju."
echo "Pokreni aplikaciju sa: npm start"
