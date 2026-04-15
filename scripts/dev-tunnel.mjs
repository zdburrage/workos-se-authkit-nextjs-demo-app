#!/usr/bin/env node

/**
 * Dev tunnel script — starts an ngrok tunnel and Next.js dev server together.
 *
 * Uses a free ngrok static domain so the URL stays the same across restarts.
 * Configure the actions endpoint once in the WorkOS Dashboard and forget about it.
 *
 * Required env vars (in .env.local):
 *   NGROK_AUTHTOKEN  — from https://dashboard.ngrok.com/get-started/your-authtoken
 *   NGROK_DOMAIN     — your free static domain, e.g. "my-demo.ngrok-free.app"
 *                      Claim one at https://dashboard.ngrok.com/domains
 *
 * Usage:
 *   npm run dev:tunnel
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually (Node scripts don't get Next.js env loading)
function loadEnvFile(filepath) {
  try {
    const content = readFileSync(filepath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // File doesn't exist, that's fine
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN;
const NGROK_DOMAIN = process.env.NGROK_DOMAIN;

// If ngrok isn't configured, fall back to plain `next dev` so the app still
// runs locally. WorkOS Actions won't be reachable, but everything else works.
if (!NGROK_AUTHTOKEN) {
  console.log(
    "\x1b[33m⚠ NGROK_AUTHTOKEN not set — starting without tunnel.\x1b[0m\n" +
      "  WorkOS Actions webhooks will not be reachable.\n" +
      "  Add NGROK_AUTHTOKEN to .env.local to enable the tunnel.\n"
  );
  const proc = spawn("npx", ["next", "dev"], { stdio: "inherit" });
  proc.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => proc.kill("SIGTERM"));
  process.on("SIGTERM", () => proc.kill("SIGTERM"));
} else {
  if (!NGROK_DOMAIN) {
    console.error(
      "\x1b[33m⚠ NGROK_DOMAIN not set — tunnel URL will change on every restart.\x1b[0m\n" +
        "  Claim a free static domain at: https://dashboard.ngrok.com/domains\n" +
        "  Add it to .env.local: NGROK_DOMAIN=your-name.ngrok-free.app"
    );
  }
  startWithTunnel();
}

let ngrokModule;
let nextProc;
let shuttingDown = false;

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n\x1b[36m⟳ Shutting down...\x1b[0m");

  if (nextProc) nextProc.kill("SIGTERM");

  // Always disconnect ngrok cleanly to prevent orphaned sessions
  try {
    if (ngrokModule) await ngrokModule.default.disconnect();
  } catch {
    // Best effort
  }

  // Give processes a moment to exit, then force quit
  setTimeout(() => process.exit(0), 2000);
}

function startWithTunnel() {
  // Register cleanup handlers only for the tunnel path
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanup();
  });
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err);
    cleanup();
  });

  main().catch(async (err) => {
    console.error("Failed to start tunnel:", err.message);
    await cleanup();
  });
}

async function main() {
  ngrokModule = await import("@ngrok/ngrok");

  console.log("\x1b[36m⟳ Starting ngrok tunnel...\x1b[0m");

  const listenerOpts = {
    addr: "localhost:3000",
    authtoken: NGROK_AUTHTOKEN,
  };

  if (NGROK_DOMAIN) {
    listenerOpts.domain = NGROK_DOMAIN;
  }

  const listener = await ngrokModule.default.forward(listenerOpts);
  const tunnelUrl = listener.url();

  console.log(`\x1b[32m✓ Tunnel ready:\x1b[0m ${tunnelUrl}`);
  console.log(
    `\x1b[32m✓ Actions endpoint:\x1b[0m ${tunnelUrl}/api/actions`
  );
  console.log(
    "\x1b[90m  → Set this as your Action URL in the WorkOS Dashboard under Actions\x1b[0m\n"
  );

  // Start Next.js dev server
  nextProc = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_TUNNEL_URL: tunnelUrl,
    },
  });

  nextProc.on("exit", (code) => {
    if (!shuttingDown) cleanup();
  });
}
