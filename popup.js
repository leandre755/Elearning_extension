let state = {
  enabled: false,
  captureImages: true,
  autoMode: false,
  selectedProvider: 'auto',
  thinkingMode: false
};

// Éléments DOM
const elements = {
  extensionToggle: document.getElementById('extensionToggle'),
  autoModeToggle: document.getElementById('autoModeToggle'),
  connectionStatus: document.getElementById('connectionStatus'),
  statusDot: document.getElementById('statusDot'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  clearBtn: document.getElementById('clearBtn'),
  schemaStatus: document.getElementById('schemaStatus'),
  schemaIcon: document.getElementById('schemaIcon'),
  schemaText: document.getElementById('schemaText'),
  schemaRediscoverBtn: document.getElementById('schemaRediscoverBtn'),
  
  // Elements de progression
  progressSection: document.getElementById('progressSection'),
  progressBarFill: document.getElementById('progressBarFill'),
  progressText: document.getElementById('progressText'),
  progressPercentage: document.getElementById('progressPercentage')
};

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  checkApiConnection();
  checkSchemaStatus();
});

// Charger les paramètres depuis le stockage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['enabled', 'captureImages', 'selectedProvider', 'thinkingMode', 'autoMode']);

  state.enabled = result.enabled || false;
  state.captureImages = result.captureImages !== false;
  state.selectedProvider = result.selectedProvider || 'auto';
  state.thinkingMode = result.thinkingMode || false;
  state.autoMode = result.autoMode || false;

  // Mettre à jour l'UI
  if (elements.extensionToggle) elements.extensionToggle.checked = state.enabled;
  if (elements.autoModeToggle) elements.autoModeToggle.checked = state.autoMode;
}

// Configurer les écouteurs d'événements
function setupEventListeners() {
  // Toggle extension active
  if (elements.extensionToggle) {
    elements.extensionToggle.addEventListener('change', async (e) => {
      state.enabled = e.target.checked;
      await saveSettings();
      notifyContentScript({ action: 'toggleExtension', enabled: state.enabled });
    });
  }

  // Toggle auto mode
  if (elements.autoModeToggle) {
    elements.autoModeToggle.addEventListener('change', async (e) => {
      state.autoMode = e.target.checked;
      await saveSettings();
    });
  }

  // Bouton Analyser
  elements.analyzeBtn.addEventListener('click', analyzeQuiz);

  // Bouton Effacer
  elements.clearBtn.addEventListener('click', clearHighlights);

  // Bouton Re-découvrir schéma
  if (elements.schemaRediscoverBtn) {
    elements.schemaRediscoverBtn.addEventListener('click', rediscoverSchema);
  }

  // Écouter les messages de progression depuis content.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'analysisProgress') {
      showProgress(message.step, message.percent);
    }
  });
}

async function saveSettings() {
  await chrome.storage.sync.set({
    enabled: state.enabled,
    captureImages: state.captureImages,
    selectedProvider: state.selectedProvider,
    thinkingMode: state.thinkingMode,
    autoMode: state.autoMode
  });
}

// Afficher la progression dans la barre
function showProgress(stepMessage, percent) {
  if (!elements.progressSection) return;
  
  // Réinitialiser les couleurs d'erreur s'il y en avait
  elements.progressText.style.color = '';
  elements.progressBarFill.style.backgroundColor = '';

  elements.progressSection.style.display = 'flex';
  elements.progressText.textContent = stepMessage;
  elements.progressBarFill.style.width = `${percent}%`;
  elements.progressPercentage.textContent = `${percent}%`;
}

// Vérifier la connexion API (combien de clés configurées)
async function checkApiConnection() {
  const keys = await chrome.storage.local.get([
    'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
    'mistralApiKey', 'claudeApiKey', 'fireworksApiKey'
  ]);

  let configuredProviders = 0;
  for (const key in keys) {
    if (keys[key] && keys[key].trim().length > 0) {
      configuredProviders++;
    }
  }

  if (configuredProviders > 0) {
    elements.statusDot.classList.add('connected');
    elements.connectionStatus.innerHTML = `${configuredProviders} IA prête${configuredProviders > 1 ? 's' : ''}`;
  } else {
    elements.statusDot.classList.remove('connected');
    elements.connectionStatus.textContent = 'Configuration requise';
  }
}

