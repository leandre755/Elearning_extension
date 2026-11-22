// ============================================================
// course-media.js — Course Note Media Validation, Sizing & Extraction
// ============================================================

const CourseMedia = (() => {
  'use strict';

  const SUPPORTED_TEXT_EXTENSIONS = new Set([
    'pdf', 'docx', 'txt', 'md', 'markdown', 'html', 'htm', 'csv'
  ]);

  const SUPPORTED_IMAGE_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'webp', 'gif'
  ]);

  const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif'
  ]);

  const SAFE_RASTER_DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

  const LIMITS = Object.freeze({
    MAX_RAW_IMAGE_BYTES: 15 * 1024 * 1024,
    MAX_IMAGE_DIM: 1600,
    PNG_KEEP_MAX_CHARS: 250 * 1024,
    MAX_STORED_IMAGE_BYTES: 700 * 1024,
    TOTAL_CONTEXT_BUDGET_BYTES: Math.floor(4.5 * 1024 * 1024),
    MAX_IMAGE_COUNT: 12
  });

  /**
   * Sniff raster course-note image MIME type from leading magic bytes.
   * Accepts PNG, JPEG, GIF, and WebP only (rejects SVG, BMP, HTML, empty).
   */
  function sniffCourseImageMime(input) {
    if (!input) return null;
    let bytes = null;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else {
      return null;
    }

    if (bytes.length < 4) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }

  /**
   * Extract lowercase extension without leading dot, or empty string if absent.
   */
  function getFileExtension(filename) {
    if (typeof filename !== 'string') return '';
    const trimmed = filename.trim();
    const lastDot = trimmed.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === trimmed.length - 1) return '';
    return trimmed.slice(lastDot + 1).toLowerCase();
  }

  /**
   * Classify a File-like object for Course Notes ingestion.
   * Returns 'rejected_svg' | 'image' | 'text' | 'unsupported'.
   */
  function classifyCourseFile(file) {
    const ext = getFileExtension(file && file.name);
    const mime = typeof (file && file.type) === 'string' ? file.type.trim().toLowerCase() : '';

    if (ext === 'svg' || mime.includes('svg')) {
      return 'rejected_svg';
    }
    if (SUPPORTED_IMAGE_EXTENSIONS.has(ext) || SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
      return 'image';
    }
    if (SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
      return 'text';
    }
    return 'unsupported';
  }

  /**
   * Parse and validate a raster base64 image data URL.
   */
  function parseImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const match = SAFE_RASTER_DATA_URL_RE.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
  }

  function isValidImageDataUrl(dataUrl) {
    return parseImageDataUrl(dataUrl) !== null;
  }

  function isImageContextFile(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.kind !== 'image' && typeof entry.dataUrl !== 'string') return false;
    return isValidImageDataUrl(entry.dataUrl);
  }

  /**
   * Scale dimensions down proportionally to fit inside maxDim without upscaling.
   */
  function computeScaledDimensions(width, height, maxDim = LIMITS.MAX_IMAGE_DIM) {
    if (
      typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
      typeof height !== 'number' || !Number.isFinite(height) || height <= 0
    ) {
      return null;
    }
    const cap = (typeof maxDim === 'number' && Number.isFinite(maxDim) && maxDim > 0)
      ? maxDim
      : LIMITS.MAX_IMAGE_DIM;
    const scale = Math.min(1, cap / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  /**
   * Partition contextFiles into sanitized textFiles and raster imageFiles.
   */
  function extractContextMedia(contextFiles) {
    const textFiles = [];
    const imageFiles = [];
    if (!Array.isArray(contextFiles)) {
      return { textFiles, imageFiles };
    }

    const seenDataUrls = new Set();
    for (const entry of contextFiles) {
      if (!entry || typeof entry !== 'object') continue;

      if (entry.kind === 'image' || typeof entry.dataUrl === 'string') {
        const parsed = parseImageDataUrl(entry.dataUrl);
        if (!parsed || seenDataUrls.has(entry.dataUrl)) continue;
        seenDataUrls.add(entry.dataUrl);
        const safeName = (typeof entry.name === 'string' && entry.name.trim().length > 0)
          ? entry.name.trim()
          : 'image';
        imageFiles.push({
          name: safeName,
          dataUrl: entry.dataUrl,
          mimeType: parsed.mimeType,
          width: (typeof entry.width === 'number' && Number.isFinite(entry.width) && entry.width > 0) ? entry.width : 0,
          height: (typeof entry.height === 'number' && Number.isFinite(entry.height) && entry.height > 0) ? entry.height : 0,
          source: 'course-note'
        });
        continue;
      }

      if (typeof entry.content === 'string' && entry.content.trim().length > 0) {
        textFiles.push(entry);
      }
    }

    return { textFiles, imageFiles };
  }

  /**
   * Merge course-note images first, followed by quiz question images,
   * validating raster dataUrls and deduplicating by dataUrl.
   */
  function mergeRequestImages(contextImages, questionImages) {
    const merged = [];
    const seen = new Set();
    const sources = [
      ...(Array.isArray(contextImages) ? contextImages : []),
      ...(Array.isArray(questionImages) ? questionImages : [])
    ];

    for (const img of sources) {
      if (!img || typeof img !== 'object') continue;
      const parsed = parseImageDataUrl(img.dataUrl);
      if (!parsed || seen.has(img.dataUrl)) continue;
      seen.add(img.dataUrl);
      merged.push({
        ...img,
        mimeType: parsed.mimeType,
        dataUrl: img.dataUrl
      });
    }
    return merged;
  }

  function _measureUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).length;
    }
    const NodeBuffer = typeof globalThis !== 'undefined' ? globalThis.Buffer : undefined;
    if (typeof NodeBuffer === 'function' && typeof NodeBuffer.byteLength === 'function') {
      return NodeBuffer.byteLength(str, 'utf8');
    }
    return str.length * 2;
  }

  function estimateContextFilesBytes(files) {
    const list = Array.isArray(files) ? files : [];
    return _measureUtf8Bytes(JSON.stringify(list));
  }

  function checkContextBudget(existingFiles, candidateEntry) {
    const baseList = Array.isArray(existingFiles) ? existingFiles : [];
    const currentImages = baseList.filter(item => isImageContextFile(item)).length;
    const isCandidateImage = candidateEntry ? isImageContextFile(candidateEntry) : false;
    const nextImageCount = currentImages + (isCandidateImage ? 1 : 0);

    if (isCandidateImage && nextImageCount > LIMITS.MAX_IMAGE_COUNT) {
      return {
        ok: false,
        reason: `Limite atteinte (${LIMITS.MAX_IMAGE_COUNT} images maximum dans les notes de cours).`
      };
    }

    const nextList = candidateEntry ? [...baseList, candidateEntry] : baseList;
    const nextBytes = estimateContextFilesBytes(nextList);

    if (nextBytes > LIMITS.TOTAL_CONTEXT_BUDGET_BYTES) {
      return {
        ok: false,
        reason: 'Espace de notes insuffisant (4,5 Mo max). Supprimez d\'anciens fichiers.'
      };
    }

    return {
      ok: true,
      usedBytes: nextBytes,
      maxBytes: LIMITS.TOTAL_CONTEXT_BUDGET_BYTES,
      imageCount: nextImageCount,
      maxImages: LIMITS.MAX_IMAGE_COUNT
    };
  }

  function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 o';
    if (bytes < 1024) return `${Math.round(bytes)} o`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
    const mb = (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');
    return `${mb} Mo`;
  }

  return {
    SUPPORTED_TEXT_EXTENSIONS,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_IMAGE_MIME_TYPES,
    SAFE_RASTER_DATA_URL_RE,
    LIMITS,
    sniffCourseImageMime,
    getFileExtension,
    classifyCourseFile,
    parseImageDataUrl,
    isValidImageDataUrl,
    isImageContextFile,
    computeScaledDimensions,
    extractContextMedia,
    mergeRequestImages,
    estimateContextFilesBytes,
    checkContextBudget,
    formatFileSize
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.CourseMedia = CourseMedia;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CourseMedia;
}
