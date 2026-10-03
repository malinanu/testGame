#!/usr/bin/env bash
# deploy-cloudpanel.sh
# Run this on your CloudPanel server as the site user to pull the latest code and deploy to the htdocs directory.
#
# Usage:
#   chmod +x scripts/deploy-cloudpanel.sh
#   ./scripts/deploy-cloudpanel.sh <domain-name>
#
# Example:
#   ./scripts/deploy-cloudpanel.sh game.yourdomain.com

set -euo pipefail

DOMAIN="${1:-}"

if [ -z "$DOMAIN" ]; then
  echo "Error: Please provide your CloudPanel domain name."
  echo "Usage: $0 <domain-name>"
  exit 1
fi

SITE_USER="$(whoami)"
HTDOCS_DIR="/home/${SITE_USER}/htdocs/${DOMAIN}"

if [ ! -d "$HTDOCS_DIR" ]; then
  echo "Error: Directory ${HTDOCS_DIR} does not exist."
  echo "Please verify the site user and domain name."
  exit 1
fi

echo "==> Pulling latest changes from git..."
git pull origin main

echo "==> Deploying public/ files to ${HTDOCS_DIR}..."
rsync -avzr --delete public/ "${HTDOCS_DIR}/"

echo "==> Setting file permissions..."
find "${HTDOCS_DIR}" -type f -exec chmod 644 {} +
find "${HTDOCS_DIR}" -type d -exec chmod 755 {} +

echo "==> Deployment complete! Visit https://${DOMAIN}/"
