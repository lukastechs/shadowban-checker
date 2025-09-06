#!/bin/bash
set -o errexit

# Fix read-only apt directory error
mkdir -p /var/lib/apt/lists/partial

# Install Ubuntu dependencies for Puppeteer
apt-get update
apt-get install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils

# Install Node.js dependencies (PUPPETEER_SKIP_DOWNLOAD=true is set in env vars to skip download here)
npm install

# Set Puppeteer cache dir
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

# Manually install Chromium
npx puppeteer browsers install chrome
