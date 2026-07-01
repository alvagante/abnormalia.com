import { z } from "npm:zod@4";

type ModelContext = {
  globalArgs: { outputDir?: string };
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
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

export const extension = {
  type: "@alvagante/content-iam",
  methods: [{
    stageAllMedia: {
      description:
        "Stage portrait, facet images, and facet cards from local files or verify assets already present in outputDir without making image API calls.",
      arguments: z.object({
        provider: z.enum(["manual_file", "existing_assets"]).default(
          "existing_assets",
        ),
        sourceDir: z.string().optional(),
        outputDir: z.string().optional(),
        portraitFilename: z.string().default("portrait.png"),
        facets: z.array(z.object({
          name: z.string(),
          imageFilename: z.string(),
          cardFilename: z.string().optional(),
        })).max(12).optional(),
        includePortrait: z.boolean().default(true),
        includeFacetImages: z.boolean().default(true),
        includeFacetCards: z.boolean().default(true),
        extraFiles: z.array(z.string()).default([]),
        requireAll: z.boolean().default(true),
      }),
      execute: async (
        args: {
          provider: "manual_file" | "existing_assets";
          sourceDir?: string;
          outputDir?: string;
          portraitFilename: string;
          facets?: Array<{
            name: string;
            imageFilename: string;
            cardFilename?: string;
          }>;
          includePortrait: boolean;
          includeFacetImages: boolean;
          includeFacetCards: boolean;
          extraFiles: string[];
          requireAll: boolean;
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        if (!outputDir) throw new Error("outputDir is required");
        if (args.provider === "manual_file" && !args.sourceDir) {
          throw new Error("sourceDir is required when provider is manual_file");
        }

        await Deno.mkdir(outputDir, { recursive: true });

        const requested = new Set<string>();
        if (args.includePortrait) requested.add(args.portraitFilename);
        for (const facet of args.facets ?? []) {
          if (args.includeFacetImages) requested.add(facet.imageFilename);
          if (args.includeFacetCards && facet.cardFilename) {
            requested.add(facet.cardFilename);
          }
        }
        for (const file of args.extraFiles) requested.add(file);

        const staged: string[] = [];
        const present: string[] = [];
        const missing: string[] = [];

        for (const filename of requested) {
          const rel = safeRelativePath(filename);
          if (!rel) {
            missing.push(filename);
            continue;
          }
          const targetPath = `${outputDir}/${rel}`;
          if (args.provider === "existing_assets") {
            if (await pathExists(targetPath)) present.push(rel);
            else missing.push(rel);
            continue;
          }

          const sourcePath = `${args.sourceDir}/${rel}`;
          if (!await pathExists(sourcePath)) {
            missing.push(rel);
            continue;
          }
          await Deno.copyFile(sourcePath, targetPath);
          staged.push(rel);
        }

        if (args.requireAll && missing.length > 0) {
          throw new Error(`Missing IAM media asset(s): ${missing.join(", ")}`);
        }

        context.logger.info(
          "stageAllMedia complete: {staged} staged, {present} present, {missing} missing",
          {
            staged: staged.length,
            present: present.length,
            missing: missing.length,
          },
        );

        return { dataHandles: [] };
      },
    },
  }],
};
