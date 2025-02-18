import Mock from 'mockjs';
import fs from 'fs';
import { prettierFile, writeFile } from './util';
import { dirname, join } from 'path';
import OpenAPIParserMock from './openAPIParserMock/index';
import Log from './log';
import pinyin from 'tiny-pinyin';

Mock.Random.extend({
  country() {
    const data = [
      'Argentina',
      'Australia',
      'Brazil',
      'Canada',
      'China',
      'France',
      'Germany',
      'India',
      'Indonesia',
      'Italy',
      'Japan',
      'South Korea',
      'Mexico',
      'Russia',
      'Saudi Arabia',
      'South Africa',
      'Turkey',
      'United Kingdom',
      'United States',
    ];
    const id = (Math.random() * data.length).toFixed();
    return data[id];
  },
  phone() {
    const phonepreFix = ['111', '112', '114'];
    return this.pick(phonepreFix) + Mock.mock(/\d{8}/); // Number()
  },
  status() {
    const status = ['success', 'error', 'default', 'processing', 'warning'];
    return status[(Math.random() * 4).toFixed(0)];
  },
  authority() {
    const status = ['admin', 'user', 'guest'];
    return status[(Math.random() * status.length).toFixed(0)];
  },
  avatar() {
    const avatar = [
      'https://gw.alipayobjects.com/zos/rmsportal/KDpgvguMpGfqaHPjicRK.svg',
      'https://gw.alipayobjects.com/zos/rmsportal/udxAbMEhpwthVVcjLXik.png',
      'https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png',
      'https://gw.alipayobjects.com/zos/rmsportal/ThXAXghbEsBCCSDihZxY.png',
      'https://gw.alipayobjects.com/zos/rmsportal/OKJXDXrmkNshAMvwtvhu.png',
      'https://avatars0.githubusercontent.com/u/507615?s=40&v=4',
      'https://avatars1.githubusercontent.com/u/8186664?s=40&v=4',
    ];
    const id = (Math.random() * avatar.length).toFixed();
    return avatar[id];
  },
  group() {
    const data = [
      'Experience Technology Department',
      'Innovation Technology Group',
      'Front-end Group 6',
      'Blockchain Platform Department',
      'Service Technology Department',
    ];
    const id = (Math.random() * data.length).toFixed();
    return data[id];
  },
  label() {
    const label = [
      'Very thoughtful',
      'fresh',
      'silly and innocent',
      'sunny boy',
      'big shot',
      'fitness expert',
      'programmer',
      'algorithm engineer',
      'Sichuan girl',
      'famous programmer',
      'long legs',
      'embracing all rivers',
      'focused on design',
      'wide range of interests',
      'IT Internet',
    ];
    const id = (Math.random() * label.length).toFixed();
    return label[id];
  },
  href() {
    const href = [
      'https://preview.pro.ant.design/dashboard/analysis',
      'https://ant.design',
      'https://procomponents.ant.design/',
      'https://umijs.org/',
      'https://github.com/umijs/dumi',
    ];
    const id = (Math.random() * href.length).toFixed();
    return href[id];
  },
});

const genMockData = (example: string) => {
  if (!example) {
    return {};
  }

  if (typeof example === 'string') {
    return Mock.mock(example);
  }

  if (Array.isArray(example)) {
    return Mock.mock(example);
  }

  return Object.keys(example)
    .map((name) => {
      return {
        [name]: Mock.mock(example[name]),
      };
    })
    .reduce((pre, next) => {
      return {
        ...pre,
        ...next,
      };
    }, {});
};

const genByTemp = ({
  method,
  path,
  parameters,
  status,
  data,
}: {
  method: string;
  path: string;
  parameters: {
    name: string;
    in: string;
    description: string;
    required: boolean;
    schema: { type: string };
    example: string;
  }[];
  status: string;
  data: string;
}) => {
  if (!['get', 'put', 'post', 'delete', 'patch'].includes(method.toLocaleLowerCase())) {
    return '';
  }

  let securityPath = path;
  parameters?.forEach((item) => {
    if (item.in === 'path') {
      securityPath = securityPath.replace(`{${item.name}}`, `:${item.name}`);
    }
  });

  return `'${method.toUpperCase()} ${securityPath}': (req: Request, res: Response) => {
    res.status(${status}).send(${data});
  }`;
};

const genMockFiles = (mockFunction: string[]) => {
  return prettierFile(` 
// @ts-ignore
import { Request, Response } from 'express';

export default {
${mockFunction.join('\n,')}
    }`)[0];
};
export type genMockDataServerConfig = { openAPI: any; mockFolder: string };

const mockGenerator = async ({ openAPI, mockFolder }: genMockDataServerConfig) => {
  const openAPParse = new OpenAPIParserMock(openAPI);
  const docs = openAPParse.parser();
  const pathList = Object.keys(docs.paths);
  const { paths } = docs;
  const mockActionsObj = {};
  pathList.forEach((path) => {
    const pathConfig = paths[path];
    Object.keys(pathConfig).forEach((method) => {
      const methodConfig = pathConfig[method];
      if (methodConfig) {
        let conte = (
          methodConfig.operationId ||
          methodConfig?.tags?.join('/') ||
          path.replace('/', '').split('/')[1]
        )?.replace(/[^\w^\s^\u4e00-\u9fa5]/gi, '');
        if (/[\u3220-\uFA29]/.test(conte)) {
          conte = pinyin.convertToPinyin(conte, '', true);
        }
        if (!conte) {
          return;
        }
        const data = genMockData(methodConfig.responses?.['200']?.example);
        if (!mockActionsObj[conte]) {
          mockActionsObj[conte] = [];
        }
        const tempFile = genByTemp({
          method,
          path,
          parameters: methodConfig.parameters,
          status: '200',
          data: JSON.stringify(data),
        });
        if (tempFile) {
          mockActionsObj[conte].push(tempFile);
        }
      }
    });
  });
  Object.keys(mockActionsObj).forEach((file) => {
    if (!file || file === 'undefined') {
      return;
    }
    if (file.includes('/')) {
      const dirName = dirname(join(mockFolder, `${file}.mock.ts`));
      if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName);
      }
    }
    writeFile(mockFolder, `${file}.mock.ts`, genMockFiles(mockActionsObj[file]));
  });
  Log('✅ Generate mock files successfully');
};

export { mockGenerator };
