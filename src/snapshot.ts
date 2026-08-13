import { existsSync, readFileSync, writeFileSync } from 'fs';
import crypto from 'crypto';
import { join } from 'path';
import * as readline from 'readline';
import type { OpenAPIObject, SchemaObject } from 'openapi3-ts';
import chalk from 'chalk';
import { defaultGetType, resolveTypeName } from './serviceGenerator';
import {
  ApiSnapshot,
  ApiSignature,
  PropertyInfo,
  FullDiffReport,
  ApiDiff,
  PropertyDiff,
} from './types';

const SNAPSHOT_FILENAME = '.openapi-snapshot.json';
const SNAPSHOT_VERSION = '1.0';

function createHash(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

function getSnapshotPath(): string {
  return join(process.cwd(), SNAPSHOT_FILENAME);
}

export function loadSnapshot(): ApiSnapshot | null {
  const path = getSnapshotPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as ApiSnapshot;
    if (!data || !data.version || !data.schemaHash || !Array.isArray(data.apis)) {
      console.warn(chalk.yellow(`[snapshot] ${SNAPSHOT_FILENAME} is corrupted, treating as first run.`));
      return null;
    }
    return data;
  } catch {
    console.warn(chalk.yellow(`[snapshot] Failed to read ${SNAPSHOT_FILENAME}, treating as first run.`));
    return null;
  }
}

export function saveSnapshot(snapshot: ApiSnapshot): void {
  const path = getSnapshotPath();
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

function flattenProperties(
  schema: SchemaObject | undefined,
  getTypeFn: (schema: SchemaObject | undefined, namespace?: string) => string,
  namespace: string = '',
): PropertyInfo[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }

  const resolved = schema.$ref ? getTypeFn(schema, namespace) : null;
  if (resolved && resolved !== 'any' && !resolved.startsWith('{')) {
    return [{ name: resolved, type: resolved, required: true }];
  }

  const props = schema.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }

  const requiredSet = new Set<string>();
  if (Array.isArray(schema.required)) {
    schema.required.forEach((r) => requiredSet.add(r));
  } else if (schema.required === true) {
    Object.keys(props).forEach((k) => requiredSet.add(k));
  }

  return Object.keys(props).map((key) => ({
    name: key,
    type: getTypeFn(props[key], namespace),
    required: requiredSet.has(key),
  }));
}

export function buildSnapshot(
  openAPI: OpenAPIObject,
  schemaPath: string,
  getTypeFn?: (schema: SchemaObject | undefined, namespace?: string) => string,
): ApiSnapshot {
  const getType = getTypeFn || ((s: SchemaObject | undefined, ns?: string) => defaultGetType(s, ns));
  const schemaHash = createHash(JSON.stringify(openAPI));

  const apis: ApiSignature[] = [];
  const paths = openAPI.paths;
  if (!paths) {
    return {
      version: SNAPSHOT_VERSION,
      generatedAt: new Date().toISOString(),
      schemaPath,
      schemaHash,
      apis: [],
    };
  }

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    const methods = ['get', 'put', 'post', 'delete', 'patch'];
    for (const method of methods) {
      const operation = (pathItem as any)[method];
      if (!operation) {
        continue;
      }

      const tags = operation.tags || [];
      const tag = tags[0] || resolveTypeName(rawPath.replace(/^\//, '').split('/')[0]) || 'default';
      const operationId = operation.operationId || `${method}${rawPath.replace(/[^a-zA-Z0-9]/g, '')}`;
      const functionName = operationId;
      const apiId = `${method.toUpperCase()}:${rawPath}`;

      const paramProps: PropertyInfo[] = [];
      if (Array.isArray(operation.parameters)) {
        for (const param of operation.parameters) {
          const p = param as any;
          if (p.in === 'header') continue;
          paramProps.push({
            name: p.name || '',
            type: getType(p.schema, ''),
            required: !!p.required,
          });
        }
      }

      const bodyProps: PropertyInfo[] = [];
      if (operation.requestBody) {
        const rb = operation.requestBody as any;
        const resolvedBody = rb.$ref ? rb : rb;
        const content = resolvedBody.content || {};
        const contentType = Object.keys(content).find(
          (ct) => ct === 'application/json' || ct === 'multipart/form-data',
        ) || Object.keys(content)[0];
        if (contentType && content[contentType] && content[contentType].schema) {
          const schema = content[contentType].schema;
          bodyProps.push(...flattenProperties(schema, getType, ''));
        }
      }

      const responseProps: PropertyInfo[] = [];
      let responseHashValue = 'none';
      const responses = operation.responses || {};
      const respCode = (responses as any)['200'] || (responses as any)['201'] || (responses as any)['default'];
      if (respCode && respCode.content) {
        const respContent = respCode.content;
        const respType = Object.keys(respContent).find(
          (ct) => ct === 'application/json',
        ) || Object.keys(respContent)[0];
        if (respType && respContent[respType] && respContent[respType].schema) {
          const respSchema = respContent[respType].schema;
          responseProps.push(...flattenProperties(respSchema, getType, ''));
          const respJson = JSON.stringify(respSchema);
          responseHashValue = createHash(respJson);
        }
      }

      apis.push({
        id: apiId,
        functionName,
        tag,
        params: paramProps,
        body: bodyProps,
        response: responseProps,
        responseHash: responseHashValue,
      });
    }
  }

  apis.sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    schemaPath,
    schemaHash,
    apis,
  };
}

