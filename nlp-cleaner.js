// ============================================================
// nlp-cleaner.js — Client-Side NLP Cleaning & Multi-Format Parsing
// ============================================================

const NLPCleaner = (() => {
  'use strict';

  const PROTECTED_SHORT_TOKENS = new Set([
    'vrai', 'faux', 'true', 'false', 'oui', 'non', 'yes', 'no',
    'none', 'all', 'n/a', 'a', 'b', 'c', 'd', 'e', 'f'
  ]);

  const COMPOUND_JOINING_PARTICLES = new Set([
    'to', 'of', 'the', 'in', 'on', 'by', 'at', 'and', 'or',
    'de', 'du', 'des', 'la', 'le', 'les', 'en', 'à', 'au', 'aux', 'et', 'ou'
  ]);

  const COMPOUND_EXACT_PAIRS = new Set([
    'well-known', 'well-being', 'self-esteem', 'self-contained',
    'self-taught', 'self-driving', 'self-attention', 'real-time',
    'open-source', 'long-term', 'short-term', 'high-level', 'low-level',
    'full-stack', 'client-side', 'server-side', 'read-only', 'built-in',
    'up-to-date', 'end-to-end', 'sous-ensemble', 'sous-jacent',
    'sous-jacente', 'sous-jacents', 'sous-jacentes', 'arrière-plan',
    'avant-propos', 'compte-rendu', 'savoir-faire', "chef-d'œuvre",
    'porte-parole', 'mot-clé', 'mots-clés', 'état-major', 'non-nul',
    'non-nulle', 'non-vide', 'co-occurrence', 'e-commerce', 'e-learning',
    'peut-être', 'bien-être', 'mal-être', 'mieux-être', 'savoir-être',
    'celui-ci', 'celle-ci', 'ceux-ci', 'celles-ci',
    'celui-là', 'celle-là', 'ceux-là', 'celles-là', 'au-dessus',
    'au-dessous', 'par-dessus', 'vis-à-vis', "c'est-à-dire",
    'quatre-vingts', 'quatre-vingt', 'vingt-deux', 'vingt-trois',
    'vingt-quatre', 'vingt-cinq', 'vingt-six', 'vingt-sept',
    'vingt-huit', 'vingt-neuf', 'dix-sept', 'dix-huit', 'dix-neuf'
  ]);

  const UNAMBIGUOUS_FRENCH_CLITICS = new Set([
    'là', 'moi', 'toi', 'nous', 'vous', 'même', 'mêmes'
  ]);

  const CONTEXTUAL_FRENCH_CLITICS = new Set([
    'ci', 'il', 'ils', 'elle', 'elles', 'lui', 'eux', 'en', 'y', 'on', 'être', 'uns', 'unes'
  ]);

  const CONTEXTUAL_CLITIC_STEMS = new Set([
    'a-t', 'va-t', 'y-a-t', 'est', 'sont', 'était', 'étaient', 'sera', 'serait',
    'dit', 'disent', 'fait', 'font', 'faut', 'peut', 'peuvent', 'doit', 'doivent',
    'voit', 'voient', 'veut', 'veulent', 'sait', 'savent', 'vient', 'viennent',
    'tient', 'prend', 'donne', 'donnez', 'dis', 'parle', 'parlez', 'vas', 'allez',
    'allons', 'parles', 'parlons', 'penses', 'pensez', 'chez', 'entre',
    'pour', 'avec', 'sans', 'par', 'celui', 'celle', 'ceux', 'celles', 'quelques',
    'les', 'aux', 'des'
  ]);

  const ENGLISH_TENS = new Set([
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'
  ]);

  const ENGLISH_UNITS = new Set([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'
  ]);

  /**
   * Normalize line endings, Unicode compatibility forms (NFKC), soft hyphens,
   * and invisible/non-printable control characters.
   */
  function normalizeTypography(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) return '';

    const preserveFormFeed = options && options.preserveFormFeed === true;

    let out = text
      .replace(/\r\n?/g, '\n')
      .replace(/[\u2028\u2029]/g, '\n')
      .normalize('NFKC');

    // Join soft-hyphenated line breaks and remove stray soft hyphens
    out = out
      .replace(/\u00AD[ \t]*\n[ \t]*/g, '')
      .replace(/\u00AD/g, '');

    // Remove zero-width / BOM / word-joiner characters
    out = out.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');

    // Strip non-printable ASCII control characters (preserve \t, \n, and optionally \f)
    if (preserveFormFeed) {
      out = out.replace(/[\x00-\x08\x0B\x0E-\x1F\x7F]/g, '');
    } else {
      out = out.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
    }

    return out;
  }

  function _buildCorpusTokenSets(text) {
    const lower = text.toLowerCase();
    const hyphenatedTokens = new Set();
    const solidTokens = new Set();

    // Single greedy O(N) maximal-token pass (never backtracks on long unbroken words)
    const tokenRe = /[\p{L}\p{N}'’]+(?:-[\p{L}\p{N}'’]+)*/gu;
    let m;
    while ((m = tokenRe.exec(lower)) !== null) {
      const tok = m[0].replace(/’/g, "'");
      if (tok.includes('-')) {
        hyphenatedTokens.add(tok);
        const parts = tok.split('-');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].length > 0) solidTokens.add(parts[i]);
        }
      } else {
        solidTokens.add(tok);
      }
    }

    return { hyphenatedTokens, solidTokens };
  }

  function _shouldPreserveHyphen(left, right, corpusSets, rightFollowedByHyphenBreak, leftPrecededByHyphenBreak) {
    const leftLower = left.toLowerCase().replace(/’/g, "'");
    const rightLower = right.toLowerCase().replace(/’/g, "'");

    // Digits on either side (e.g. UTF-8, 3-day, 2020-2025)
    if (/\d$/.test(left) || /^\d/.test(right)) {
      return true;
    }

    // Single-letter prefix (e.g. e-learning, t-shirt, x-ray)
    if (left.length === 1) {
      return true;
    }

    // Proper-noun / mixed-case boundary (e.g. Jean-Pierre), unless both sides are ALL-CAPS
    const leftAllCaps = left.length >= 2 && /^[\p{Lu}\d'’]+$/u.test(left) && /\p{Lu}/u.test(left);
    const rightAllCaps = right.length >= 2 && /^[\p{Lu}\d]+$/u.test(right) && /\p{Lu}/u.test(right);
    if (/^\p{Lu}/u.test(right) && !(leftAllCaps && rightAllCaps)) {
      return true;
    }

    // Internal hyphenated particle on either side (e.g. up-to-date, state-of-the-art, vis-à-vis, au-fur-et-à-mesure)
    if (left.includes('-')) {
      const lastSeg = leftLower.split('-').pop();
      if (COMPOUND_JOINING_PARTICLES.has(lastSeg)) {
        return true;
      }
    }
    if (right.includes('-')) {
      const firstSeg = rightLower.split('-')[0];
      if (COMPOUND_JOINING_PARTICLES.has(firstSeg)) {
        return true;
      }
    }
    if (rightFollowedByHyphenBreak && (COMPOUND_JOINING_PARTICLES.has(rightLower) || COMPOUND_JOINING_PARTICLES.has(leftLower))) {
      return true;
    }
    if (leftPrecededByHyphenBreak && COMPOUND_JOINING_PARTICLES.has(leftLower)) {
      return true;
    }

    // Exact known compound pair
    const hyphenated = `${leftLower}-${rightLower}`;
    if (COMPOUND_EXACT_PAIRS.has(hyphenated)) {
      return true;
    }

    // English compound numbers (twenty-one, forty-two)
    if (ENGLISH_TENS.has(leftLower) && ENGLISH_UNITS.has(rightLower)) {
      return true;
    }

    // Exact O(1) corpus evidence BEFORE heuristic clitic suffixes:
    // if hyphenated form appears intact elsewhere in the text, keep hyphen;
    // if solid joined form appears intact elsewhere, definitely de-hyphenate.
    if (corpusSets && corpusSets.hyphenatedTokens.has(hyphenated)) {
      return true;
    }
    const joined = `${leftLower}${rightLower}`;
    if (corpusSets && corpusSets.solidTokens.has(joined)) {
      return false;
    }

    // Unambiguous French clitics (e.g. peut-être, lui-même, celui-là)
    if (UNAMBIGUOUS_FRENCH_CLITICS.has(rightLower) && leftLower.length >= 2) {
      return true;
    }

    // Contextual pronoun/clitic suffixes (only on plausible French stems or -t inversion)
    if (
      CONTEXTUAL_FRENCH_CLITICS.has(rightLower) &&
      (CONTEXTUAL_CLITIC_STEMS.has(leftLower) || /-t$/.test(leftLower))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Rejoin line-broken hyphenated words (e.g. `algo-\nrithme` -> `algorithme`),
   * while preserving legitimate compound words when unambiguous.
   */
  function dehyphenate(text) {
    if (typeof text !== 'string' || text.length === 0) return '';

    let current = text.replace(/\r\n?/g, '\n');
    const corpusSets = _buildCorpusTokenSets(current);

    // Match word ending with a single hyphen at EOL followed by next-line word token
    // (disjoint prefix class including apostrophes guarantees O(N) without backtracking).
    const pattern = /(^|[^\p{L}\p{N}'’-])([\p{L}\p{N}'’]+(?:-[\p{L}\p{N}'’]+)*)-[ \t]*\n[ \t]*([\p{L}\p{N}'’]+(?:-[\p{L}\p{N}'’]+)*)/gu;

    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      const next = current.replace(pattern, (full, prefix, left, right, offset, source) => {
        // Guard against numbered list item starting on the next line (e.g. "foo-\n1. Bar")
        const afterEnd = source.slice(offset + full.length, offset + full.length + 6);
        if (/^\d+$/.test(right) && /^[.)]\s/.test(afterEnd)) {
          return full;
        }

        // Require at least one letter on one side (skip pure punctuation/dashes)
        if (!/\p{L}/u.test(left) && !/\p{L}/u.test(right)) {
          return full;
        }

        const rightFollowedByHyphenBreak = /^-[ \t]*\n/.test(afterEnd);
        let leftPrecededByHyphenBreak = false;
        if (prefix === '\n' || prefix === ' ' || prefix === '\t') {
          const beforeSlice = source.slice(Math.max(0, offset - 8), offset + prefix.length);
          leftPrecededByHyphenBreak = /-[ \t]*\n[ \t]*$/.test(beforeSlice);
        }

        changed = true;
        if (_shouldPreserveHyphen(left, right, corpusSets, rightFollowedByHyphenBreak, leftPrecededByHyphenBreak)) {
          return `${prefix}${left}-${right}`;
        }
        return `${prefix}${left}${right}`;
      });
      current = next;
      if (!changed) break;
    }

    return current;
  }

  function _makeHeaderSignature(trimmed, isBoundary = false, expectedTotalPages = null) {
    if (!trimmed || trimmed.length > 140) return null;
    // Standalone bare fractions (e.g. 1/2, 3/4) are handled by strict edge page-number check,
    // never normalized into a generic '__PAGE__' repeated-footer bucket.
    if (/^\d{1,4}\s*\/\s*\d{1,4}$/.test(trimmed)) return null;

    let sig = trimmed.replace(/[ \t]+/g, ' ');
    if (isBoundary) {
      sig = sig
        .replace(/\b(?:page|p\.)\s*\d+(?:\s*(?:\/|sur|of)\s*\d+)?\b/gi, '__PAGE__')
        .replace(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g, (full, a, b, offset, str) => {
          const cur = parseInt(a, 10);
          const total = parseInt(b, 10);
          if (cur < 1 || total < cur) return full;
          if (typeof expectedTotalPages === 'number' && total !== expectedTotalPages) return full;
          // Do not treat labeled values like "Probabilité : 1/3" as page numbers
          if (/:\s*$/.test(str.slice(0, offset))) return full;
          return '__PAGE__';
        })
        .replace(/\s[-–—|]\s+(\d{1,4})\s*$/g, (full, num, offset, str) => {
          const n = parseInt(num, 10);
          if (n < 1) return full;
          if (typeof expectedTotalPages === 'number' && n > expectedTotalPages) return full;
          if (/[=:<>*+/]\s*$/.test(str.slice(0, offset))) return full;
          return ' __PAGE__';
        })
        .replace(/^\s*(\d{1,4})\s*[-–—|]\s+/g, (full, num) => {
          const n = parseInt(num, 10);
          if (n < 1) return full;
          if (typeof expectedTotalPages === 'number' && n > expectedTotalPages) return full;
          return '__PAGE__ ';
        });
    } else {
      // Non-boundary lines require an explicit header/footer delimiter (-, –, —, /, ,)
      // excluding '|' so serialized table rows ("Page 1 | Valide") are never stripped.
      sig = sig
        .replace(/[-–—/,]\s*(?:page|p\.)\s*\d+(?:\s*(?:\/|sur|of)\s*\d+)?\s*$/gi, ' __PAGE__')
        .replace(/^(?:page|p\.)\s*\d+(?:\s*(?:\/|sur|of)\s*\d+)?\s*[-–—/,]/gi, '__PAGE__ ');
    }

    return sig.trim() || null;
  }

  function _hasExplicitHeaderSignal(trimmed, sig) {
    if (sig && sig.includes('__PAGE__')) return true;
    if (/(?:©|all rights reserved|tous droits réservés)/i.test(trimmed)) return true;
    // Require explicit footer/header markers (4-digit year or dash delimiters, never tabular ' | ')
    // so quiz options & table rows like "Copyright Law" or "Droit applicable | Copyright" are never stripped.
    if (/\bcopyright\b/i.test(trimmed) && (/\b\d{4}\b/.test(trimmed) || /[-–—]/.test(trimmed))) {
      return true;
    }
    if (/\b(?:confidentiel|confidential)\b/i.test(trimmed) && /[-–—]/.test(trimmed)) {
      return true;
    }
    return false;
  }

  function _isProtectedContentLine(trimmed) {
    if (!trimmed) return true;
    // Do not treat line-broken hyphenated prose words as headers/footers
    if (/[\p{L}]-$/u.test(trimmed)) return true;

    // Structural content lines are ALWAYS protected (even if they contain fractions/numbers)
    if (/^(?:[-*•+]|\d{1,3}[.)]|\d{1,3}\s+[-–—]|[a-zA-Z][.)])\s+/.test(trimmed)) return true;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^(?:question|q\d+|exercice|exercise|chapitre|chapter|section|partie|part|théorème|theorem|définition|definition|exemple|example|remarque|note)\b/i.test(trimmed)) {
      return true;
    }
    if (PROTECTED_SHORT_TOKENS.has(trimmed.toLowerCase())) return true;
    if (/^(?:[{}\[\]();]+|---+|\*\*\*+|===+)$/.test(trimmed)) return true;
    if (/^\|/.test(trimmed)) return true;

    return false;
  }

  function _isBoundaryFractionPageNumber(trimmed, expectedTotalPages) {
    const m = /^(\d{1,4})\s*\/\s*(\d{1,4})$/.exec(trimmed);
    if (!m) return false;
    const cur = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    if (cur < 1 || total < cur) return false;
    if (typeof expectedTotalPages === 'number' && total !== expectedTotalPages) return false;
    return true;
  }

  function _isStandalonePageNumberLine(trimmed) {
    if (!trimmed) return false;
    if (/^(?:page|p\.)\s*\d{1,4}(?:\s*(?:\/|sur|of)\s*\d{1,4})?$/i.test(trimmed)) return true;
    if (/^(?:page|p\.)\s+[ivxlcdm]{1,6}$/i.test(trimmed)) return true;
    if (/^[-–—]\s*\d{1,4}\s*[-–—]$/.test(trimmed)) return true;
    if (/^\[\s*(?:page\s*)?\d{1,4}\s*\]$/i.test(trimmed)) return true;
    return false;
  }

  function _stripHeadersAndFootersInternal(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
      return { text: '', removedLines: 0 };
    }

    const opts = options && typeof options === 'object' ? options : {};
    const minRepeats = Number.isInteger(opts.minHeaderRepeats) && opts.minHeaderRepeats >= 2
      ? opts.minHeaderRepeats
      : 3;

    let removedLines = 0;
    let working = text;
    let processedFormFeedPages = false;

    // Pass 1: Form-feed (\f) page-boundary header/footer detection
    if (working.includes('\f')) {
      const pages = working.split('\f');
      if (pages.length >= minRepeats) {
        processedFormFeedPages = true;
        const pageLinesList = pages.map(p => p.split('\n'));
        const topCounts = new Map();
        const bottomCounts = new Map();

        for (const pLines of pageLinesList) {
          const nonEmptyIndices = [];
          for (let i = 0; i < pLines.length; i++) {
            if (pLines[i].trim().length > 0) nonEmptyIndices.push(i);
          }

          const win = Math.min(3, Math.floor(nonEmptyIndices.length / 3));
          if (win === 0) continue;

          const topSeen = new Set();
          for (const idx of nonEmptyIndices.slice(0, win)) {
            const trimmed = pLines[idx].trim();
            const sig = _makeHeaderSignature(trimmed, true, pages.length);
            if (sig && !_isProtectedContentLine(trimmed, sig) && !topSeen.has(sig)) {
              topSeen.add(sig);
              topCounts.set(sig, (topCounts.get(sig) || 0) + 1);
            }
          }

          const bottomSeen = new Set();
          for (const idx of nonEmptyIndices.slice(-win)) {
            const trimmed = pLines[idx].trim();
            const sig = _makeHeaderSignature(trimmed, true, pages.length);
            if (sig && !_isProtectedContentLine(trimmed, sig) && !bottomSeen.has(sig)) {
              bottomSeen.add(sig);
              bottomCounts.set(sig, (bottomCounts.get(sig) || 0) + 1);
            }
          }
        }

        const topHeaders = new Set(
          [...topCounts.entries()].filter(([, c]) => c >= minRepeats).map(([s]) => s)
        );
        const bottomFooters = new Set(
          [...bottomCounts.entries()].filter(([, c]) => c >= minRepeats).map(([s]) => s)
        );

        // Pre-check whether bare edge integers recur monotonically across >= minRepeats pages
        // at the same edge (top or bottom), so isolated numeric quiz answers are never stripped.
        const topBareNums = [];
        const bottomBareNums = [];
        for (let pIdx = 0; pIdx < pageLinesList.length; pIdx++) {
          const pLines = pageLinesList[pIdx];
          const nonEmptyIndices = [];
          for (let i = 0; i < pLines.length; i++) {
            if (pLines[i].trim().length > 0) nonEmptyIndices.push(i);
          }
          if (nonEmptyIndices.length < 3) continue;
          const win = Math.min(3, Math.floor(nonEmptyIndices.length / 3));
          const topIdxSet = new Set(win > 0 ? nonEmptyIndices.slice(0, win) : []);
          const bottomIdxSet = new Set(win > 0 ? nonEmptyIndices.slice(-win) : []);
          const firstIdx = nonEmptyIndices[0];
          const secondIdx = nonEmptyIndices[1];
          const lastIdx = nonEmptyIndices[nonEmptyIndices.length - 1];
          const penultIdx = nonEmptyIndices[nonEmptyIndices.length - 2];
          const firstSig = _makeHeaderSignature(pLines[firstIdx].trim(), true, pages.length);
          const lastSig = _makeHeaderSignature(pLines[lastIdx].trim(), true, pages.length);
          const firstStripped = topIdxSet.has(firstIdx) && firstSig && topHeaders.has(firstSig);
          const lastStripped = bottomIdxSet.has(lastIdx) && lastSig && bottomFooters.has(lastSig);

          const topEdgeIdx = firstStripped ? secondIdx : firstIdx;
          const bottomEdgeIdx = lastStripped ? penultIdx : lastIdx;
          const topVal = topEdgeIdx !== undefined ? pLines[topEdgeIdx].trim() : '';
          const bottomVal = bottomEdgeIdx !== undefined ? pLines[bottomEdgeIdx].trim() : '';

          if (/^\d{1,4}$/.test(topVal)) {
            const n = parseInt(topVal, 10);
            if (n >= 1 && n <= pages.length) topBareNums.push({ pIdx, n });
          }
          if (/^\d{1,4}$/.test(bottomVal)) {
            const n = parseInt(bottomVal, 10);
            if (n >= 1 && n <= pages.length) bottomBareNums.push({ pIdx, n });
          }
        }

        function isMonotonicPageSeries(entries) {
          if (entries.length < minRepeats) return false;
          for (let k = 1; k < entries.length; k++) {
            if (entries[k].n <= entries[k - 1].n) return false;
          }
          return true;
        }
        const allowTopBarePageNums = isMonotonicPageSeries(topBareNums);
        const allowBottomBarePageNums = isMonotonicPageSeries(bottomBareNums);

        const cleanedPages = pageLinesList.map(pLines => {
          const nonEmptyIndices = [];
          for (let i = 0; i < pLines.length; i++) {
            if (pLines[i].trim().length > 0) nonEmptyIndices.push(i);
          }
          const win = Math.min(3, Math.floor(nonEmptyIndices.length / 3));
          const topIdxSet = new Set(win > 0 ? nonEmptyIndices.slice(0, win) : []);
          const bottomIdxSet = new Set(win > 0 ? nonEmptyIndices.slice(-win) : []);
          const firstNonEmpty = nonEmptyIndices[0];
          const secondNonEmpty = nonEmptyIndices[1];
          const lastNonEmpty = nonEmptyIndices[nonEmptyIndices.length - 1];
          const penultNonEmpty = nonEmptyIndices[nonEmptyIndices.length - 2];
          const firstSig = firstNonEmpty !== undefined ? _makeHeaderSignature(pLines[firstNonEmpty].trim(), true, pages.length) : null;
          const lastSig = lastNonEmpty !== undefined ? _makeHeaderSignature(pLines[lastNonEmpty].trim(), true, pages.length) : null;
          const firstStripped = firstNonEmpty !== undefined && topIdxSet.has(firstNonEmpty) && firstSig && topHeaders.has(firstSig);
          const lastStripped = lastNonEmpty !== undefined && bottomIdxSet.has(lastNonEmpty) && lastSig && bottomFooters.has(lastSig);

          const kept = [];
          for (let i = 0; i < pLines.length; i++) {
            const trimmed = pLines[i].trim();
            const sig = _makeHeaderSignature(trimmed, true, pages.length);
            const isTopHeader = topIdxSet.has(i) && sig && topHeaders.has(sig);
            const isBottomFooter = bottomIdxSet.has(i) && sig && bottomFooters.has(sig);
            const isTopEdge = nonEmptyIndices.length >= 3 && (
              i === firstNonEmpty || (firstStripped && i === secondNonEmpty)
            );
            const isBottomEdge = nonEmptyIndices.length >= 3 && (
              i === lastNonEmpty || (lastStripped && i === penultNonEmpty)
            );
            const isEdgeLine = isTopEdge || isBottomEdge;
            let isBoundaryBareNum = false;
            let isBoundaryFractionPage = false;
            if (isEdgeLine) {
              const posInNonEmpty = nonEmptyIndices.indexOf(i);
              const prevNeighbor = posInNonEmpty > 0 ? pLines[nonEmptyIndices[posInNonEmpty - 1]].trim() : '';
              const nextNeighbor = posInNonEmpty >= 0 && posInNonEmpty < nonEmptyIndices.length - 1
                ? pLines[nonEmptyIndices[posInNonEmpty + 1]].trim()
                : '';

              const prevPromptsAnswer = /[:?]\s*$/.test(prevNeighbor);
              const remainingAfterStrip = nonEmptyIndices.length - (firstStripped ? 1 : 0) - (lastStripped ? 1 : 0) - 1;

              if (/^\d{1,4}$/.test(trimmed)) {
                const n = parseInt(trimmed, 10);
                const edgeAllowsBare = (isTopEdge && allowTopBarePageNums) || (isBottomEdge && allowBottomBarePageNums);
                const neighborIsBareNum = /^\d{1,4}$/.test(prevNeighbor) || /^\d{1,4}$/.test(nextNeighbor);
                isBoundaryBareNum = edgeAllowsBare && n >= 1 && n <= pages.length && !neighborIsBareNum && !prevPromptsAnswer && remainingAfterStrip >= 1;
              } else if (_isBoundaryFractionPageNumber(trimmed, pages.length)) {
                const neighborIsFraction = /^\d{1,4}\s*\/\s*\d{1,4}$/.test(prevNeighbor) ||
                  /^\d{1,4}\s*\/\s*\d{1,4}$/.test(nextNeighbor);
                isBoundaryFractionPage = !neighborIsFraction && !prevPromptsAnswer && remainingAfterStrip >= 1;
              }
            }

            if (isTopHeader || isBottomFooter || isBoundaryBareNum || isBoundaryFractionPage) {
              removedLines++;
            } else {
              kept.push(pLines[i]);
            }
          }
          return kept.join('\n');
        });

        working = cleanedPages.join('\n\n');
      } else {
        working = working.replace(/\f+/g, '\n\n');
      }
    }

    // Pass 2: Standalone repeated header/footer lines with explicit header/page/copyright signals.
    // Measure gaps over NON-EMPTY lines so blank-line-separated HTML/Markdown paragraphs
    // never masquerade as page-scale spacing, and never strip unmarked body quiz options.
    const lines = working.split('\n');
    const nonEmptyPosByLine = new Map();
    let nonEmptyCounter = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        nonEmptyPosByLine.set(i, nonEmptyCounter++);
      }
    }

    const occurrencesBySig = new Map();

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length < 4 || trimmed.length > 120) continue;

      const sig = _makeHeaderSignature(trimmed, false);
      if (!sig || _isProtectedContentLine(trimmed, sig)) continue;
      if (!_hasExplicitHeaderSignal(trimmed, sig)) continue;

      if (!occurrencesBySig.has(sig)) {
        occurrencesBySig.set(sig, []);
      }
      occurrencesBySig.get(sig).push(i);
    }

    const indicesToRemove = new Set();
    for (const [, idxs] of occurrencesBySig.entries()) {
      if (idxs.length < minRepeats) continue;

      let totalNonEmptyGap = 0;
      for (let k = 1; k < idxs.length; k++) {
        totalNonEmptyGap += nonEmptyPosByLine.get(idxs[k]) - nonEmptyPosByLine.get(idxs[k - 1]);
      }
      const avgNonEmptyGap = totalNonEmptyGap / (idxs.length - 1);

      const minGap = processedFormFeedPages ? 2 : 10;
      if (avgNonEmptyGap >= minGap) {
        for (const idx of idxs) {
          indicesToRemove.add(idx);
        }
      }
    }

    if (indicesToRemove.size > 0) {
      const filtered = [];
      for (let i = 0; i < lines.length; i++) {
        if (indicesToRemove.has(i)) {
          removedLines++;
        } else {
          filtered.push(lines[i]);
        }
      }
      working = filtered.join('\n');
    }

    return { text: working, removedLines };
  }

  function stripHeadersAndFooters(text, options = {}) {
    return _stripHeadersAndFootersInternal(text, options).text;
  }

  function _stripPageNumbersInternal(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return { text: '', removedLines: 0 };
    }

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let removedLines = 0;

    for (const line of lines) {
      if (_isStandalonePageNumberLine(line.trim())) {
        removedLines++;
      } else {
        kept.push(line);
      }
    }

    return { text: kept.join('\n'), removedLines };
  }

  function stripPageNumbers(text) {
    return _stripPageNumbersInternal(text).text;
  }

  function _stripTocLinesInternal(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return { text: '', removedLines: 0 };
    }

    // Require 4+ consecutive dots or 3+ spaced dots (never a 3-dot ellipsis '...'
    // or fill-in-the-blank underscores '____'), followed by a page number or valid
    // Roman numeral (>=2 chars or uppercase single I/V/X).
    const tocRe = /^.{2,150}?(?:\.{4,}|(?:\.\s){3,})\s*(?:\d{1,4}|[ivxlcdm]{2,6}|[IVXLCDM]{2,6}|[IVX])\s*$/;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let removedLines = 0;

    for (const line of lines) {
      if (tocRe.test(line.trim())) {
        removedLines++;
      } else {
        kept.push(line);
      }
    }

    return { text: kept.join('\n'), removedLines };
  }

  function stripTocLines(text) {
    return _stripTocLinesInternal(text).text;
  }

  function _compactWhitespaceInternal(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return { text: '', removedLines: 0 };
    }

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const normalizedLines = lines.map(line => {
      const trimmedRight = line.trimEnd();
      const listMatch = /^([ \t]{0,6})((?:[-*•+]|\d{1,3}[.)])\s+)(.*)$/.exec(trimmedRight);
      if (listMatch) {
        const indent = listMatch[1].replace(/\t/g, '  ').slice(0, 4);
        const marker = listMatch[2].replace(/[ \t]+/g, ' ');
        const body = listMatch[3].replace(/[ \t]{2,}/g, ' ').trim();
        return `${indent}${marker}${body}`;
      }
      return trimmedRight.trim().replace(/[ \t]{2,}/g, ' ');
    });

    let removedLines = 0;
    const compacted = [];
    let consecutiveBlanks = 0;

    for (const line of normalizedLines) {
      if (line === '') {
        consecutiveBlanks++;
        if (consecutiveBlanks <= 1 && compacted.length > 0) {
          compacted.push('');
        } else if (consecutiveBlanks > 1) {
          removedLines++;
        }
      } else {
        consecutiveBlanks = 0;
        compacted.push(line);
      }
    }

    while (compacted.length > 0 && compacted[compacted.length - 1] === '') {
      compacted.pop();
    }

    return { text: compacted.join('\n'), removedLines };
  }

  function compactWhitespace(text) {
    return _compactWhitespaceInternal(text).text;
  }

  /**
   * Main NLP cleaning pipeline.
   * Returns { text, stats: { originalChars, cleanedChars, removedLines, reductionRatio } }.
   */
  function cleanText(rawText, options = {}) {
    if (typeof rawText !== 'string' || rawText.length === 0) {
      return {
        text: '',
        stats: {
          originalChars: 0,
          cleanedChars: 0,
          removedLines: 0,
          reductionRatio: 0
        }
      };
    }

    const opts = options && typeof options === 'object' ? options : {};
    const originalChars = rawText.length;
    let totalRemovedLines = 0;

    // 1. Typography normalization (keep \f temporarily for page-boundary detection)
    let text = normalizeTypography(rawText, { preserveFormFeed: true });

    if (opts.stripPagination !== false) {
      // 2. Repeated header/footer removal
      const hfResult = _stripHeadersAndFootersInternal(text, opts);
      text = hfResult.text;
      totalRemovedLines += hfResult.removedLines;

      // Strip any remaining \f characters
      text = text.replace(/\f+/g, '\n\n');

      // 3. Standalone page-number stripping
      const pnResult = _stripPageNumbersInternal(text);
      text = pnResult.text;
      totalRemovedLines += pnResult.removedLines;

      // 4. Table-of-contents dot-leader stripping
      const tocResult = _stripTocLinesInternal(text);
      text = tocResult.text;
      totalRemovedLines += tocResult.removedLines;
    } else {
      text = text.replace(/\f+/g, '\n\n');
    }

    // 5. Line-broken word de-hyphenation (disabled for structured record formats like CSV)
    if (opts.dehyphenate !== false) {
      text = dehyphenate(text);
    }

    // 6. Whitespace & blank-line compaction
    const wsResult = _compactWhitespaceInternal(text);
    text = wsResult.text;
    totalRemovedLines += wsResult.removedLines;

    const cleanedChars = text.length;
    const reductionRatio = originalChars > 0
      ? Math.max(0, Number(((originalChars - cleanedChars) / originalChars).toFixed(4)))
      : 0;

    return {
      text,
      stats: {
        originalChars,
        cleanedChars,
        removedLines: totalRemovedLines,
        reductionRatio
      }
    };
  }

  /**
   * Decode common HTML named & numeric character references safely.
   */
  function decodeHtmlEntities(text) {
    if (typeof text !== 'string' || text.length === 0) return '';

    const NAMED = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
      ndash: '–',
      mdash: '—',
      hellip: '…',
      laquo: '«',
      raquo: '»',
      copy: '©',
      reg: '®',
      euro: '€'
    };

    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity) => {
      if (entity[0] === '#') {
        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
        if (!Number.isNaN(code) && code > 0 && code <= 0x10FFFF) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return full;
          }
        }
        return full;
      }
      const key = entity.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : full;
    });
  }

  /**
   * Extract readable text from untrusted HTML safely without innerHTML.
   * Uses DOMParser in browser environments and a safe stripping fallback in Node.
   */
  function extractTextFromHTML(html) {
    if (typeof html !== 'string' || html.trim().length === 0) return '';

    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript, svg, template').forEach(el => el.remove());

      const BLOCK_TAGS = new Set([
        'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
        'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
        'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
        'SECTION', 'TABLE', 'TR', 'UL'
      ]);
      const CELL_TAGS = new Set(['TD', 'TH']);

      const chunks = [];
      const root = doc.body || doc.documentElement;

      function walkNode(node, targetChunks) {
        if (!node) return;
        if (node.nodeType === 3) {
          targetChunks.push(node.nodeValue || '');
          return;
        }
        if (node.nodeType !== 1) return;

        const tag = (node.tagName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'TEMPLATE') {
          return;
        }

        if (tag === 'TR') {
          let hasCells = false;
          const cells = [];
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 1 && CELL_TAGS.has((child.tagName || '').toUpperCase())) {
              hasCells = true;
              const cellChunks = [];
              for (let c = child.firstChild; c; c = c.nextSibling) {
                walkNode(c, cellChunks);
              }
              const cellText = cellChunks.join('').replace(/\s+/g, ' ').trim();
              if (cellText.length > 0) cells.push(cellText);
            }
          }
          if (hasCells) {
            if (cells.length > 0) {
              targetChunks.push('\n', cells.join(' | '), '\n');
            }
            return;
          }
        }

        const isBlock = BLOCK_TAGS.has(tag);
        if (isBlock) targetChunks.push('\n');

        for (let child = node.firstChild; child; child = child.nextSibling) {
          walkNode(child, targetChunks);
        }

        if (CELL_TAGS.has(tag)) {
          targetChunks.push(' | ');
        } else if (isBlock) {
          targetChunks.push('\n');
        }
      }

      walkNode(root, chunks);
      return chunks.join('').replace(/ \| \n/g, '\n');
    }

    // Non-DOM fallback (e.g. Node unit tests): single-pass O(N) scanner (no quadratic regexes)
    const DANGEROUS_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template']);
    const NESTABLE_DANGEROUS_TAGS = new Set(['svg', 'template']);
    const BLOCK_TAGS_FALLBACK = new Set([
      'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
      'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
      'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
      'section', 'table', 'tr', 'ul'
    ]);
    const CELL_TAGS_FALLBACK = new Set(['td', 'th']);

    function isAsciiLetter(code) {
      return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    function isTagBoundaryChar(ch) {
      return ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '/';
    }

    function findTagEnd(str, start) {
      // HTML5 attribute-state-aware '>' finder: quotes only open immediately after '='
      // (with optional whitespace), never inside unquoted attribute values like title=O'Reilly.
      // selfClosing is true ONLY for '/' in attrName state immediately followed by '>'.
      // Strictly O(N) over the tag slice.
      let state = 'attrName'; // 'attrName' | 'afterEq' | 'unquoted' | 'quoted'
      let quote = '';
      for (let k = start; k < str.length; k++) {
        const ch = str[k];
        if (state === 'quoted') {
          if (ch === quote) {
            state = 'attrName';
            quote = '';
          }
        } else if (state === 'afterEq') {
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
            continue;
          } else if (ch === '"' || ch === "'") {
            state = 'quoted';
            quote = ch;
          } else if (ch === '>') {
            return { gt: k, selfClosing: false };
          } else {
            state = 'unquoted';
          }
        } else if (state === 'unquoted') {
          if (ch === '>') {
            return { gt: k, selfClosing: false };
          } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
            state = 'attrName';
          }
        } else {
          // 'attrName'
          if (ch === '>') {
            return { gt: k, selfClosing: false };
          } else if (ch === '/' && str[k + 1] === '>') {
            return { gt: k + 1, selfClosing: true };
          } else if (ch === '=') {
            state = 'afterEq';
          }
        }
      }
      return { gt: -1, selfClosing: false };
    }

    function skipComment(str, lt) {
      if (str.startsWith('<!-->', lt)) return lt + 5;
      if (str.startsWith('<!--->', lt)) return lt + 6;
      // Single forward O(N) scan for '-->' or '--!>' (avoids dual EOF rescanning)
      let pos = lt + 4;
      const totalLen = str.length;
      while (pos < totalLen) {
        const idx = str.indexOf('--', pos);
        if (idx === -1) return -1;
        if (str[idx + 2] === '>') return idx + 3;
        if (str[idx + 2] === '!' && str[idx + 3] === '>') return idx + 4;
        pos = idx + 1;
      }
      return -1;
    }

    function findRawTextCloserSpan(asciiLower, origHtml, rawTagName, startPos) {
      const closeNeedle = `</${rawTagName}`;
      const totalLen = asciiLower.length;
      let searchFrom = startPos;
      while (searchFrom < totalLen) {
        const closeIdx = asciiLower.indexOf(closeNeedle, searchFrom);
        if (closeIdx === -1) return null;
        const afterNameIdx = closeIdx + closeNeedle.length;
        if (afterNameIdx < totalLen && isTagBoundaryChar(asciiLower[afterNameIdx])) {
          const closeGt = origHtml.indexOf('>', afterNameIdx);
          if (closeGt === -1) return null;
          return { closeStart: closeIdx, closeEnd: closeGt + 1 };
        }
        searchFrom = afterNameIdx;
      }
      return null;
    }

    function findRawTextCloser(asciiLower, origHtml, rawTagName, startPos) {
      const span = findRawTextCloserSpan(asciiLower, origHtml, rawTagName, startPos);
      return span ? span.closeEnd : -1;
    }

    // ASCII-only lowercased shadow string guarantees 1:1 UTF-16 offset alignment with html
    // (avoids index shift from case-expanding Unicode characters like Turkish 'İ' U+0130).
    const lower = html.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
    const len = html.length;
    const out = [];
    let i = 0;
    let inTableRow = false;
    let rowCells = [];
    let currentCell = null;

    function pushText(segment) {
      if (!segment) return;
      if (currentCell !== null) {
        currentCell.push(segment);
      } else if (!(inTableRow && /^\s*$/.test(segment))) {
        out.push(segment);
      }
    }

    function finishCurrentCell() {
      if (currentCell !== null) {
        const cellText = currentCell.join('').replace(/\s+/g, ' ').trim();
        const visibleText = decodeHtmlEntities(cellText).replace(/\s+/g, ' ').trim();
        if (visibleText.length > 0) rowCells.push(cellText);
        currentCell = null;
      }
    }

    function finishTableRow() {
      finishCurrentCell();
      if (rowCells.length > 0) {
        out.push('\n', rowCells.join(' | '), '\n');
      }
      rowCells = [];
      inTableRow = false;
    }

    while (i < len) {
      const lt = html.indexOf('<', i);
      if (lt === -1) {
        pushText(html.slice(i));
        break;
      }
      if (lt > i) {
        pushText(html.slice(i, lt));
      }

      // Inspect characters right after '<' BEFORE scanning for '>' (strictly O(1) on literal '<')
      if (lt + 1 >= len) {
        pushText('<');
        break;
      }

      // HTML comment <!-- ... --> (including HTML5 short comments <!-->, <!--->, and --!>)
      if (html.startsWith('<!--', lt)) {
        const afterComment = skipComment(html, lt);
        if (afterComment === -1) break;
        i = afterComment;
        continue;
      }

      const c1 = html.charCodeAt(lt + 1);
      // DOCTYPE / CDATA / declaration <! ... > or processing instruction <? ... >
      if (c1 === 33 || c1 === 63) { // '!' or '?'
        const gtDecl = html.indexOf('>', lt + 2);
        if (gtDecl === -1) break;
        i = gtDecl + 1;
        continue;
      }

      // Must start with <[A-Za-z] or </[A-Za-z]; otherwise emit literal '<' in O(1)
      const isClosing = c1 === 47; // '/'
      const nameStart = isClosing ? lt + 2 : lt + 1;
      if (nameStart >= len || !isAsciiLetter(html.charCodeAt(nameStart))) {
        pushText('<');
        i = lt + 1;
        continue;
      }

      // Parse tag name directly in O(nameLen)
      let nameEnd = nameStart + 1;
      while (nameEnd < len) {
        const code = html.charCodeAt(nameEnd);
        if (isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 58 || code === 45) {
          nameEnd++;
        } else {
          break;
        }
      }

      // After tag name must be valid HTML tag boundary
      if (nameEnd < len && !isTagBoundaryChar(html[nameEnd])) {
        pushText('<');
        i = lt + 1;
        continue;
      }

      const tagEnd = isClosing
        ? { gt: html.indexOf('>', nameEnd), selfClosing: false }
        : findTagEnd(html, nameEnd);
      const gt = tagEnd.gt;
      if (gt === -1) {
        break; // unclosed real tag at EOF
      }

      const tagName = lower.slice(nameStart, nameEnd);

      // HTML5 RCDATA elements (<title>, <textarea>): inner '<...' is character data, never markup
      if (!isClosing && (tagName === 'title' || tagName === 'textarea')) {
        const span = findRawTextCloserSpan(lower, html, tagName, gt + 1);
        if (tagName === 'textarea') {
          const innerText = span ? html.slice(gt + 1, span.closeStart) : html.slice(gt + 1);
          pushText(innerText);
        }
        // <title> content is ignored to match DOMParser's doc.body extraction
        if (!span) break;
        i = span.closeEnd;
        continue;
      }

      if (!isClosing && DANGEROUS_TAGS.has(tagName)) {
        // Only foreign <svg .../> is self-closing in HTML5; script/style/noscript/template are NOT
        const isSelfClosingSvg = tagName === 'svg' && tagEnd.selfClosing;
        if (isSelfClosingSvg) {
          pushText(' ');
          i = gt + 1;
          continue;
        }

        if (NESTABLE_DANGEROUS_TAGS.has(tagName)) {
          // Single-pass O(N) tag-aware nesting scanner for <svg> and <template>
          // (tracks nested <svg> foreign-content depth for CDATA and self-closing <script/>/<style/>).
          let depth = 1;
          let svgDepth = tagName === 'svg' ? 1 : 0;
          let pos = gt + 1;
          let closedAt = -1;

          while (pos < len && depth > 0) {
            const innerLt = html.indexOf('<', pos);
            if (innerLt === -1) break;
            if (innerLt + 1 >= len) break;

            if (html.startsWith('<!--', innerLt)) {
              const afterCmt = skipComment(html, innerLt);
              if (afterCmt === -1) break;
              pos = afterCmt;
              continue;
            }

            if (svgDepth > 0 && html.startsWith('<![CDATA[', innerLt)) {
              const endCdata = html.indexOf(']]>', innerLt + 9);
              if (endCdata === -1) break;
              pos = endCdata + 3;
              continue;
            }

            const ic1 = html.charCodeAt(innerLt + 1);
            if (ic1 === 33 || ic1 === 63) {
              const gtD = html.indexOf('>', innerLt + 2);
              if (gtD === -1) break;
              pos = gtD + 1;
              continue;
            }

            const innerClosing = ic1 === 47;
            const innerNameStart = innerClosing ? innerLt + 2 : innerLt + 1;
            if (innerNameStart >= len || !isAsciiLetter(html.charCodeAt(innerNameStart))) {
              pos = innerLt + 1;
              continue;
            }

            let innerNameEnd = innerNameStart + 1;
            while (innerNameEnd < len) {
              const code = html.charCodeAt(innerNameEnd);
              if (isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 58 || code === 45) {
                innerNameEnd++;
              } else {
                break;
              }
            }
            if (innerNameEnd < len && !isTagBoundaryChar(html[innerNameEnd])) {
              pos = innerLt + 1;
              continue;
            }

            const innerEnd = innerClosing
              ? { gt: html.indexOf('>', innerNameEnd), selfClosing: false }
              : findTagEnd(html, innerNameEnd);
            if (innerEnd.gt === -1) break;

            const innerName = lower.slice(innerNameStart, innerNameEnd);
            if (
              !innerClosing &&
              !(svgDepth > 0 && innerEnd.selfClosing) &&
              (innerName === 'script' || innerName === 'style' || innerName === 'noscript' ||
                (svgDepth === 0 && (innerName === 'title' || innerName === 'textarea')))
            ) {
              const rawClosedAt = findRawTextCloser(lower, html, innerName, innerEnd.gt + 1);
              if (rawClosedAt === -1) break;
              pos = rawClosedAt;
              continue;
            }

            if (innerName === 'svg' && tagName !== 'svg') {
              if (innerClosing) {
                if (svgDepth > 0) svgDepth--;
              } else if (!innerEnd.selfClosing) {
                svgDepth++;
              }
            }

            if (innerName === tagName) {
              if (innerClosing) {
                depth--;
                if (tagName === 'svg' && svgDepth > 0) svgDepth--;
                if (depth === 0) {
                  closedAt = innerEnd.gt + 1;
                  break;
                }
              } else {
                const innerSelfClose = tagName === 'svg' && innerEnd.selfClosing;
                if (!innerSelfClose) {
                  depth++;
                  if (tagName === 'svg') svgDepth++;
                }
              }
            }
            pos = innerEnd.gt + 1;
          }

          pushText(' ');
          if (closedAt === -1) break;
          i = closedAt;
          continue;
        }

        // Flat raw-text elements (script, style, noscript) cannot nest
        const closedAt = findRawTextCloser(lower, html, tagName, gt + 1);
        pushText(' ');
        if (closedAt === -1) {
          break; // unclosed dangerous tag strips to EOF
        }
        i = closedAt;
        continue;
      }

      if (tagName === 'tr') {
        if (!isClosing) {
          if (inTableRow) finishTableRow();
          inTableRow = true;
          rowCells = [];
          currentCell = null;
        } else {
          finishTableRow();
        }
      } else if (tagName === 'table' && isClosing && inTableRow) {
        finishTableRow();
      } else if (CELL_TAGS_FALLBACK.has(tagName)) {
        if (!isClosing) {
          if (!inTableRow) {
            inTableRow = true;
            rowCells = [];
          }
          finishCurrentCell();
          currentCell = [];
        } else {
          finishCurrentCell();
        }
      } else if (BLOCK_TAGS_FALLBACK.has(tagName)) {
        if (currentCell !== null) {
          currentCell.push(' ');
        } else {
          out.push('\n');
        }
      }
      // Inline tags (<sub>, <sup>, <em>, <strong>, <span>, <a>, etc.) emit no extra spaces,
      // matching DOMParser so H<sub>2</sub>O -> H2O and <em>algo</em>rithme -> algorithme.
      i = gt + 1;
    }

    if (inTableRow) {
      finishTableRow();
    }

    const stripped = out.join('');
    return decodeHtmlEntities(stripped);
  }

  function _detectCsvDelimiter(text) {
    const sampleLimit = Math.min(text.length, 4096);
    const commaPerRow = [];
    const semiPerRow = [];
    let inQuotes = false;
    let atFieldStart = true;
    let rowCommas = 0;
    let rowSemis = 0;
    let rowHasContent = false;

    for (let i = 0; i < sampleLimit; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            i++;
          } else {
            inQuotes = false;
          }
        }
      } else {
        if (ch === '"' && atFieldStart) {
          inQuotes = true;
          atFieldStart = false;
          rowHasContent = true;
        } else if (ch === ',') {
          rowCommas++;
          atFieldStart = true;
          rowHasContent = true;
        } else if (ch === ';') {
          rowSemis++;
          atFieldStart = true;
          rowHasContent = true;
        } else if (ch === '\n') {
          if (rowHasContent) {
            commaPerRow.push(rowCommas);
            semiPerRow.push(rowSemis);
            if (commaPerRow.length >= 5) break;
          }
          rowCommas = 0;
          rowSemis = 0;
          atFieldStart = true;
          rowHasContent = false;
        } else if (ch !== ' ' && ch !== '\t') {
          atFieldStart = false;
          rowHasContent = true;
        }
      }
    }

    if (rowHasContent && commaPerRow.length < 5) {
      commaPerRow.push(rowCommas);
      semiPerRow.push(rowSemis);
    }

    function scoreCounts(counts) {
      if (counts.length === 0) return { total: 0, nonZeroRows: 0, consistent: false, spread: Infinity };
      let total = 0;
      let nonZeroRows = 0;
      let min = Infinity;
      let max = 0;
      for (let k = 0; k < counts.length; k++) {
        const c = counts[k];
        total += c;
        if (c > 0) nonZeroRows++;
        if (c < min) min = c;
        if (c > max) max = c;
      }
      const consistent = counts.length >= 2 && min > 0 && min === max;
      const spread = max > 0 ? (max - min) / max : Infinity;
      return { total, nonZeroRows, consistent, spread };
    }

    const cScore = scoreCounts(commaPerRow);
    const sScore = scoreCounts(semiPerRow);

    if (sScore.total === 0) return ',';
    if (cScore.total === 0) return ';';
    if (sScore.consistent && !cScore.consistent) return ';';
    if (cScore.consistent && !sScore.consistent) return ',';
    if (sScore.nonZeroRows !== cScore.nonZeroRows) {
      return sScore.nonZeroRows > cScore.nonZeroRows ? ';' : ',';
    }
    if (sScore.spread !== cScore.spread) {
      return sScore.spread < cScore.spread ? ';' : ',';
    }
    return sScore.total > cScore.total ? ';' : ',';
  }

  /**
   * Parse RFC-4180 CSV (quoted fields, escaped "" quotes, commas inside quotes)
   * into structured readable lines.
   */
  function parseCSV(csvText, options = {}) {
    if (typeof csvText !== 'string' || csvText.trim().length === 0) return '';

    const opts = options && typeof options === 'object' ? options : {};
    const normalized = csvText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const delimiter = opts.delimiter || _detectCsvDelimiter(normalized);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];

      if (inQuotes) {
        if (ch === '"') {
          if (normalized[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else if (ch === '\n') {
          field += ' ';
        } else {
          field += ch;
        }
      } else {
        if (ch === '"' && field.trim().length === 0) {
          field = '';
          inQuotes = true;
        } else if (ch === delimiter) {
          row.push(field.trim());
          field = '';
        } else if (ch === '\n') {
          row.push(field.trim());
          rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field.trim());
      rows.push(row);
    }

    const nonEmptyRows = rows.filter(r => r.some(cell => cell.length > 0));
    return nonEmptyRows
      .map(r => r.filter(cell => cell.length > 0).join(' | '))
      .filter(line => line.length > 0)
      .join('\n');
  }

  return {
    cleanText,
    normalizeTypography,
    dehyphenate,
    stripHeadersAndFooters,
    stripPageNumbers,
    stripTocLines,
    compactWhitespace,
    extractTextFromHTML,
    parseCSV,
    decodeHtmlEntities
  };
})();

globalThis.NLPCleaner = NLPCleaner;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NLPCleaner;
}
