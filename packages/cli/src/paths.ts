import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sameFileIdentity(
  input: Pick<BigIntStats, "dev" | "ino">,
  output: Pick<BigIntStats, "dev" | "ino">,
): boolean {
  return input.dev === output.dev && input.ino === output.ino;
}

export async function assertNewOutputPath(inputPath: string, outputPath: string): Promise<void> {
  const inputAbsolute = resolve(inputPath);
  const outputAbsolute = resolve(outputPath);
  const inputReal = await realpath(inputAbsolute);

  if (await exists(outputAbsolute)) {
    const [outputReal, inputStat, outputStat] = await Promise.all([
      realpath(outputAbsolute),
      stat(inputAbsolute, { bigint: true }),
      stat(outputAbsolute, { bigint: true }),
    ]);
    if (
      comparable(inputReal) === comparable(outputReal)
      || sameFileIdentity(inputStat, outputStat)
    ) {
      throw new Error("Refusing to overwrite input bundle");
    }
    throw new Error(`Output already exists: ${outputPath}`);
  }

  const outputParentReal = await realpath(dirname(outputAbsolute));
  const candidate = join(outputParentReal, basename(outputAbsolute));
  if (comparable(inputReal) === comparable(candidate)) {
    throw new Error("Refusing to overwrite input bundle");
  }
}
