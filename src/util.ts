/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-lonely-if */
/* eslint-disable no-param-reassign */
import path from 'path';
import fs from 'fs';
import { camelCase, upperFirst } from 'lodash';

export const getAbsolutePath = (filePath: string) => {
  if (filePath && !path.isAbsolute(filePath)) {
    return path.join(process.cwd(), filePath);
  }
  return filePath;
};

export const mkdir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
  }
};

export const prettierFile = (content: string): [string, boolean] => {
  let result = content;
  let hasError = false;
  try {
    const prettier = require('prettier');

    const prettierOptions = prettier.resolveConfig.sync(process.cwd());
    result = prettier.format(content, {
      parser: 'typescript',
      ...prettierOptions,
    });
  } catch (error) {
    hasError = true;
  }
  return [result, hasError];
};

export const writeFile = (folderPath: string, fileName: string, content: string) => {
  const filePath = path.join(folderPath, fileName);
  mkdir(path.dirname(filePath));
  const [prettierContent, hasError] = prettierFile(content);
  fs.writeFileSync(filePath, prettierContent, {
    encoding: 'utf8',
  });
  return hasError;
};

export const getTagName = (name: string) => {
  const result = name.split('.');
  // The tag in the data source is equivalent to the full op API name, which is determined to be 4-5 segments, as shown above
  // Take the middle 1-2 fields as the tag, as the basis for the serviceController to create a directory
  if (result.length === 4) {
    return result[2];
  }
  if (result.length === 5) {
    return result[2] + upperFirst(result[3]);
  }
  return name;
};

/**
 * Format the apiInfo returned by the request according to the current data source type
 * If it is an op data source, process the tags and tags in the path
 * - before: prefix (product set. product code) + operation object (required) + sub-operation object (optional) + action (required)
 * - after: operation object (required) + sub-operation object (optional) ==> camel case
 */
export const formatApiInfo = (apiInfo: Record<string, any>): any => {
  if (
    !(
      apiInfo &&
      apiInfo.schema.info &&
      apiInfo.schema.info.extensions &&
      apiInfo.schema.info.extensions['x-antTech-description']
    )
  ) {
    // Non-op data source, return directly
    return apiInfo;
  }

  apiInfo.schema.tags = apiInfo.schema.tags.map((item: Record<string, string>) => {
    return {
      ...item,
      name: getTagName(item.name),
    };
  });

  for (const child_path in apiInfo.schema.paths) {
    apiInfo.schema.paths[child_path].post.tags = apiInfo.schema.paths[
      child_path
    ].post.tags.map((tag: string) => getTagName(tag));
  }

  return apiInfo;
};

type serviceParam = {
  title: string;
  type: string;
  description: string;
  default: string;
  [key: string]: any;
};

type serviceParams = Record<string, serviceParam>;
/**
 * In a one-party scenario, since onex will process the response to the request
 * 1. The parameter fields in Response & Request will be changed to camelCase
 * onex related code: http://gitlab.alipay-inc.com/one-console/sdk/blob/master/src/request.ts#L110
 * 2. Also note:
 * The data returned by op and the type format of the request parameters need additional processing
 *  - (name) key.n, (type) string  ==> key: string []
 *  - (name) key.m,  (type) string ===>  key: string []
 *  - (name) key.key1 , (type) string ==> key: {key1:string}
 *  - (name) key.n.key1 ,(type) string => key:{ key1 :string}[]
 *  - (name) key.n.key1.m,(type) string ==> key:{key1: string[]}[]
 */
export function formatParamsForYFH(
  params: serviceParams,
  paramsObject: serviceParams = {},
): serviceParams {
  Object.keys(params).forEach((name) => {
    const prop = params[name];
    let key = name;
    const nameList = name.split('.');
    const nameListLength = nameList.length;

    if (nameListLength === 1) {
      // Normal key
      paramsObject[key] = { ...prop };
    } else if (nameListLength === 2 && nameList[1] !== 'n' && nameList[1] !== 'm') {
      const [childKey] = nameList;
      // key.child_key
      const key_child_key = camelCase(nameList[1]);
      paramsObject[childKey] = combineParams(childKey, key_child_key, prop, paramsObject);
    } else {
      // key.n.child_key
      if (nameList[nameListLength - 2] === 'n' || nameList[nameListLength - 2] === 'm') {
        const child_key = camelCase(nameList.pop());
        nameList.pop();
        key = nameList.join('.');
        paramsObject[key] = combineParams(key, child_key, prop, paramsObject, '.n.key');
      } else {
        const child_key = camelCase(nameList.pop());
        key = nameList.join('.');

        // .key.n
        if (child_key === 'n' || child_key === 'm') {
          // .n.key.m
          if (nameList[nameList.length - 2] === 'n' || nameList[nameList.length - 2] === 'm') {
            const child_child_key = camelCase(nameList.pop());
            nameList.pop();
            key = nameList.join('.');
            paramsObject[key] = combineParams(key, child_child_key, prop, paramsObject, '.n.key.m');
          } else {
            prop.type = `${prop.type}[]`;
            paramsObject[key] = { ...prop };
          }
        } else {
          paramsObject[key] = combineParams(key, child_key, prop, paramsObject);
        }
      }
    }

    paramsObject[key].name = camelCase(key);
  });

  const hasInvoke = Object.keys(paramsObject).filter((param) => param.includes('.')).length > 0;

  if (hasInvoke) {
    // recursion
    return formatParamsForYFH(paramsObject);
  }
  return paramsObject;
}

function combineParams(
  key: string,
  child_key: string,
  prop: serviceParam,
  paramsObject: serviceParams,
  type?: string,
): serviceParam {
  const typeSuffix = type === '.n.key.m' ? '[]' : '';
  const keySuffix = type === '.n.key' || type === '.n.key.m' ? '[]' : '';
  if (paramsObject[key]) {
    const child_type = `{${child_key}:${prop.type}${typeSuffix}, ${paramsObject[key].type.slice(
      1,
    )}`;
    paramsObject[key] = {
      ...paramsObject[key],
      type: child_type,
    };
  } else {
    paramsObject[key] = {
      ...prop,
      type: `{${child_key}:${prop.type}
      }${keySuffix}`,
    };
  }

  return paramsObject[key];
}

export const stripDot = (str: string) => {
  return str.replace(/[-_ .](\w)/g, (_all, letter) => letter.toUpperCase());
};
