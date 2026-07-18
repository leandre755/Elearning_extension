// Settings Page Script

// Éléments DOM
const elements = {
  groqApiKey: document.getElementById('groqApiKey'),
  geminiApiKey: document.getElementById('geminiApiKey'),
  nvidiaApiKey: document.getElementById('nvidiaApiKey'),
  mistralApiKey: document.getElementById('mistralApiKey'),
  claudeApiKey: document.getElementById('claudeApiKey'),
  serpApiKey: document.getElementById('serpApiKey'),

  agenticSearch: document.getElementById('agenticSearch'),
  autoMode: document.getElementById('autoMode'),

  captureImages: document.getElementById('captureImages'),
  imageMinSize: document.getElementById('imageMinSize'),
  imageMinSizeDisplay: document.getElementById('imageMinSizeDisplay'),
  imageQuality: document.getElementById('imageQuality'),
  imageQualityDisplay: document.getElementById('imageQualityDisplay'),

  priorityList: document.getElementById('priorityList'),
  modelOverrides: document.getElementById('modelOverrides'),

  contextText: document.getElementById('contextText'),
  fileInput: document.getElementById('fileInput'),
  fileUploadArea: document.getElementById('fileUploadArea'),
  fileList: document.getElementById('fileList'),

  customQuestionSelector: document.getElementById('customQuestionSelector'),
  customAnswerSelector: document.getElementById('customAnswerSelector'),

  highlightColor: document.getElementById('highlightColor'),
  highlightIntensity: document.getElementById('highlightIntensity'),

  schemaList: document.getElementById('schemaList'),
  refreshSchemasBtn: document.getElementById('refreshSchemasBtn'),
  clearAllSchemasBtn: document.getElementById('clearAllSchemasBtn'),

  saveBtn: document.getElementById('saveBtn'),
  resetBtn: document.getElementById('resetBtn'),
  saveStatus: document.getElementById('saveStatus'),

  // Nouveaux éléments
  discretionSlider: document.getElementById('discretionSlider'),
  highlightPreviewElement: document.getElementById('highlightPreviewElement'),
  discretionDescription: document.getElementById('discretionDescription'),
  colorCustomizerRow: document.getElementById('colorCustomizerRow')
};

// État local
let uploadedFiles = [];
let providerOrder = ['groq', 'gemini', 'nvidia', 'mistral', 'claude'];
let customModels = {};

// Descriptions des modes de discrétion
const discretionDescriptions = {
  1: {
    title: '🕵️ Ultra-Furtif (Invisible)',
    desc: 'Aucun contour, pas de clignotement. Seul un changement de fond extrêmement subtil de +4% d\'opacité signale la réponse. Indétectable par les proctors.',
    style: (previewEl, color) => {
      previewEl.style.outline = 'none';
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(77, 168, 218, 0.04)';
      previewEl.style.animation = 'none';
    }
  },
  2: {
    title: '🤫 Furtif (Recommandé)',
    desc: 'Une fine bordure gauche bleu calme de 3px, sans aucune animation ni effet clignotant. Idéal pour un usage discret.',
    style: (previewEl, color) => {
      previewEl.style.outline = 'none';
      previewEl.style.borderLeft = `3px solid ${color}`;
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
      previewEl.style.animation = 'none';
    }
  },
  3: {
    title: '👁️ Visible (Marquage Net)',
    desc: 'Un contour bleu calme complet de 1.5px autour de l\'option de réponse. Pas d\'animation.',
    style: (previewEl, color) => {
      previewEl.style.outline = `1.5px solid ${color}`;
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
      previewEl.style.animation = 'none';
    }
  },
  4: {
    title: '🔥 Glow (Mode Privé)',
    desc: 'Le contour d\'origine pulsant avec l\'ombre portée lumineuse cyan/violette. À utiliser en privé sans surveillance.',
    style: (previewEl, color) => {
      previewEl.style.outline = `3px solid ${color}`;
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = `0 0 15px rgba(77, 168, 218, 0.6), 0 0 30px rgba(77, 168, 218, 0.3)`;
      previewEl.style.backgroundColor = 'rgba(77, 168, 218, 0.1)';
      previewEl.style.animation = 'none';
    }
  }
};

// Traduction discretion int <-> discretion string
const discretionIntToString = {
  1: 'ultra-furtif',
  2: 'furtif',
  3: 'visible',
  4: 'glow'
};

