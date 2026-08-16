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

const run = async () => {
  await testAuthorizationHeader();
  await testDeclareTypeIsOptIn();
  await testApiPrefixDeduplicationCanBeDisabled();
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
