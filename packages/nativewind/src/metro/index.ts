/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { spawn, spawnSync } from "node:child_process";

import findCacheDir from "find-cache-dir";
import { getCreateOptions } from "../transform-css";

export interface WithNativeWindOptions {
  postcss?: string;
}

export interface GetTransformOptionsOptions {
  dev: boolean;
  hot: boolean;
  platform: string | null | undefined;
}

export type WithTailwindOptions = WithNativeWindOptions &
  GetTransformOptionsOptions;

// We actually don't do anything to the Metro config,
export default function withNativeWind(
  config: Record<string, any> = {},
  options: WithNativeWindOptions = {}
) {
  return {
    ...config,
    transformer: {
      ...config.transformer,
      getTransformOptions: async (...args: any[]) => {
        const entry: string = args[0][0];
        const transformOptions: GetTransformOptionsOptions = args[1];

        startTailwind(entry, { ...options, ...transformOptions });

        return config.transformer?.getTransformOptions(...args);
      },
    },
  };
}

function startTailwind(
  main: string,
  { postcss, platform }: WithTailwindOptions
) {
  const cacheDirectory = findCacheDir({ name: "nativewind", create: true });
  if (!cacheDirectory) throw new Error("Unable to secure cache directory");

  const nativewindOutput = join(cacheDirectory, "output");
  const nativewindOutputJS = `${nativewindOutput}.js`;
  writeFileSync(nativewindOutputJS, "");

  process.env.NATIVEWIND_OUTPUT = nativewindOutput;
  process.env.NATIVEWIND_NATIVE = platform !== "web" ? "true" : undefined;

  let inputPath: string | undefined;
  try {
    if (main === "node_modules/expo/AppEntry.js") {
      const file = readdirSync(cwd()).find((file) =>
        file.match(/app.(ts|tsx|cjs|mjs|js)/gi)
      );

      if (file) {
        main = join(cwd(), file);
      }
    }

    if (main) {
      const cssImport = readFileSync(main, "utf8").match(/["'](.+\.css)["']/);

      if (cssImport && typeof cssImport[0] === "string") {
        inputPath = cssImport[0];
      }
    }
  } finally {
    if (!inputPath) {
      inputPath = join(cacheDirectory, "input.css");
      writeFileSync(inputPath, "@tailwind components;@tailwind utilities;");
    }
  }

  const spawnCommands = ["tailwind", "-i", inputPath];

  if (postcss) {
    spawnCommands.push("--postcss", postcss);
  }

  const isDevelopment = process.env.NODE_ENV !== "production";

  if (isDevelopment) {
    spawnCommands.push("--watch", "--poll");

    const cli = spawn("npx", spawnCommands, {
      shell: true,
    });

    cli.stdout.on("data", (data) => {
      const createOptions = JSON.stringify(
        getCreateOptions(data.toString().trim())
      );
      writeFileSync(
        nativewindOutputJS,
        `const {NativeWindStyleSheet}=require("nativewind/dist/style-sheet");\nNativeWindStyleSheet.create(${createOptions});`
      );
    });

    cli.stderr.on("data", (data: Buffer) => {
      const output = data.toString().trim();

      // Ignore this, RN projects won't have Browserslist setup anyway.
      if (output.startsWith("[Browserslist] Could not parse")) {
        return;
      }

      if (output) console.error(`NativeWind: ${output}`);
    });
  } else {
    spawnSync("npx", spawnCommands, { shell: true });
  }
}