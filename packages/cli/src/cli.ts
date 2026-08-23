import { CliUsageError, parseCliArguments } from "./arguments.js";
import { CliCommandError, executeCommand } from "./commands.js";
import type { CliIo } from "./commands.js";

const processIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export async function runCli(args: readonly string[], io: CliIo = processIo): Promise<number> {
  try {
    return await executeCommand(parseCliArguments(args), io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    if (error instanceof CliUsageError || error instanceof CliCommandError) return error.exitCode;
    return 1;
  }
}
