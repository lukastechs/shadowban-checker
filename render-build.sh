#!/bin/bash
set -o errexit
npm install
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR
npx puppeteer browsers install chrome
cp -r $PUPPETEER_CACHE_DIR/* /opt/render/project/src/.cache/puppeteer/ || true
