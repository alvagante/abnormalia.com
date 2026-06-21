import { z } from "npm:zod@4";

const MusicTrackSchema = z.object({
  title: z.string(),
  filename: z.string(),
  lyrics: z.string().optional(),
});

type MusicTrack = z.infer<typeof MusicTrackSchema>;
type Manifest = Record<string, { title: string; lyrics?: string }>;

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** Returns all MP3 files in numeric version subdirectories, sorted by dir name. */
async function scanVersionedMp3s(
  outputDir: string,
): Promise<Array<{ relPath: string; basename: string }>> {
  const result: Array<{ relPath: string; basename: string }> = [];
  if (!await pathExists(outputDir)) return result;
  for await (const entry of Deno.readDir(outputDir)) {
    if (entry.isDirectory && /^\d+$/.test(entry.name)) {
      const vDir = `${outputDir}/${entry.name}`;
      try {
        for await (const file of Deno.readDir(vDir)) {
          if (file.isFile && file.name.endsWith(".mp3")) {
            result.push({ relPath: `${entry.name}/${file.name}`, basename: file.name });
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
  }
  return result.sort((a, b) => {
    const av = parseInt(a.relPath.split("/")[0], 10);
    const bv = parseInt(b.relPath.split("/")[0], 10);
    return av - bv;
  });
}

/** Returns MP3 basenames at the root of outputDir (current-run tracks). */
async function scanRootMp3s(outputDir: string): Promise<string[]> {
  const result: string[] = [];
  if (!await pathExists(outputDir)) return result;
  for await (const entry of Deno.readDir(outputDir)) {
    if (entry.isFile && entry.name.endsWith(".mp3")) result.push(entry.name);
  }
  return result;
}

async function readManifest(outputDir: string): Promise<Manifest> {
  const p = `${outputDir}/tracks-manifest.json`;
  if (!await pathExists(p)) return {};
  try {
    return JSON.parse(await Deno.readTextFile(p)) as Manifest;
  } catch {
    return {};
  }
}

async function writeManifest(outputDir: string, manifest: Manifest): Promise<void> {
  await Deno.mkdir(outputDir, { recursive: true });
  await Deno.writeTextFile(
    `${outputDir}/tracks-manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.mp3$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type ModelContext = {
  writeResource: (spec: string, name: string, data: unknown) => Promise<unknown>;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
    warning: (msg: string, props?: Record<string, unknown>) => void;
  };
};

export const model = {
  type: "@alvagante/ixen-tracks",
  version: "2026.06.21.1",
  globalArguments: z.object({}),
  resources: {
    versionedTrackCount: {
      description: "Count of MP3 files across all versioned subdirectories",
      schema: z.object({
        trackCount: z.number().int().nonnegative(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    allTracks: {
      description:
        "Complete MP3 track list across all versions with titles and lyrics from tracks-manifest.json",
      schema: z.object({
        tracks: z.array(MusicTrackSchema),
        trackCount: z.number().int().nonnegative(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    countVersionedTracks: {
      description:
        "Count MP3 files in versioned subdirectories of the ixen output dir. Run before music generation to decide whether to skip.",
      arguments: z.object({
        outputDir: z.string(),
      }),
      execute: async (
        args: { outputDir: string },
        context: ModelContext,
      ) => {
        const versioned = await scanVersionedMp3s(args.outputDir);
        context.logger.info(
          "Counted {count} versioned MP3(s) in {outputDir}",
          { count: versioned.length, outputDir: args.outputDir },
        );
        const handle = await context.writeResource(
          "versionedTrackCount",
          "count",
          { trackCount: versioned.length },
        );
        return { dataHandles: [handle] };
      },
    },

    build: {
      description:
        "Scan versioned subdirs and root dir for all MP3 files, merge metadata from new tracks, persist tracks-manifest.json, and return the complete ordered track list.",
      arguments: z.object({
        outputDir: z.string(),
        newTracks: z.array(MusicTrackSchema).default([]),
      }),
      execute: async (
        args: { outputDir: string; newTracks: MusicTrack[] },
        context: ModelContext,
      ) => {
        const manifest = await readManifest(args.outputDir);

        // Merge new tracks into manifest, keyed by basename
        for (const t of args.newTracks ?? []) {
          const basename = t.filename.split("/").pop() ?? t.filename;
          manifest[basename] = {
            title: t.title,
            ...(t.lyrics ? { lyrics: t.lyrics } : {}),
          };
        }

        const versionedMp3s = await scanVersionedMp3s(args.outputDir);
        for (const { basename } of versionedMp3s) {
          if (!manifest[basename]) {
            manifest[basename] = { title: titleFromFilename(basename) };
          }
        }

        const rootMp3s = await scanRootMp3s(args.outputDir);
        for (const basename of rootMp3s) {
          if (!manifest[basename]) {
            manifest[basename] = { title: titleFromFilename(basename) };
          }
        }

        await writeManifest(args.outputDir, manifest);

        // Build final list: versioned (oldest first) then root-level (newest)
        const tracks: MusicTrack[] = [];
        for (const { relPath, basename } of versionedMp3s) {
          const meta = manifest[basename];
          tracks.push({
            filename: relPath,
            title: meta?.title ?? titleFromFilename(basename),
            ...(meta?.lyrics ? { lyrics: meta.lyrics } : {}),
          });
        }
        for (const basename of rootMp3s) {
          const meta = manifest[basename];
          tracks.push({
            filename: basename,
            title: meta?.title ?? titleFromFilename(basename),
            ...(meta?.lyrics ? { lyrics: meta.lyrics } : {}),
          });
        }

        context.logger.info(
          "Built track manifest: {total} track(s) ({versioned} versioned, {current} current) in {outputDir}",
          {
            total: tracks.length,
            versioned: versionedMp3s.length,
            current: rootMp3s.length,
            outputDir: args.outputDir,
          },
        );

        const handle = await context.writeResource("allTracks", "tracks", {
          tracks,
          trackCount: tracks.length,
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
