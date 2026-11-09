# 🌌 Cosmos Scintillation

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Cosmos Scintillation** is a lightweight desktop workbench for building the backend of an app or game. Create a project, design its database, build a secured API or WebSocket server by dragging blocks, try it all out on a safe copy of your data, and export real code and SQL when you are ready. A built-in launcher starts local services for testing, in the style of XAMPP.

---

## ✨ Features

- **🗂️ Project-Based Workflow:** Everything lives in one project folder. Pick the kind of database you want when you create it, and add APIs, WebSockets and links to your own services as you go.
- **🗄️ Every Kind of Database:** Design SQL, Postgres, MySQL, MariaDB, SQL Server, SQLite, MongoDB and Redis style databases. Engines are plain YAML files, so adding another is a copy and edit.
- **🕸️ Visual Schema Preview:** A Supabase-style diagram of your tables, their column types and the connections between them. Drag tables around, pan, zoom, and draw relations between columns.
- **📊 Data Grid:** Browse and edit rows page by page. Add made-up rows with **Dummy data** (values follow the column name and type), or press **Auto fill** on a new row. Columns can create their own uuid.
- **🧩 Visual API Builder:** Build REST APIs and WebSocket servers by dragging blocks and wiring them together, no code needed. Start from a template: one route, a WebSocket chat, or all five routes of a table (list, read, create, change, delete). A **Data** tab lets you pick a table's columns and add them as blocks.
- **🧪 Built-In Tester:** Send requests to your API, or messages to your WebSocket, and see the answer, every block that ran, and the log. It works on a safe copy of your data, so nothing is saved. The database has its own tester for lookups, trying a row, and checking every row for broken rules.
- **🌍 Many Languages:** Export the same visual script as TypeScript, Go, Ruby, Rust, C# or Python, and choose package add-ons for the language you pick.
- **🔒 Secure by Default:** Exported APIs include security headers, an API key checked in constant time, a website allow-list (CORS), request size and rate limits, safe error messages, and a data store that only accepts the fields your tables define.
- **💾 Portable Scripts:** Save a visual script as a `.cosmos-script.yaml` file and import it into another project.
- **🛡️ Safe Deleting:** Deleting a table, a database or many rows always asks you to confirm first.
- **🚀 Local Launcher:** Start and stop local services (such as MariaDB, MySQL, PostgreSQL, MongoDB, Redis or a static file server) from one place.
- **🔌 Extensions:** Add engines, languages, blocks, services and themes with simple YAML files. Extensions are data only, so they never run code.
- **🎨 Simple Themes & Motion:** A few clean themes and smooth animations that follow a motion setting.
- **⚡ Light on Memory:** Rows are read one page at a time, views load only when opened, and large boards draw only the blocks on screen.

---

## 🚀 Tech Stack

- **Desktop Shell:** Electron
- **Frontend:** React + TypeScript
- **Styling:** CSS Modules
- **Build:** electron-vite
- **Definitions:** YAML (engines, languages, blocks, services, themes)

---

## 🛠️ Getting Started

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development |
| `npm run build` | Build the app |
| `npm run dist` | Build and package an installer |
| `npm run typecheck` | Check the TypeScript |
| `npm run check:yaml` | Check that every built-in YAML file parses |
| `npm run smoke` | Generate an API in every language and run the tester against it |

---

## 📁 Project Layout

```
scripts/
├── common/      Shared code: models, exporters, code generation, the tester
├── defaults/    Built-in engines, languages, blocks, services, themes, keybinds
├── preload/     The bridge between the window and the main process
└── ui/          The main process entry, controllers and views
docs/FORMATS.md  How to write languages, blocks and scripts
tools/           Smoke test and YAML check
```

To add your own engine, language, block or theme, copy a file from `scripts/defaults/` and edit it. `docs/FORMATS.md` describes every field.

---

## 📄 License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.
