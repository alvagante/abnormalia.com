import { Buffer } from "node:buffer";
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
const OrientationSchema = z.enum(["wide", "portrait", "square"]);
const BackgroundSchema = z.enum(["opaque", "transparent", "auto"]);
const QualitySchema = z.enum(["auto", "low", "medium", "high"]);
const FormatSchema = z.enum(["png", "webp", "jpeg"]);

type Provider = z.infer<typeof ProviderSchema>;
type Format = z.infer<typeof FormatSchema>;
type Orientation = z.infer<typeof OrientationSchema>;

const MIME_TYPES: Record<Format, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};
const DEFAULT_SIZE: Record<Orientation, string> = {
  wide: "1536x1024",
  portrait: "1024x1536",
  square: "1024x1024",
};

type ModelContext = {
  globalArgs: { outputDir?: string };
  writeResource: (
    specName: "infographic",
    name: string,
    content: unknown,
  ) => Promise<unknown>;
  createFileWriter: (
    specName: "html" | "imageFile",
    name: string,
    overrides?: { contentType?: string },
  ) => {
    writeText?: (text: string) => Promise<unknown>;
    writeAll?: (bytes: Uint8Array) => Promise<unknown>;
  };
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "infographic.png";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "infographic";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readAssetBytes(args: {
  provider: Provider;
  sourcePath?: string;
  outputDir?: string;
  filename: string;
}): Promise<Uint8Array> {
  if (args.provider === "manual_file") {
    if (!args.sourcePath) {
      throw new Error("sourcePath is required when provider is manual_file");
    }
    const bytes = await Deno.readFile(args.sourcePath);
    if (args.outputDir) {
      await Deno.mkdir(args.outputDir, { recursive: true });
      const outputPath = `${args.outputDir}/${args.filename}`;
      if (args.sourcePath !== outputPath) {
        await Deno.writeFile(outputPath, bytes);
      }
    }
    return bytes;
  }

  if (!args.outputDir) {
    throw new Error("outputDir is required when provider is existing_assets");
  }
  return await Deno.readFile(`${args.outputDir}/${args.filename}`);
}

function renderHtml(title: string, imageSrc: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;background:#f7f4ef;color:#1f1d1b;font-family:system-ui,sans-serif}
main{min-height:100vh;display:grid;place-items:center;padding:24px}
img{max-width:100%;max-height:calc(100vh - 48px);object-fit:contain}
</style>
</head>
<body><main><img src="${escapeHtml(imageSrc)}" alt="${
    escapeHtml(title)
  }"></main></body>
</html>`;
}

export const extension = {
  type: "@alvagante/content-infographic",
  methods: [{
    saveAsset: {
      description:
        "Store an infographic image from a local file or from an asset already present in outputDir without calling OpenAI.",
      arguments: z.object({
        provider: ProviderSchema.default("manual_file"),
        sourcePath: z.string().optional(),
        topic: z.string().min(1),
        title: z.string().min(1).optional(),
        details: z.string().optional(),
        keyPoints: z.array(z.string().min(1)).default([]),
        style: StyleSchema.default("clean"),
        orientation: OrientationSchema.default("wide"),
        background: BackgroundSchema.default("opaque"),
        size: z.string().optional(),
        quality: QualitySchema.default("auto"),
        format: FormatSchema.default("png"),
        filename: z.string().optional(),
        htmlFilename: z.string().optional(),
        model: z.string().default("manual_file"),
        outputDir: z.string().optional(),
      }),
      execute: async (
        args: {
          provider: Provider;
          sourcePath?: string;
          topic: string;
          title?: string;
          details?: string;
          keyPoints: string[];
          style: string;
          orientation: Orientation;
          background: string;
          size?: string;
          quality: string;
          format: Format;
          filename?: string;
          htmlFilename?: string;
          model: string;
          outputDir?: string;
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        const title = args.title ?? `${args.topic} Infographic`;
        const filename = args.filename ?? basename(args.sourcePath ?? "");
        const htmlFilename = args.htmlFilename ??
          `${slugify(title)}-infographic.html`;
        const size = args.size ?? DEFAULT_SIZE[args.orientation];
        const bytes = await readAssetBytes({
          provider: args.provider,
          sourcePath: args.sourcePath,
          outputDir,
          filename,
        });
        const imageSrc = outputDir
          ? `./${filename}`
          : `data:${MIME_TYPES[args.format]};base64,${
            Buffer.from(bytes).toString("base64")
          }`;
        const html = renderHtml(title, imageSrc);
        const generatedAt = new Date().toISOString();
        const metadata = {
          title,
          topic: args.topic,
          details: args.details,
          keyPoints: args.keyPoints,
          prompt: `Manual infographic image for ${title}`,
          augmentedPrompt: `Manual infographic image for ${title}`,
          model: args.model,
          style: args.style,
          orientation: args.orientation,
          background: args.background,
          size,
          quality: args.quality,
          format: args.format,
          filename,
          htmlFilename,
          imagePath: outputDir ? `${outputDir}/${filename}` : undefined,
          htmlPath: outputDir ? `${outputDir}/${htmlFilename}` : undefined,
          generatedAt,
        };

        const dataHandles: unknown[] = [
          await context.writeResource("infographic", "main", metadata),
        ];
        const imageWriter = context.createFileWriter("imageFile", "imageFile", {
          contentType: MIME_TYPES[args.format],
        });
        if (!imageWriter.writeAll) throw new Error("imageFile writer failed");
        dataHandles.push(await imageWriter.writeAll(bytes));
        const htmlWriter = context.createFileWriter("html", "html");
        if (!htmlWriter.writeText) throw new Error("html writer failed");
        dataHandles.push(await htmlWriter.writeText(html));

        if (outputDir) {
          await Deno.writeTextFile(`${outputDir}/${htmlFilename}`, html);
        }
        context.logger.info("Infographic asset stored: {htmlFilename}", {
          htmlFilename,
        });
        return { dataHandles };
      },
    },
  }],
};
