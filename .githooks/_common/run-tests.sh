#!/usr/bin/env bash
# Safe Exm — exécute la suite de tests unitaires (node:test, aucune dépendance). Timeout : 5 minutes.
# Usage : run-tests.sh [target_root] (défaut : racine du dépôt ; pre-push passe un export propre de HEAD).
# Échoue si zéro test exécuté, si des tests échouent, ou si des tests sont skippés.
set -u
TARGET_ROOT="${1:-$(git rev-parse --show-toplevel)}" || exit 2
cd "$TARGET_ROOT" || exit 2

command -v node >/dev/null 2>&1 || { echo "[tests] ❌ Node.js est introuvable : installez Node.js."; exit 1; }

shopt -s nullglob
TESTS=(tests/*.test.js)
if [ "${#TESTS[@]}" -eq 0 ]; then
  echo "[tests] ❌ Aucun fichier tests/*.test.js : une suite vide ne valide rien."
  echo "[tests]    Comment corriger : restaurez tests/invariants.test.js (git checkout HEAD -- tests/)."
  exit 1
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
GATE_ROOT="$TARGET_ROOT" timeout 300 node --test "${TESTS[@]}" >"$OUT" 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  cat "$OUT"
  if [ "$RC" -eq 124 ]; then
    echo "[tests] ❌ Timeout : les tests ont dépassé 5 minutes."
  else
    echo "[tests] ❌ Des tests échouent (code $RC). Corrigez le code, pas le test."
  fi
  exit 1
fi

# Garde-fou : au moins un test passé, zéro échec, zéro test skippé.
if ! grep -qE '^ℹ tests [1-9][0-9]*$' "$OUT" || ! grep -qE '^ℹ pass [1-9][0-9]*$' "$OUT" || ! grep -qE '^ℹ fail 0$' "$OUT" || ! grep -qE '^ℹ skipped 0$' "$OUT"; then
  cat "$OUT"
  echo "[tests] ❌ Suite invalide (zéro test passé ou test(s) ignoré(s)/skippé(s)) : résultat refusé."
  exit 1
fi
grep -E '^ℹ (tests|pass|fail|skipped)' "$OUT"
exit 0
