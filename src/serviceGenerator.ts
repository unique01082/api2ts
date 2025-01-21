import { existsSync, readFileSync } from 'fs';
import glob from 'glob';
import { camelCase, isBoolean, isArray } from 'lodash';
import * as nunjucks from 'nunjucks';
import type {
  ContentObject,
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts';
import { join } from 'path';
import ReservedDict from 'reserved-words';
import rimraf from 'rimraf';
import pinyin from 'tiny-pinyin';
import type { GenerateServiceProps } from './index';
import Log from './log';
import { stripDot, writeFile } from './util';

const BASE_DIRS = ['service', 'services'];

export type TypescriptFileType = 'interface' | 'serviceController' | 'serviceIndex';

export interface APIDataType extends OperationObject {
  path: string;
  method: string;
}

export type TagAPIDataType = Record<string, APIDataType[]>;

export interface MappingItemType {
  antTechApi: string;
  popAction: string;
  popProduct: string;
  antTechVersion: string;
}

export interface ControllerType {
  fileName: string;
  controllerName: string;
}

export const getPath = () => {
  const cwd = process.cwd();
  return existsSync(join(cwd, 'src')) ? join(cwd, 'src') : cwd;
};

// Compatible with C# generic typeLastName method
function getTypeLastName(typeName) {
  const tempTypeName = typeName || '';

  const childrenTypeName = tempTypeName?.match(/\[\[.+\]\]/g)?.[0];
  if (!childrenTypeName) {
    let publicKeyToken = (tempTypeName.split('PublicKeyToken=')?.[1] ?? '').replace('null', '');
    const firstTempTypeName = tempTypeName.split(',')?.[0] ?? tempTypeName;
    let typeLastName = firstTempTypeName.split('/').pop().split('.').pop();
    if (typeLastName.endsWith('[]')) {
      typeLastName = typeLastName.substring(0, typeLastName.length - 2) + 'Array';
    }
    // Special handling of C# default system type, no publicKeyToken appended
    const isCsharpSystemType = firstTempTypeName.startsWith('System.');
    if (!publicKeyToken || isCsharpSystemType) {
      return typeLastName;
    }
    return `${typeLastName}_${publicKeyToken}`;
  }
  const currentTypeName = getTypeLastName(tempTypeName.replace(childrenTypeName, ''));
  const childrenTypeNameLastName = getTypeLastName(
    childrenTypeName.substring(2, childrenTypeName.length - 2),
  );
  return `${currentTypeName}_${childrenTypeNameLastName}`;
}

// Type declaration filter keywords
const resolveTypeName = (typeName: string) => {
  if (ReservedDict.check(typeName)) {
    return `__openAPI__${typeName}`;
  }
  const typeLastName = getTypeLastName(typeName);

  const name = typeLastName
    .replace(/[-_ ](\w)/g, (_all, letter) => letter.toUpperCase())
    .replace(/[^\w^\s^\u4e00-\u9fa5]/gi, '');

  // When the model name starts with a number, ts will report an error. This scenario usually occurs when the name defined in the backend is in Chinese.
  if (name === '_' || /^\d+$/.test(name)) {
    Log(
      '⚠️ Models cannot start with number. It is recommended to contact the backend to modify it.',
    );
    return `Pinyin_${name}`;
  }
  if (!/[\u3220-\uFA29]/.test(name) && !/^\d$/.test(name)) {
    return name;
  }
  const noBlankName = name.replace(/ +/g, '');
  return pinyin.convertToPinyin(noBlankName, '', true);
};

function getRefName(refObject: any): string {
  if (typeof refObject !== 'object' || !refObject.$ref) {
    return refObject;
  }
  const refPaths = refObject.$ref.split('/');
  return resolveTypeName(refPaths[refPaths.length - 1]) as string;
}

const defaultGetType = (schemaObject: SchemaObject | undefined, namespace: string = ''): string => {
  if (schemaObject === undefined || schemaObject === null) {
    return 'any';
  }
  if (typeof schemaObject !== 'object') {
    return schemaObject;
  }
  if (schemaObject.$ref) {
    return [namespace, getRefName(schemaObject)].filter((s) => s).join('.');
  }

  let { type } = schemaObject as any;

  const numberEnum = [
    'integer',
    'long',
    'float',
    'double',
    'number',
    'int',
    'float',
    'double',
    'int32',
    'int64',
  ];

  const dateEnum = ['Date', 'date', 'dateTime', 'date-time', 'datetime'];

  const stringEnum = ['string', 'email', 'password', 'url', 'byte', 'binary'];

  if (type === 'null') {
    return 'null';
  }

  if (numberEnum.includes(schemaObject.format)) {
    type = 'number';
  }

  if (schemaObject.enum) {
    type = 'enum';
  }

  if (numberEnum.includes(type)) {
    return 'number';
  }

  if (dateEnum.includes(type)) {
    return 'Date';
  }

  if (stringEnum.includes(type)) {
    return 'string';
  }

  if (type === 'boolean') {
    return 'boolean';
  }

  if (type === 'array') {
    let { items } = schemaObject;
    if (schemaObject.schema) {
      items = schemaObject.schema.items;
    }

    if (Array.isArray(items)) {
      const arrayItemType = (items as any)
        .map((subType) => defaultGetType(subType.schema || subType, namespace))
        .toString();
      return `[${arrayItemType}]`;
    }
    const arrayType = defaultGetType(items, namespace);
    return arrayType.includes(' | ') ? `(${arrayType})[]` : `${arrayType}[]`;
  }

  if (type === 'enum') {
    return Array.isArray(schemaObject.enum)
      ? Array.from(
          new Set(
            schemaObject.enum.map((v) =>
              typeof v === 'string' ? `"${v.replace(/"/g, '"')}"` : defaultGetType(v),
            ),
          ),
        ).join(' | ')
      : 'string';
  }

  if (schemaObject.oneOf && schemaObject.oneOf.length) {
    return schemaObject.oneOf.map((item) => defaultGetType(item, namespace)).join(' | ');
  }
  if (schemaObject.anyOf && schemaObject.anyOf.length) {
    return schemaObject.anyOf.map((item) => defaultGetType(item, namespace)).join(' | ');
  }
  if (schemaObject.allOf && schemaObject.allOf.length) {
    return `(${schemaObject.allOf.map((item) => defaultGetType(item, namespace)).join(' & ')})`;
  }
  if (schemaObject.type === 'object' || schemaObject.properties) {
    if (!Object.keys(schemaObject.properties || {}).length) {
      return 'Record<string, any>';
    }
    return `{ ${Object.keys(schemaObject.properties)
      .map((key) => {
        let required = false;
        if (isBoolean(schemaObject.required) && schemaObject.required) {
          required = true;
        }
        if (isArray(schemaObject.required) && schemaObject.required.includes(key)) {
          required = true;
        }
        if (
          'required' in (schemaObject.properties[key] || {}) &&
          ((schemaObject.properties[key] || {}) as any).required
        ) {
          required = true;
        }
        /**
         * Convert the type attribute to a string, compatible with incorrect formats such as:
         * 3d_tile (starting with a number) and other incorrect names,
         * When formatting later, the correct string will be converted to normal form,
         * The wrong string will continue to be retained.
         * */
        return `'${key}'${required ? '' : '?'}: ${defaultGetType(
          schemaObject.properties && schemaObject.properties[key],
          namespace,
        )}; `;
      })
      .join('')}}`;
  }
  return 'any';
};

export const getGenInfo = (isDirExist: boolean, appName: string, absSrcPath: string) => {
  // If dir does not exist, it is not occupied and it is the first time
  if (!isDirExist) {
    return [false, true];
  }
  const indexList = glob.sync(`@(${BASE_DIRS.join('|')})/${appName}/index.@(js|ts)`, {
    cwd: absSrcPath,
  });
  // dir exists and index exists
  if (indexList && indexList.length) {
    const indexFile = join(absSrcPath, indexList[0]);
    try {
      const line = (readFileSync(indexFile, 'utf-8') || '').split(/\r?\n/).slice(0, 3).join('');
      // dir exists, index exists, and index is generated by us. Then it is not occupied and it is not the first time
      if (line.includes('// API modified time：')) {
        return [false, false];
      }
      // dir exists, index exists, and the index content is not generated by us. If the openAPI subfile exists, it is not the first time, otherwise it is the first time
      return [true, !existsSync(join(indexFile, 'openAPI'))];
    } catch (e) {
      // Because glob has obtained the file but does not have permission to read it, it is treated as dirUsed and recreated in the subdirectory, so it is treated as firstTime
      return [true, true];
    }
  }
  // The dir exists, but the index does not. There is a conflict. First, check whether there is an openAPI folder under the dir.
  return [
    true,
    !(
      existsSync(join(absSrcPath, BASE_DIRS[0], appName, 'openAPI')) ||
      existsSync(join(absSrcPath, BASE_DIRS[1], appName, 'openAPI'))
    ),
  ];
};

const DEFAULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: { id: { type: 'number' } },
};