const discretionStringToInt = {
  'ultra-furtif': 1,
  'furtif': 2,
  'visible': 3,
  'glow': 4
};

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  loadSchemas();
});

// Charger les paramètres
async function loadSettings() {
  const syncSettings = await chrome.storage.sync.get([
    'captureImages', 'imageMinSize', 'imageQuality',
    'contextText',
    'customQuestionSelector', 'customAnswerSelector',
    'highlightColor', 'highlightIntensity',
    'providerOrder', 'customModels', 'agenticSearch', 'autoMode',
    'highlightDiscretion'
  ]);

  // S1 — API keys are stored in local storage
  const localSettings = await chrome.storage.local.get([
    'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
    'mistralApiKey', 'claudeApiKey',
    'serpApiKey', 'contextFiles'
  ]);

  // Appliquer les valeurs (Clés API — local storage)
  elements.groqApiKey.value = localSettings.groqApiKey || '';
  elements.geminiApiKey.value = localSettings.geminiApiKey || '';
  elements.nvidiaApiKey.value = localSettings.nvidiaApiKey || '';
  elements.mistralApiKey.value = localSettings.mistralApiKey || '';
  elements.claudeApiKey.value = localSettings.claudeApiKey || '';
  if (elements.serpApiKey) elements.serpApiKey.value = localSettings.serpApiKey || '';

  // Mettre à jour les badges et accordéons
  updateApiKeyBadges();

  // Options
  if (elements.agenticSearch) elements.agenticSearch.checked = syncSettings.agenticSearch === true;
  if (elements.autoMode) elements.autoMode.checked = syncSettings.autoMode === true;

  // Image Capture Settings
  elements.captureImages.checked = syncSettings.captureImages !== false;
  elements.imageMinSize.value = syncSettings.imageMinSize || 50;
  elements.imageMinSizeDisplay.textContent = `${elements.imageMinSize.value} px`;

  elements.imageQuality.value = syncSettings.imageQuality || 0.8;
  elements.imageQualityDisplay.textContent = elements.imageQuality.value;

  // Order & Models
  if (syncSettings.providerOrder) providerOrder = syncSettings.providerOrder;
  if (syncSettings.customModels) customModels = syncSettings.customModels;

  renderPriorityList();
  renderModelOverrides();

  // Context & UI Settings
  elements.contextText.value = syncSettings.contextText || '';
  elements.customQuestionSelector.value = syncSettings.customQuestionSelector || '';
  elements.customAnswerSelector.value = syncSettings.customAnswerSelector || '';
  elements.highlightColor.value = syncSettings.highlightColor || '#4DA8DA';
  elements.highlightIntensity.value = syncSettings.highlightIntensity || 0.4;

  // Appliquer le slider de discrétion
  const discretionStr = syncSettings.highlightDiscretion || 'furtif';
  const discretionInt = discretionStringToInt[discretionStr] || 2;
  elements.discretionSlider.value = discretionInt;
  updateDiscretionUI();

  if (localSettings.contextFiles) {
    uploadedFiles = localSettings.contextFiles;
    renderFileList();
  }
}

// Rendre la liste de priorité
function renderPriorityList() {
  elements.priorityList.innerHTML = '';
  providerOrder.forEach((id) => {
    const provider = window.QuizProviders.PROVIDERS[id.toLowerCase()];
    if (!provider) return;

    const item = document.createElement('div');
    item.className = 'priority-item';
    item.draggable = true;
    item.dataset.id = id;
    item.innerHTML = `
      <span class="handle">☰</span>
      <div class="provider-info">
        <span>${provider.name}</span>
      </div>
    `;

    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);

    elements.priorityList.appendChild(item);
  });
}

// Rendre les overrides de modèles
function renderModelOverrides() {
  elements.modelOverrides.innerHTML = '';
  Object.keys(window.QuizProviders.PROVIDERS).forEach(key => {
    const p = window.QuizProviders.PROVIDERS[key];
    const id = key.toLowerCase();

    const div = document.createElement('div');
    div.className = 'model-override-card';
    div.style.borderLeftColor = p.color || '#444';
    div.innerHTML = `
      <h3>${p.name}</h3>
      <div class="model-inputs-row">
        <div class="input-group">
          <label>Modèle Texte</label>
          <input type="text" placeholder="Default: ${p.defaultTextModel}" 
                 value="${customModels[id]?.text || ''}" data-provider="${id}" data-type="text" class="model-input">
        </div>
        <div class="input-group">
          <label>Modèle Vision</label>
          <input type="text" placeholder="Default: ${p.defaultVisionModel}" 
                 value="${customModels[id]?.vision || ''}" data-provider="${id}" data-type="vision" class="model-input">
        </div>
      </div>
    `;
    elements.modelOverrides.appendChild(div);
  });
}

