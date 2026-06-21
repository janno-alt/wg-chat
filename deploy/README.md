# Deployment nach Mittwald mStudio

Ziel: wg-chat als **Container-Stack** (Backend + Postgres/pgvector) im Mittwald
mStudio, Image über **GitHub Container Registry (GHCR)**, Auslieferung per GitHub
Actions. Alles in der EU (DE) → DSGVO-konform.

```
GitHub Tag v* ──▶ Actions: Image bauen (Backend inkl. Widget) ──▶ GHCR
              ──▶ mittwald/deploy-container-action ──▶ Stack aktualisiert
chat.kine.media ──(VirtualHost/TLS)──▶ Backend :8787 ──intern──▶ postgres :5432
```

## ⚠️ Reihenfolge (Henne-Ei): erst Image, dann Stack

Ein Container-Stack braucht ein **vorhandenes Image**. Das Image entsteht aber erst
durch die GitHub Action. Deshalb in dieser Reihenfolge:

1. **Image bauen lassen (ohne Mittwald, ohne Terminal):** in GitHub →
   **Actions** → Workflow **„Image bauen (GHCR)"** → **Run workflow** (optional
   einen Tag wie `v0.1.0` eintragen). Baut & pusht `ghcr.io/janno-alt/wg-chat-backend:…`.
   (Dein Rechner braucht kein Docker – das macht die Action.) Alternativ baut auch
   der „Build & Deploy"-Workflow per Tag; sein Deploy-Schritt wird übersprungen,
   solange `MITTWALD_STACK_ID` nicht gesetzt ist.
2. **GHCR-Package erreichbar machen:** auf *public* stellen **oder** Registry-Zugang
   in mStudio hinterlegen (siehe Schritt 3 unten).
3. **Stack anlegen** – jetzt existiert das Image: in mStudio einen Container mit
   `ghcr.io/janno-alt/wg-chat-backend:latest` (+ pgvector-Container) anlegen, oder
   `mw stack deploy`. **Stack-ID notieren.**
4. **`MITTWALD_STACK_ID` + Secrets setzen** (siehe unten).
5. **Erneut deployen:** Tag pushen / Workflow erneut starten → jetzt läuft auch der
   Deploy-Schritt und der Stack wird aus `deploy/stack.yaml` aktualisiert.

> Hinweis: mStudio verlangt beim Container-Anlegen **immer ein Image**. Deshalb
> niemals „leeren Stack" anlegen, sondern erst Image bauen (Schritt 1), dann den
> Container **mit** diesem Image anlegen.

---

## Variante A: komplett über die mStudio-UI (ohne CI, ohne Stack-ID, ohne Terminal)

Am direktesten, wenn man kein Auto-Deploy braucht. Nach Schritt 1+2 oben
(Image gebaut + Package public) zwei Container anlegen:

**Container „postgres"** (Name = interner Hostname):
- Image `pgvector/pgvector:pg16`
- Env: `POSTGRES_USER=wgchat`, `POSTGRES_PASSWORD=<wählen>`, `POSTGRES_DB=wgchat`
- Volume: neu, Mount `/var/lib/postgresql/data`

**Container „backend"**:
- Image `ghcr.io/janno-alt/wg-chat-backend:latest`, Port `8787`
- Env: `NODE_ENV=production`, `PORT=8787`,
  `DATABASE_URL=postgres://wgchat:<pw>@postgres:5432/wgchat`,
  `LLM_PROVIDER=mistral`, `MISTRAL_API_KEY=<key>`,
  `MISTRAL_CHAT_MODEL=mistral-small-latest`, `MISTRAL_EMBED_MODEL=mistral-embed`,
  `EMBEDDING_DIMENSIONS=1024`, `ADMIN_API_KEY=<key>`,
  `PUBLIC_BASE_URL=https://chat.deine-domain.de`, `ALLOW_ALL_ORIGINS=false`

Migration läuft beim Start automatisch. Danach Domain → `backend:8787` (Schritt 5
unten) und seeden. **Keine Stack-ID, keine GitHub-Secrets nötig.**

## Variante B: automatisch per GitHub Action

Hier legst du **keinen Container von Hand** an – die Action schreibt beide Services
aus `deploy/stack.yaml` in den bereits vorhandenen **`default`-Stack** des Projekts.
Du brauchst nur dessen ID (`mw stack list` oder UI) + die Secrets/Variables unten.

## 0. Voraussetzungen

- mStudio-Tarif **mit Container Hosting** (nicht in allen Plänen – ggf. freischalten).
- `mw` CLI installiert & eingeloggt (`mw login`).
- Repo liegt auf GitHub.

## 1. Stack in mStudio anlegen (nach dem ersten Image-Build, siehe Reihenfolge oben)

Container-Stack im Projekt anlegen (GUI: *Containers → Create* mit dem bereits
gepushten Image, oder `mw stack deploy`) und dessen **Stack-ID** notieren – die
Action aktualisiert den Stack danach aus `deploy/stack.yaml`.

```bash
mw stack list           # Stack-ID herausfinden
```

## 2. GitHub Secrets & Variables setzen