const DEFAULT_PATH_PARAM: ParameterObject = {
  in: 'path',
  name: null,
  schema: {
    type: 'string',
  },
  required: true,
  isObject: false,
  type: 'string',
};

function defaultGetFileTag(operationObject: OperationObject, apiPath: string, _apiMethod: string) {
  return operationObject['x-swagger-router-controller']
    ? [operationObject['x-swagger-router-controller']]
    : operationObject.tags || [operationObject.operationId] || [
          apiPath.replace('/', '').split('/')[1],
        ];
}
class ServiceGenerator {
  protected apiData: TagAPIDataType = {};

  protected classNameList: ControllerType[] = [];

  protected version: string;

  protected mappings: MappingItemType[] = [];

  protected finalPath: string;

  protected config: GenerateServiceProps;
  protected openAPIData: OpenAPIObject;

  constructor(config: GenerateServiceProps, openAPIData: OpenAPIObject) {
    this.finalPath = '';
    this.config = {
      projectName: 'api',
      templatesFolder: join(__dirname, '../', 'templates'),
      ...config,
    };
    if (this.config.hook?.afterOpenApiDataInited) {
      this.openAPIData = this.config.hook.afterOpenApiDataInited(openAPIData) || openAPIData;
    } else {
      this.openAPIData = openAPIData;
    }
    const { info } = this.openAPIData;
    const basePath = '';
    this.version = info.version;
    const hookCustomFileNames = this.config.hook?.customFileNames || defaultGetFileTag;
    Object.keys(this.openAPIData.paths || {}).forEach((p) => {
      const pathItem: PathItemObject = this.openAPIData.paths[p];
      ['get', 'put', 'post', 'delete', 'patch'].forEach((method) => {
        const operationObject: OperationObject = pathItem[method];
        if (!operationObject) {
          return;
        }

        let tags = hookCustomFileNames(operationObject, p, method);
        if (!tags) {
          tags = defaultGetFileTag(operationObject, p, method);
        }

        tags.forEach((tagString) => {
          const tag = this.config.isCamelCase
            ? camelCase(resolveTypeName(tagString))
            : resolveTypeName(tagString);

          if (!this.apiData[tag]) {
            this.apiData[tag] = [];
          }
          this.apiData[tag].push({
            path: `${basePath}${p}`,
            method,
            ...operationObject,
          });
        });
      });
    });
  }

