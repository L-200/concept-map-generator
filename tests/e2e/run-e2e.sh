#!/usr/bin/env bash
set -e

# ==============================================================================
# E2E Test Suite Runner Script
# Novak Hybrid Diagramming Platform (Concept Maps & Flowcharts)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

TIER=""
FULL_MODE="0"

for arg in "$@"; do
  case $arg in
    --tier=*)
      TIER="${arg#*=}"
      ;;
    -t=*|--target=*)
      TIER="${arg#*=}"
      ;;
    --full|-f)
      FULL_MODE="1"
      ;;
    --help|-h)
      echo "Usage: ./tests/e2e/run-e2e.sh [options]"
      echo ""
      echo "Options:"
      echo "  --tier=1|2|3|4    Run a specific test tier"
      echo "  --full            Run all tests in strict M5 acceptance gate mode"
      echo "  --help, -h        Show this help message"
      exit 0
      ;;
  esac
done

export E2E_FULL="$FULL_MODE"

echo "===================================================================="
echo " Running E2E Test Suite: Novak Hybrid Diagramming Platform"
if [ "$FULL_MODE" = "1" ]; then
  echo " Mode: STRICT M5 ACCEPTANCE GATE (E2E_FULL=1)"
else
  echo " Mode: Progressive Testability (Tiers 1 - 4)"
fi
echo " Target Directory: tests/e2e/"
echo "===================================================================="

if [ -n "$TIER" ]; then
  case $TIER in
    1)
      TARGET_FILE="tests/e2e/tier1-features.test.ts"
      ;;
    2)
      TARGET_FILE="tests/e2e/tier2-boundary.test.ts"
      ;;
    3)
      TARGET_FILE="tests/e2e/tier3-combinations.test.ts"
      ;;
    4)
      TARGET_FILE="tests/e2e/tier4-scenarios.test.ts"
      ;;
    *)
      echo "Error: Unknown tier '$TIER'. Valid tiers are 1, 2, 3, 4."
      exit 1
      ;;
  esac
  echo "Running Tier $TIER: $TARGET_FILE"
  npx vitest run "$TARGET_FILE"
else
  npx vitest run tests/e2e
fi

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo " [PASS] All targeted E2E test suites executed successfully!"
else
  echo " [FAIL] E2E test run failed with exit code $EXIT_CODE."
fi

exit $EXIT_CODE
