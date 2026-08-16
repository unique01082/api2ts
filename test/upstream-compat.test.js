const assert = require('assert');
const http = require('http');

const { getSchema } = require('../dist/index');

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

const run = async () => {
  await testAuthorizationHeader();
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
