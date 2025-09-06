#!/bin/bash
set -o errexit

# Install Ubuntu dependencies for Puppeteer
apt-get update
apt-get install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils

# Install Node.js dependencies
npm install

# Set Puppeteer cache
export PUPPETEER_CACHE_DIR=/opt/render/project/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

# Install Chromium
npx puppeteer browsers install chrome

# Cache Chromium for future builds
cp -r $PUPPETEER_CACHE_DIR/* /opt/render/project/src/.cache/puppeteer/ || true
