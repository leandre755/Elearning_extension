// ============================================================
// schema-cache.js — Persistent SchemaMap Storage per Domain
// ============================================================

const SchemaCache = (() => {
  'use strict';

  const STORAGE_PREFIX = 'schema_';
  const SCHEMA_VERSION = 1;

  /**
   * Normalize a hostname for storage key consistency.
   * Strips 'www.' prefix and lowercases.
   */
  function normalizeHostname(hostname) {
    return hostname.replace(/^www\./, '').toLowerCase();
  }

  /**
   * Build the storage key for a given hostname.
   */
  function storageKey(hostname) {
    return `${STORAGE_PREFIX}${normalizeHostname(hostname)}`;
  }

  /**
   * Retrieve the cached SchemaMap for a hostname.
   * @param {string} hostname - e.g. "moodle.univ-example.fr"
   * @returns {Object|null} The SchemaMap or null if not cached.
   */
  async function getCachedSchema(hostname) {
    try {
      const key = storageKey(hostname);
      const result = await chrome.storage.local.get([key]);
      const entry = result[key];

      if (!entry || !entry.schema) return null;

      // Version check — discard schemas from older versions
      if (entry.version !== SCHEMA_VERSION) {
        console.log(`🗑️ SchemaCache: schéma obsolète (v${entry.version}) pour ${hostname}, suppression...`);
        await chrome.storage.local.remove([key]);
        return null;
      }

      console.log(`✅ SchemaCache: schéma trouvé pour ${hostname} (découvert le ${entry.discoveredAt})`);
      return entry.schema;
    } catch (e) {
      console.warn('⚠️ SchemaCache.get erreur:', e.message);
      return null;
    }
  }

  /**
   * Store a SchemaMap for a hostname permanently.
   * @param {string} hostname
   * @param {Object} schemaMap - The SchemaMap JSON object from LLM.
   */
  async function saveSchema(hostname, schemaMap) {
    try {
      const key = storageKey(hostname);
      const entry = {
        schema: schemaMap,
        discoveredAt: new Date().toISOString(),
        version: SCHEMA_VERSION,
        hostname: normalizeHostname(hostname)
      };

      await chrome.storage.local.set({ [key]: entry });
      console.log(`💾 SchemaCache: schéma sauvegardé pour ${hostname}`);
      return true;
    } catch (e) {
      console.error('❌ SchemaCache.save erreur:', e.message);
      return false;
    }
  }

  /**
   * Remove the cached schema for one specific hostname.
   * @param {string} hostname
   */
  async function clearSchema(hostname) {
    try {
      const key = storageKey(hostname);
      await chrome.storage.local.remove([key]);
      console.log(`🗑️ SchemaCache: schéma supprimé pour ${hostname}`);
      return true;
    } catch (e) {
      console.error('❌ SchemaCache.clear erreur:', e.message);
      return false;
    }
  }

  /**
   * Remove ALL cached schemas.
   */
  async function clearAllSchemas() {
    try {
      const all = await chrome.storage.local.get(null);
      const schemaKeys = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));

      if (schemaKeys.length > 0) {
        await chrome.storage.local.remove(schemaKeys);
        console.log(`🗑️ SchemaCache: ${schemaKeys.length} schéma(s) purgé(s)`);
      }
      return schemaKeys.length;
    } catch (e) {
      console.error('❌ SchemaCache.clearAll erreur:', e.message);
      return 0;
    }
  }

  /**
   * List all cached schemas with their metadata.
   * @returns {Array<{hostname, platform, confidence, discoveredAt}>}
   */
  async function listCachedSchemas() {
    try {
      const all = await chrome.storage.local.get(null);
      const schemas = [];

      for (const [key, entry] of Object.entries(all)) {
        if (!key.startsWith(STORAGE_PREFIX) || !entry.schema) continue;
        schemas.push({
          hostname: entry.hostname || key.replace(STORAGE_PREFIX, ''),
          platform: entry.schema.platform || 'Inconnue',
          confidence: entry.schema.confidence || 0,
          discoveredAt: entry.discoveredAt || 'N/A'
        });
      }

      return schemas;
    } catch (e) {
      console.error('❌ SchemaCache.list erreur:', e.message);
      return [];
    }
  }

  // Public API
  return {
    getCachedSchema,
    saveSchema,
    clearSchema,
    clearAllSchemas,
    listCachedSchemas,
    STORAGE_PREFIX,
    SCHEMA_VERSION
  };
})();

// Export for content script usage
if (typeof window !== 'undefined') {
  window.SchemaCache = SchemaCache;
}
