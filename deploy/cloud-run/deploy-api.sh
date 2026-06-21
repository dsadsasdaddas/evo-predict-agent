#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0594452709}"
REGION="${REGION:-asia-east2}"
REPOSITORY="${REPOSITORY:-evomate}"
SERVICE="${SERVICE:-evomate-api}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:latest}"
PYTHON_BIN="${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.14}"
EVOMAP_LLM_SECRET="${EVOMAP_LLM_SECRET:-evomap-llm-api-key}"
EVOMAP_LLM_BASE_URL="${EVOMAP_LLM_BASE_URL:-https://api.evomap.ai/v1}"
EVOMAP_LLM_MODEL="${EVOMAP_LLM_MODEL:-evomap-claude-opus-4-7}"
EVOMAP_LLM_TIMEOUT_MS="${EVOMAP_LLM_TIMEOUT_MS:-30000}"

export CLOUDSDK_PYTHON="$PYTHON_BIN"

echo "[evomate] project=$PROJECT_ID region=$REGION service=$SERVICE"
gcloud config set project "$PROJECT_ID" >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  echo "[evomate] creating Artifact Registry repository $REPOSITORY in $REGION"
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="EvoMate container images"
fi

echo "[evomate] building $IMAGE"
gcloud builds submit --tag "$IMAGE" .

SECRET_ARGS=()
EVOMAP_LLM_DISABLED="1"
if gcloud secrets describe "$EVOMAP_LLM_SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "[evomate] using Secret Manager secret $EVOMAP_LLM_SECRET for EvoMap Claude"
  SECRET_ARGS=(--set-secrets "EVOMAP_LLM_API_KEY=${EVOMAP_LLM_SECRET}:latest")
  EVOMAP_LLM_DISABLED="0"
else
  echo "[evomate] secret $EVOMAP_LLM_SECRET not found; deploying with EvoMap LLM disabled"
fi

echo "[evomate] deploying Cloud Run service $SERVICE"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 120 \
  --set-env-vars "EVOMAP_LLM_DISABLED=${EVOMAP_LLM_DISABLED},EVOMAP_LLM_BASE_URL=${EVOMAP_LLM_BASE_URL},EVOMAP_LLM_MODEL=${EVOMAP_LLM_MODEL},EVOMAP_LLM_TIMEOUT_MS=${EVOMAP_LLM_TIMEOUT_MS},EVOMATE_PROJECT_ROOT=/app,EVOMATE_STATE_DIR=/tmp/evomate,GEP_ASSETS_DIR=/tmp/evomate-assets,EVOMATE_REMOTE_EXECUTE=0" \
  "${SECRET_ARGS[@]}"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --platform managed --format='value(status.url)')"
echo "[evomate] deployed: $URL"
echo "[evomate] hook endpoint: $URL/api/hook-events"
