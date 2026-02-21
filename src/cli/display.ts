import chalk from "chalk";

export function banner(): void {
  console.log(
    chalk.bold.cyan(`
 ╦ ╦╔═╗╦═╗╦  ╔╦╗  ╔╦╗╔═╗╔═╗╔╦╗╔═╗╦═╗
 ║║║║ ║╠╦╝║   ║║   ║ ║╣ ╚═╗ ║ ║╣ ╠╦╝
 ╚╩╝╚═╝╩╚═╩═╝═╩╝   ╩ ╚═╝╚═╝ ╩ ╚═╝╩╚═
`),
  );
  console.log(chalk.dim("  AI-powered QA Tester | Type 'help' for commands\n"));
}

export function info(msg: string): void {
  console.log(chalk.blue(`[info] ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(`[ok] ${msg}`));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`[warn] ${msg}`));
}

export function error(msg: string): void {
  console.log(chalk.red(`[error] ${msg}`));
}

export function cost(line: string): void {
  console.log(chalk.dim(line));
}

export function agentMessage(msg: string): void {
  console.log(chalk.white(`\n${msg}\n`));
}

export function modeLabel(mode: string): string {
  const colors: Record<string, (s: string) => string> = {
    extract: chalk.magenta,
    act: chalk.green,
    task: chalk.yellow,
    observe: chalk.cyan,
    search: chalk.blue,
    ask: chalk.white,
    goto: chalk.gray,
    chat: chalk.cyanBright,
    learn: chalk.yellowBright,
    auto: chalk.dim,
  };
  const colorFn = colors[mode] ?? chalk.dim;
  return colorFn(`[${mode}]`);
}

export function modeSwitch(from: string, to: string, instruction: string): void {
  console.log(chalk.cyan(`[${from} -> ${to}] ${instruction}`));
}

export function separator(): void {
  console.log(chalk.dim("─".repeat(60)));
}
