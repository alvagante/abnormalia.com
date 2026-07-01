import { z } from "npm:zod@4";

const MediaRestoreSchema = z.object({
  version: z.number().int().positive().optional(),
  restoredImages: z.array(z.string()),
  missingImages: z.array(z.string()),
  restoredCards: z.array(z.string()),
  missingCards: z.array(z.string()),
  restoredInfographic: z.array(z.string()),
  missingInfographic: z.array(z.string()),
  restoredFiles: z.array(z.string()),
  missingFiles: z.array(z.string()),
  generatedAt: z.string(),
});

type RestoreGroup = "images" | "cards" | "infographic";

type ModelContext = {
  globalArgs: {
    outputDir?: string;
  };
  writeResource: (
    specName: "mediaRestore",
    name: string,
    content: unknown,
  ) => Promise<unknown>;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
    warning: (msg: string, props?: Record<string, unknown>) => void;
  };
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function listVersionDirs(outputDir: string): Promise<number[]> {
  const versions: number[] = [];
  if (!await pathExists(outputDir)) return versions;

  for await (const entry of Deno.readDir(outputDir)) {
    if (entry.isDirectory && /^\d+$/.test(entry.name)) {
      versions.push(Number(entry.name));
    }
  }

  return versions.toSorted((a, b) => a - b);
}

function safeRelativePath(path: string): string | undefined {
  const [withoutHash] = path.split("#", 1);
  const [clean] = withoutHash.split("?", 1);
  if (
    !clean ||
    clean.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(clean) ||
    clean.split("/").includes("..")
  ) {
    return undefined;
  }
  return clean;
}

function localRefsFromHtml(html: string): string[] {
  const refs = new Set<string>();
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(html))) {
    const ref = safeRelativePath(match[1]);
    if (ref) refs.add(ref);
  }

  return [...refs];
}

async function copyIfPresent(
  sourceDir: string,
  outputDir: string,
  file: string,
): Promise<boolean> {
  const rel = safeRelativePath(file);
  if (!rel) return false;

  const sourcePath = `${sourceDir}/${rel}`;
  if (!await pathExists(sourcePath)) return false;

  const targetPath = `${outputDir}/${rel}`;
  const parent = rel.split("/").slice(0, -1).join("/");
  if (parent) await Deno.mkdir(`${outputDir}/${parent}`, { recursive: true });
  await Deno.copyFile(sourcePath, targetPath);
  return true;
}

async function infographicFiles(
  sourceDir: string,
  htmlFile: string,
): Promise<string[]> {
  const files = new Set<string>([htmlFile]);
  const rel = safeRelativePath(htmlFile);
  if (!rel) return [...files];

  const htmlPath = `${sourceDir}/${rel}`;
  if (!await pathExists(htmlPath)) return [...files];

  const html = await Deno.readTextFile(htmlPath);
  for (const ref of localRefsFromHtml(html)) {
    files.add(ref);
  }
  return [...files];
}

