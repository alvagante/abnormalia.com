import { z } from "npm:zod@4";

const MusicModelSchema = z.enum(["suno-ttapi", "lyria-002"]);
const SunoVersionSchema = z.enum([
  "chirp-v3-0",
  "chirp-v3-5",
  "chirp-v4",
  "chirp-v4-5",
]);

const TrackSchema = z.object({
  title: z.string(),
  filename: z.string(),
  lyrics: z.string().optional(),
});

const PlaylistSchema = z.object({
  title: z.string(),
  topic: z.string(),
  genre: z.string(),
  mood: z.string(),
  model: z.string(),
  sunoVersion: z.string().optional(),
  instrumental: z.boolean(),
  outputDir: z.string(),
  reusedExisting: z.boolean(),
  trackCount: z.number().int().nonnegative(),
  tracks: z.array(TrackSchema).min(1),
  generatedAt: z.string(),
});

type MusicModel = z.infer<typeof MusicModelSchema>;
type SunoVersion = z.infer<typeof SunoVersionSchema>;
type Track = z.infer<typeof TrackSchema>;
type Playlist = z.infer<typeof PlaylistSchema>;

type OneMinRecord = {
  uuid?: string;
  status?: string;
  temporaryUrl?: string;
  audioUrl?: string;
  aiRecordDetail?: {
    resultObject?: unknown[];
  };
  error?: string;
};

type OneMinResponse = {
  aiRecord?: OneMinRecord;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function extname(path: string): string {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 ? filename.slice(dotIndex) : "";
}

function join(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

function buildFilename(
  title: string,
  model: MusicModel,
  index: number,
  total: number,
): string {
  const slug = slugify(title.split(" ").slice(0, 6).join(" "));
  const ts = Date.now().toString(36);
  const ext = model === "lyria-002" ? "wav" : "mp3";
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `${slug}-${ts}${suffix}.${ext}`;
}

function buildTrackTitle(baseTitle: string, index: number, total: number): string {
  if (total <= 1 || index === 0) {
    return baseTitle;
  }
  return `${baseTitle} (Alt ${index + 1})`;
}

function titleFromFilename(filename: string): string {
  const withoutExt = filename.slice(0, Math.max(0, filename.length - extname(filename).length));
  const withoutSuffix = withoutExt
    .replace(/-[a-z0-9]{6,}(?:-\d+)?$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const source = withoutSuffix || withoutExt;
  return source.replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractTrackUrls(record: OneMinRecord | undefined): string[] {
  if (!record) {
    return [];
  }

  const urls: string[] = [];
  if (record.temporaryUrl) {
    urls.push(record.temporaryUrl);
  }
  if (record.audioUrl) {
    urls.push(record.audioUrl);
  }

  for (const item of record.aiRecordDetail?.resultObject ?? []) {
    if (typeof item === "string") {
      urls.push(item);
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      "temporaryUrl" in item &&
      typeof item.temporaryUrl === "string"
    ) {
      urls.push(item.temporaryUrl);
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      "audioUrl" in item &&
      typeof item.audioUrl === "string"
    ) {
      urls.push(item.audioUrl);
    }
  }

  return uniqueStrings(urls).filter(isHttpUrl);
}

async function generateLyrics(
  anthropicApiKey: string,
  topic: string,
  genre: string,
  mood: string,
  title?: string,
): Promise<{ title: string; lyrics: string; tags: string }> {
  const prompt =
    `You are a skilled songwriter. Write song lyrics where the subject of "${topic}" narrates itself in first person - the topic becomes the singer.
Genre: ${genre}
Mood: ${mood}
${title ? `Title: ${title}` : "Suggest a catchy title"}

Requirements:
- Structure: verse, chorus, verse, chorus, bridge, chorus
- Under 400 words, singable
- Educational yet engaging - the topic personified

Respond with ONLY a JSON object (no markdown fences):
{"title":"...","lyrics":"...","tags":"comma,separated,genre,mood,descriptors"}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const json = await response.json() as {
    content?: Array<{ text?: string }>;
  };
  const text = json.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `Failed to parse lyrics JSON from Anthropic response: ${text.slice(0, 200)}`,
    );
  }

  return JSON.parse(match[0]) as {
    title: string;
    lyrics: string;
    tags: string;
  };
}

async function pollFor1minResult(
  apiKey: string,
  uuid: string,
  maxWaitMs = 300_000,
): Promise<string[]> {
  const deadline = Date.now() + maxWaitMs;
  const interval = 5_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    const response = await fetch(`https://api.1min.ai/api/features/${uuid}`, {
      headers: { "API-KEY": apiKey },
    });
    if (!response.ok) {
      const body = await response.text();
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        continue;
      }
      throw new Error(`1min.ai polling error ${response.status}: ${body}`);
    }

    const json = await response.json() as OneMinResponse;
    const record = json.aiRecord;

    if (record?.status === "FAILED") {
      throw new Error(
        `1min.ai song generation failed: ${record.error ?? "unknown error"}`,
      );
    }

    if (record?.status === "SUCCESS") {
      const urls = extractTrackUrls(record);
      if (urls.length > 0) {
        return urls;
      }
    }
  }

  throw new Error(
    `Timed out after ${maxWaitMs / 1000}s waiting for song generation`,
  );
}

