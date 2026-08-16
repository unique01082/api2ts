# @baolq/api2ts

[![npm version](https://img.shields.io/npm/v/@baolq/api2ts)](https://www.npmjs.com/package/@baolq/api2ts)
[![npm downloads](https://img.shields.io/npm/dm/@baolq/api2ts)](https://www.npmjs.com/package/@baolq/api2ts)
[![license](https://img.shields.io/npm/l/@baolq/api2ts)](https://www.npmjs.com/package/@baolq/api2ts)
[![GitHub stars](https://img.shields.io/github/stars/unique01082/api2ts?style=social)](https://github.com/unique01082/api2ts)

Generate typed TypeScript API clients, model declarations, and optional mocks from OpenAPI 3 or Swagger 2 documents.

`@baolq/api2ts` groups operations into controller files, creates request functions and TypeScript types, supports protected remote schemas, and can detect API changes before replacing generated code. It works with any request library that accepts an Umi-style `request(url, options)` call.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration files](#configuration-files)
- [Generated output](#generated-output)
- [Configuration API](#configuration-api)
- [Request adapters](#request-adapters)
- [Schema sources and authentication](#schema-sources-and-authentication)
- [API prefixes](#api-prefixes)
- [Type generation](#type-generation)
- [Response data fields](#response-data-fields)
- [Multipart requests](#multipart-requests)
- [Mock generation](#mock-generation)
- [Diff mode](#diff-mode)
- [Hooks](#hooks)
- [Custom templates](#custom-templates)
- [Programmatic API](#programmatic-api)
- [CLI reference](#cli-reference)
- [Troubleshooting](#troubleshooting)
- [Development and release](#development-and-release)
- [License](#license)

## Features

- Reads OpenAPI 3.x and converts Swagger 2 documents automatically.
- Accepts remote HTTP(S) schemas or local JSON/CommonJS-compatible schema files.
- Generates one controller module per OpenAPI tag, a shared declaration file, and an index module.
- Generates typed path, query, cookie, body, response, and file-upload parameters.
- Supports GET, PUT, POST, DELETE, and PATCH operations.
- Lets you bring any compatible request implementation; Umi request is the default.
- Supports string-literal unions or TypeScript enums.
- Preserves legacy output by default while exposing opt-in interface, multipart Blob, and object-valued mock modes.
- Generates multiple projects from one configuration file.
- Provides hooks for naming, types, grouping, request defaults, and OpenAPI preprocessing.
- Supports custom Nunjucks templates.
- Reports added, removed, and modified APIs with snapshot-based diff mode.
- Sanitizes generated identifiers, including reserved words and names that start with digits.

## Installation

Install the generator as a development dependency:

```bash
pnpm add -D @baolq/api2ts
```

Equivalent commands:

```bash
npm install --save-dev @baolq/api2ts
# or
yarn add --dev @baolq/api2ts
```

## Quick start

Create `openapi2ts.config.ts` in the project root:

```ts
import type { GenerateServiceProps } from '@baolq/api2ts';

const config: GenerateServiceProps = {
  schemaPath: 'https://petstore.swagger.io/v2/swagger.json',
  serversPath: './src/services',
  projectName: 'petstore',

  // Relative to each generated controller file.
  requestLibPath: '../../lib/request',
};

export default config;
```

Add a script to `package.json`:

```json
{
  "scripts": {
    "api:generate": "api2ts"
  }
}
```

Generate the client:

```bash
pnpm api:generate
```

The example writes files to `src/services/petstore/`. Generation replaces existing files under that project directory, except paths containing `_deperated`. Treat the directory as generated code and keep custom application logic elsewhere.

### Multiple schemas

Export an array to generate several clients sequentially:

```ts
import type { GenerateServiceProps } from '@baolq/api2ts';

const configs: GenerateServiceProps[] = [
  {
    schemaPath: 'https://example.com/openapi/app.json',
    serversPath: './src/services',
    projectName: 'app',
    requestLibPath: '../../lib/request',
  },
  {
    schemaPath: 'https://example.com/openapi/auth.json',
    serversPath: './src/services',
    projectName: 'auth',
    requestLibPath: '../../lib/request',
  },
];

export default configs;
```

## Configuration files

The CLI uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) with the module name `openapi2ts`. It searches upward from the current working directory and accepts configuration in:

- the `openapi2ts` property of `package.json`;
- `.openapi2tsrc`, `.openapi2tsrc.json`, `.openapi2tsrc.yaml`, `.openapi2tsrc.yml`, `.openapi2tsrc.js`, `.openapi2tsrc.ts`, or `.openapi2tsrc.cjs`;
- the same rc filenames inside `.config/`;
- `openapi2ts.config.js`, `openapi2ts.config.ts`, or `openapi2ts.config.cjs`.

Because the CLI performs synchronous configuration loading, `.mjs` configuration is not supported. A configuration may be one `GenerateServiceProps` object or an array of them.

JSON configuration example:

```json
{
  "schemaPath": "https://example.com/openapi.json",
  "serversPath": "./src/services",
  "projectName": "api",
  "requestLibPath": "../../lib/request"
}
```

## Generated output

Given `serversPath: './src/services'` and `projectName: 'petstore'`, the generator creates:

```text
src/services/petstore/
├── index.ts
├── typings.d.ts
├── pet.ts
└── store.ts
```

- `typings.d.ts` declares the configured global namespace, `API` by default.
- Each controller file contains request functions for one tag/group.
- `index.ts` imports every controller and default-exports an object containing them.

Example use:

```ts
import petstore from './services/petstore';

const pet = await petstore.pet.getPetById({ petId: 42 });
```

A generated controller follows this shape:

```ts
import request from '../../lib/request';

export async function getPetById(
  params: API.GetPetByIdParams,
  options?: Record<string, unknown>,
) {
  const { petId: param0, ...queryParams } = params;
  return request<API.Pet>(`/pets/${param0}`, {
    method: 'GET',
    params: queryParams,
    ...(options || {}),
  });
}
```

The exact names and signatures depend on the source document and configuration.

## Configuration API

`schemaPath` is operationally required even though it remains optional in the TypeScript type for backward compatibility.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `schemaPath` | `string` | — | URL or local module path for an OpenAPI 3 or Swagger 2 document. |
| `serversPath` | `string` | `./src/service` | Parent directory for generated service projects. |
| `projectName` | `string` | `api` | Child directory created beneath `serversPath`. |
| `authorization` | `string` | — | Exact value sent in the `authorization` header when fetching a remote schema. |
| `requestLibPath` | `string` | — | Default-import path for the request function, or a complete import statement beginning with `import`. |
| `requestImportStatement` | `string` | generated from `requestLibPath` | Complete request import emitted in controllers. This takes precedence when provided. |
| `requestOptionsType` | `string` | `{[key: string]: any}` | TypeScript type used for the optional request `options` argument. |
| `namespace` | `string` | `API` | Global namespace used for generated model and parameter types. |
| `apiPrefix` | `string \| function` | — | Static literal or runtime expression prepended to generated paths. See [API prefixes](#api-prefixes). |
| `dedupeApiPrefix` | `boolean` | `true` | Avoids repeating a matching quoted literal prefix already present in a path. |
| `declareType` | `'type' \| 'interface'` | `'type'` | Prefers interfaces for compatible object schemas. Aliases, unions, intersections, and enums remain appropriate TypeScript forms. |
| `enumStyle` | `'string-literal' \| 'enum'` | `'string-literal'` | Emits enum schemas as string-literal unions or TypeScript enums. |
| `nullable` | `boolean` | `false` | Emits non-required object properties as required properties whose value includes `null`, instead of optional properties. |
| `dataFields` | `string[]` | — | Selects the first matching top-level property from referenced object response schemas. |
| `isCamelCase` | `boolean` | `true` | Camel-cases generated grouping names and request function names. |
| `mockFolder` | `string` | — | Enables mock generation and specifies its output directory. |
| `mockConfig` | `{ msw?: boolean }` | `{}` | Selects legacy Express-style mocks or object-valued route maps. |
| `formDataJsonBlob` | `boolean` | `false` | Serializes object-valued multipart fields as `application/json` Blob parts. |
| `templatesFolder` | `string` | bundled templates | Directory containing all three required Nunjucks templates. |
| `diffMode` | `boolean` | `false` | Compares the schema with a saved snapshot before generation. |
| `hook` | `GenerateServiceProps['hook']` | — | Customizes preprocessing, grouping, naming, types, and request defaults. |

Defaults deliberately retain the historical output. The following newer behavior is opt-in unless shown otherwise:

```ts
export default {
  schemaPath: 'https://example.com/openapi.json',
  declareType: 'interface',
  formDataJsonBlob: true,
  mockConfig: { msw: true },

  // true is already the default; set false only to intentionally repeat a prefix.
  dedupeApiPrefix: true,
};
```

## Request adapters

Generated functions call:

```ts
request<ResponseType>(url, {
  method,
  params,
  data,
  headers,
  requestType,
  ...options,
});
```

Without request configuration, controllers contain:

```ts
import { request } from 'umi';
```

### Default import by path

Use `requestLibPath` when your adapter has a default export:

```ts
export default {
  requestLibPath: '../../lib/request',
  requestOptionsType: 'RequestOptions',
};
```

Paths are copied into generated controller files; they are not resolved by the generator. Make them relative to the final controller location or use a project alias.

### Complete import statement

Pass an import statement through either option:

```ts
export default {
  requestLibPath: "import { http as request } from '@/lib/http'",
};
```

or:

```ts
export default {
  requestImportStatement: "import { http as request } from '@/lib/http'",
};
```

`requestImportStatement` wins if both are present.

### Minimal fetch adapter

This example adapts generated calls to `fetch`:

```ts
export type RequestOptions = {
  method?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  requestType?: string;
  signal?: AbortSignal;
};

export default async function request<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, data, requestType: _requestType, ...init } = options;
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });

  const queryString = query.toString();

  const response = await fetch(queryString ? `${url}?${queryString}` : url, {
    ...init,
    body:
      data instanceof FormData
        ? data
        : data === undefined
          ? undefined
          : JSON.stringify(data),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
```

Production adapters commonly add base URLs, authentication, JSON headers, error normalization, retries, and cancellation.

## Schema sources and authentication

### Remote schema

HTTP and HTTPS URLs are fetched as JSON:

```ts
export default {
  schemaPath: 'https://example.com/openapi.json',
  authorization: `Bearer ${process.env.OPENAPI_TOKEN}`,
};
```

The `authorization` header is omitted when the option is absent. Keep tokens in environment variables and do not commit them.

### Local schema

Use an absolute path for predictable Node module resolution:

```ts
import path from 'node:path';

export default {
  schemaPath: path.resolve(process.cwd(), 'openapi.json'),
};
```

Local schemas are loaded as Node modules, so JSON and CommonJS-compatible modules are supported. YAML schema files are not parsed directly; convert them to JSON first or expose them over HTTP as JSON.

Swagger 2 documents are converted in memory with `swagger2openapi` before generation. OpenAPI documents pass through unchanged.

## API prefixes

`apiPrefix` accepts a quoted literal string or a JavaScript expression. The quotes inside the configuration value distinguish a static prefix from a runtime expression.

### Static prefix

```ts
export default {
  // The value itself includes quote characters.
  apiPrefix: "'/api/v1'",
};
```

This turns `/pets` into `/api/v1/pets`. With the default `dedupeApiPrefix: true`, an input path already beginning with `/api/v1` remains unchanged.

Set `dedupeApiPrefix: false` only if repeating the literal is intentional:

```ts
export default {
  apiPrefix: "'/api'",
  dedupeApiPrefix: false,
};
```

### Runtime expression

An unquoted value is emitted inside the generated template literal:

```ts
export default {
  apiPrefix: 'API_BASE_URL',
};
```

Generated path:

```ts
`${API_BASE_URL}/pets`
```

### Prefix function

Compute a prefix per operation:

```ts
export default {
  apiPrefix({ method, namespace }) {
    return method === 'get' && namespace === 'public' ? "'/public-api'" : "'/api'";
  },
};
```

The callback receives `path`, lowercase `method`, generated `namespace` (the operation group/tag), and `functionName`.

## Type generation

By default, schemas are emitted inside `declare namespace API` using type aliases:

```ts
declare namespace API {
  type Pet = {
    id: number;
    name?: string;
  };
}
```

Set `namespace` to rename the global namespace:

```ts
export default {
  namespace: 'PetstoreAPI',
};
```

Set `declareType: 'interface'` to prefer interfaces for object-shaped declarations:

```ts
export default {
  declareType: 'interface',
};
```

Complex aliases cannot always be represented correctly as interfaces. The generator keeps using `type` for unions, intersections, scalar aliases, arrays, and similar schemas, preserving valid output.

### Enums

The default produces string-literal unions:

```ts
type Status = 'available' | 'pending' | 'sold';
```

Use TypeScript enums instead:

```ts
export default {
  enumStyle: 'enum',
};
```

### Optional versus nullable properties

Default (`nullable: false`):

```ts
type Pet = {
  name?: string;
};
```

With `nullable: true`:

```ts
type Pet = {
  name: string | null;
};
```

This option changes how non-required properties are represented; it does not reinterpret every OpenAPI `nullable` keyword.

## Response data fields

Some APIs wrap their payload:

```json
{
  "code": 0,
  "result": {
    "id": 42,
    "name": "Ada"
  }
}
```

For a response schema that references an object component, `dataFields` selects the first matching property as the generated response type:

```ts
export default {
  dataFields: ['result', 'data'],
};
```

The order is significant. If none of the fields exist, the original response schema is used. This changes generated typing only; your request adapter must still unwrap the runtime response if necessary.

## Multipart requests

For `multipart/form-data`, binary and base64 fields become `File` or `File[]` parameters. Other body fields are appended to `FormData`.

Legacy-compatible behavior serializes an object field as a JSON string:

```ts
formData.append('metadata', JSON.stringify(metadata));
```

Some servers require a JSON part with an explicit media type. Enable:

```ts
export default {
  formDataJsonBlob: true,
};
```

Generated behavior:

```ts
formData.append(
  'metadata',
  new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
);
```

The default remains `false` for backward compatibility.

## Mock generation

Set `mockFolder` to generate route maps from response examples:

```ts
export default {
  schemaPath: 'https://example.com/openapi.json',
  mockFolder: './mocks',
};
```

### Express-style route maps

The default emits `*.mock.ts` files whose values accept Express `Request` and `Response`:

```ts
export default {
  'GET /pets/:petId': (req: Request, res: Response) => {
    res.status(200).send({ id: 42, name: 'Ada' });
  },
};
```

### Object-valued route maps

For consumers that build MSW handlers or otherwise need serializable route values:

```ts
export default {
  mockFolder: './mocks',
  mockConfig: { msw: true },
};
```

This emits `*.ts` files without Express imports:

```ts
export default {
  'GET /pets/:petId': { id: 42, name: 'Ada' },
};
```

These files are route maps, not ready-made `http.get()`/`rest.get()` MSW handlers. Adapt the map to the MSW version and server setup used by your application.

## Diff mode

Diff mode compares operation signatures with the previous generated snapshot:

```bash
pnpm api:generate -- --diff
```

You may also enable it in configuration:

```ts
export default {
  diffMode: true,
};
```

On the first run, generation succeeds and a snapshot is saved in the current working directory:

```text
.openapi-snapshot.<schema-hash-key>.json
```

The eight-character key is derived from `schemaPath`, so multiple configurations can keep independent snapshots. Later runs report:

- added operations;
- removed operations;
- changed parameter, body, and response properties;
- type and required/optional changes.

When APIs would be removed, an interactive terminal asks for confirmation and defaults to No. In a non-interactive environment such as CI, removals abort generation automatically. Added or modified APIs do not require confirmation. A successful diff-mode generation replaces the snapshot.

Commit snapshots if your team wants the last accepted schema signature shared across machines and CI. Otherwise add `.openapi-snapshot.*.json` to `.gitignore`.

## Hooks

All hooks are optional:

| Hook | Signature | Purpose |
| --- | --- | --- |
| `afterOpenApiDataInited` | `(openAPIData: OpenAPIObject) => OpenAPIObject` | Preprocess the converted OpenAPI document before grouping and generation. Returning a falsy value falls back to the original object. |
| `customFunctionName` | `(data: APIDataType) => string` | Choose each generated request function name. |
| `customTypeName` | `(data: APIDataType) => string` | Choose the parameter type name for an operation. |
| `customOptionsDefaultValue` | `(data: OperationObject) => Record<string, any> \| undefined` | Provide the generated fallback object for request `options`. |
| `customClassName` | `(tagName: string) => string` | Rename a generated controller file/group. |
| `customType` | `(schemaObject, namespace, originGetType) => string` | Override schema-to-TypeScript conversion. Return a string to override; otherwise the default resolver is used. |
| `customFileNames` | `(operationObject, apiPath, apiMethod) => string[]` | Choose one or more groups/files for an operation. A missing/falsy result uses default grouping. |

Types used by hooks are exported or available from the package declarations where noted. `APIDataType` is currently an internal source type, so hook parameters can usually be inferred from a typed `GenerateServiceProps` object.

### Naming and request defaults

```ts
import type { GenerateServiceProps } from '@baolq/api2ts';

const config: GenerateServiceProps = {
  schemaPath: 'https://example.com/openapi.json',
  hook: {
    customFunctionName(operation) {
      return operation.operationId
        ? `api_${operation.operationId}`
        : `${operation.method}_request`;
    },
    customTypeName(operation) {
      return `${operation.operationId || 'Anonymous'}Input`;
    },
    customOptionsDefaultValue(operation) {
      return operation.deprecated ? { skipErrorHandler: true } : undefined;
    },
  },
};

export default config;
```

### Custom type mapping

```ts
import type { GenerateServiceProps } from '@baolq/api2ts';

const config: GenerateServiceProps = {
  schemaPath: 'https://example.com/openapi.json',
  hook: {
    customType(schema, namespace, getDefaultType) {
      if (schema?.type === 'integer' && schema.format === 'int64') {
        return 'string';
      }
      return getDefaultType(schema, namespace);
    },
  },
};

export default config;
```

### Custom grouping

```ts
export default {
  schemaPath: 'https://example.com/openapi.json',
  hook: {
    customFileNames(operation, apiPath, method) {
      if (operation.tags?.length) return operation.tags;
      return [`${method}-${apiPath.split('/').filter(Boolean)[0] || 'default'}`];
    },
    customClassName(tagName) {
      return `${tagName}Api`;
    },
  },
};
```

Return multiple names from `customFileNames` to generate the same operation into multiple controller files. Hook results should be deterministic and valid as filenames/identifiers after your project conventions are applied.

## Custom templates

The published package includes three [Nunjucks](https://mozilla.github.io/nunjucks/) templates:

```text
templates/
├── interface.njk
├── serviceController.njk
└── serviceIndex.njk
```

Custom templates are the most flexible extension point when you need to change the structure of generated source code rather than only its names or runtime behavior. Typical uses include adding project headers, changing exports, attaching operation metadata, wrapping request calls, or matching an internal SDK convention.

### Choose the smallest extension point

| Requirement | Recommended extension point |
| --- | --- |
| Base URL, authentication, retries, errors, cancellation, or response unwrapping | [Request adapter](#request-adapters) |
| Function/type names, controller grouping, schema type mapping, or OpenAPI preprocessing | [Hooks](#hooks) |
| Imports, exports, function signatures, request-call structure, comments, or generated file layout | Custom templates |

Prefer the request adapter or a hook when it can express the change. Template overrides own a copy of generated-code structure and therefore require review when upgrading `@baolq/api2ts`.

### Copy the bundled templates

Start from the templates shipped with the exact package version installed by the project:

```bash
mkdir -p tools/api2ts-templates
cp node_modules/@baolq/api2ts/templates/*.njk tools/api2ts-templates/
```

Keep all three files together, even when only one is customized. Point the generator at the copied directory with an absolute path:

```ts
import path from 'node:path';
import type { GenerateServiceProps } from '@baolq/api2ts';

const config: GenerateServiceProps = {
  schemaPath: 'https://example.com/openapi.json',
  templatesFolder: path.resolve(process.cwd(), 'tools/api2ts-templates'),
};

export default config;
```

The folder must contain `interface.njk`, `serviceController.njk`, and `serviceIndex.njk` with those exact names. A missing template causes generation to fail instead of silently falling back to the package copy.

### Template context reference

The generator passes the following top-level values to each template:

| Template | Important context values |
| --- | --- |
| `interface.njk` | `namespace`, `nullable`, `declareType`, `disableTypeCheck`, and `list` of resolved declarations. Each declaration includes fields such as `typeName`, `type`, `parent`, `props`, and `isEnum`. |
| `serviceController.njk` | `namespace`, `requestOptionsType`, `requestImportStatement`, `formDataJsonBlob`, `disableTypeCheck`, `genType`, `className`, `instanceName`, and `list` of operations. |
| `serviceIndex.njk` | `namespace`, `disableTypeCheck`, and `list` of controllers containing `fileName` and `controllerName`. |

Each item in the controller operation `list` includes the original OpenAPI operation fields plus normalized fields used by the bundled template:

| Field | Meaning |
| --- | --- |
| `functionName` | Final generated function name. |
| `typeName` | Qualified request-parameter type name. |
| `path` / `pathInComment` | Executable request path and comment-safe path. |
| `method` | Lowercase HTTP method. |
| `desc` | Combined summary, description, and default-response description. |
| `params` / `hasParams` | Normalized path, query, and cookie parameters and their presence flag. |
| `body`, `file`, `hasFormData` | Body schema, file inputs, and multipart state. |
| `response` | Response media type and generated TypeScript type. |
| `options` | Default request options returned by `customOptionsDefaultValue`. |
| `operationId`, `tags`, `deprecated` | Original OpenAPI operation metadata when present. |

These values form an advanced API. New fields may be added in compatible releases, but a custom template should only depend on fields it needs.

### Recipe: add a generated-file banner

Add a stable banner near the top of any copied template:

```njk
// Generated by @baolq/api2ts. Do not edit this file directly.
// Update openapi2ts.config.ts or tools/api2ts-templates instead.
```

This makes ownership clear without changing runtime behavior.

### Recipe: provide named controller exports

The bundled `serviceIndex.njk` default-exports a controller object. The following version retains that API while also allowing named imports:

```njk
// @ts-ignore
/* eslint-disable */
// API modified time：{{ apiResourceModifyTime }}
// API resourceId：{{ apiResourceId }}
{% for api in list -%}
import * as {{ api.controllerName }} from './{{ api.fileName }}'
{% endfor %}

export {
  {% for api in list -%}
  {{ api.controllerName }},
  {% endfor -%}
}

export default {
  {% for api in list -%}
  {{ api.controllerName }},
  {% endfor -%}
}
```

Consumers can then choose either style:

```ts
import api, { pet } from './services/petstore';

await api.pet.getPetById({ petId: 42 });
await pet.getPetById({ petId: 42 });
```

Keeping the default export makes this customization backward-compatible for existing imports.

### Recipe: attach operation metadata to request options

Request middleware may need the OpenAPI operation ID or controller name for tracing and policy decisions. In `serviceController.njk`, add metadata immediately before the final options spread:

```njk
    meta: {
      operationId: '{{ api.operationId if api.operationId else api.functionName }}',
      controller: '{{ className }}',
    },
    ...(options || {{ api.options | dump }}),
```

Then declare the field in the configured request options type and consume it in the request adapter:

```ts
export type RequestOptions = {
  meta?: {
    operationId: string;
    controller: string;
  };
  [key: string]: unknown;
};
```

Because the caller-provided `options` spread comes last, callers can override generated metadata when required. If metadata must be immutable, place it after that spread instead and document the contract for consumers.

### Validation workflow

Treat customized templates like source code:

1. Generate into a dedicated directory or fixture.
2. Review the generated diff, especially public imports and function signatures.
3. Type-check the generated client with the same `tsconfig.json` used by consumers.
4. Run at least one representative request per customized path: query, JSON body, multipart, and error handling as applicable.
5. Commit the copied templates and representative generated output or golden fixtures so changes are reviewable.

Example verification commands:

```bash
pnpm api:generate
git diff -- tools/api2ts-templates src/services
pnpm exec tsc --noEmit
```

### Upgrade workflow

When upgrading `@baolq/api2ts`:

1. Read the package release notes.
2. Compare each copied template with the new bundled version.
3. Port upstream fixes into the customized copy while preserving intentional changes.
4. Regenerate, inspect the full output diff, and repeat the validation workflow.

For example:

```bash
diff -u \
  node_modules/@baolq/api2ts/templates/serviceController.njk \
  tools/api2ts-templates/serviceController.njk
```

Avoid copying templates from the repository's `main` branch into a project using an older npm version; the template context may not match that installed generator.

## Programmatic API

The package exports `generateService`, `getSchema`, and `GenerateServiceProps`.

### `generateService(options)`

Generate a client without the CLI:

```ts
import path from 'node:path';
import { generateService } from '@baolq/api2ts';

await generateService({
  schemaPath: path.resolve(process.cwd(), 'openapi.json'),
  serversPath: './src/services',
  projectName: 'api',
  requestLibPath: '../../lib/request',
});
```

Signature:

```ts
function generateService(options: GenerateServiceProps): Promise<void>;
```

The promise resolves after service files, optional mocks, and an optional snapshot are written. A schema fetch failure is logged and generation returns without writing a client.

### `getSchema(schemaPath, authorization?)`

Load a raw schema without converting Swagger 2 to OpenAPI 3:

```ts
import { getSchema } from '@baolq/api2ts';

const schema = await getSchema(
  'https://example.com/openapi.json',
  `Bearer ${process.env.OPENAPI_TOKEN}`,
);
```

Signature:

```ts
function getSchema(
  schemaPath: string,
  authorization?: string,
): Promise<unknown | null>;
```

Remote failures are logged and return `null`. Local module-loading errors propagate from Node.

## CLI reference

```text
api2ts [--diff]
```

| Argument | Description |
| --- | --- |
| `--diff` | Forces diff mode for every loaded configuration, even when `diffMode` is false or absent. |

The CLI has no positional schema or output arguments. Put generation settings in a discovered configuration file. It processes configuration arrays in order and logs configuration or generation errors to standard output.

Common package scripts:

```json
{
  "scripts": {
    "api:generate": "api2ts",
    "api:check": "api2ts --diff"
  }
}
```

## Troubleshooting

### `Error: config is not found`

Run the command from the project tree containing a supported configuration filename. Check spelling: the module name is `openapi2ts`, while the executable is `api2ts`.

### The generated request import cannot be resolved

`requestLibPath` is emitted into each controller and is not rebased automatically. Calculate it from `<serversPath>/<projectName>/<controller>.ts`, use a configured TypeScript path alias, or supply a complete `requestImportStatement`.

### A local schema cannot be found

Pass an absolute path created with `path.resolve(process.cwd(), ...)`. Relative `require()` paths can otherwise resolve from the installed package rather than your application root.

### YAML schema loading fails

The schema loader expects JSON from remote URLs and Node-loadable modules for local files. Convert YAML to JSON before generation.

### Generated changes disappear

Generation removes existing content inside the project output directory before writing new files. Do not hand-edit generated files. Put behavior in the request adapter, configuration hooks, or copied templates.

### Generation stops in CI when an API was removed

This is the safety behavior of diff mode. Review the report and accept the removal in an interactive run, then commit the updated generated code and snapshot. Alternatively, do not enable diff mode in that CI job.

### `apiPrefix` produces invalid template syntax

Use a value containing quotes for a static prefix, such as `"'/api'"`. Use an unquoted identifier only when it is a real runtime expression available to the generated controller.

### Types are present but unavailable in another TypeScript project

`typings.d.ts` declares a global namespace. Ensure the generated directory is included by that project's `tsconfig.json` (`include`, `files`, or an imported source path) and is not excluded.

### A schema produces `any`

The generator falls back to `any` for missing or incomplete schema objects so generation remains valid. Improve the OpenAPI schema or use `hook.customType` for a deliberate mapping.

## Development and release

Clone and verify the project:

```bash
git clone https://github.com/unique01082/api2ts.git
cd api2ts
pnpm install --frozen-lockfile
pnpm test
```

Useful commands:

```bash
pnpm build                 # compile TypeScript into dist/
pnpm test                  # build and run generation/regression tests
pnpm pack --dry-run        # inspect the npm package contents
```

The npm package publishes only `dist/`, `templates/`, and npm's standard metadata files. Releases follow semantic versioning and are published at:

- npm: [@baolq/api2ts](https://www.npmjs.com/package/@baolq/api2ts)
- GitHub: [unique01082/api2ts releases](https://github.com/unique01082/api2ts/releases)

## License

MIT © Bao LE.

### Acknowledgements

`@baolq/api2ts` is maintained as a fork of [chenshuai2144/openapi2typescript](https://github.com/chenshuai2144/openapi2typescript), published upstream as [`@umijs/openapi`](https://www.npmjs.com/package/@umijs/openapi). Sincere thanks to chenshuai2144, kobe, the UmiJS community, and every upstream contributor whose work provides the foundation of this library.

The fork continues to track upstream changes where they fit its compatibility goals. Credit for upstream functionality remains with its original authors and contributors, under the MIT license.

### Differences from upstream

This fork adds or extends the following areas beyond the upstream project:

| Area | Added or extended in `@baolq/api2ts` |
| --- | --- |
| Distribution | An independently versioned public package, `@baolq/api2ts`, with the `api2ts` CLI and verified npm release artifacts. |
| Change safety | Snapshot-based diff mode through `diffMode` or `--diff`, including added/removed/modified API reports, per-schema snapshots, interactive removal confirmation, and fail-closed behavior in non-interactive environments. |
| Backward compatibility | Compatibility-hardened variants of upstream capabilities: safe interface fallback for complex aliases, configurable literal-prefix deduplication, and opt-in multipart JSON Blob and object-valued mock output so existing generated clients keep their previous defaults. |
| Identifier safety | Additional sanitization for reserved words and controller/tag names that begin with digits while preserving existing filenames where possible. |
| Invalid or incomplete schemas | Guards for missing request/response content and schemas, plus a clean abort when a remote schema cannot be fetched. |
| Runtime packaging | `tslib` is declared as a runtime dependency and published tarballs are checked through clean-consumer TypeScript and runtime smoke tests. |
| Documentation and regression coverage | A complete single-page reference, dedicated upstream-compatibility fixtures, and regression tests for compatibility-sensitive generation behavior. |