export const extension = {
  type: "@alvagante/content-ixen",
  resources: {
    mediaRestore: {
      description:
        "Files restored from the latest versioned Ixen directory before regeneration.",
      schema: MediaRestoreSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: [{
    restoreMedia: {
      description:
        "Restore selected Ixen media from the latest numeric version directory without making generation API calls.",
      arguments: z.object({
        outputDir: z.string().optional(),
        version: z.number().int().positive().optional(),
        restoreImages: z.boolean().default(true),
        heroFile: z.string().default("hero.png"),
        imageFiles: z.array(z.string()).default([]),
        restoreCards: z.boolean().default(true),
        cardFiles: z.array(z.string()).default([]),
        restoreInfographic: z.boolean().default(true),
        infographicHtml: z.string().default("infographic.html"),
      }),
      execute: async (
        args: {
          outputDir?: string;
          version?: number;
          restoreImages: boolean;
          heroFile: string;
          imageFiles: string[];
          restoreCards: boolean;
          cardFiles: string[];
          restoreInfographic: boolean;
          infographicHtml: string;
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        if (!outputDir) {
          throw new Error("outputDir is required");
        }

        const versions = await listVersionDirs(outputDir);
        const version = args.version ?? versions.at(-1);
        const requested = new Map<string, RestoreGroup>();

        if (args.restoreImages) {
          requested.set(args.heroFile, "images");
          for (const file of args.imageFiles) requested.set(file, "images");
        }

        if (args.restoreCards) {
          for (const file of args.cardFiles) requested.set(file, "cards");
        }

        if (args.restoreInfographic) {
          if (version) {
            const sourceDir = `${outputDir}/${version}`;
            for (
              const file of await infographicFiles(
                sourceDir,
                args.infographicHtml,
              )
            ) {
              requested.set(file, "infographic");
            }
          } else {
            requested.set(args.infographicHtml, "infographic");
          }
        }

        const restored = new Map<RestoreGroup, string[]>([
          ["images", []],
          ["cards", []],
          ["infographic", []],
        ]);
        const missing = new Map<RestoreGroup, string[]>([
          ["images", []],
          ["cards", []],
          ["infographic", []],
        ]);

        if (!version) {
          for (const [file, group] of requested) {
            missing.get(group)?.push(file);
          }
        } else {
          const sourceDir = `${outputDir}/${version}`;
          for (const [file, group] of requested) {
            if (await copyIfPresent(sourceDir, outputDir, file)) {
              restored.get(group)?.push(file);
            } else {
              missing.get(group)?.push(file);
            }
          }
        }

        const restoredFiles = [
          ...restored.get("images") ?? [],
          ...restored.get("cards") ?? [],
          ...restored.get("infographic") ?? [],
        ];
        const missingFiles = [
          ...missing.get("images") ?? [],
          ...missing.get("cards") ?? [],
          ...missing.get("infographic") ?? [],
        ];

        context.logger.info(
          "Restored {restored} media file(s), missing {missing} in {outputDir}",
          {
            restored: restoredFiles.length,
            missing: missingFiles.length,
            outputDir,
            version,
          },
        );

        const handle = await context.writeResource("mediaRestore", "media", {
          version,
          restoredImages: restored.get("images") ?? [],
          missingImages: missing.get("images") ?? [],
          restoredCards: restored.get("cards") ?? [],
          missingCards: missing.get("cards") ?? [],
          restoredInfographic: restored.get("infographic") ?? [],
          missingInfographic: missing.get("infographic") ?? [],
          restoredFiles,
          missingFiles,
          generatedAt: new Date().toISOString(),
        });

        return { dataHandles: [handle] };
      },
    },
    stageMediaAssets: {
      description:
        "Stage selected Ixen media from local files or verify assets already present in outputDir without making generation API calls.",
      arguments: z.object({
        provider: z.enum(["manual_file", "existing_assets"]).default(
          "existing_assets",
        ),
        sourceDir: z.string().optional(),
        outputDir: z.string().optional(),
        requireAll: z.boolean().default(true),
        includeImages: z.boolean().default(true),
        heroFile: z.string().default("hero.png"),
        imageFiles: z.array(z.string()).default([]),
        includeCards: z.boolean().default(true),
        cardFiles: z.array(z.string()).default([]),
        includeInfographic: z.boolean().default(true),
        infographicHtml: z.string().default("infographic.html"),
        extraFiles: z.array(z.string()).default([]),
      }),
      execute: async (
        args: {
          provider: "manual_file" | "existing_assets";
          sourceDir?: string;
          outputDir?: string;
          requireAll: boolean;
          includeImages: boolean;
          heroFile: string;
          imageFiles: string[];
          includeCards: boolean;
          cardFiles: string[];
          includeInfographic: boolean;
          infographicHtml: string;
          extraFiles: string[];
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        if (!outputDir) {
          throw new Error("outputDir is required");
        }
        if (args.provider === "manual_file" && !args.sourceDir) {
          throw new Error("sourceDir is required when provider is manual_file");
        }

        await Deno.mkdir(outputDir, { recursive: true });

        const requested = new Map<string, RestoreGroup>();
        if (args.includeImages) {
          requested.set(args.heroFile, "images");
          for (const file of args.imageFiles) requested.set(file, "images");
        }
        if (args.includeCards) {
          for (const file of args.cardFiles) requested.set(file, "cards");
        }
        if (args.includeInfographic) {
          const baseDir = args.provider === "manual_file"
            ? args.sourceDir!
            : outputDir;
          for (
            const file of await infographicFiles(baseDir, args.infographicHtml)
          ) {
            requested.set(file, "infographic");
          }
        }
        for (const file of args.extraFiles) requested.set(file, "infographic");

        const restored = new Map<RestoreGroup, string[]>([
          ["images", []],
          ["cards", []],
          ["infographic", []],
        ]);
        const missing = new Map<RestoreGroup, string[]>([
          ["images", []],
          ["cards", []],
          ["infographic", []],
        ]);

        for (const [file, group] of requested) {
          const rel = safeRelativePath(file);
          if (!rel) {
            missing.get(group)?.push(file);
            continue;
          }
          if (args.provider === "existing_assets") {
            if (await pathExists(`${outputDir}/${rel}`)) {
              restored.get(group)?.push(rel);
            } else {
              missing.get(group)?.push(rel);
            }
            continue;
          }

          if (await copyIfPresent(args.sourceDir!, outputDir, rel)) {
            restored.get(group)?.push(rel);
          } else {
            missing.get(group)?.push(rel);
          }
        }

        const restoredFiles = [
          ...restored.get("images") ?? [],
          ...restored.get("cards") ?? [],
          ...restored.get("infographic") ?? [],
        ];
        const missingFiles = [
          ...missing.get("images") ?? [],
          ...missing.get("cards") ?? [],
          ...missing.get("infographic") ?? [],
        ];

        if (args.requireAll && missingFiles.length > 0) {
          throw new Error(
            `Missing Ixen media asset(s): ${missingFiles.join(", ")}`,
          );
        }

        context.logger.info(
          "Staged {restored} media file(s), missing {missing} in {outputDir}",
          {
            restored: restoredFiles.length,
            missing: missingFiles.length,
            outputDir,
          },
        );

        const handle = await context.writeResource("mediaRestore", "media", {
          restoredImages: restored.get("images") ?? [],
          missingImages: missing.get("images") ?? [],
          restoredCards: restored.get("cards") ?? [],
          missingCards: missing.get("cards") ?? [],
          restoredInfographic: restored.get("infographic") ?? [],
          missingInfographic: missing.get("infographic") ?? [],
          restoredFiles,
          missingFiles,
          generatedAt: new Date().toISOString(),
        });

        return { dataHandles: [handle] };
      },
    },
  }],
};