function diffProperties(before: PropertyInfo[], after: PropertyInfo[]): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const beforeMap = new Map(before.map((p) => [p.name, p]));
  const afterMap = new Map(after.map((p) => [p.name, p]));

  for (const [name, bProp] of beforeMap) {
    const aProp = afterMap.get(name);
    if (!aProp) {
      diffs.push({
        property: name,
        change: 'removed',
        before: `${bProp.type}${bProp.required ? '' : '?'}`,
      });
    } else {
      if (bProp.type !== aProp.type) {
        diffs.push({
          property: name,
          change: 'typeChanged',
          before: bProp.type,
          after: aProp.type,
        });
      }
      if (bProp.required !== aProp.required) {
        diffs.push({
          property: name,
          change: 'requiredChanged',
          before: bProp.required ? 'required' : 'optional',
          after: aProp.required ? 'required' : 'optional',
        });
      }
    }
  }

  for (const [name, aProp] of afterMap) {
    if (!beforeMap.has(name)) {
      diffs.push({
        property: name,
        change: 'added',
        after: `${aProp.type}${aProp.required ? '' : '?'}`,
      });
    }
  }

  return diffs;
}

export function computeDiff(previous: ApiSnapshot | null, current: ApiSnapshot): FullDiffReport {
  const report: FullDiffReport = {
    hasChanges: false,
    schemaChanged: false,
    added: [],
    removed: [],
    modified: [],
  };

  if (!previous) {
    report.hasChanges = current.apis.length > 0;
    return report;
  }

  if (previous.schemaHash !== current.schemaHash) {
    report.schemaChanged = true;
  }

  const prevMap = new Map(previous.apis.map((a) => [a.id, a]));
  const currMap = new Map(current.apis.map((a) => [a.id, a]));

  for (const [id, curr] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      report.added.push({ type: 'added', id, functionName: curr.functionName, tag: curr.tag });
    } else {
      const paramDiffs = diffProperties(prev.params, curr.params);
      const bodyDiffs = diffProperties(prev.body, curr.body);
      const responseDiffs = diffProperties(prev.response, curr.response);
      const allDiffs = [...paramDiffs, ...bodyDiffs, ...responseDiffs];

      if (allDiffs.length > 0 || prev.responseHash !== curr.responseHash) {
        const categories: ('params' | 'body' | 'response')[] = [];
        if (paramDiffs.length) categories.push('params');
        if (bodyDiffs.length || (prev.responseHash !== curr.responseHash && prev.body.length === 0)) categories.push('body');
        if (responseDiffs.length || prev.responseHash !== curr.responseHash) categories.push('response');

        const enrichedDiffs: PropertyDiff[] = [];
        for (const d of paramDiffs) {
          enrichedDiffs.push({ ...d, property: `[params] ${d.property}` });
        }
        for (const d of bodyDiffs) {
          enrichedDiffs.push({ ...d, property: `[body] ${d.property}` });
        }
        for (const d of responseDiffs) {
          enrichedDiffs.push({ ...d, property: `[response] ${d.property}` });
        }

        if (prev.responseHash !== curr.responseHash && !responseDiffs.length) {
          enrichedDiffs.push({
            property: '[response]',
            change: 'typeChanged',
            before: `hash:${prev.responseHash.slice(0, 8)}...`,
            after: `hash:${curr.responseHash.slice(0, 8)}...`,
          });
        }

        report.modified.push({
          type: 'modified',
          id,
          functionName: curr.functionName,
          tag: curr.tag,
          propertyDiffs: enrichedDiffs,
          changedCategories: categories.length ? categories : ['response'],
        });
      }
    }
  }

  for (const [id, prev] of prevMap) {
    if (!currMap.has(id)) {
      report.removed.push({ type: 'removed', id, functionName: prev.functionName, tag: prev.tag });
    }
  }

  report.hasChanges =
    report.added.length > 0 || report.removed.length > 0 || report.modified.length > 0;
  return report;
}

