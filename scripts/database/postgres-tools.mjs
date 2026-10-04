import { spawn } from "node:child_process";

export function redactCommandOutput(value) {
  return value
    .replace(
      /\b(postgres(?:ql)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi,
      "$1[REDACTED]@",
    )
    .replace(
      /\b(password|pgpassword|token|secret)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]",
    );
}

export function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName)
    throw new Error("Database URL must include a database name.");
  return databaseName;
}

export function databaseUrlWithName(databaseUrl, databaseName) {
  assertSafeDatabaseName(databaseName);
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export function assertSafeDatabaseName(databaseName) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error("Disposable database name contains unsafe characters.");
  }
}

export async function runCommand(command, args, options = {}) {
  const displayName = options.displayName ?? command;
  process.stdout.write(`Running ${displayName}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: options.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `${displayName} could not start (${error.code ?? "unknown error"}).`,
        ),
      );
    });
    child.on("close", (code) => {
      const safeStdout = redactCommandOutput(stdout);
      const safeStderr = redactCommandOutput(stderr);
      if (options.echoOutput && safeStdout) process.stdout.write(safeStdout);
      if (code === 0) {
        resolve({ stdout: safeStdout, stderr: safeStderr });
        return;
      }
      if (safeStdout) process.stderr.write(safeStdout);
      if (safeStderr) process.stderr.write(safeStderr);
      reject(new Error(`${displayName} failed with exit code ${code}.`));
    });
  });
}

export function runPostgresTool(tool, args, databaseUrl, options = {}) {
  const parsed = new URL(databaseUrl);
  const connectionEnvironment = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: databaseNameFromUrl(databaseUrl),
  };
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    const value = parsed.searchParams.get(parameter);
    if (value) connectionEnvironment[`PG${parameter.toUpperCase()}`] = value;
  }
  const dockerService = process.env.POSTGRES_TOOLS_DOCKER_SERVICE;
  if (dockerService) {
    const environmentArguments = Object.keys(connectionEnvironment).flatMap(
      (key) => ["--env", key],
    );
    return runCommand(
      "docker",
      [
        "compose",
        "exec",
        "--no-TTY",
        ...environmentArguments,
        dockerService,
        tool,
        ...args,
      ],
      {
        ...options,
        displayName: options.displayName ?? `${tool} via Docker Compose`,
        env: { ...options.env, ...connectionEnvironment },
      },
    );
  }
  return runCommand(tool, args, {
    ...options,
    displayName: options.displayName ?? tool,
    // Keep connection details in the child environment so credentials never
    // appear in process arguments or the script's logs.
    env: { ...options.env, ...connectionEnvironment },
  });
}

export function quoteIdentifier(identifier) {
  assertSafeDatabaseName(identifier);
  return `"${identifier.replaceAll('"', '""')}"`;
}
