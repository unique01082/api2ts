const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const { generateService, getSchema } = require('../dist/index');

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });

const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const testAuthorizationHeader = async () => {
  const receivedHeaders = [];
  const server = http.createServer((request, response) => {
    receivedHeaders.push(request.headers);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ openapi: '3.0.0', info: { title: 'test', version: '1.0.0' }, paths: {} }));
  });
  const address = await listen(server);
  const schemaUrl = `http://${address.address}:${address.port}/openapi.json`;

  try {
    await getSchema(schemaUrl);
    await getSchema(schemaUrl, 'Bearer secret');
  } finally {
    await close(server);
  }

  assert.strictEqual(receivedHeaders[0].authorization, undefined);
  assert.strictEqual(receivedHeaders[1].authorization, 'Bearer secret');
};

const assertTypescriptParses = (filePath) => {
  const program = ts.createProgram([filePath], { noEmit: true, skipLibCheck: true });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  assert.deepStrictEqual(diagnostics, []);
};

const compileGeneratedTypescript = (outputPath) => {
  fs.writeFileSync(
    path.join(outputPath, 'request.ts'),
    'export default function request<T>(_url: string, _options: unknown): Promise<T> { return Promise.resolve(undefined as T); }\n',
  );
  const files = fs
    .readdirSync(outputPath)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => path.join(outputPath, fileName));
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2015,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

const testDeclareTypeIsOptIn = async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'api2ts-declare-type-'));
  const schemaPath = path.join(__dirname, 'example-files/swagger-custom-hook.json');

  try {
    await generateService({ schemaPath, serversPath: path.join(outputRoot, 'default') });
    await generateService({
      schemaPath,
      serversPath: path.join(outputRoot, 'interface'),
      declareType: 'interface',
    });

    const defaultDeclaration = path.join(outputRoot, 'default/api/typings.d.ts');
    const interfaceDeclaration = path.join(outputRoot, 'interface/api/typings.d.ts');
    const defaultSource = fs.readFileSync(defaultDeclaration, 'utf8');
    const interfaceSource = fs.readFileSync(interfaceDeclaration, 'utf8');

    assert.match(defaultSource, /\btype\s+\w+\s*=/);
    assert.match(interfaceSource, /\binterface\s+\w+\s*{/);
    assert.doesNotMatch(interfaceSource, /\binterface\s+\w+\s*=/);
    assertTypescriptParses(interfaceDeclaration);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
};

const testApiPrefixDeduplicationCanBeDisabled = async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'api2ts-prefix-'));
  const schemaPath = path.join(outputRoot, 'openapi.json');
  fs.writeFileSync(
    schemaPath,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'prefix test', version: '1.0.0' },
      paths: {
        '/api/users': {
          get: {
            operationId: 'listUsers',
            tags: ['Users'],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    }),
  );

  try {
    await generateService({
      schemaPath,
      serversPath: path.join(outputRoot, 'default'),
      apiPrefix: "'/api'",
    });
    await generateService({
      schemaPath,
      serversPath: path.join(outputRoot, 'disabled'),
      apiPrefix: "'/api'",
      dedupeApiPrefix: false,
    });

    const defaultController = fs.readFileSync(path.join(outputRoot, 'default/api/users.ts'), 'utf8');
    const disabledController = fs.readFileSync(path.join(outputRoot, 'disabled/api/users.ts'), 'utf8');
    assert.match(defaultController, /request(?:<[^>]+>)?\(`\/api\/users`/);
    assert.match(disabledController, /request(?:<[^>]+>)?\(`\/api\/api\/users`/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
};

const testNumericAndReservedControllerNamesCompile = async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'api2ts-controller-names-'));
  const schemaPath = path.join(outputRoot, 'openapi.json');
  fs.writeFileSync(
    schemaPath,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'controller names', version: '1.0.0' },
      paths: {
        '/numeric': {
          get: {
            operationId: 'getNumeric',
            tags: ['2.0 User'],
            responses: { 200: { description: 'OK' } },
          },
        },
        '/imports': {
          get: {
            operationId: 'getImports',
            tags: ['Import'],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    }),
  );

  try {
    await generateService({ schemaPath, serversPath: outputRoot, requestLibPath: './request' });
    const generatedPath = path.join(outputRoot, 'api');
    const diagnostics = compileGeneratedTypescript(generatedPath);
    const indexSource = fs.readFileSync(path.join(generatedPath, 'index.ts'), 'utf8');

    assert.deepStrictEqual(diagnostics, []);
    assert.match(indexSource, /import \* as __openAPI__20User from '\.\/20User'/);
    assert.match(indexSource, /import \* as __openAPI__import from '\.\/import'/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
};

const testMswMocksAreOptIn = async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'api2ts-mocks-'));
  const schemaPath = path.join(__dirname, 'example-files/apispec_1.json');
  const legacyPath = path.join(outputRoot, 'legacy');
  const mswPath = path.join(outputRoot, 'msw');

  try {
    await generateService({ schemaPath, serversPath: path.join(outputRoot, 'services-legacy'), mockFolder: legacyPath });
    await generateService({
      schemaPath,
      serversPath: path.join(outputRoot, 'services-msw'),
      mockFolder: mswPath,
      mockConfig: { msw: true },
    });

    const legacySource = fs.readFileSync(path.join(legacyPath, 'list.mock.ts'), 'utf8');
    const mswSource = fs.readFileSync(path.join(mswPath, 'list.ts'), 'utf8');
    assert.match(legacySource, /import { Request, Response } from 'express'/);
    assert.match(legacySource, /\(req: Request, res: Response\) =>/);
    assert.doesNotMatch(mswSource, /from 'express'/);
    assert.doesNotMatch(mswSource, /\(req: Request, res: Response\) =>/);
    assert.match(mswSource, /'GET [^']+': {/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
};

const run = async () => {
  await testAuthorizationHeader();
  await testDeclareTypeIsOptIn();
  await testApiPrefixDeduplicationCanBeDisabled();
  await testNumericAndReservedControllerNamesCompile();
  await testMswMocksAreOptIn();
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
