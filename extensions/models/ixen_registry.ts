import { z } from "npm:zod@4";
import yaml from "npm:js-yaml@4.1.0";

const EntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  description: z.string(),
});

type Entry = z.infer<typeof EntrySchema>;

type ModelContext = {
  writeResource: (spec: string, name: string, data: unknown) => Promise<unknown>;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
    warning: (msg: string, props?: Record<string, unknown>) => void;
  };
};

async function readRegistry(registryPath: string): Promise<Entry[]> {
  try {
    const text = await Deno.readTextFile(registryPath);
    // JSON_SCHEMA prevents js-yaml from auto-parsing bare dates (e.g. 2026-06-19) as Date objects
    const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    if (!Array.isArray(parsed)) return [];
    return (parsed as Record<string, unknown>[]).map((e) => ({
      slug: String(e.slug ?? ""),
      title: String(e.title ?? ""),
      date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date ?? ""),
      description: String(e.description ?? ""),
    }));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

async function writeRegistry(registryPath: string, entries: Entry[]): Promise<void> {
  const text = yaml.dump(entries, { lineWidth: -1 });
  await Deno.writeTextFile(registryPath, text);
}

export const model = {
  type: "@alvagante/ixen-registry",
  version: "2026.06.22.1",
  globalArguments: z.object({}),
  resources: {
    registry: {
      description: "Current state of the ixen registry after sync",
      schema: z.object({
        entries: z.array(EntrySchema),
        added: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
      }),
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    sync: {
      description:
        "Upsert ixen entries into a YAML registry file, keyed by slug. Accepts parallel arrays (slugs/titles/dates/descriptions) that are zipped internally.",
      arguments: z.object({
        registryPath: z.string().default("_data/ixens.yml"),
        slugs: z.array(z.string()),
        titles: z.array(z.string()),
        dates: z.array(z.string()),
        descriptions: z.array(z.string()),
      }),
      execute: async (
        args: {
          registryPath: string;
          slugs: string[];
          titles: string[];
          dates: string[];
          descriptions: string[];
        },
        context: ModelContext,
      ) => {
        context.logger.info(
          "ixen-registry sync: upserting {count} entry/entries into {path}",
          { count: args.slugs.length, path: args.registryPath },
        );

        const incoming: Entry[] = args.slugs.map((slug, i) => ({
          slug,
          title: args.titles[i] ?? slug,
          // generatedAt is a full ISO timestamp; keep only the date part
          date: (args.dates[i] ?? new Date().toISOString()).slice(0, 10),
          description: args.descriptions[i] ?? "",
        }));

        const existing = await readRegistry(args.registryPath);
        const bySlug = new Map(existing.map((e) => [e.slug, e]));

        let added = 0;
        let updated = 0;
        for (const entry of incoming) {
          if (bySlug.has(entry.slug)) updated++;
          else added++;
          bySlug.set(entry.slug, entry);
        }

        // Preserve existing order; append genuinely new entries at the end
        const merged: Entry[] = existing.map((e) => bySlug.get(e.slug)!);
        for (const entry of incoming) {
          if (!existing.some((e) => e.slug === entry.slug)) {
            merged.push(entry);
          }
        }

        await writeRegistry(args.registryPath, merged);

        context.logger.info(
          "ixen-registry sync: {added} added, {updated} updated in {path}",
          { added, updated, path: args.registryPath },
        );

        const handle = await context.writeResource("registry", "current", {
          entries: merged,
          added,
          updated,
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
