# Repo Intelligence

**Local codebase Q&A with source-grounded answers.** Repo Intelligence indexes source files, chunks them by code structure, embeds them locally, and answers architecture questions with citations.

**Demo:** [Repo Intelligence](https://christopherhammer.dev/assets/videos/narrated/project-demos/repo-intelligence-narrated.mp4)

## Who Uses It

- New engineers joining a repo
- Tech leads auditing unfamiliar code
- Coding agents that need context before editing
- Solo builders returning to an old project
- Teams that want local code understanding without uploading private source

## Core Features

- Upload/index TypeScript, JavaScript, Python, Go, Rust, and Markdown files
- Chunk code by functions, classes, and headings
- Local embeddings with Ollama/nomic-embed-text
- LanceDB vector storage
- Source-cited answers
- Local Next.js app and desktop packaging path

## Example Questions

- Where does license validation happen?
- Which files control the onboarding flow?
- What should change to add PDF export?
- Which tests cover this module?

## Quick Start

```bash
npm install
ollama pull llama3.2
ollama pull nomic-embed-text
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Portfolio Context

Repo Intelligence is the context layer a serious coding agent needs before making changes. It pairs naturally with Craig, Surgical Code Editor, and Code Reviewer.

---

Built by **Christopher L. Hammer** - self-taught AI/product builder shipping local-first tools, demos, and real product surfaces.

- Portfolio: [christopherhammer.dev](https://christopherhammer.dev)
- Proof demos: [https://christopherhammer.dev#proof](https://christopherhammer.dev#proof)
- GitHub: [christopherlhammer11-ai](https://github.com/christopherlhammer11-ai)

