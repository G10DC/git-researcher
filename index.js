// index.js
// Minimal CLI entry point: readline -> runPipeline.
// All logic lives in src/pipeline.js (and modules). No cascade logic here.

import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { runPipeline } from './src/pipeline.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.clear();
  console.log(
    chalk.bold.cyan(
      `\n  ================================================\n` +
        `  🔎  GITRESEARCHER - idea analysis + GitHub repos   🔎\n` +
        `  ================================================\n`
    )
  );

  const idea = (await ask(chalk.cyan.bold('Enter a software project idea:\n> '))).trim();
  if (!idea) {
    console.log(chalk.red('⚠️ Empty input.'));
    rl.close();
    return;
  }

  const spinner = ora({ text: 'Starting...' }).start();
  try {
    const result = await runPipeline(idea, {
      onProgress: (m) => {
        spinner.text = chalk.yellow(m);
      },
    });
    spinner.succeed(chalk.green(`Report generated in ${result.dir}`));
    console.log(chalk.gray('Final report copy: architectural_report.md'));
    console.log(chalk.gray('\nReport preview:\n') + chalk.white(String(result.finalReport).slice(0, 600) + '...\n'));
  } catch (e) {
    spinner.fail(chalk.red('Pipeline error.'));
    console.error(e);
  } finally {
    rl.close();
  }
}

main();
