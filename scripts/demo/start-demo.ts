import "dotenv/config";

import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { requireSafeDemoEnvironment } from "./demo-environment";

function run(command: string, args: ReadonlyArray<string>): void {
  const executable =
    process.platform === "win32" && command === "npm"
      ? process.env.ComSpec || "cmd.exe"
      : command;
  const executableArgs =
    process.platform === "win32" && command === "npm"
      ? ["/d", "/s", "/c", command, ...args]
      : [...args];
  const result = spawnSync(executable, executableArgs, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`,
    );
  }
}

async function responds(url: URL): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json,text/html" },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function verifyApplication(applicationUrl: URL): Promise<boolean> {
  const requiredPaths = ["/api/health/live", "/api/health/ready", "/sign-in"];
  const results = await Promise.all(
    requiredPaths.map(async (path) => ({
      ok: await responds(new URL(path, applicationUrl)),
      path,
    })),
  );

  for (const result of results) {
    console.log(`  ${result.ok ? "OK" : "WAIT"} ${result.path}`);
  }
  return results.every((result) => result.ok);
}

async function waitForApplication(
  applicationUrl: URL,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Application exited with code ${child.exitCode}.`);
    }
    if (await verifyApplication(applicationUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Application did not become ready within 60 seconds.");
}

async function main(): Promise<void> {
  const target = requireSafeDemoEnvironment(process.env);
  const npm = "npm";

  console.log("Checking Docker and local PostgreSQL...");
  run("docker", ["compose", "up", "-d", "postgres"]);
  run(npm, ["run", "prisma:validate"]);
  run(npm, ["run", "prisma:status"]);

  console.log("Checking application endpoints...");
  if (await verifyApplication(target.applicationUrl)) {
    console.log(`Demo application is ready at ${target.applicationUrl.href}`);
    console.log("Existing application process was left unchanged.");
    console.log("Check fixtures with: npm run demo:data -- --check");
    return;
  }

  console.log("Starting the Next.js development application...");
  const executable =
    process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : npm;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", "run", "dev"]
      : ["run", "dev"];
  const child = spawn(executable, args, {
    env: process.env,
    stdio: "inherit",
  });

  const stop = (): void => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await waitForApplication(target.applicationUrl, child);
  console.log(`Demo application is ready at ${target.applicationUrl.href}`);
  console.log("Check fixtures with: npm run demo:data -- --check");
  console.log(
    "Press Ctrl+C to stop the application; PostgreSQL data is retained.",
  );

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Application exited with code ${code}.`));
    });
  });
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Demo startup failed.",
  );
  process.exitCode = 1;
});
