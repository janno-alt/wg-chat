# Backend-Container (läuft via tsx – kein separater Build-Schritt nötig).
# Build-Context = Repo-Root (siehe docker-compose.yml), damit das npm-Workspace
# inkl. @wg-chat/shared korrekt aufgelöst wird.
FROM node:22-alpine
WORKDIR /app

# Manifeste zuerst -> besseres Layer-Caching beim npm install
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/widget/package.json packages/widget/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
RUN npm install

# Shared + Backend + Widget + Dashboard
COPY packages/shared packages/shared
COPY packages/backend packages/backend
COPY packages/widget packages/widget
COPY packages/dashboard packages/dashboard

# Widget (-> /w.js) und Dashboard (-> / ) bauen, beide liefert das Backend aus
RUN npm run build --workspace @wg-chat/widget \
 && npm run build --workspace @wg-chat/dashboard

WORKDIR /app/packages/backend
EXPOSE 8787

# Beim Start: idempotente Migration, dann Server.
CMD ["sh", "-c", "npm run migrate && npm run start"]
