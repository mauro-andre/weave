# Weave Todos — a from-scratch example

A small VeloJS todo app built on **Weave**, exactly as a real user would: run the
Weave server with Docker, design entities in code, push them, and drive everything
through the typed SDK. No SQL anywhere.

```
test-app/
  docker-compose.yml      # Postgres 17 + the Weave server (ghcr.io/mauro-andre/weave)
  weave.config.ts         # points the CLI at the weave/ folder
  weave/entities/         # list.ts, todo.ts — your data model, as code
  app/                    # the VeloJS app (loader + actions + UI)
    weave.ts              # the configured SDK client (server-side only)
    Todos.tsx
```

## 1. Start Weave

```bash
docker compose up -d
```

This brings up Postgres 17 and the Weave server at **http://localhost:3100**
(port 3000 is left free for the app's dev server).

> The image is `ghcr.io/mauro-andre/weave:latest`. If the pull fails because the
> package is private, run `docker login ghcr.io` first.

## 2. Get an API key

Open **http://localhost:3100**, sign in with `master` / `master`, and create an API
key on the API page. Then:

```bash
cp .env.example .env
# paste the key into WEAVE_KEY
```

## 3. Push the entities

The data model lives in `weave/entities/`. Push it to the server:

```bash
npm install
npm run push        # weave push — creates `list` and `todo` on the server
```

## 4. Run the app

```bash
npm run dev         # http://localhost:3000
```

Add lists, add todos, check them off. Every read is a `weave.todo.find({ expand:
{ list: true } })`; every change is a typed `create` / `update` / `delete` — all
running server-side in VeloJS loaders and actions, with the database invisible.

## How it talks to Weave

`app/weave.ts` builds the client once from the environment:

```ts
import { createClient } from "@mauroandre/weave-sdk";
import list from "../weave/entities/list.js";
import todo from "../weave/entities/todo.js";

export const weave = createClient({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  entities: { list, todo },
});
```

It's imported only inside loaders and actions (`await import("./weave.js")`), so the
god-mode key never reaches the browser.
