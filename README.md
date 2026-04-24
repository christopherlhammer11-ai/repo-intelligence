# Repo Intelligence

Repo Intelligence is a local desktop-first codebase Q&A tool. It ingests source files, chunks them by code structure, embeds them with Ollama, stores vectors in LanceDB, and answers repository questions with cited source chunks.

## What it does

- Upload or drag in `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, and `.md` files
- Chunk code along logical boundaries like functions, classes, and markdown headings
- Generate embeddings locally with `nomic-embed-text`
- Store vectors locally in LanceDB
- Ask grounded questions against the indexed codebase with cited file and line references
- Run as either a local Next.js app or a packaged macOS desktop app

## Local app setup

1. Install dependencies:

```bash
npm install
```

2. Make sure Ollama is running and the required models are installed:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

3. Start the web app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Desktop app setup

The Electron build wraps the same Next.js app into a local desktop shell. Indexed vectors and uploaded files are stored in the user app data directory instead of the repo folder.

On macOS, the default storage location is:

```bash
~/Library/Application Support/Repo Intelligence
```

You can override that location with:

```bash
REPO_INTELLIGENCE_DATA_ROOT=/custom/path
```

### Run the desktop app in development

```bash
npm run desktop:dev
```

### Build a macOS DMG

```bash
npm run electron:build:mac
```

The output lands in:

```bash
dist-electron/Repo-Intelligence.dmg
```

## Environment

Copy `.env.example` to `.env.local` if you want to override the defaults.

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434/api
OLLAMA_CHAT_MODEL=llama3.2:latest
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_NUM_CTX=4096
```

## Project structure

```bash
repo-intelligence/
├── app/
│   ├── api/
│   │   ├── chat/route.ts
│   │   └── ingest/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── repo-intelligence-app.tsx
│   └── ui/
├── electron/
│   └── main.js
├── lib/
│   ├── app-paths.ts
│   ├── chunker.ts
│   ├── embeddings.ts
│   ├── utils.ts
│   └── vectorstore.ts
├── public/
├── .env.example
├── next.config.ts
└── package.json
```
