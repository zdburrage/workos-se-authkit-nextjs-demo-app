#!/usr/bin/env node

/**
 * Environment seed script — tears down non-essential users and re-creates
 * the demo environment from seed-config.json.
 *
 * Preserves directory-managed users (synced via SCIM/directory sync).
 * Resolves org references by name so the config stays readable.
 *
 * Usage:
 *   npm run seed            # tear down + re-seed
 *   npm run seed -- --dry   # preview what would happen
 *   npm run seed -- --clean # tear down only, no re-seed
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Env loading (same as dev-tunnel) ---
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
    // File doesn't exist
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

const API_KEY = process.env.WORKOS_API_KEY;
const API_HOST = process.env.WORKOS_API_HOSTNAME || "api.workos.com";

if (!API_KEY) {
  console.error("\x1b[31m✗ WORKOS_API_KEY is required in .env.local\x1b[0m");
  process.exit(1);
}

const DRY = process.argv.includes("--dry");
const CLEAN_ONLY = process.argv.includes("--clean");
const CONFIG_PATH =
  process.argv.find((a) => a.startsWith("--config="))?.split("=")[1] ||
  resolve(import.meta.dirname, "seed-config.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

// --- API helpers ---
const baseUrl = `https://${API_HOST}`;
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
      await sleep(retryAfter * 1000);
      return api(method, path, body);
    }
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function paginate(path) {
  const results = [];
  let after = null;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const url = after ? `${path}${sep}after=${after}&limit=100` : `${path}${sep}limit=100`;
    const res = await api("GET", url);
    const items = res.data || [];
    results.push(...items);
    if (!res.list_metadata?.after) break;
    after = res.list_metadata.after;
  }
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Core logic ---
async function resolveOrgMap() {
  console.log("\x1b[36m⟳ Loading organizations...\x1b[0m");
  const orgs = await paginate("/organizations");
  const map = {};
  for (const org of orgs) {
    map[org.name] = org.id;
  }
  return map;
}

async function getExistingUsers() {
  console.log("\x1b[36m⟳ Loading existing users...\x1b[0m");
  return paginate("/user_management/users");
}

async function getUserMemberships(userId) {
  return paginate(`/user_management/organization_memberships?user_id=${userId}`);
}

async function isDirectoryManaged(userId) {
  const memberships = await getUserMemberships(userId);
  return memberships.some((m) => m.directory_managed);
}

async function teardown(existingUsers) {
  console.log("\n\x1b[33m⟳ Tearing down existing users...\x1b[0m");
  let deleted = 0;
  let skipped = 0;

  for (const user of existingUsers) {
    if (config.settings.preserveDirectoryManagedUsers) {
      const managed = await isDirectoryManaged(user.id);
      if (managed) {
        console.log(`  \x1b[90m↷ Skip (directory-managed): ${user.email}\x1b[0m`);
        skipped++;
        continue;
      }
    }

    if (DRY) {
      console.log(`  \x1b[90m⊘ Would delete: ${user.email}\x1b[0m`);
      deleted++;
    } else {
      try {
        await api("DELETE", `/user_management/users/${user.id}`);
        console.log(`  \x1b[31m✗ Deleted: ${user.email}\x1b[0m`);
        deleted++;
      } catch (err) {
        console.error(`  \x1b[31m✗ Failed to delete ${user.email}: ${err.message}\x1b[0m`);
      }
    }
    await sleep(200);
  }

  console.log(
    `\n  ${DRY ? "Would delete" : "Deleted"}: ${deleted} | Skipped: ${skipped}`
  );
}

async function seed(orgMap) {
  console.log("\n\x1b[32m⟳ Seeding users...\x1b[0m");
  const password = config.settings.defaultPassword;

  for (const userDef of config.users) {
    // Resolve org names to IDs
    const orgIds = (userDef.memberships || []).map((name) => {
      const id = orgMap[name];
      if (!id) {
        console.error(`  \x1b[31m✗ Unknown org "${name}" — skipping membership\x1b[0m`);
      }
      return id;
    }).filter(Boolean);

    if (DRY) {
      console.log(`  \x1b[90m⊘ Would create: ${userDef.email} → [${userDef.memberships.join(", ")}]\x1b[0m`);
      continue;
    }

    // Create user
    try {
      const body = {
        email: userDef.email,
        first_name: userDef.firstName,
        last_name: userDef.lastName,
        password,
        ...(userDef.metadata && { metadata: userDef.metadata }),
      };
      const user = await api("POST", "/user_management/users", body);
      console.log(`  \x1b[32m✓ Created: ${user.email} (${user.id})\x1b[0m`);

      // Verify email
      if (config.settings.verifyEmails) {
        await api("PUT", `/user_management/users/${user.id}`, {
          email_verified: true,
        });
      }

      // Create org memberships
      for (const orgId of orgIds) {
        await api("POST", "/user_management/organization_memberships", {
          user_id: user.id,
          organization_id: orgId,
        });
        const orgName = Object.entries(orgMap).find(([, id]) => id === orgId)?.[0];
        console.log(`    \x1b[32m↪ Added to ${orgName}\x1b[0m`);
      }

      // Set metadata (if not set during creation — older API versions)
      if (userDef.metadata && !user.metadata?.deny_login) {
        await api("PUT", `/user_management/users/${user.id}`, {
          metadata: userDef.metadata,
        });
      }
    } catch (err) {
      console.error(`  \x1b[31m✗ Failed to create ${userDef.email}: ${err.message}\x1b[0m`);
    }

    await sleep(200);
  }
}

// --- Main ---
async function main() {
  if (DRY) console.log("\x1b[33m⚠ DRY RUN — no changes will be made\x1b[0m\n");

  const orgMap = await resolveOrgMap();
  const existingUsers = await getExistingUsers();

  console.log(`  Found ${existingUsers.length} existing users, ${Object.keys(orgMap).length} organizations`);

  // Validate org references before doing anything
  if (!CLEAN_ONLY) {
    const missing = [];
    for (const u of config.users) {
      for (const orgName of u.memberships || []) {
        if (!orgMap[orgName]) missing.push(orgName);
      }
    }
    if (missing.length) {
      console.error(`\n\x1b[31m✗ Unknown orgs in config: ${[...new Set(missing)].join(", ")}\x1b[0m`);
      console.error("  Available orgs:", Object.keys(orgMap).join(", "));
      process.exit(1);
    }
  }

  await teardown(existingUsers);

  if (!CLEAN_ONLY) {
    await seed(orgMap);
  }

  console.log("\n\x1b[32m✓ Done!\x1b[0m");
}

main().catch((err) => {
  console.error("\x1b[31mFatal:\x1b[0m", err.message);
  process.exit(1);
});
