#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import {
  SCHEMA_VERSION,
  computeAssetId,
  verifyAssetId,
  canonicalize,
  GEP_GENE_CATEGORIES,
  GEP_OUTCOME_STATUSES,
} from '@evomap/gep-sdk';

function readStdin() {
  return readFileSync(0, 'utf8');
}

function stampAsset(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('asset must be object');
  if (!asset.schema_version) asset.schema_version = SCHEMA_VERSION;
  delete asset.asset_id;
  asset.asset_id = computeAssetId(asset);
  return asset;
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function unwrapStore(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
}

function schemaValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schemaDir = resolve('node_modules/@evomap/gep-sdk/schemas');
  const schemas = {
    Gene: readJson(resolve(schemaDir, 'gene.schema.json'), null),
    Capsule: readJson(resolve(schemaDir, 'capsule.schema.json'), null),
    EvolutionEvent: readJson(resolve(schemaDir, 'evolution-event.schema.json'), null),
    Mutation: readJson(resolve(schemaDir, 'mutation.schema.json'), null),
  };
  const validators = {};
  for (const [type, schema] of Object.entries(schemas)) {
    if (schema) validators[type] = ajv.compile(schema);
  }
  return validators;
}

function validateAssets(payload = {}) {
  const assetsDir = payload.assets_dir || 'assets';
  const validators = schemaValidator();
  const genes = unwrapStore(readJson(resolve(assetsDir, 'genes.json'), { genes: [] }), 'genes');
  const capsules = unwrapStore(readJson(resolve(assetsDir, 'capsules.json'), { capsules: [] }), 'capsules');
  const eventLines = (() => {
    try { return readFileSync(resolve(assetsDir, 'events.jsonl'), 'utf8').split(/\n/).filter(Boolean); }
    catch { return []; }
  })();
  const events = eventLines.map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'EvolutionEvent', id: 'invalid_json', __parse_error: line }; }
  });
  const assets = [...genes, ...capsules, ...events];
  const results = assets.map((asset) => {
    const validate = validators[asset?.type];
    const schemaOk = validate ? validate(asset) : false;
    const hashOk = verifyAssetId(asset);
    return {
      id: asset?.id || null,
      type: asset?.type || null,
      schema_ok: !!schemaOk,
      hash_ok: !!hashOk,
      ok: !!schemaOk && !!hashOk,
      errors: schemaOk ? [] : (validate?.errors || [{ message: `unsupported asset type ${asset?.type}` }]).map((e) => ({ instancePath: e.instancePath, message: e.message })),
    };
  });
  return { ok: results.every((r) => r.ok), total: results.length, results };
}

const cmd = process.argv[2] || 'info';

if (cmd === 'info') {
  console.log(JSON.stringify({
    ok: true,
    sdk: '@evomap/gep-sdk',
    schema_version: SCHEMA_VERSION,
    gene_categories: GEP_GENE_CATEGORIES,
    outcome_statuses: GEP_OUTCOME_STATUSES,
  }, null, 2));
} else if (cmd === 'stamp') {
  const asset = JSON.parse(readStdin());
  console.log(JSON.stringify(stampAsset(asset), null, 2));
} else if (cmd === 'verify') {
  const asset = JSON.parse(readStdin());
  console.log(JSON.stringify({ ok: verifyAssetId(asset), expected: computeAssetId(asset), claimed: asset.asset_id || null }, null, 2));
} else if (cmd === 'validate-schema') {
  const input = readStdin().trim();
  const payload = input ? JSON.parse(input) : {};
  console.log(JSON.stringify(validateAssets(payload), null, 2));
} else if (cmd === 'canonicalize') {
  const asset = JSON.parse(readStdin());
  process.stdout.write(canonicalize(asset));
} else {
  console.error('Usage: node scripts/gep_bridge.mjs info|stamp|verify|validate-schema|canonicalize');
  process.exit(2);
}
