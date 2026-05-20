#!/bin/bash
# =============================================================
# Script de déploiement NFS - VPS
# Usage: bash deploy.sh
# A exécuter sur le VPS après avoir cloné les repos
# =============================================================

set -e

echo "======================================"
echo "  Déploiement NFS Backend + Backoffice"
echo "======================================"

# ---- VARIABLES - Adapter selon votre VPS ----
BACKEND_DIR="/var/www/nfs-backend"
BACKOFFICE_DIR="/var/www/nfs-backoffice"
BACKEND_REPO="https://github.com/ErnestJabea/nfs-backend.git"
BACKOFFICE_REPO="https://github.com/ErnestJabea/nfs-backoffice.git"
NODE_VERSION="20"

# ---- 1. Installer Node.js si besoin ----
if ! command -v node &> /dev/null; then
  echo "[1/7] Installation de Node.js $NODE_VERSION..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
else
  echo "[1/7] Node.js déjà installé : $(node -v)"
fi

# ---- 2. Installer Nginx si besoin ----
if ! command -v nginx &> /dev/null; then
  echo "[2/7] Installation de Nginx..."
  apt-get update && apt-get install -y nginx
else
  echo "[2/7] Nginx déjà installé."
fi

# ---- 3. Déploiement du Backend ----
echo "[3/7] Déploiement du backend..."
if [ -d "$BACKEND_DIR" ]; then
  cd "$BACKEND_DIR"
  git pull origin master
else
  git clone "$BACKEND_REPO" "$BACKEND_DIR"
  cd "$BACKEND_DIR"
fi

npm install
npx prisma generate

# ---- 4. Déploiement du Backoffice ----
echo "[4/7] Déploiement du backoffice..."
if [ -d "$BACKOFFICE_DIR" ]; then
  cd "$BACKOFFICE_DIR"
  git pull origin master
else
  git clone "$BACKOFFICE_REPO" "$BACKOFFICE_DIR"
  cd "$BACKOFFICE_DIR"
fi

npm install
VITE_API_URL=/api npm run build

# ---- 5. Configuration Nginx ----
echo "[5/7] Configuration Nginx..."
cp "$BACKEND_DIR/nginx.conf" /etc/nginx/sites-available/nfs
ln -sf /etc/nginx/sites-available/nfs /etc/nginx/sites-enabled/nfs
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---- 6. Installation et démarrage du service backend ----
echo "[6/7] Installation du service systemd..."
cp "$BACKEND_DIR/nfs-backend.service" /etc/systemd/system/nfs-backend.service
systemctl daemon-reload
systemctl enable nfs-backend
systemctl restart nfs-backend

# ---- 7. Vérification ----
echo "[7/7] Vérification..."
sleep 3
systemctl status nfs-backend --no-pager || true

echo ""
echo "======================================"
echo "  Déploiement terminé !"
echo "  Backoffice : http://YOUR_IP/"
echo "  API        : http://YOUR_IP/api/"
echo "======================================"