function formatPropertyDiff(diff: PropertyDiff): string {
  switch (diff.change) {
    case 'added':
      return chalk.dim('+ ') + `${diff.property}: ${diff.after}`;
    case 'removed':
      return chalk.dim('- ') + `${diff.property}: ${diff.before}`;
    case 'typeChanged':
      return chalk.dim('~ ') + `${diff.property}: ${chalk.red(diff.before)} → ${chalk.green(diff.after)}`;
    case 'requiredChanged':
      return chalk.dim('~ ') + `${diff.property}: ${chalk.red(diff.before)} → ${chalk.green(diff.after)}`;
    default:
      return diff.property;
  }
}

export function printDiffReport(report: FullDiffReport): void {
  console.log('');

  if (report.schemaChanged) {
    console.log(chalk.blue('[snapshot]') + ' OpenAPI schema has changed.');
  }

  if (!report.hasChanges) {
    console.log(chalk.green('[snapshot]') + ' No API changes detected.');
    console.log('');
    return;
  }

  const total = report.added.length + report.removed.length + report.modified.length;
  console.log(chalk.bold('[snapshot]') + ` ${total} change${total === 1 ? '' : 's'} detected:`);
  console.log('');

  if (report.added.length > 0) {
    console.log(chalk.green('  +' + ' ADDED (' + report.added.length + ')'));
    for (const api of report.added) {
      console.log(chalk.green(`    + ${api.id}`));
      console.log(chalk.green(`      → ${api.functionName} (tag: ${api.tag})`));
    }
    console.log('');
  }

  if (report.removed.length > 0) {
    console.log(chalk.red('  - REMOVED (' + report.removed.length + ')'));
    for (const api of report.removed) {
      console.log(chalk.red(`    - ${api.id}`));
      console.log(chalk.red(`      → ${api.functionName} (tag: ${api.tag})`));
    }
    console.log('');
  }

  if (report.modified.length > 0) {
    console.log(chalk.yellow('  ~ MODIFIED (' + report.modified.length + ')'));
    for (const api of report.modified) {
      console.log(chalk.yellow(`    ~ ${api.id}`));
      console.log(chalk.yellow(`      → ${api.functionName} (tag: ${api.tag})`));
      if (api.propertyDiffs) {
        for (const d of api.propertyDiffs) {
          console.log('        ' + formatPropertyDiff(d));
        }
      }
    }
    console.log('');
  }
}

export function confirmRemovals(removed: ApiDiff[]): Promise<boolean> {
  if (removed.length === 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.red('[snapshot]') + ` ${removed.length} API${removed.length === 1 ? '' : 's'} will be removed from generated files.`);
    console.log(chalk.dim('  The corresponding generated files/functions will be deleted on next generation.'));
    console.log('');

    rl.question(
      chalk.bold('  Continue with generation? (deleted APIs cannot be recovered) [y/N]: '),
      (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes');
      },
    );
  });
}
