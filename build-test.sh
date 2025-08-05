#!/bin/bash
echo "🔧 Preparing test build..."
npm install

echo "🛠️  Building macOS test version..."
npm run build:mac:test

echo "✅ Build complete!"
echo "📦 Output files:"
ls -la dist/*.dmg dist/*.zip