import { z } from "npm:zod@4";

const ProviderSchema = z.enum(["manual_file", "existing_assets"]);
const StyleSchema = z.enum([
  "none",
  "ixen-dark",
  "ixen-light",
  "technical-diagram",
  "cyberpunk-photo",
  "educational",
  "pencil-bw",
  "pencil-color-accents",
  "blueprint",
  "clean",
  "editorial",
  "vintage-playing-card",
  "tarot-technical",
  "brutalist",
  "risograph",
  "field-guide",
  "monochrome-ink",
  "luminous-minimal",
]);
const SkillLevelSchema = z.enum([
  "novice",
  "intermediate",
  "senior",
  "guru",
]);
const BackgroundSchema = z.enum(["opaque", "transparent", "auto"]);
const QualitySchema = z.enum(["auto", "low", "medium", "high"]);
const FormatSchema = z.enum(["png", "webp", "jpeg"]);

type Provider = z.infer<typeof ProviderSchema>;
type Format = z.infer<typeof FormatSchema>;
type SkillLevel = z.infer<typeof SkillLevelSchema>;

const MIME_TYPES: Record<Format, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};
const SKILL_LEVEL_VALUES: Record<SkillLevel, number> = {
  novice: 1,
  intermediate: 2,
  senior: 3,
  guru: 4,
};

type ModelContext = {
  globalArgs: { outputDir?: string };
  writeResource: (
    specName: "card",
    name: string,
    content: unknown,
  ) => Promise<unknown>;
  createFileWriter: (
    specName: "imageFile",
    name: string,
    overrides?: { contentType?: string },
  ) => { writeAll: (bytes: Uint8Array) => Promise<unknown> };
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "card.png";
}

async function readAssetBytes(args: {
  provider: Provider;
  sourcePath?: string;
  outputDir?: string;
  filename: string;
}): Promise<{ bytes: Uint8Array; outputPath?: string }> {
  if (args.provider === "manual_file") {
    if (!args.sourcePath) {
      throw new Error("sourcePath is required when provider is manual_file");
    }
    const bytes = await Deno.readFile(args.sourcePath);
    let outputPath: string | undefined;
    if (args.outputDir) {
      await Deno.mkdir(args.outputDir, { recursive: true });
      outputPath = `${args.outputDir}/${args.filename}`;
      if (args.sourcePath !== outputPath) {
        await Deno.writeFile(outputPath, bytes);
      }
    }
    return { bytes, outputPath };
  }

  if (!args.outputDir) {
    throw new Error("outputDir is required when provider is existing_assets");
  }
  const outputPath = `${args.outputDir}/${args.filename}`;
  return { bytes: await Deno.readFile(outputPath), outputPath };
}

export const extension = {
  type: "@alvagante/content-card",
  methods: [{
    saveAsset: {
      description:
        "Store a content card image from a local file or from an asset already present in outputDir without calling the OpenAI Images API.",
      arguments: z.object({
        provider: ProviderSchema.default("manual_file"),
        sourcePath: z.string().optional(),
        prompt: z.string().default("Manual content card asset"),
        title: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        cardNumber: z.number().int().positive().default(1),
        cardCount: z.number().int().positive().optional(),
        skillLevel: SkillLevelSchema.default("intermediate"),
        cornerIcon: z.string().min(1).optional(),
        logo: z.string().min(1).optional(),
        style: StyleSchema.default("none"),
        model: z.string().default("manual_file"),
        background: BackgroundSchema.default("opaque"),
        size: z.string().default("manual"),
        quality: QualitySchema.default("auto"),
        format: FormatSchema.default("png"),
        filename: z.string().optional(),
        outputDir: z.string().optional(),
      }),
      execute: async (
        args: {
          provider: Provider;
          sourcePath?: string;
          prompt: string;
          title?: string;
          text?: string;
          cardNumber: number;
          cardCount?: number;
          skillLevel: SkillLevel;
          cornerIcon?: string;
          logo?: string;
          style: string;
          model: string;
          background: string;
          size: string;
          quality: string;
          format: Format;
          filename?: string;
          outputDir?: string;
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        const filename = args.filename ?? basename(args.sourcePath ?? "");
        const { bytes, outputPath } = await readAssetBytes({
          provider: args.provider,
          sourcePath: args.sourcePath,
          outputDir,
          filename,
        });
        const fileHandle = await context.createFileWriter(
          "imageFile",
          "imageFile",
          { contentType: MIME_TYPES[args.format] },
        ).writeAll(bytes);
        const cardHandle = await context.writeResource("card", "card", {
          prompt: args.prompt,
          augmentedPrompt: args.prompt,
          title: args.title,
          text: args.text,
          cardNumber: args.cardNumber,
          cardCount: args.cardCount,
          skillLevel: args.skillLevel,
          skillValue: SKILL_LEVEL_VALUES[args.skillLevel],
          cornerIcon: args.cornerIcon,
          logo: args.logo,
          model: args.model,
          style: args.style,
          background: args.background,
          size: args.size,
          quality: args.quality,
          format: args.format,
          filename,
          outputPath,
          generatedAt: new Date().toISOString(),
        });
        context.logger.info("Card asset stored: {filename}", { filename });
        return { dataHandles: [cardHandle, fileHandle] };
      },
    },
  }],
};