**Secrets** (Repo → Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Inhalt |
|---|---|
| `MITTWALD_API_TOKEN` | API-Token aus mStudio (Profil → API-Tokens) |
| `POSTGRES_PASSWORD` | DB-Passwort – **nur Buchstaben/Zahlen** (URL-sicher!) |
| `MISTRAL_API_KEY` | EU-LLM-Key von Mistral La Plateforme |
| `ADMIN_API_KEY` | Schlüssel für den MCP-Server (`x-admin-key`) |
| `SESSION_SECRET` | zufälliger String (≥16 Zeichen) zum Signieren der Login-Cookies |
| `ADMIN_PASSWORD` | Passwort für den Dashboard-Login |

`GITHUB_TOKEN` ist automatisch vorhanden (Push nach GHCR).

**Variables** (*Variables*-Tab):

| Variable | Beispiel |
|---|---|
| `PUBLIC_BASE_URL` | `https://chat.wg-digital.xyz` |
| `MITTWALD_STACK_ID` | die Stack-ID aus Schritt 1 |
| `ADMIN_EMAIL` | Login-E-Mail fürs Dashboard (Bootstrap-Admin) |

## 3. GHCR-Image für Mittwald zugänglich machen

Das Backend-Image liegt nach dem ersten Build unter
`ghcr.io/<owner>/wg-chat-backend`. Mittwald muss es ziehen können – eine Variante:

- **Privat (empfohlen):** Registry-Zugang in mStudio hinterlegen –
  ```bash
  mw registry create --description "GHCR" --uri ghcr.io --username <github-user>
  # als Passwort einen GitHub PAT mit Scope read:packages eintragen
  ```
- **Öffentlich (einfachste Variante):** GHCR-Package auf *public* stellen
  (GitHub → Packages → Package settings → Visibility). Dann sind keine Zugangsdaten nötig.

## 4. Erstes Deploy auslösen

```bash
git tag v0.1.0 && git push origin v0.1.0     # oder: Actions → Workflow „Build & Deploy" → Run
```

Der Workflow baut das Image, pusht nach GHCR und ruft
`mittwald/deploy-container-action` mit `deploy/stack.yaml` auf. Das Backend führt
beim Start automatisch die (idempotente) **Migration** aus.

## 5. Domain + TLS verbinden (einmalig)

Backend-Container-UID ermitteln und VirtualHost auf Port 8787 zeigen lassen
(TLS/Let's Encrypt übernimmt Mittwald):

```bash
mw container list
mw domain virtualhost create \
  --hostname chat.kine.media \
  --path-to-container /:<backend-container-uid>:8787/tcp
```

## 6. Demo-Tenant seeden & verifizieren

```bash
# Seed im laufenden Backend-Container ausführen (legt Tenant "demo" + FAQ + Trigger an,
# erzeugt mit gesetztem MISTRAL_API_KEY auch die Embeddings):
mw container exec <backend-container-uid> -- npm run seed

# Health & Config
curl https://chat.kine.media/health
curl https://chat.kine.media/api/config/demo
curl https://chat.kine.media/w.js | head -c 60
```

**Chat-Kaskade (echte pgvector-DB → endlich volle E2E):**

```bash
# Hinweis: stack.yaml setzt ALLOW_ALL_ORIGINS=false. Für curl-Tests entweder
# temporär auf "true" setzen ODER eine erlaubte Domain beim Tenant pflegen.
curl -s -X POST https://chat.kine.media/api/chat \
  -H 'content-type: application/json' -H 'x-site-key: demo' \
  -d '{"sessionId":"t1","message":"Was kostet eine Website?"}'      # → source "faq", 0 LLM

curl -s -X POST https://chat.kine.media/api/chat \
  -H 'content-type: application/json' -H 'x-site-key: demo' \
  -d '{"sessionId":"t1","message":"Habt ihr ein Aquarium?"}'         # → "escalation", 0 LLM
```

Mit `MISTRAL_API_KEY` greifen zusätzlich Cache/Retrieval/RAG; jede LLM-/Embedding-
Nutzung landet in `llm_usage` (Pro-Kunde-Kosten).

## 7. Updates

Neuen Tag pushen → CI baut & deployt. Da `latest`/Tags genutzt werden, holt
Mittwald das neue Image. `deploy/stack.yaml` ist die Quelle der Wahrheit –
manuelle UI-Änderungen am Stack werden beim Deploy überschrieben.

## DSGVO

Mittwald = Hosting in Deutschland/EU; Chatverläufe + Embeddings in der EU-Postgres;
Mistral als EU-Provider. AVV mit Mittwald und Mistral abschließen. Claude/Anthropic
wird nur intern fürs MCP-Management genutzt (Phase 6), nie im Antwortpfad des Bots.

## Pro-Kunde-Trennung (Erinnerung)

Default ist Row-Level-Isolation über `tenant_id` + Origin-Whitelist je Tenant.
Für besonders sensible Kunden kann ein eigener Stack mit eigener Postgres
(eigenes Volume) gefahren werden – gleicher Code, vollständig isolierte Daten.
