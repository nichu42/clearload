#!/bin/bash
set -e

# 🫧 ClearLoad Bootstrap & Startup Script (Unix/macOS/Linux)

echo "🫧 Checking environment..."
if ! command -v node &> /dev/null; then
  echo "❌ Error: Node.js is not installed. Please download it from https://nodejs.org/"
  exit 1
fi

# Detect if we are outside the repo directory
if [ ! -f "package.json" ]; then
  echo "🫧 Repository not detected locally. Cloning ClearLoad..."
  git clone https://codeberg.org/nichu42/clearload.git
  cd clearload
fi

echo "🫧 Installing dependencies..."
npm install

echo "🫧 Starting ClearLoad on http://localhost:3000..."
OPEN_BROWSER=true npm start