  public genFile() {
    const basePath = this.config.serversPath || './src/service';
    try {
      const finalPath = join(basePath, this.config.projectName);

      this.finalPath = finalPath;
      glob
        .sync(`${finalPath}/**/*`)
        .filter((ele) => !ele.includes('_deperated'))
        .forEach((ele) => {
          rimraf.sync(ele);
        });
    } catch (error) {
      Log(`🚥 Failed to generate: ${error}`);
    }
    // Generate TS type declarations
    this.genFileFromTemplate('typings.d.ts', 'interface', {
      namespace: this.config.namespace,
      nullable: this.config.nullable,
      // namespace: 'API',
      list: this.getInterfaceTP(),
      disableTypeCheck: false,
    });
    // Generate controller files
    const prettierError = [];
    // Generate service statistics
    this.getServiceTP().forEach((tp) => {
      // Select the appropriate controller template according to the current data source type
      const template = 'serviceController';
      const hasError = this.genFileFromTemplate(
        this.getFinalFileName(`${tp.className}.ts`),
        template,
        {
          namespace: this.config.namespace,
          requestOptionsType: this.config.requestOptionsType,
          requestImportStatement: this.config.requestImportStatement,
          disableTypeCheck: false,
          ...tp,
        },
      );
      prettierError.push(hasError);
    });

    if (prettierError.includes(true)) {
      Log(`🚥 Formatting failed. Please check the service files for possible syntax errors.`);
    }
    // Generate index file
    this.genFileFromTemplate(`index.ts`, 'serviceIndex', {
      namespace: this.config.namespace,
      list: this.classNameList,
      disableTypeCheck: false,
    });

    // Print log
    Log(`✅ The service files is generated successfully`);
  }

  public concatOrNull = (...arrays) => {
    const c = [].concat(...arrays.filter(Array.isArray));
    return c.length > 0 ? c : null;
  };

