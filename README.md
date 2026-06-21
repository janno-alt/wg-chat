# wg-chat

Mandantenfähiges, EU-konformes **KI-Chatbot-Produkt** zum Einbetten auf WordPress-
(und beliebigen) Kundenseiten. Zentraler Container-Dienst (Mittwald mStudio) +
einbettbares `<script>`-Widget. Kostenbewusste Antwort-Kaskade, KI-gestützte
Wissensdatenbank, seitenspezifischer Outreach, Lead-Übergabe & Live-Übernahme.

> Vollständiger Architektur-/Phasenplan: siehe
> `~/.claude/plans/ich-h-tte-gern-ein-refactored-wigderson.md`.

## Was schon drin ist (Phase 0 + 1)

- **Monorepo** (npm workspaces): `backend` (Fastify/TS), `widget` (Preact, Shadow DOM), `shared` (Typen).
- **PostgreSQL 16 + pgvector** in Docker; vollständiges DB-Schema + idempotente Migration + Seed.
- **LLM-Provider-Abstraktion** mit Mistral (EU) – Generierung **und** Embeddings; pro Tenant umschaltbar.
- **Kostenbewusste `/chat`-Kaskade**: FAQ-Keyword → semantischer Cache → KB-Retrieval → RAG (gegated durch Pro-Tenant-Budget) → Eskalation. Jeder LLM-/Embedding-Aufruf landet in `llm_usage` (Tokens + €).
- **Einbettbares Widget**: Bubble + Chatfenster, Theme pro Tenant, **clientseitige Outreach-Trigger** (Verweildauer/Scroll/Idle/Exit-Intent/Element-Dwell), Eskalations-/Lead-Formular.
- **Mandanten-Trennung** über `site_key` + Origin-Whitelist; Kostenattribution pro Tenant.
- **KB-Ingestion (Phase 2)**: Website-**Crawler** (Sitemap/BFS), Einzel-URL & manuelle Q&A, HTML→Text, **Chunking + Embeddings** in pgvector (**HNSW**-Index, `ef_search`-getunt), Reindex. **KI-FAQ-Generierung** aus Inhalten (als Entwürfe mit menschlicher Freigabe). Alles über eine gesicherte **Admin-API** (`x-admin-key`) inkl. Kostenübersicht & Wissenslücken.
- **Lead-Handling (Phase 4)**: öffentlicher `POST /api/lead`, Persistenz + Markierung der Konversation, **Webhook-Push** (CRM/FormBuilder/N8N) + **E-Mail** (SMTP) – non-blocking. KI-**Antwortvorschlag** für Wissenslücken (RAG), Tenant-Einstellungen & Lead-Liste über die Admin-API.
- **Web-Dashboard (Phase 5)**: React/Vite/Tailwind-SPA (`packages/dashboard`) mit Login (Admin-Key), **Kundenverwaltung** (anlegen/bearbeiten) und pro Kunde: Wissensbasis, Konversationen+Transkript, Leads, Wissenslücken, **Kosten** und Einstellungen.
- **MCP-Server (Phase 6)**: `packages/mcp` (stdio, `@modelcontextprotocol/sdk`) mit **20 Tools**, die die Admin-API für Claude verfügbar machen – KB pflegen/crawlen, Tenants, Leads, Wissenslücken, Kosten & Einstellungen im Dialog.
- **Live-Übernahme (Phase 7)**: WebSocket-Hub im Backend (`/ws/agent`, `/ws/visitor`), **Agenten-Inbox** im Dashboard (Live-Tab) – Chats in Echtzeit sehen, **übernehmen** (KI pausiert automatisch via `handedOff`), antworten, zurückgeben. Das Widget zeigt „Mitarbeiter verbunden" und Agenten-Nachrichten live.

**Alle Phasen des Plans (0–7) sind umgesetzt.**

## Schnellstart

```bash
cp .env.example .env
# optional: MISTRAL_API_KEY in .env eintragen (sonst laufen nur FAQ + Eskalation, ohne Embeddings/RAG)
# Falls Port 5432 belegt ist (z.B. laufende CRM-DB): POSTGRES_HOST_PORT=5433 in .env setzen
# und DATABASE_URL entsprechend auf localhost:5433 anpassen.

# 1) Stack starten (Postgres + Backend, Backend migriert beim Start automatisch)
docker compose up -d --build

# 2) Demo-Daten anlegen (Tenant "demo", FAQ, Outreach-Trigger; embeddet nur mit API-Key)
docker compose run --rm backend npm run seed

# 3) Backend testen
curl http://localhost:8787/health
curl http://localhost:8787/api/config/demo
```

