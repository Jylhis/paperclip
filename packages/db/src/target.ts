export type DatabaseTarget =
  | { kind: "url"; connectionString: string }
  | {
      kind: "socket";
      socketDir: string;
      database: string;
      user: string;
      port?: number;
    };

export function targetFromUrl(connectionString: string): DatabaseTarget {
  return { kind: "url", connectionString };
}

export type PostgresOptionsArgs =
  | readonly [string]
  | readonly [
      {
        host: string;
        database: string;
        username: string;
        port?: number;
      },
    ];

export function postgresOptions(target: DatabaseTarget): PostgresOptionsArgs {
  if (target.kind === "url") {
    return [target.connectionString];
  }

  return [
    {
      host: target.socketDir,
      database: target.database,
      username: target.user,
      ...(target.port !== undefined && { port: target.port }),
    },
  ];
}

export function describeTarget(target: DatabaseTarget): string {
  if (target.kind === "socket") {
    const portSuffix = target.port !== undefined ? `:${target.port}` : "";
    return `socket:${target.socketDir}${portSuffix}/${target.database}`;
  }

  try {
    const url = new URL(target.connectionString);
    const host = url.host || url.pathname;
    const database = url.pathname.replace(/^\//, "");
    return database ? `${host}/${database}` : host;
  } catch {
    return "postgres://<unparseable>";
  }
}
