import { z } from "npm:zod@4";

const ProviderSchema = z.enum(["manual_file", "existing_assets"]);
type Provider = z.infer<typeof ProviderSchema>;

type ModelContext = {
  globalArgs: { outputDir?: string };
  writeResource: (
    specName: "song" | "playlist",
    name: string,
    content: unknown,
  ) => Promise<unknown>;
  createFileWriter: (
    specName: "audioFile",
    name: string,
    overrides?: { contentType?: string },
  ) => { writeAll: (bytes: Uint8Array) => Promise<unknown> };
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "track.mp3";
}

function buildTrackTitle(
  baseTitle: string,
  index: number,
  total: number,
): string {
  if (total <= 1 || index === 0) return baseTitle;
  return `${baseTitle} (Alt ${index + 1})`;
}

async function readAudioAsset(args: {
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

export const extension = {
  type: "@alvagante/content-music",
  methods: [{
    savePlaylistAssets: {
      description:
        "Store an audio playlist from local files or from tracks already present in outputDir without calling a music provider.",
      arguments: z.object({
        provider: ProviderSchema.default("manual_file"),
        topic: z.string().min(1),
        title: z.string().optional(),
        genre: z.string().default("manual"),
        mood: z.string().default("manual"),
        instrumental: z.boolean().default(false),
        model: z.string().default("manual_file"),
        sunoVersion: z.string().optional(),
        outputDir: z.string().optional(),
        tracks: z.array(z.object({
          sourcePath: z.string().optional(),
          filename: z.string().optional(),
          title: z.string().optional(),
          lyrics: z.string().optional(),
          contentType: z.string().default("audio/mpeg"),
        })).min(1),
      }),
      execute: async (
        args: {
          provider: Provider;
          topic: string;
          title?: string;
          genre: string;
          mood: string;
          instrumental: boolean;
          model: string;
          sunoVersion?: string;
          outputDir?: string;
          tracks: Array<{
            sourcePath?: string;
            filename?: string;
            title?: string;
            lyrics?: string;
            contentType: string;
          }>;
        },
        context: ModelContext,
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        const resolvedTitle = args.title ?? args.topic;
        const dataHandles: unknown[] = [];
        const tracks: Array<
          { title: string; filename: string; lyrics?: string }
        > = [];

        for (const [index, track] of args.tracks.entries()) {
          const filename = track.filename ?? basename(track.sourcePath ?? "");
          const bytes = await readAudioAsset({
            provider: args.provider,
            sourcePath: track.sourcePath,
            outputDir,
            filename,
          });
          dataHandles.push(
            await context.createFileWriter(
              "audioFile",
              `audio-file-${index + 1}`,
              { contentType: track.contentType },
            ).writeAll(bytes),
          );
          tracks.push({
            title: track.title ??
              buildTrackTitle(resolvedTitle, index, args.tracks.length),
            filename,
            lyrics: track.lyrics,
          });
        }

        const generatedAt = new Date().toISOString();
        dataHandles.unshift(
          await context.writeResource("playlist", "playlist", {
            title: resolvedTitle,
            topic: args.topic,
            genre: args.genre,
            mood: args.mood,
            model: args.model,
            sunoVersion: args.sunoVersion,
            instrumental: args.instrumental,
            trackCount: tracks.length,
            tracks,
            generatedAt,
          }),
        );

        if (tracks.length === 1) {
          dataHandles.unshift(
            await context.writeResource("song", "song", {
              title: tracks[0].title,
              topic: args.topic,
              lyrics: tracks[0].lyrics,
              genre: args.genre,
              mood: args.mood,
              model: args.model,
              sunoVersion: args.sunoVersion,
              instrumental: args.instrumental,
              filename: tracks[0].filename,
              outputPath: outputDir
                ? `${outputDir}/${tracks[0].filename}`
                : undefined,
              generatedAt,
            }),
          );
        }

        context.logger.info(
          "Stored manual playlist with {trackCount} track(s)",
          {
            trackCount: tracks.length,
          },
        );
        return { dataHandles };
      },
    },
  }],
};