### Alternativ lokal ohne Docker

```bash
npm install
npm run db:up            # nur Postgres via Docker
npm run migrate          # Schema anlegen
npm run seed             # Demo-Tenant
npm run dev              # Backend auf :8787 (tsx watch)
```

### Widget testen

```bash
# Dev-Server mit Live-Reload (lädt Config vom Backend auf :8787)
npm run widget:dev       # öffnet http://localhost:5173

# ODER produktiv bauen und die Demo-Kundenseite servieren
npm run widget:build     # erzeugt packages/widget/dist/w.js
npx serve .              # dann examples/demo.html im Browser öffnen
```

## Verifikation der Kaskade (Kostenkontrolle)

```bash
# FAQ-Treffer → source "faq", KEIN llm_usage-Eintrag
curl -s -X POST http://localhost:8787/api/chat \
  -H 'content-type: application/json' -H 'x-site-key: demo' \
  -d '{"sessionId":"test1","message":"Was kostet eine Website?"}'

# Abseitige Frage → source "escalation", escalate:true (0 LLM), Wissenslücke geloggt
curl -s -X POST http://localhost:8787/api/chat \
  -H 'content-type: application/json' -H 'x-site-key: demo' \
  -d '{"sessionId":"test1","message":"Habt ihr ein Aquarium?"}'
```

Mit gesetztem `MISTRAL_API_KEY` greifen zusätzlich Cache/Retrieval/RAG; die Kosten
landen in der Tabelle `llm_usage` (Grundlage der Pro-Kunde-Kostenübersicht).

DB-freier Logik-Check (Chunking, HTML-Extraktion, Tokenizer, Kosten-Mathematik):

```bash
npm run smoke --workspace @wg-chat/backend
```

## Wissensdatenbank pflegen (Admin-API, Phase 2)

Gesichert über `ADMIN_API_KEY` (Header `x-admin-key`). Brücke bis zum Dashboard
(Phase 5) und Andockpunkt für den MCP-Server (Phase 6). Embeddings/Generierung
brauchen `MISTRAL_API_KEY`.

```bash
KEY=dein-admin-key

# Website crawlen (Sitemap/BFS) und als KB indexieren
curl -s -X POST http://localhost:8787/api/admin/demo/kb/crawl \
  -H "x-admin-key: $KEY" -H 'content-type: application/json' \
  -d '{"startUrl":"https://kunde.example","maxPages":20}'

# Einzelne URL / manuelles Q&A
curl -s -X POST http://localhost:8787/api/admin/demo/kb/url \
  -H "x-admin-key: $KEY" -H 'content-type: application/json' -d '{"url":"https://kunde.example/preise"}'
curl -s -X POST http://localhost:8787/api/admin/demo/kb/manual \
  -H "x-admin-key: $KEY" -H 'content-type: application/json' \
  -d '{"sourceType":"faq","title":"Habt ihr Parkplätze?","content":"Parkplätze","canonicalAnswer":"Ja, direkt am Haus."}'

# KI-FAQ-Vorschläge aus einem Dokument (Entwürfe, Freigabe durch Mensch)
curl -s -X POST http://localhost:8787/api/admin/demo/kb/<docId>/faqgen \
  -H "x-admin-key: $KEY" -H 'content-type: application/json' -d '{"count":5}'

# Dokumente listen · reindexen · löschen
curl -s -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/kb
curl -s -X POST  -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/kb/<docId>/reindex
curl -s -X DELETE -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/kb/<docId>

# Kostenübersicht (pro Kunde) & Wissenslücken
curl -s -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/usage
curl -s -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/gaps

# KI-Antwortvorschlag für eine Wissenslücke (RAG); Lead-Ziele setzen; Leads sehen
curl -s -X POST -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/gaps/<gapId>/suggest
curl -s -X PUT  -H "x-admin-key: $KEY" -H 'content-type: application/json' \
  -d '{"notifyEmail":"vertrieb@kunde.example","leadWebhookUrl":"https://n8n.kine.media/webhook/lead"}' \
  http://localhost:8787/api/admin/demo/settings
curl -s -H "x-admin-key: $KEY" http://localhost:8787/api/admin/demo/leads
```

### Lead-Erfassung (öffentlich, vom Widget)

Das Eskalations-/Kontaktformular sendet an `POST /api/lead` (Header `x-site-key`).
Der Lead wird gespeichert, die Konversation markiert und – non-blocking – per
**Webhook** (an `lead_webhook_url`, z. B. N8N→CRM/FormBuilder) und **E-Mail**
(an `notify_email`, falls SMTP konfiguriert) verschickt.

