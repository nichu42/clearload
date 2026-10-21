#!/bin/bash
set -e

# 🫧 ClearLoad Bootstrap & Startup Script (Unix/macOS/Linux)

# Load NVM if present
if [ -z "$NVM_DIR" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh"
elif [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

echo "🫧 Checking environment..."
if ! command -v node &> /dev/null; then
  echo "❌ Error: Node.js is not installed. Please download it from https://nodejs.org/"
  exit 1
fi

# Detect if we are outside the repo directory
if [ ! -f "package.json" ]; then
  echo "🫧 Repository not detected locally. Cloning ClearLoad..."
  git clone https://github.com/nichu42/clearload.git
  cd clearload
fi

echo "🫧 Installing dependencies..."
npm install

echo "🫧 Starting ClearLoad on http://localhost:3000..."
OPEN_BROWSER=true npm start
