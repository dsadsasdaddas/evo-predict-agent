FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    EVOMATE_PROJECT_ROOT=/app \
    EVOMATE_STATE_DIR=/tmp/evomate \
    GEP_ASSETS_DIR=/tmp/evomate-assets \
    EVOMAP_LLM_DISABLED=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY deploy ./deploy
COPY evo_predict_agent ./evo_predict_agent

RUN npm ci --include=dev

EXPOSE 8080

CMD ["sh", "-lc", "EVOMATE_API_PORT=${PORT:-8080} npm run evomate:api"]