// Drag & Drop Handlers
let dragSrcEl = null;

function handleDragStart(e) {
  this.classList.add('dragging');
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  if (dragSrcEl !== this) {
    const allItems = [...elements.priorityList.querySelectorAll('.priority-item')];
    const fromIndex = allItems.indexOf(dragSrcEl);
    const toIndex = allItems.indexOf(this);

    // Update array
    providerOrder.splice(toIndex, 0, providerOrder.splice(fromIndex, 1)[0]);
    renderPriorityList();
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove('dragging');
}

// Mettre à jour le statut des accordéons
function updateApiKeyBadges() {
  const providers = ['groq', 'gemini', 'claude', 'mistral', 'nvidia'];
  providers.forEach(p => {
    const input = document.getElementById(`${p}ApiKey`);
    const badge = document.getElementById(`${p}StatusBadge`);
    const card = document.getElementById(`card-${p}`);
    if (input && badge) {
      const hasKey = input.value.trim().length > 0;
      if (hasKey) {
        badge.textContent = 'Configurée ✅';
        badge.className = 'key-status-badge badge-connected';
        if (card && !card.hasAttribute('open')) {
          card.removeAttribute('open');
        }
      } else {
        badge.textContent = 'Non configurée';
        badge.className = 'key-status-badge badge-empty';
        if (card) {
          card.setAttribute('open', '');
        }
      }
    }
  });
}

// Gérer la mise à jour visuelle du curseur de discrétion
function updateDiscretionUI() {
  const value = parseInt(elements.discretionSlider.value);
  const color = elements.highlightColor.value;
  const previewEl = elements.highlightPreviewElement;
  const descEl = elements.discretionDescription;
  const colorRow = elements.colorCustomizerRow;

  // Mettre à jour l'état actif des étiquettes textuelles
  document.querySelectorAll('.step-label').forEach(label => {
    const val = parseInt(label.dataset.value);
    if (val === value) {
      label.classList.add('active');
    } else {
      label.classList.remove('active');
    }
  });

  const level = discretionDescriptions[value];
  if (level && previewEl && descEl) {
    descEl.innerHTML = `<strong>${level.title}</strong> — ${level.desc}`;
    level.style(previewEl, color);
  }

  // Cacher/Afficher le personnalisateur de couleur
  if (colorRow) {
    if (value === 3 || value === 4) {
      colorRow.style.opacity = '1';
      colorRow.style.pointerEvents = 'auto';
    } else {
      colorRow.style.opacity = '0.4';
      colorRow.style.pointerEvents = 'none';
    }
  }
}

// Configurer les écouteurs
function setupEventListeners() {
  // Navigation par Onglets
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const targetId = btn.getAttribute('aria-controls');
      const contentEl = document.getElementById(targetId);
      if (contentEl) {
        contentEl.classList.add('active');
      }
    });
  });

  // Toggles de visibilité de clé API
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🔒';
    });
  });

  // Liaison dynamique des clés d'API aux badges
  ['groq', 'gemini', 'claude', 'mistral', 'nvidia'].forEach(p => {
    const input = document.getElementById(`${p}ApiKey`);
    if (input) {
      input.addEventListener('input', updateApiKeyBadges);
    }
  });

  // Test API Buttons
  document.querySelectorAll('.test-btn').forEach(btn => {
    btn.addEventListener('click', () => testProvider(btn.dataset.provider, btn));
  });

  // Discretion Slider
  elements.discretionSlider.addEventListener('input', updateDiscretionUI);

  // Étiquettes de discrétion cliquables
  document.querySelectorAll('.step-label').forEach(label => {
    label.addEventListener('click', () => {
      elements.discretionSlider.value = label.dataset.value;
      updateDiscretionUI();
    });
  });

  // Couleur et Intensité de surlignage
  elements.highlightColor.addEventListener('input', updateDiscretionUI);
  elements.highlightIntensity.addEventListener('input', updateDiscretionUI);

  // Sliders de taille et qualité image
  elements.imageMinSize.addEventListener('input', (e) => {
    elements.imageMinSizeDisplay.textContent = `${e.target.value} px`;
  });
  elements.imageQuality.addEventListener('input', (e) => {
    elements.imageQualityDisplay.textContent = e.target.value;
  });

  elements.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  elements.saveBtn.addEventListener('click', saveSettings);
  elements.resetBtn.addEventListener('click', resetSettings);

  // Gestion du cache des schémas
  if (elements.refreshSchemasBtn) {
    elements.refreshSchemasBtn.addEventListener('click', loadSchemas);
  }
  if (elements.clearAllSchemasBtn) {
    elements.clearAllSchemasBtn.addEventListener('click', handleClearAllSchemas);
  }
}

