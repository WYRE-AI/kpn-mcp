#!/usr/bin/env node
/**
 * Optional live smoke for the Grexx acceptatie pilot.
 *
 * Skips with exit 0 when KPN_GREXX_USERNAME, KPN_GREXX_PASSWORD or
 * KPN_GREXX_BASE_URL is unset, so CI never calls Grexx.
 *
 * When all three are set (after `npm run build`):
 *   1. kpn_grexx_test_connection
 *   2. kpn_grexx_zipcode_check
 *
 * Zipcode defaults: portfolio All, 1012JS, house 1, isRoomNumberKnown false.
 * Override with KPN_GREXX_SMOKE_PORTFOLIO, KPN_GREXX_SMOKE_ZIPCODE,
 * KPN_GREXX_SMOKE_HOUSE_NUMBER.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['KPN_GREXX_USERNAME', 'KPN_GREXX_PASSWORD', 'KPN_GREXX_BASE_URL'];

function textOf(result) {
  const content = result?.content?.[0];
  return content?.type === 'text' ? content.text : JSON.stringify(result);
}

async function main() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.log(`smoke:grexx skipped (unset: ${missing.join(', ')}). No Grexx call was made.`);
    process.exit(0);
  }

  const handlersPath = resolve(root, 'dist/handlers/index.js');
  const serverPath = resolve(root, 'dist/mcp-server.js');
  if (!existsSync(handlersPath) || !existsSync(serverPath)) {
    console.error('smoke:grexx needs a build. Run `npm run build` first.');
    process.exit(1);
  }

  const { handleToolCall } = await import(handlersPath);
  const { resolveEnvCredentials } = await import(serverPath);
  const { KpnGrexxClient } = await import('@wyre-ai/node-kpn');

  const { creds, error } = resolveEnvCredentials();
  if (!creds?.baseUrl) {
    console.error(error ?? 'KPN_GREXX_BASE_URL is required.');
    process.exit(1);
  }

  const client = new KpnGrexxClient({
    username: creds.username,
    password: creds.password,
    baseUrl: creds.baseUrl,
    authMode: creds.authMode,
    tokenUrl: creds.tokenUrl,
    scope: creds.scope,
  });

  const houseRaw = process.env.KPN_GREXX_SMOKE_HOUSE_NUMBER ?? '1';
  const houseNumber = Number(houseRaw);
  if (!Number.isInteger(houseNumber) || houseNumber < 1) {
    console.error('KPN_GREXX_SMOKE_HOUSE_NUMBER must be a positive integer.');
    process.exit(1);
  }

  console.log('kpn_grexx_test_connection');
  const connection = await handleToolCall(client, 'kpn_grexx_test_connection', {});
  console.log(textOf(connection));
  if (connection.isError) process.exit(1);

  const zipArgs = {
    portfolio: process.env.KPN_GREXX_SMOKE_PORTFOLIO ?? 'All',
    zipCode: process.env.KPN_GREXX_SMOKE_ZIPCODE ?? '1012JS',
    houseNumber,
    isRoomNumberKnown: false,
  };
  console.log(`kpn_grexx_zipcode_check ${zipArgs.portfolio} ${zipArgs.zipCode} ${zipArgs.houseNumber}`);
  const zip = await handleToolCall(client, 'kpn_grexx_zipcode_check', zipArgs);
  console.log(textOf(zip));
  if (zip.isError) process.exit(1);

  console.log('smoke:grexx passed.');
}

main().catch((error) => {
  console.error('smoke:grexx failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