async function callMusicApi(
  apiKey: string,
  params: {
    model: MusicModel;
    lyrics?: string;
    title?: string;
    tags?: string;
    instrumental: boolean;
    sunoVersion: SunoVersion;
    musicDescription?: string;
  },
): Promise<string[]> {
  const body = params.model === "suno-ttapi"
    ? {
      type: "MUSIC_GENERATOR",
      model: "suno-ttapi",
      promptObject: {
        mv: params.sunoVersion,
        custom: !params.instrumental && !!params.lyrics,
        prompt: params.lyrics ?? "",
        title: params.title ?? "",
        tags: params.tags ?? "",
        instrumental: params.instrumental,
      },
    }
    : {
      type: "MUSIC_GENERATOR",
      model: "lyria-002",
      conversationId: "MUSIC_GENERATOR",
      promptObject: {
        prompt: params.musicDescription ??
          `${params.tags ?? ""} ${params.title ?? ""}`.trim(),
      },
    };

  const response = await fetch("https://api.1min.ai/api/features", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "API-KEY": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`1min.ai API error ${response.status}: ${errorBody}`);
  }

  const json = await response.json() as OneMinResponse;
  const record = json.aiRecord;
  const urls = extractTrackUrls(record);
  if (record?.status === "SUCCESS" && urls.length > 0) {
    return urls;
  }

  const uuid = record?.uuid;
  if (!uuid) {
    throw new Error(
      `1min.ai returned no audio URL and no UUID for polling. Response: ${JSON.stringify(json)}`,
    );
  }

  return await pollFor1minResult(apiKey, uuid);
}