// Tester un fournisseur
async function testProvider(id, btn) {
  const originalText = btn.textContent;
  btn.textContent = '⌛...';
  btn.disabled = true;

  const apiKeyInput = document.getElementById(`${id}ApiKey`);
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(`Veuillez entrer une clé pour ${id}`, 'error');
    btn.textContent = originalText;
    btn.disabled = false;
    return;
  }

  try {
    const providerKey = id.toLowerCase();
    const provider = window.QuizProviders.PROVIDERS[providerKey];
    const model = customModels[providerKey]?.text || provider.defaultTextModel;

    const response = await window.QuizProviders.callProvider(
      providerKey,
      apiKey,
      model,
      "Hello, respond with 'OK' if you see this.",
      []
    );

    if (response) {
      showStatus(`✅ Test ${id} réussi!`, 'success');
      btn.style.borderColor = '#6BCB77';

      // DET-01 : Lancement de la synchronisation des modèles en arrière-plan
      console.log(`🔄 Lancement de la synchronisation des modèles pour ${providerKey}...`);
      window.ModelRegistry.syncProviderModels(providerKey, apiKey)
        .then(() => {
          console.log(`✅ Synchronisation des modèles complétée pour ${providerKey}`);
        })
        .catch(syncErr => {
          console.warn(`⚠️ Échec de la synchronisation des modèles après test réussi pour ${providerKey}:`, syncErr);
        });
    } else {
      throw new Error('Réponse vide');
    }
  } catch (err) {
    showStatus(`❌ Test ${id} échoué: ${err.message}`, 'error');
    btn.style.borderColor = '#E85D75';
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Traiter les fichiers
async function handleFiles(files) {
  for (const file of files) {
    try {
      const content = await readFileContent(file);
      if (content && content.trim().length > 0) {
        uploadedFiles.push({
          name: file.name,
          content: content,
          size: file.size,
          type: file.type
        });
        showStatus(`✅ Fichier ajouté : ${file.name}`, 'success');
      } else {
        showStatus(`⚠️ Fichier vide ou illisible : ${file.name}`, 'error');
      }
    } catch (error) {
      console.error(`Erreur lecture ${file.name}:`, error);
      showStatus(`❌ Erreur lecture : ${file.name}`, 'error');
    }
  }
  renderFileList();
}

async function readFileContent(file) {
  const extension = file.name.split('.').pop().toLowerCase();

  if (extension === 'pdf') {
    return await extractTextFromPDF(file);
  } else if (extension === 'docx') {
    return await extractTextFromDOCX(file);
  } else {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
}

// Extraction PDF via PDF.js
async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();

    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Bibliothèque PDF.js non chargée');
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  } catch (error) {
    console.error('Erreur PDF.js:', error);
    throw error;
  }
}

// Extraction DOCX via Mammoth.js
async function extractTextFromDOCX(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();

    if (typeof mammoth === 'undefined') {
      throw new Error('Bibliothèque Mammoth.js non chargée');
    }

    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
  } catch (error) {
    console.error('Erreur Mammoth.js:', error);
    throw error;
  }
}

