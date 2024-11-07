/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import http from 'http';
import https from 'https';
import fetch from 'node-fetch';
import type { OpenAPIObject, OperationObject, SchemaObject } from 'openapi3-ts';
import converter from 'swagger2openapi';
import Log from './log';
import { mockGenerator } from './mockGenerator';
import { ServiceGenerator } from './serviceGenerator';
import type { APIDataType } from './serviceGenerator';

const getImportStatement = (requestLibPath: string) => {
  if (requestLibPath && requestLibPath.startsWith('import')) {
    return requestLibPath;
  }
  if (requestLibPath) {
    return `import request from '${requestLibPath}'`;
  }
  return `import { request } from "umi"`;
};

export type GenerateServiceProps = {
  requestLibPath?: string;
  requestOptionsType?: string;
  requestImportStatement?: string;
  apiPrefix?:
    | string
    | ((params: {
        path: string;
        method: string;
        namespace: string;
        functionName: string;
        autoExclude?: boolean;
      }) => string);
  /**
   * The path to the generated folder
   */
  serversPath?: string;
  /**
   * The URL of Swagger 2.0 or OpenAPI 3.0
   */
  schemaPath?: string;
  projectName?: string;
  authorization?: string;

  hook?: {
    /** change open api data after constructor */
    afterOpenApiDataInited?: (openAPIData: OpenAPIObject) => OpenAPIObject;

    customFunctionName?: (data: APIDataType) => string;
    customTypeName?: (data: APIDataType) => string;
    customOptionsDefaultValue?: (data: OperationObject) =>  Record<string, any> | undefined;
    customClassName?: (tagName: string) => string;

    /**
     * Customize the type hook
     * Return non-strings to use the default method to get the type
     * @example set number to string
     * function customType(schemaObject,namespace){
     *  if(schemaObject.type==='number' && !schemaObject.format){
     *    return 'BigDecimalString';
     *  }
     * }
     */
    customType?: (
      schemaObject: SchemaObject | undefined,
      namespace: string,
      originGetType: (schemaObject: SchemaObject | undefined, namespace: string) => string,
    ) => string;

    /**
     * Customize the generated file name, multiple files can be returned, indicating that multiple files are generated
     * If the return value is empty, the default acquisition method is used to obtain
     * @example Generate file name using operationId
     * function customFileNames(operationObject,apiPath){
     *   const operationId=operationObject.operationId;
     *   if (!operationId) {
     *      console.warn('[Warning] no operationId', apiPath);
     *      return;
     *    }
     *    const res = operationId.split('_');
     *    if (res.length > 1) {
     *      res.shift();
     *      if (res.length > 2) {
     *        console.warn('[Warning]  operationId has more than 2 part', apiPath);
     *      }
     *      return [res.join('_')];
     *    } else {
     *      const controllerName = (res || [])[0];
     *      if (controllerName) {
     *        return [controllerName];
     *      }
     *      return;
     *    }
     * }
     */
    customFileNames?: (
      operationObject: OperationObject,
      apiPath: string,
      _apiMethod: string,
    ) => string[];
  };
  namespace?: string;

  /**
   * The default value is false. When true, null is used instead of optional.
   */
  nullable?: boolean;

  mockFolder?: string;
  /**
   * The file path of the template file
   */
  templatesFolder?: string;

  enumStyle?: 'string-literal' | 'enum';

  /**
   * Data fields in response
   * example: ['result', 'res']
   */
  dataFields?: string[];

  /**
   * Template files and request functions are named in camelCase
   */
  isCamelCase?: boolean;
};

const converterSwaggerToOpenApi = (swagger: any) => {
  if (!swagger.swagger) {
    return swagger;
  }
  return new Promise((resolve, reject) => {
    converter.convertObj(swagger, {}, (err, options) => {
      Log(['💺 Convert Swagger to openAPI']);
      if (err) {
        reject(err);
        return;
      }
      resolve(options.openapi);
    });
  });
};

export const getSchema = async (schemaPath: string, authorization?: string) => {
  if (schemaPath.startsWith('http')) {
    const protocol = schemaPath.startsWith('https:') ? https : http;
    try {
      const agent = new protocol.Agent({
        rejectUnauthorized: false,
      });
      const headers = {
        authorization,
      };
      const json = await fetch(schemaPath, { agent, headers }).then((rest) => rest.json());
      return json;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('fetch openapi error:', error);
    }
    return null;
  }
  if (require.cache[schemaPath]) {
    delete require.cache[schemaPath];
  }
  const schema = require(schemaPath);
  return schema;
};

const getOpenAPIConfig = async (schemaPath: string, authorization?: string) => {
  const schema = await getSchema(schemaPath, authorization);
  if (!schema) {
    return null;
  }
  const openAPI = await converterSwaggerToOpenApi(schema);
  return openAPI;
};

// Generate service data from appName
export const generateService = async ({
  authorization,
  requestLibPath,
  schemaPath,
  mockFolder,
  nullable = false,
  requestOptionsType = '{[key: string]: any}',
  ...rest
}: GenerateServiceProps) => {
  const openAPI = await getOpenAPIConfig(schemaPath, authorization);
  const requestImportStatement = getImportStatement(requestLibPath);
  const serviceGenerator = new ServiceGenerator(
    {
      namespace: 'API',
      requestOptionsType,
      requestImportStatement,
      enumStyle: 'string-literal',
      nullable,
      isCamelCase: true,
      ...rest,
    },
    openAPI,
  );
  serviceGenerator.genFile();

  if (mockFolder) {
    await mockGenerator({
      openAPI,
      mockFolder: mockFolder || './mocks/',
    });
  }
};
