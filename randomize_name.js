const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'manifest.json');

// Des noms innocents pour cacher l'extension aux systèmes anti-fraude
const innocentNames = [
  "Google Docs Offline",
  "PDF Viewer",
  "Chrome Media Router",
  "WebRTC Control",
  "System Monitor",
  "AdBlock Engine",
  "Vue.js devtools",
  "React Developer Tools",
  "Grammar Checker",
  "Safe Browsing",
  "Volume Booster",
  "Tab Manager",
  "Color Picker"
];

function randomizeName() {
  try {
    const rawData = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(rawData);
    
    const randomPrefix = innocentNames[Math.floor(Math.random() * innocentNames.length)];
    const randomSuffix = Math.floor(Math.random() * 10000);
    const newName = `${randomPrefix} ${randomSuffix}`;
    
    manifest.name = newName;
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[${new Date().toLocaleTimeString()}] Nom de l'extension modifié: "${newName}"`);
    console.log(`-> N'oubliez pas de cliquer sur l'icône "Actualiser" de l'extension dans chrome://extensions/`);
  } catch (error) {
    console.error("Erreur lors de la modification du manifest:", error);
  }
}

// 1. Exécution immédiate
randomizeName();

// 2. Exécution toutes les 2 heures
const DEUX_HEURES = 2 * 60 * 60 * 1000;
setInterval(randomizeName, DEUX_HEURES);

console.log("Script de randomisation lancé.");
console.log("L'extension changera de nom dans manifest.json toutes les 2 heures.");
console.log("Laissez ce terminal ouvert ou utilisez pm2/forever.");