```bash
curl -s -X POST http://localhost:8787/api/lead \
  -H 'content-type: application/json' -H 'x-site-key: demo' \
  -d '{"sessionId":"t1","name":"Max","email":"max@example.com","message":"Bitte Rückruf"}'
```

## Web-Dashboard (Phase 5)

Interne Agentur-Oberfläche für alles, was sonst über die Admin-API läuft.
Anmeldung mit Backend-URL + `ADMIN_API_KEY` (im localStorage gehalten).

```bash
npm run dashboard:dev     # http://localhost:5174 (erwartet Backend auf :8787)
npm run dashboard:build   # statischer Build (packages/dashboard/dist)
```

Funktionen: Kunden anlegen/bearbeiten (Domains, Budget, aktiv), **Wissensbasis**
(crawlen/URL/FAQ, freigeben, reindex, FAQ-Gen, löschen), **Live**-Agenten-Inbox
(Phase 7: Chats live übernehmen/beantworten), **Konversationen** mit Transkript,
**Leads**, **Wissenslücken** (+ KI-Vorschlag), **Kosten** pro Kunde, **Einstellungen**
(Theme, Begrüßung, Lead-Ziele). Das Dashboard ist ein internes Tool – separat hosten
oder lokal gegen das deployte Backend betreiben (nicht Teil des öffentlichen Mittwald-Stacks).

> Hinweis Realtime/Deploy: Der WS-Hub ist In-Memory (ein Container reicht für Mittwald).
> Bei Mehr-Instanz-Betrieb später Redis-Pub/Sub hinter derselben Hub-Schnittstelle ergänzen.

## MCP-Server (Phase 6)

Pflege der Wissensbasis & Config direkt aus Claude – wie eure übrigen MCP-Tools.
Der Server umhüllt die Admin-REST-API (keine direkte DB/LLM-Anbindung).

```bash
# Schnelltest (spawnt den Server, listet die Tools – ohne laufendes Backend):
npm run verify --workspace @wg-chat/mcp
```

Beispiel-Eintrag in der MCP-Host-Konfiguration (z. B. Claude):

```json
{
  "mcpServers": {
    "wg-chat": {
      "command": "npx",
      "args": ["tsx", "/Users/jannofleischer/MCP/Chatbot/packages/mcp/src/index.ts"],
      "env": {
        "WG_CHAT_API": "https://chat.kine.media",
        "WG_CHAT_ADMIN_KEY": "<dein-admin-key>"
      }
    }
  }
}
```

Tools u. a.: `list_tenants`, `create_tenant`, `crawl_site`, `add_faq`, `ingest_url`,
`generate_faqs`, `publish_document`, `list_leads`, `list_gaps`, `suggest_gap_answer`,
`get_usage`, `get_settings`, `update_settings`.

## DSGVO / EU

End-Nutzerdaten werden ausschließlich über EU-Provider (Mistral, optional
Vertex-EU) und eine EU-Postgres verarbeitet. Claude/Anthropic wird nur intern für
das spätere MCP-Management benutzt – nie im Antwortpfad des Bots.

## Deployment (Mittwald mStudio)

Container-Stack (Backend + Postgres/pgvector) im mStudio, Image über GitHub
Container Registry, Auslieferung per GitHub Actions. Das Backend liefert das
Widget unter `GET /w.js` aus demselben Origin aus – das Einbettungs-Snippet ist
dadurch eine einzige Zeile ohne CORS-Thematik. Vollständige Anleitung:
[deploy/README.md](deploy/README.md). Stack-Definition: `deploy/stack.yaml`,
CI: `.github/workflows/deploy.yml`.

## Projektstruktur

```
packages/
  shared/   Wire-Typen (Widget ⇄ Backend)
  backend/  Fastify-API, DB (Drizzle+pgvector), LLM-Provider, Kaskade, /w.js,
            KB-Ingestion (Crawler/Chunking/Embeddings/FAQ-Gen), Admin-API
  widget/    Preact-Widget (IIFE), Shadow DOM, Outreach-Engine
  dashboard/ React/Vite/Tailwind Admin-SPA (Phase 5)
  mcp/       MCP-Server (stdio) – Admin-API als Claude-Tools (Phase 6)
examples/   Demo-Kundenseite + WordPress-Snippet
deploy/     Mittwald stack.yaml + Deployment-Anleitung
.github/    CI-Workflow (Build → GHCR → Mittwald-Deploy)
```