function renderFileList() {
  elements.fileList.innerHTML = '';
  uploadedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-name">📄 ${file.name}</span>
      <button class="remove-file" data-index="${index}">✕</button>
    `;
    elements.fileList.appendChild(item);
  });
  document.querySelectorAll('.remove-file').forEach(btn => {
    btn.addEventListener('click', () => {
      uploadedFiles.splice(parseInt(btn.dataset.index), 1);
      renderFileList();
    });
  });
}

// Sauvegarder les paramètres
async function saveSettings() {
  const models = {};
  document.querySelectorAll('.model-input').forEach(input => {
    const p = input.dataset.provider;
    const t = input.dataset.type;
    if (!models[p]) models[p] = {};
    models[p][t] = input.value.trim();
  });

  const discretionVal = parseInt(elements.discretionSlider.value);
  const discretionStr = discretionIntToString[discretionVal] || 'furtif';

  try {
    // S1 — Save API keys + context files to local storage (sécurité)
    await chrome.storage.local.set({
      groqApiKey: elements.groqApiKey.value.trim(),
      geminiApiKey: elements.geminiApiKey.value.trim(),
      nvidiaApiKey: elements.nvidiaApiKey.value.trim(),
      mistralApiKey: elements.mistralApiKey.value.trim(),
      claudeApiKey: elements.claudeApiKey.value.trim(),
      serpApiKey: elements.serpApiKey ? elements.serpApiKey.value.trim() : '',
      contextFiles: uploadedFiles
    });

    // Save non-sensitive UI settings to sync
    await chrome.storage.sync.set({
      captureImages: elements.captureImages.checked,
      imageMinSize: parseInt(elements.imageMinSize.value),
      imageQuality: parseFloat(elements.imageQuality.value),
      providerOrder: providerOrder,
      customModels: models,
      agenticSearch: elements.agenticSearch ? elements.agenticSearch.checked : false,
      autoMode: elements.autoMode ? elements.autoMode.checked : false,
      contextText: elements.contextText.value,
      customQuestionSelector: elements.customQuestionSelector.value,
      customAnswerSelector: elements.customAnswerSelector.value,
      highlightColor: elements.highlightColor.value,
      highlightIntensity: parseFloat(elements.highlightIntensity.value),
      highlightDiscretion: discretionStr
    });

    showStatus('✅ Paramètres sauvegardés!', 'success');
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    showStatus('❌ Erreur de sauvegarde', 'error');
  }
}

async function resetSettings() {
  if (confirm('Réinitialiser tout?')) {
    await chrome.storage.sync.clear();
    location.reload();
  }
}

function showStatus(message, type) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = `save-status ${type}`;
  setTimeout(() => elements.saveStatus.textContent = '', 4000);
}

// Gestion du Cache des Schémas
async function loadSchemas() {
  if (!elements.schemaList) return;
  if (typeof SchemaCache === 'undefined') {
    elements.schemaList.innerHTML = '<p class="help-text">SchemaCache non disponible</p>';
    return;
  }

  try {
    const schemas = await SchemaCache.listCachedSchemas();
    renderSchemaList(schemas);
  } catch (e) {
    elements.schemaList.innerHTML = '<p class="help-text">Erreur de chargement</p>';
  }
}

function renderSchemaList(schemas) {
  if (!elements.schemaList) return;
  elements.schemaList.innerHTML = '';

  if (schemas.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'help-text';
    empty.textContent = 'Aucun schéma en cache. Les schémas sont créés automatiquement.';
    elements.schemaList.appendChild(empty);
    return;
  }

  schemas.forEach(schema => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

    const info = document.createElement('div');
    const confidence = schema.confidence ? ` (${Math.round(schema.confidence * 100)}%)` : '';
    const date = schema.discoveredAt !== 'N/A'
      ? new Date(schema.discoveredAt).toLocaleDateString('fr-FR')
      : '';

    const hostSpan = document.createElement('span');
    hostSpan.className = 'file-name';
    hostSpan.textContent = `🌐 ${schema.hostname}`;
    info.appendChild(hostSpan);

    const detailSpan = document.createElement('span');
    detailSpan.style.fontSize = '0.8em';
    detailSpan.style.opacity = '0.7';
    detailSpan.style.display = 'block';
    detailSpan.textContent = `${schema.platform}${confidence}${date ? ' — ' + date : ''}`;
    info.appendChild(detailSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'remove-file';
    deleteBtn.textContent = '✕';
    deleteBtn.dataset.hostname = schema.hostname;
    deleteBtn.addEventListener('click', () => handleDeleteSchema(schema.hostname));

    item.appendChild(info);
    item.appendChild(deleteBtn);
    elements.schemaList.appendChild(item);
  });
}

async function handleDeleteSchema(hostname) {
  if (typeof SchemaCache === 'undefined') return;
  await SchemaCache.clearSchema(hostname);
  showStatus(`🗑️ Schéma supprimé pour ${hostname}`, 'success');
  loadSchemas();
}

async function handleClearAllSchemas() {
  if (typeof SchemaCache === 'undefined') return;
  if (!confirm('Supprimer tous les schémas en cache ?')) return;
  const count = await SchemaCache.clearAllSchemas();
  showStatus(`🗑️ ${count} schéma(s) purgé(s)`, 'success');
  loadSchemas();
}