async function listExistingAudioFiles(outputDir: string): Promise<string[]> {
  const candidates: Array<{ name: string; mtime: number }> = [];

  try {
    for await (const entry of Deno.readDir(outputDir)) {
      if (!entry.isFile && !entry.isSymlink) {
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (![".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(ext)) {
        continue;
      }
      const stat = await Deno.stat(join(outputDir, entry.name));
      candidates.push({
        name: entry.name,
        mtime: stat.mtime?.getTime() ?? 0,
      });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  const hasMp3 = candidates.some((file) => extname(file.name).toLowerCase() === ".mp3");
  return candidates
    .filter((file) => hasMp3 ? extname(file.name).toLowerCase() === ".mp3" : true)
    .sort((left, right) => left.mtime - right.mtime || left.name.localeCompare(right.name))
    .map((file) => file.name);
}

async function readPlaylistMetadata(outputDir: string): Promise<Playlist | null> {
  const metadataPath = join(outputDir, ".ixen-soundtrack.json");
  try {
    const raw = await Deno.readTextFile(metadataPath);
    return PlaylistSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof SyntaxError ||
      error instanceof z.ZodError
    ) {
      return null;
    }
    throw error;
  }
}

async function writePlaylistMetadata(outputDir: string, playlist: Playlist): Promise<void> {
  await Deno.mkdir(outputDir, { recursive: true });
  await Deno.writeTextFile(
    join(outputDir, ".ixen-soundtrack.json"),
    JSON.stringify(playlist, null, 2),
  );
}

function reuseTracksFromFiles(
  filenames: string[],
  title: string,
  metadata: Playlist | null,
  fallbackLyrics?: string,
): Track[] {
  const metadataByFilename = new Map(
    (metadata?.tracks ?? []).map((track) => [track.filename, track]),
  );

  return filenames.map((filename, index) => {
    const stored = metadataByFilename.get(filename);
    if (stored) {
      return stored;
    }
    return {
      title: index === 0 ? title : `${title} (Alt ${index + 1})`,
      filename,
      lyrics: metadata?.tracks[index]?.lyrics ?? fallbackLyrics,
    };
  }).map((track, index) => ({
    title: track.title || (index === 0 ? title : `${title} (Alt ${index + 1})`),
    filename: track.filename,
    lyrics: track.lyrics ?? fallbackLyrics,
  }));
}

export const model = {
  type: "@abnormalia/ixen-soundtrack",
  version: "2026.06.17.1",
  globalArguments: z.object({
    apiKey: z.string().optional().meta({ sensitive: true }),
    anthropicApiKey: z.string().optional().meta({ sensitive: true }),
    outputDir: z.string().optional(),
  }),
  resources: {
    playlist: {
      description:
        "Reusable soundtrack playlist for an Ixen page, including track titles and filenames.",
      schema: PlaylistSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  files: {
    audioFile: {
      description: "Generated audio track file for an Ixen soundtrack.",
      contentType: "audio/mpeg",
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  methods: {
    generateOrReuse: {
      description:
        "Reuse existing soundtrack files from outputDir when present; otherwise generate one or more tracks and persist playlist metadata for future reruns.",
      arguments: z.object({
        topic: z.string().min(1),
        title: z.string().min(1),
        genre: z.string().default("ambient"),
        mood: z.string().default("contemplative"),
        instrumental: z.boolean().default(false),
        model: MusicModelSchema.default("suno-ttapi"),
        sunoVersion: SunoVersionSchema.default("chirp-v4-5"),
        lyricsFallback: z.string().optional(),
        outputDir: z.string().optional(),
      }),
      execute: async (
        args: {
          topic: string;
          title: string;
          genre: string;
          mood: string;
          instrumental: boolean;
          model: MusicModel;
          sunoVersion: SunoVersion;
          lyricsFallback?: string;
          outputDir?: string;
        },
        context: {
          globalArgs: {
            apiKey?: string;
            anthropicApiKey?: string;
            outputDir?: string;
          };
          writeResource: (
            specName: "playlist",
            name: string,
            content: Playlist,
          ) => Promise<unknown>;
          createFileWriter: (
            specName: "audioFile",
            name: string,
            overrides?: { contentType?: string },
          ) => {
            writeAll: (bytes: Uint8Array) => Promise<unknown>;
          };
          logger: {
            info: (msg: string, props?: Record<string, unknown>) => void;
          };
        },
      ) => {
        const outputDir = args.outputDir ?? context.globalArgs.outputDir;
        if (!outputDir) {
          throw new Error(
            "outputDir is required so the soundtrack can be reused on future workflow runs",
          );
        }

        context.logger.info("Preparing soundtrack for {topic}", {
          topic: args.topic,
          outputDir,
        });

        const existingFiles = await listExistingAudioFiles(outputDir);
        const existingMetadata = await readPlaylistMetadata(outputDir);
        const generatedAt = new Date().toISOString();

        if (existingFiles.length > 0) {
          const tracks = reuseTracksFromFiles(
            existingFiles,
            args.title,
            existingMetadata,
            args.lyricsFallback,
          )
            .map((track) => ({
              title: track.title || titleFromFilename(track.filename),
              filename: track.filename,
              lyrics: track.lyrics ?? args.lyricsFallback,
            }));
          const playlist: Playlist = {
            title: existingMetadata?.title ?? args.title,
            topic: args.topic,
            genre: existingMetadata?.genre ?? args.genre,
            mood: existingMetadata?.mood ?? args.mood,
            model: existingMetadata?.model ?? args.model,
            sunoVersion: existingMetadata?.sunoVersion ??
              (args.model === "suno-ttapi" ? args.sunoVersion : undefined),
            instrumental: existingMetadata?.instrumental ?? args.instrumental,
            outputDir,
            reusedExisting: true,
            trackCount: tracks.length,
            tracks,
            generatedAt,
          };
          await writePlaylistMetadata(outputDir, playlist);
          const handle = await context.writeResource("playlist", "playlist", playlist);
          context.logger.info("Reused {trackCount} existing soundtrack files", {
            trackCount: tracks.length,
          });
          return { dataHandles: [handle] };
        }

        const { apiKey, anthropicApiKey } = context.globalArgs;
        if (!apiKey) {
          throw new Error(
            "apiKey (1min.ai) is required when no existing soundtrack files are present",
          );
        }

        let lyrics: string | undefined;
        let trackTitle = args.title;
        let tags = `${args.genre},${args.mood}`;
        const needsLyrics = !args.instrumental && args.model === "suno-ttapi";

        if (needsLyrics) {
          if (!anthropicApiKey) {
            throw new Error(
              "anthropicApiKey is required for lyric generation when creating a new Suno soundtrack",
            );
          }

          context.logger.info("Generating lyrics for {topic}", { topic: args.topic });
          const lyricResult = await generateLyrics(
            anthropicApiKey,
            args.topic,
            args.genre,
            args.mood,
            trackTitle,
          );
          lyrics = lyricResult.lyrics;
          trackTitle = lyricResult.title || trackTitle;
          tags = lyricResult.tags;
        }

        const musicDescription = args.instrumental || args.model === "lyria-002"
          ? `${args.genre} ${args.mood} music about ${args.topic}`
          : undefined;

        context.logger.info("Generating soundtrack with {model}", {
          model: args.model,
        });
        const urls = await callMusicApi(apiKey, {
          model: args.model,
          lyrics,
          title: trackTitle,
          tags,
          instrumental: args.instrumental,
          sunoVersion: args.sunoVersion,
          musicDescription,
        });
        if (urls.length === 0) {
          throw new Error("Music provider returned no playable track URLs");
        }

        await Deno.mkdir(outputDir, { recursive: true });

        const contentType = args.model === "lyria-002" ? "audio/wav" : "audio/mpeg";
        const dataHandles: unknown[] = [];
        const tracks: Track[] = [];
        const downloads: Array<{ filename: string; bytes: Uint8Array }> = [];

        for (const [index, url] of urls.entries()) {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Failed to download audio from provider (${response.status})`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          const filename = buildFilename(trackTitle, args.model, index, urls.length);
          downloads.push({ filename, bytes });

          tracks.push({
            title: buildTrackTitle(trackTitle, index, urls.length),
            filename,
            lyrics,
          });
        }

        for (const [index, download] of downloads.entries()) {
          const writer = context.createFileWriter("audioFile", `audio-file-${index + 1}`, {
            contentType,
          });
          dataHandles.push(await writer.writeAll(download.bytes));
          await Deno.writeFile(join(outputDir, download.filename), download.bytes);
        }

        const playlist: Playlist = {
          title: args.title,
          topic: args.topic,
          genre: args.genre,
          mood: args.mood,
          model: args.model,
          sunoVersion: args.model === "suno-ttapi" ? args.sunoVersion : undefined,
          instrumental: args.instrumental,
          outputDir,
          reusedExisting: false,
          trackCount: tracks.length,
          tracks,
          generatedAt,
        };

        await writePlaylistMetadata(outputDir, playlist);
        dataHandles.unshift(await context.writeResource("playlist", "playlist", playlist));
        context.logger.info("Generated {trackCount} soundtrack files", {
          trackCount: tracks.length,
        });
        return { dataHandles };
      },
    },
  },
};
