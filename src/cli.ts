export type CommandHandler = (args: string[]) => Promise<number> | number;

export interface CliCommand {
  name: string;
  description: string;
  run: CommandHandler;
}

export interface CliRouter {
  run(argv?: string[]): Promise<number>;
  usage(): string;
}

export function createCliRouter(commands: CliCommand[]): CliRouter {
  const commandMap = new Map(commands.map((command) => [command.name, command]));

  return {
    async run(argv = process.argv.slice(2)): Promise<number> {
      const [commandName, ...commandArgs] = argv;

      if (!commandName || commandName === "-h" || commandName === "--help") {
        process.stdout.write(`${this.usage()}\n`);
        return 0;
      }

      const command = commandMap.get(commandName);
      if (!command) {
        process.stderr.write(`Unknown command: ${commandName}\n\n${this.usage()}\n`);
        return 1;
      }

      try {
        return await command.run(commandArgs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        return 1;
      }
    },

    usage(): string {
      const lines = ["Usage: gji <command> [options]", "", "Commands:"];
      for (const command of commands) {
        lines.push(`  ${command.name.padEnd(10)} ${command.description}`);
      }
      return lines.join("\n");
    },
  };
}
