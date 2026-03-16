#!/usr/bin/env node

import { Command } from "commander";
import { createServer } from "./server.js";

const program = new Command();

program
  .name("clawno-server")
  .description("ClawNO11 Server — chat proxy + management API for mobile clients")
  .version("0.1.0");

program
  .command("start")
  .description("Start the ClawNO11 server")
  .option("-p, --port <number>", "Server port", "18800")
  .option("-g, --gateway <url>", "OpenClaw gateway URL", "http://localhost:18789")
  .option("--host <address>", "Bind address", "0.0.0.0")
  .option("--token <string>", "Bearer token for authentication (auto-generated if omitted)")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const server = createServer({
      port,
      host: opts.host,
      gatewayUrl: opts.gateway,
      bearerToken: opts.token,
    });

    server.start();
  });

program
  .command("version")
  .description("Print version")
  .action(() => {
    console.log("0.1.0");
  });

program.parse();
