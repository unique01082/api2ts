import chalk from 'chalk';

// eslint-disable-next-line no-console
const Log = (...rest) => console.log(`${chalk.blue('[openAPI]')}: ${rest.join('\n')}`);

// eslint-disable-next-line no-console
export const LogAdded = (msg: string) => console.log(chalk.green(`[+] ${msg}`));

// eslint-disable-next-line no-console
export const LogRemoved = (msg: string) => console.log(chalk.red(`[-] ${msg}`));

// eslint-disable-next-line no-console
export const LogModified = (msg: string) => console.log(chalk.yellow(`[~] ${msg}`));

// eslint-disable-next-line no-console
export const LogSnap = (msg: string) => console.log(chalk.blue(`[snapshot] ${msg}`));

export default Log;
