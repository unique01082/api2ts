const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ts = require('typescript');

const openAPI = require('../dist/index');

const gen = async () => {
  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-empty.json`,
    serversPath: './servers/empty',
  });

  await openAPI.generateService({
    schemaPath: `${__dirname}/test-allof-api.json`,
    serversPath: './servers-allof',
  });

  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-get-method-params-convert-obj.json`,
    serversPath: './servers',
  });

  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-schema-contain-blank-symbol.json`,
    serversPath: './servers/blank-symbol-servers',
  });

  await openAPI.generateService({
    requestLibPath: "import request  from '@/request';",
    schemaPath: `${__dirname}/example-files/swagger-custom-hook.json`,
    serversPath: './servers/custom',
    hook: {
      // 自定义类名
      customClassName: (tagName) => {
        return /[A-Z].+/.exec(tagName);
      },
      // 自定义函数名
      customFunctionName: (data) => {
        let funName = data.operationId ? data.operationId : '';
        const suffix = 'Using';
        if (funName.indexOf(suffix) != -1) {
          funName = funName.substring(0, funName.lastIndexOf(suffix));
        }
        return funName;
      },
      // 自定义类型名
      customTypeName: (data) => {
        const { operationId } = data;
        const funName = operationId ? operationId[0].toUpperCase() + operationId.substring(1) : '';
        const tag = data?.tags?.[0];

        return `${tag ? tag : ''}${funName}`;
      },
    },
  });

  // 支持null类型作为默认值
  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-get-method-params-convert-obj.json`,
    serversPath: './servers/support-null',
    nullable: true,
  });

  // 正常命名文件和请求函数
  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-get-method-params-convert-obj.json`,
    serversPath: './servers/name/normal',
    isCamelCase: false,
  });

  // 小驼峰命名文件和请求函数
  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-get-method-params-convert-obj.json`,
    serversPath: './servers/name/camel-case',
    isCamelCase: true,
  });

  const reservedTagsServersPath = path.join(__dirname, 'servers/reserved-controller-tags');
  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-reserved-controller-tags.json`,
    serversPath: reservedTagsServersPath,
    requestLibPath: './request',
  });

  const reservedTagsOutputPath = path.join(reservedTagsServersPath, 'api');
  fs.writeFileSync(
    path.join(reservedTagsOutputPath, 'request.ts'),
    'export default function request<T>(_url: string, _options: unknown): Promise<T> { return Promise.resolve(undefined as T); }\n',
  );

  const reservedTagsProgram = ts.createProgram(
    fs
      .readdirSync(reservedTagsOutputPath)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => path.join(reservedTagsOutputPath, fileName)),
    {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2015,
    },
  );
  const reservedTagsDiagnostics = ts
    .getPreEmitDiagnostics(reservedTagsProgram)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  assert.deepStrictEqual(reservedTagsDiagnostics, []);

  const reservedTagsIndex = fs.readFileSync(path.join(reservedTagsOutputPath, 'index.ts'), 'utf8');
  assert(!/import\s+\*\s+as\s+(?:import|export)\b/.test(reservedTagsIndex));
  assert(reservedTagsIndex.includes("from './import'"));
  assert(reservedTagsIndex.includes("from './export'"));

  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/swagger-file-convert.json`,
    serversPath: './file-servers',
  });

  // check 文件生成
  const fileControllerStr = fs.readFileSync(
    path.join(__dirname, 'file-servers/api/fileController.ts'),
    'utf8',
  );
  assert(fileControllerStr.indexOf('!(item instanceof File)') > 0);
  assert(fileControllerStr.indexOf(`requestType: 'form',`) > 0);
  assert(fileControllerStr.indexOf('Content-Type') < 0);
  // await openAPI.generateService({
  //   // requestLibPath: "import request  from '@/request';",
  //   schemaPath: `http://82.157.33.9/swagger/swagger.json`,
  //   serversPath: './servers',
  // });
  // await openAPI.generateService({
  //   schemaPath: 'https://gw.alipayobjects.com/os/antfincdn/CA1dOm%2631B/openapi.json',
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: 'http://petstore.swagger.io/v2/swagger.json',
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: 'https://gw.alipayobjects.com/os/antfincdn/LyDMjDyIhK/1611471979478-opa.json',
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: 'https://gw.alipayobjects.com/os/antfincdn/Zd7dLTHUjE/ant-design-pro.json',
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: `${__dirname}/morse-api.json`,
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: `${__dirname}/oc-swagger.json`,
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });
  // await openAPI.generateService({
  //   schemaPath: `${__dirname}/java-api.json`,
  //   serversPath: './servers',
  //   mockFolder: './mocks',
  // });

  await openAPI.generateService({
    schemaPath: `${__dirname}/example-files/apispec_1.json`,
    serversPath: './apispe',
    mockFolder: './mocks',
  });
};
gen();
