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
]);
const BackgroundSchema = z.enum(["opaque", "transparent", "auto"]);
const QualitySchema = z.enum(["auto", "low", "medium", "high"]);
const FormatSchema = z.enum(["png", "webp", "jpeg"]);

type Provider = z.infer<typeof ProviderSchema>;
type Format = z.infer<typeof FormatSchema>;

const MIME_TYPES: Record<Format, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

type ModelContext = {
  globalArgs: { outputDir?: string };
  writeResource: (
    specName: "image",
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
  return path.split("/").filter(Boolean).at(-1) ?? "image.png";
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
  type: "@alvagante/content-image",
  methods: [{
    saveAsset: {
      description:
        "Store an image from a local file or from an asset already present in outputDir without calling the OpenAI Images API.",
      arguments: z.object({
        provider: ProviderSchema.default("manual_file"),
        sourcePath: z.string().optional(),
        prompt: z.string().default("Manual image asset"),
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
        const imageHandle = await context.writeResource("image", "image", {
          prompt: args.prompt,
          augmentedPrompt: args.prompt,
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
        context.logger.info("Image asset stored: {filename}", { filename });
        return { dataHandles: [imageHandle, fileHandle] };
      },
    },
  }],
};
