import type { Command } from "commander";

import { printJson } from "../lib/cli-helpers";

type LogKind = "events" | "logs" | "commands" | "all";
type LogCursorState = {
  logs: number;
  events: number;
  commands: number;
};
type TimelineEntry = {
  source: "event" | "log" | "command";
  id: number;
  timestamp: string | null;
  message: string;
  payload: Record<string, unknown>;
};

export function register(program: Command) {
  const runs = program.command("runs").description("Inspect and create runs");

  runs.command("list").action(async () => {
    const [{ ensureArcheReady }, { listRuns }] = await Promise.all([
      import("../lib/bootstrap"),
      import("../lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await listRuns());
  });

  runs
    .command("manual")
    .argument("<ticketKey>")
    .option("--force", "bypass eligibility checks and active-run guard")
    .action(async (ticketKey: string, options: { force?: boolean }) => {
      const [{ ensureArcheReady }, { createManualRunForTicket }] =
        await Promise.all([
          import("../lib/bootstrap"),
          import("../lib/arche/runs"),
        ]);
      await ensureArcheReady();
      const run = await createManualRunForTicket({
        ticketKey,
        force: Boolean(options.force),
      });
      printJson(run);
    });

  runs
    .command("retry")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, { retryRun }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await retryRun(runId));
    });

  runs
    .command("cancel")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, { cancelRun }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await cancelRun(runId));
    });

  runs
    .command("approve-plan")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, { approvePlan }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await approvePlan(runId));
    });

  runs
    .command("respond")
    .argument("<runId>")
    .requiredOption("--message <message>")
    .action(async (runId: string, options: { message: string }) => {
      const [{ ensureArcheReady }, { respondToRun }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await respondToRun(runId, options.message));
    });

  runs
    .command("approve")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, { approvePublish }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await approvePublish(runId));
    });

  runs
    .command("reject")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, { rejectPublish }] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      printJson(await rejectPublish(runId));
    });

  runs
    .command("inspect")
    .argument("<runId>")
    .action(async (runId: string) => {
      const [{ ensureArcheReady }, runsModule] = await Promise.all([
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
      ]);
      await ensureArcheReady();
      const [detail, eventsPage] = await Promise.all([
        runsModule.getRunDetail(runId),
        runsModule.listRunEvents(runId, { limit: 100 }),
      ]);
      printJson({
        run: detail.run,
        tasks: detail.tasks,
        recentLogs: detail.logs.slice(-10),
        recentEvents: eventsPage.items.slice(-10),
      });
    });

  runs
    .command("logs")
    .argument("<runId>")
    .option("--kind <kind>", "events|logs|commands|all", "all")
    .option("--follow", "poll for new log entries")
    .option("--json", "output structured JSON")
    .action(
      async (
        runId: string,
        options: { kind?: string; follow?: boolean; json?: boolean },
      ) => {
        const kind = validateLogKind(options.kind);
        const [{ ensureArcheReady }, runsModule, { sleep }] =
          await Promise.all([
            import("../lib/bootstrap"),
            import("../lib/arche/runs"),
            import("../lib/arche/utils"),
          ]);
        await ensureArcheReady();

        const cursors: LogCursorState = {
          logs: 0,
          events: 0,
          commands: 0,
        };

        do {
          const batch = await loadLogEntries(runsModule, runId, kind, cursors);
          updateLogCursors(cursors, batch);

          if (options.json) {
            if (options.follow) {
              for (const entry of batch.entries) {
                process.stdout.write(`${JSON.stringify(entry)}\n`);
              }
            } else {
              printJson(batch.entries);
            }
          } else {
            for (const entry of batch.entries) {
              process.stdout.write(`${formatLogEntry(entry)}\n`);
            }
          }

          if (!options.follow) {
            break;
          }

          await sleep(1000);
        } while (true);
      },
    );
}

function validateLogKind(value: string | undefined): LogKind {
  if (
    value === "events" ||
    value === "logs" ||
    value === "commands" ||
    value === "all"
  ) {
    return value;
  }
  throw new Error(`Unsupported log kind: ${value ?? ""}`);
}

async function loadLogEntries(
  runsModule: {
    listRunLogsPage: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
    listRunEvents: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
    listRunCommands: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
  },
  runId: string,
  kind: LogKind,
  cursors: LogCursorState,
) {
  const [logsPage, eventsPage, commandsPage] = await Promise.all([
    kind === "logs" || kind === "all"
      ? runsModule.listRunLogsPage(runId, { afterId: cursors.logs })
      : Promise.resolve({ items: [] }),
    kind === "events" || kind === "all"
      ? runsModule.listRunEvents(runId, { afterId: cursors.events })
      : Promise.resolve({ items: [] }),
    kind === "commands" || kind === "all"
      ? runsModule.listRunCommands(runId, { afterId: cursors.commands })
      : Promise.resolve({ items: [] }),
  ]);

  const entries: TimelineEntry[] = [
    ...logsPage.items.map((log) => ({
      source: "log" as const,
      id: Number(log.id),
      timestamp: typeof log.timestamp === "string" ? log.timestamp : null,
      message: `${String(log.stream)}: ${String(log.message)}`,
      payload: log,
    })),
    ...eventsPage.items.map((event) => ({
      source: "event" as const,
      id: Number(event.id),
      timestamp: typeof event.timestamp === "string" ? event.timestamp : null,
      message: `event ${String(event.type)}`,
      payload: event,
    })),
    ...commandsPage.items.map((command) => ({
      source: "command" as const,
      id: Number(command.id),
      timestamp:
        typeof command.timestamp === "string" ? command.timestamp : null,
      message: `command [${String(command.phase)}] exit=${String(command.returncode)} ${String(command.command)}`,
      payload: command,
    })),
  ].sort((left, right) => {
    const leftTs = Date.parse(left.timestamp ?? "");
    const rightTs = Date.parse(right.timestamp ?? "");
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }
    return left.id - right.id;
  });

  return {
    entries,
    latestIds: {
      logs:
        logsPage.items.length > 0
          ? Number(logsPage.items.at(-1)?.id ?? cursors.logs)
          : cursors.logs,
      events:
        eventsPage.items.length > 0
          ? Number(eventsPage.items.at(-1)?.id ?? cursors.events)
          : cursors.events,
      commands:
        commandsPage.items.length > 0
          ? Number(commandsPage.items.at(-1)?.id ?? cursors.commands)
          : cursors.commands,
    },
  };
}

function updateLogCursors(
  cursors: LogCursorState,
  batch: { latestIds: LogCursorState },
) {
  cursors.logs = batch.latestIds.logs;
  cursors.events = batch.latestIds.events;
  cursors.commands = batch.latestIds.commands;
}

function formatLogEntry(entry: TimelineEntry) {
  const timestamp = entry.timestamp ?? "-";
  return `${timestamp} ${entry.message}`;
}
