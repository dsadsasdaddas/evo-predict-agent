#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0594452709}"
REGION="${REGION:-asia-east2}"
REPOSITORY="${REPOSITORY:-evomate}"
SERVICE="${SERVICE:-evomate-web}"
API_URL="${NEXT_PUBLIC_EVOMATE_API_URL:-https://evomate-api-3mkana4zma-df.a.run.app}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:latest}"
PYTHON_BIN="${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.14}"

export CLOUDSDK_PYTHON="$PYTHON_BIN"

echo "[evomate-web] project=$PROJECT_ID region=$REGION service=$SERVICE api=$API_URL"
gcloud config set project "$PROJECT_ID" >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  echo "[evomate-web] creating Artifact Registry repository $REPOSITORY in $REGION"
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="EvoMate container images"
fi

echo "[evomate-web] building $IMAGE"
BUILD_CONFIG="$(mktemp -t evomate-web-cloudbuild.XXXXXX.yaml)"
cat >"$BUILD_CONFIG" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -f
      - Dockerfile.web
      - --build-arg
      - NEXT_PUBLIC_EVOMATE_API_URL=${API_URL}
      - -t
      - ${IMAGE}
      - .
images:
  - ${IMAGE}
EOF
trap 'rm -f "$BUILD_CONFIG"' EXIT
gcloud builds submit --config "$BUILD_CONFIG" .

echo "[evomate-web] deploying Cloud Run service $SERVICE"
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
  --set-env-vars "NEXT_PUBLIC_EVOMATE_API_URL=${API_URL},EVOMATE_PROJECT_ROOT=/app"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --platform managed --format='value(status.url)')"
echo "[evomate-web] deployed: $URL"
echo "[evomate-web] mobile demo: $URL/mobile"