  public getFuncationName(data: APIDataType) {
    // Get the same part of the path
    const pathBasePrefix = this.getBasePrefix(Object.keys(this.openAPIData.paths));
    return this.config.hook && this.config.hook.customFunctionName
      ? this.config.hook.customFunctionName(data)
      : data.operationId
      ? this.resolveFunctionName(stripDot(data.operationId), data.method)
      : data.method + this.genDefaultFunctionName(data.path, pathBasePrefix);
  }

  public getTypeName(data: APIDataType) {
    const namespace = this.config.namespace ? `${this.config.namespace}.` : '';
    const typeName = this.config?.hook?.customTypeName?.(data) || this.getFuncationName(data);

    return resolveTypeName(`${namespace}${typeName ?? data.operationId}Params`);
  }

  public getServiceTP() {
    return Object.keys(this.apiData)
      .map((tag, index) => {
        // functionName tag level duplicate prevention
        const tmpFunctionRD: Record<string, number> = {};
        const genParams = this.apiData[tag]
          .filter(
            (api) =>
              // Variables are not supported yet
              !api.path.includes('${'),
          )
          .map((api) => {
            const newApi = api;
            try {
              const allParams = this.getParamsTP(newApi.parameters, newApi.path);
              const body = this.getBodyTP(newApi.requestBody);
              const response = this.getResponseTP(newApi.responses);

              // let { file, ...params } = allParams || {}; // I dont't know if 'file' is valid parameter, maybe it's safe to remove it
              // const newfile = this.getFileTP(newApi.requestBody);
              // file = this.concatOrNull(file, newfile);
              const params = allParams || {};
              const file = this.getFileTP(newApi.requestBody);

              let formData = false;
              if ((body && (body.mediaType || '').includes('form-data')) || file) {
                formData = true;
              }

              let functionName = this.getFuncationName(newApi);

              if (functionName && tmpFunctionRD[functionName]) {
                functionName = `${functionName}_${(tmpFunctionRD[functionName] += 1)}`;
              } else if (functionName) {
                tmpFunctionRD[functionName] = 1;
              }

              let formattedPath = newApi.path.replace(
                /:([^/]*)|{([^}]*)}/gi,
                (_, str, str2) => `$\{${str || str2}}`,
              );
              if (newApi.extensions && newApi.extensions['x-antTech-description']) {
                const { extensions } = newApi;
                const { apiName, antTechVersion, productCode, antTechApiName } = extensions[
                  'x-antTech-description'
                ];
                formattedPath = antTechApiName || formattedPath;
                this.mappings.push({
                  antTechApi: formattedPath,
                  popAction: apiName,
                  popProduct: productCode,
                  antTechVersion,
                });
                newApi.antTechVersion = antTechVersion;
              }

              // Add alias to params in path
              const escapedPathParams = ((params || {}).path || []).map((ele, index) => ({
                ...ele,
                alias: `param${index}`,
              }));
              if (escapedPathParams.length) {
                escapedPathParams.forEach((param) => {
                  formattedPath = formattedPath.replace(`$\{${param.name}}`, `$\{${param.alias}}`);
                });
              }

              const finalParams =
                escapedPathParams && escapedPathParams.length
                  ? { ...params, path: escapedPathParams }
                  : params;

              // Handling complex objects in query
              if (finalParams && finalParams.query) {
                finalParams.query = finalParams.query.map((ele) => ({
                  ...ele,
                  isComplexType: ele.isObject,
                }));
              }

              const getPrefixPath = () => {
                if (!this.config.apiPrefix) {
                  return formattedPath;
                }
                // Static apiPrefix
                const prefix =
                  typeof this.config.apiPrefix === 'function'
                    ? `${this.config.apiPrefix({
                        path: formattedPath,
                        method: newApi.method,
                        namespace: tag,
                        functionName,
                      })}`.trim()
                    : this.config.apiPrefix.trim();

                if (!prefix) {
                  return formattedPath;
                }

                if (prefix.startsWith("'") || prefix.startsWith('"') || prefix.startsWith('`')) {
                  const finalPrefix = prefix.slice(1, prefix.length - 1);
                  if (
                    formattedPath.startsWith(finalPrefix) ||
                    formattedPath.startsWith(`/${finalPrefix}`)
                  ) {
                    return formattedPath;
                  }
                  return `${finalPrefix}${formattedPath}`;
                }
                // prefix variable
                return `$\{${prefix}}${formattedPath}`;
              };

              return {
                ...newApi,
                functionName: this.config.isCamelCase ? camelCase(functionName) : functionName,
                typeName: this.getTypeName(newApi),
                path: getPrefixPath(),
                pathInComment: formattedPath.replace(/\*/g, '&#42;'),
                hasPathVariables: formattedPath.includes('{'),
                hasApiPrefix: !!this.config.apiPrefix,
                method: newApi.method,
                // If functionName and summary are the same, summary is not displayed.
                desc:
                  functionName === newApi.summary
                    ? newApi.description
                    : [
                        newApi.summary,
                        newApi.description,
                        (newApi.responses?.default as ResponseObject)?.description
                          ? `Return Value: ${
                              (newApi.responses?.default as ResponseObject).description
                            }`
                          : '',
                      ]
                        .filter((s) => s)
                        .join(' '),
                hasHeader: !!(params && params.header) || !!(body && body.mediaType),
                params: finalParams,
                hasParams: Boolean(Object.keys(finalParams || {}).length),
                options: this.config.hook?.customOptionsDefaultValue?.(newApi) || {},
                body,
                file,
                hasFormData: formData,
                response,
              };
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error('[GenSDK] gen service param error:', error);
              throw error;
            }
          })
          // Sort it out, otherwise git will be messed up every time
          .sort((a, b) => a.path.localeCompare(b.path));

        const fileName = this.replaceDot(tag) || `api${index}`;

        let className = fileName;
        if (this.config.hook && this.config.hook.customClassName) {
          className = this.config.hook.customClassName(tag);
        }
        if (genParams.length) {
          this.classNameList.push({
            fileName: className,
            controllerName: className,
          });
        }
        return {
          genType: 'ts',
          className,
          instanceName: `${fileName[0]?.toLowerCase()}${fileName.substr(1)}`,
          list: genParams,
        };
      })
      .filter((ele) => !!ele?.list?.length);
  }

  public getBodyTP(requestBody: any = {}) {
    const reqBody: RequestBodyObject = this.resolveRefObject(requestBody);
    if (!reqBody) {
      return null;
    }
    const reqContent: ContentObject = reqBody.content;
    if (typeof reqContent !== 'object') {
      return null;
    }
    let mediaType = Object.keys(reqContent)[0];

    const schema: SchemaObject = reqContent[mediaType].schema || DEFAULT_SCHEMA;

    if (mediaType === '*/*') {
      mediaType = '';
    }
    // If requestBody has a required attribute, it will be displayed normally; if not, it is not required by default
    const required = typeof requestBody.required === 'boolean' ? requestBody.required : false;
    if (schema.type === 'object' && schema.properties) {
      const propertiesList = Object.keys(schema.properties)
        .map((p) => {
          if (
            schema.properties &&
            schema.properties[p] &&
            !['binary', 'base64'].includes((schema.properties[p] as SchemaObject).format || '') &&
            !(
              ['string[]', 'array'].includes((schema.properties[p] as SchemaObject).type || '') &&
              ['binary', 'base64'].includes(
                ((schema.properties[p] as SchemaObject).items as SchemaObject).format || '',
              )
            )
          ) {
            return {
              key: p,
              schema: {
                ...schema.properties[p],
                type: this.getType(schema.properties[p], this.config.namespace),
                required: schema.required?.includes(p) ?? false,
              },
            };
          }
          return undefined;
        })
        .filter((p) => p);
      return {
        mediaType,
        ...schema,
        required,
        propertiesList,
      };
    }
    return {
      mediaType,
      required,
      type: this.getType(schema, this.config.namespace),
    };
  }
  public getFileTP(requestBody: any = {}) {
    const reqBody: RequestBodyObject = this.resolveRefObject(requestBody);
    if (reqBody && reqBody.content && reqBody.content['multipart/form-data']) {
      const ret = this.resolveFileTP(reqBody.content['multipart/form-data'].schema);
      return ret.length > 0 ? ret : null;
    }
    return null;
  }
  public resolveFileTP(obj: any) {
    let ret = [];
    const resolved = this.resolveObject(obj);
    const props =
      (resolved.props &&
        resolved.props.length > 0 &&
        resolved.props[0].filter(
          (p) =>
            p.format === 'binary' ||
            p.format === 'base64' ||
            ((p.type === 'string[]' || p.type === 'array') &&
              (p.items.format === 'binary' || p.items.format === 'base64')),
        )) ||
      [];
    if (props.length > 0) {
      ret = props.map((p) => {
        return { title: p.name, multiple: p.type === 'string[]' || p.type === 'array' };
      });
    }
    if (resolved.type) ret = [...ret, ...this.resolveFileTP(resolved.type)];
    return ret;
  }

  public getResponseTP(responses: ResponsesObject = {}) {
    const { components } = this.openAPIData;
    const response: ResponseObject | undefined =
      responses && this.resolveRefObject(responses.default || responses['200'] || responses['201']);
    const defaultResponse = {
      mediaType: '*/*',
      type: 'any',
    };
    if (!response) {
      return defaultResponse;
    }
    const resContent: ContentObject | undefined = response.content;
    const resContentMediaTypes = Object.keys(resContent || {});
    const mediaType = resContentMediaTypes.includes('application/json')
      ? 'application/json'
      : resContentMediaTypes[0]; // Prefer application/json
    if (typeof resContent !== 'object' || !mediaType) {
      return defaultResponse;
    }
    let schema = (resContent[mediaType].schema || DEFAULT_SCHEMA) as SchemaObject;

    if (schema.$ref) {
      const refPaths = schema.$ref.split('/');
      const refName = refPaths[refPaths.length - 1];
      const childrenSchema = components.schemas[refName] as SchemaObject;
      if (
        childrenSchema?.type === 'object' &&
        'properties' in childrenSchema &&
        this.config.dataFields
      ) {
        schema =
          this.config.dataFields
            .map((field) => childrenSchema.properties[field])
            .filter(Boolean)?.[0] ||
          resContent[mediaType].schema ||
          DEFAULT_SCHEMA;
      }
    }

    if ('properties' in schema) {
      Object.keys(schema.properties).map((fieldName) => {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        schema.properties[fieldName]['required'] = schema.required?.includes(fieldName) ?? false;
      });
    }
    return {
      mediaType,
      type: this.getType(schema, this.config.namespace),
    };
  }

  public getParamsTP(
    parameters: (ParameterObject | ReferenceObject)[] = [],
    path: string = null,
  ): Record<string, ParameterObject[]> {
    const templateParams: Record<string, ParameterObject[]> = {};

    if (parameters && parameters.length) {
      ['query', 'path', 'cookie' /* , 'file' */].forEach((source) => {
        // Possible values are "query", "header", "path" or "cookie". (https://swagger.io/specification/)
        const params = parameters
          .map((p) => this.resolveRefObject(p))
          .filter((p: ParameterObject) => p.in === source)
          .map((p) => {
            const isDirectObject = ((p.schema || {}).type || p.type) === 'object';
            const refList = ((p.schema || {}).$ref || p.$ref || '').split('/');
            const ref = refList[refList.length - 1];
            const deRefObj = (Object.entries(
              (this.openAPIData.components && this.openAPIData.components.schemas) || {},
            ).find(([k]) => k === ref) || []) as any;
            const isRefObject = (deRefObj[1] || {}).type === 'object';
            return {
              ...p,
              isObject: isDirectObject || isRefObject,
              type: this.getType(p.schema || DEFAULT_SCHEMA, this.config.namespace),
            };
          });

        if (params.length) {
          templateParams[source] = params;
        }
      });
    }

    if (path && path.length > 0) {
      const regex = /\{(\w+)\}/g;
      templateParams.path = templateParams.path || [];
      let match = null;
      while ((match = regex.exec(path))) {
        if (!templateParams.path.some((p) => p.name === match[1])) {
          templateParams.path.push({
            ...DEFAULT_PATH_PARAM,
            name: match[1],
          });
        }
      }

      // If path has no content, the path parameter will be deleted to avoid affecting the subsequent hasParams judgment
      if (!templateParams.path.length) delete templateParams.path;
    }

    return templateParams;
  }

  public getInterfaceTP() {
    const { components } = this.openAPIData;
    const data =
      components &&
      components.schemas &&
      [components.schemas].map((defines) => {
        if (!defines) {
          return null;
        }

        return Object.keys(defines).map((typeName) => {
          const result = this.resolveObject(defines[typeName]);

          const getDefinesType = () => {
            if (result.type) {
              return (defines[typeName] as SchemaObject).type === 'object' || result.type;
            }
            return 'Record<string, any>';
          };
          return {
            typeName: resolveTypeName(typeName),
            type: getDefinesType(),
            parent: result.parent,
            props: result.props || [],
            isEnum: result.isEnum,
          };
        });
      });

    // Forcefully replace the type of the request parameter params and generate the xxxxParams type corresponding to the method
    Object.keys(this.openAPIData.paths || {}).forEach((p) => {
      const pathItem: PathItemObject = this.openAPIData.paths[p];
      ['get', 'put', 'post', 'delete', 'patch'].forEach((method) => {
        const operationObject: OperationObject = pathItem[method];
        if (!operationObject) {
          return;
        }
        operationObject.parameters = operationObject.parameters?.filter(
          (item) => (item as ParameterObject)?.in !== 'header',
        );
        const props = [];
        if (operationObject.parameters) {
          operationObject.parameters.forEach((parameter: any) => {
            props.push({
              desc: parameter.description ?? '',
              name: parameter.name,
              required: parameter.required,
              type: this.getType(parameter.schema),
            });
          });
        }
        // parameters may be in path
        if (pathItem.parameters) {
          pathItem.parameters.forEach((parameter: any) => {
            props.push({
              desc: parameter.description ?? '',
              name: parameter.name,
              required: parameter.required,
              type: this.getType(parameter.schema),
            });
          });
        }

        if (props.length > 0 && data) {
          data.push([
            {
              typeName: this.getTypeName({ ...operationObject, method, path: p }),
              type: 'Record<string, any>',
              parent: undefined,
              props: [props],
              isEnum: false,
            },
          ]);
        }
      });
    });
    // ---- Generate xxxparams type end---------

    return (
      data &&
      data
        .reduce((p, c) => p && c && p.concat(c), [])
        // Sort it out, otherwise git will be messed up every time
        .sort((a, b) => a.typeName.localeCompare(b.typeName))
    );
  }

  private genFileFromTemplate(
    fileName: string,
    type: TypescriptFileType,
    params: Record<string, any>,
  ): boolean {
    // console.log('fileName :>> ', fileName);
    // console.log('type :>> ', type);
    // console.log('params :>> ', params);
    try {
      const template = this.getTemplate(type);
      // Set output to not escape
      nunjucks.configure({
        autoescape: false,
      });
      return writeFile(this.finalPath, fileName, nunjucks.renderString(template, params));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[GenSDK] file gen fail:', fileName, 'type:', type);
      throw error;
    }
  }

  private getTemplate(type: 'interface' | 'serviceController' | 'serviceIndex'): string {
    return readFileSync(join(this.config.templatesFolder, `${type}.njk`), 'utf8');
  }

  // Get the list of properties of TS type
  getProps(schemaObject: SchemaObject) {
    const requiredPropKeys = schemaObject?.required ?? false;
    return schemaObject.properties
      ? Object.keys(schemaObject.properties).map((propName) => {
          const schema: SchemaObject =
            (schemaObject.properties && schemaObject.properties[propName]) || DEFAULT_SCHEMA;
          // Remove special symbols from attribute key values, because special symbols in function input parameters will cause file parsing failure
          propName = propName.replace(/[\[|\]]/g, '');
          return {
            ...schema,
            name: propName,
            type: this.getType(schema),
            desc: [schema.title, schema.description].filter((s) => s).join(' '),
            // If there is no required information, all fields are optional by default.
            required: requiredPropKeys ? requiredPropKeys.some((key) => key === propName) : false,
          };
        })
      : [];
  }

  getType(schemaObject: SchemaObject | undefined, namespace?: string) {
    const hookFunc = this.config.hook?.customType;
    if (hookFunc) {
      const type = hookFunc(schemaObject, namespace, defaultGetType);
      if (typeof type === 'string') {
        return type;
      }
    }
    return defaultGetType(schemaObject, namespace);
  }

  resolveObject(schemaObject: SchemaObject) {
    schemaObject = schemaObject ?? {};
    // Reference Types
    if (schemaObject.$ref) {
      return this.resolveRefObject(schemaObject);
    }
    // Enumeration Types
    if (schemaObject.enum) {
      return this.resolveEnumObject(schemaObject);
    }
    // Inheritance Type
    if (schemaObject.allOf && schemaObject.allOf.length) {
      return this.resolveAllOfObject(schemaObject);
    }
    // Object Type
    if (schemaObject.properties) {
      return this.resolveProperties(schemaObject);
    }
    // Array Types
    if (schemaObject.items && schemaObject.type === 'array') {
      return this.resolveArray(schemaObject);
    }
    return schemaObject;
  }

  resolveArray(schemaObject: SchemaObject) {
    if (schemaObject.items.$ref) {
      const refObj = schemaObject.items.$ref.split('/');
      return {
        type: `${refObj[refObj.length - 1]}[]`,
      };
    }
    // TODO: The specific attributes need to be parsed here, but since the parser layer is not yet certain, it will return any for now.
    return 'any[]';
  }

  resolveProperties(schemaObject: SchemaObject) {
    return {
      props: [this.getProps(schemaObject)],
    };
  }

  resolveEnumObject(schemaObject: SchemaObject) {
    const enumArray = schemaObject.enum;

    let enumStr;
    switch (this.config.enumStyle) {
      case 'enum':
        enumStr = `{${enumArray.map((v) => `${v}="${v}"`).join(',')}}`;
        break;
      case 'string-literal':
        enumStr = Array.from(
          new Set(
            enumArray.map((v) =>
              typeof v === 'string' ? `"${v.replace(/"/g, '"')}"` : this.getType(v),
            ),
          ),
        ).join(' | ');
        break;
      default:
        break;
    }

    return {
      isEnum: this.config.enumStyle == 'enum',
      type: Array.isArray(enumArray) ? enumStr : 'string',
    };
  }

  resolveAllOfObject(schemaObject: SchemaObject) {
    const props = (schemaObject.allOf || []).map((item) =>
      item.$ref ? [{ ...item, type: this.getType(item).split('/').pop() }] : this.getProps(item),
    );

    if (schemaObject.properties) {
      const extProps = this.getProps(schemaObject);
      return { props: [...props, extProps] };
    }

    return { props };
  }

  // Convert the address path to upper camel case
  private genDefaultFunctionName(path: string, pathBasePrefix: string) {
    // Capitalize the first letter
    function toUpperFirstLetter(text: string) {
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    return path
      ?.replace(pathBasePrefix, '')
      .split('/')
      .map((str) => {
        /**
         * Compatible with incorrect naming such as /user/:id/:name
         * Because it is typeName, it is converted directly
         * */
        let s = resolveTypeName(str);
        if (s.includes('-')) {
          s = s.replace(/(-\w)+/g, (_match: string, p1) => p1?.slice(1).toUpperCase());
        }

        if (s.match(/^{.+}$/gim)) {
          return `By${toUpperFirstLetter(s.slice(1, s.length - 1))}`;
        }
        return toUpperFirstLetter(s);
      })
      .join('');
  }
  // Detect all path duplication areas (prefix)
  private getBasePrefix(paths: string[]) {
    const arr = [];
    paths
      .map((item) => item.split('/'))
      .forEach((pathItem) => {
        pathItem.forEach((item, key) => {
          if (arr.length <= key) {
            arr[key] = [];
          }
          arr[key].push(item);
        });
      });

    const res = [];
    arr
      .map((item) => Array.from(new Set(item)))
      .every((item) => {
        const b = item.length === 1;
        if (b) {
          res.push(item);
        }
        return b;
      });

    return `${res.join('/')}/`;
  }

  private resolveRefObject(refObject: any): any {
    if (!refObject || !refObject.$ref) {
      return refObject;
    }
    const refPaths = refObject.$ref.split('/');
    if (refPaths[0] === '#') {
      refPaths.shift();
      let obj: any = this.openAPIData;
      refPaths.forEach((node: any) => {
        obj = obj[node];
      });
      if (!obj) {
        throw new Error(`[GenSDK] Data Error! Notfoud: ${refObject.$ref}`);
      }
      return {
        ...this.resolveRefObject(obj),
        type: obj.$ref ? this.resolveRefObject(obj).type : obj,
      };
    }
    return refObject;
  }

  private getFinalFileName(s: string): string {
    // Supports underscore, hyphen and space delimiters. Note that the order of the delimiter enumeration values ​​cannot be changed, otherwise regular matching will result in an error.
    return s.replace(/[-_ ](\w)/g, (_all, letter) => letter.toUpperCase());
  }

  private replaceDot(s: string) {
    return s.replace(/\./g, '_').replace(/[-_ ](\w)/g, (_all, letter) => letter.toUpperCase());
  }

  private resolveFunctionName(functionName: string, methodName) {
    // Type declaration filter keywords
    if (ReservedDict.check(functionName)) {
      return `${functionName}Using${methodName.toUpperCase()}`;
    }
    return functionName;
  }
}

export { ServiceGenerator };