// Analyser le quiz
async function analyzeQuiz() {
  state.hasError = false; // Réinitialisation du flag d'erreur
  if (elements.progressSection) elements.progressSection.style.display = 'block'; // S'assurer que la progression est affichée
  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = '⏳ Analyse en cours...';
  showProgress('Initialisation de la page...', 5);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('Aucun onglet actif trouvé');
    }

    try {
      await sendMessageToTab(tab.id, {
        action: 'analyzeQuiz',
        settings: state,
        forceFallback: true
      });
    } catch (err) {
      console.log('⚠️ Script non détecté, injection en cours...');
      showProgress('Injection du script cœur...', 15);

      for (const file of ['providers.js', 'schema-cache.js', 'schema-detector.js', 'dom-extractor.js', 'highlight-manager.js', 'content.js']) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [file]
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      showProgress('Lancement de l\'analyse...', 25);

      await sendMessageToTab(tab.id, {
        action: 'analyzeQuiz',
        settings: state,
        forceFallback: true
      });
    }
  } catch (error) {
    showError(error.message);
    state.hasError = true; // Flag d'erreur pour empêcher la dissimulation de l'UX/UI
  } finally {
    elements.analyzeBtn.disabled = false;
    elements.analyzeBtn.textContent = '🔍 Trouver les Réponses';
    
    // Masquer la progression après 2.5s uniquement s'il n'y a pas d'erreur
    if (!state.hasError) {
      setTimeout(() => {
        if (elements.progressSection) elements.progressSection.style.display = 'none';
      }, 2500);
    }
  }
}

// Wrapper de message vers l'onglet
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response && response.success) {
        showResults(response.data);
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Erreur inconnue'));
      }
    });
  });
}

// Afficher les résultats synthétisés
function showResults(data) {
  const qCount = data.questionsFound;
  const aCount = data.answersHighlighted;
  showProgress(`✅ Surligné ${aCount}/${qCount} réponse${qCount > 1 ? 's' : ''}`, 100);
}

// Afficher une erreur dans la barre
function showError(message) {
  if (elements.progressText) {
    elements.progressText.textContent = `❌ Erreur: ${message}`;
    elements.progressText.style.color = '#E85D75';
  }
  if (elements.progressBarFill) {
    elements.progressBarFill.style.backgroundColor = '#E85D75';
    elements.progressBarFill.style.width = '100%';
  }
}

// Effacer les surlignages
async function clearHighlights() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' }).catch(() => {});
  }
  if (elements.progressSection) elements.progressSection.style.display = 'none';
}

// Notifier le content script
async function notifyContentScript(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// Vérifier le schéma du site actif
async function checkSchemaStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getSchemaStatus' }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });

    if (!response || !response.success) {
      if (elements.schemaStatus) elements.schemaStatus.style.display = 'none';
      return;
    }

    const data = response.data;
    if (!elements.schemaStatus) return;

    elements.schemaStatus.style.display = 'flex';

    if (data.hasSchema) {
      elements.schemaStatus.className = 'schema-status known';
      elements.schemaIcon.textContent = '🧠';
      const platformText = data.platform ? ` (${data.platform})` : '';
      elements.schemaText.textContent = `Structure reconnue${platformText}`;
    } else if (data.hasInteractive) {
      elements.schemaStatus.className = 'schema-status unknown';
      elements.schemaIcon.textContent = '🔍';
      elements.schemaText.textContent = 'Nouveau site — Analyse au premier clic';
    } else {
      elements.schemaStatus.className = 'schema-status';
      elements.schemaIcon.textContent = 'ℹ️';
      elements.schemaText.textContent = 'Aucun questionnaire détecté';
      elements.schemaRediscoverBtn.style.display = 'none';
    }
  } catch (e) {
    if (elements.schemaStatus) elements.schemaStatus.style.display = 'none';
  }
}

// Lancer une re-découverte manuelle de schéma
async function rediscoverSchema() {
  if (!elements.schemaRediscoverBtn) return;

  elements.schemaRediscoverBtn.disabled = true;
  elements.schemaRediscoverBtn.textContent = '⏳';
  elements.schemaText.textContent = 'Analyse de la structure...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aucun onglet actif');

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'discoverSchema' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response && response.success) {
      elements.schemaStatus.className = 'schema-status known';
      elements.schemaIcon.textContent = '🧠';
      const d = response.data;
      elements.schemaText.textContent = `Structure apprise (${d.platform})`;
    } else {
      elements.schemaStatus.className = 'schema-status unknown';
      elements.schemaIcon.textContent = '❌';
      elements.schemaText.textContent = response?.error || 'Échec de l\'analyse';
    }
  } catch (e) {
    elements.schemaIcon.textContent = '❌';
    elements.schemaText.textContent = 'Erreur: ' + e.message;
  } finally {
    elements.schemaRediscoverBtn.disabled = false;
    elements.schemaRediscoverBtn.textContent = '🔄';
  }
}