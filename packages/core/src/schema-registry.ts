import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnySchemaObject, ErrorObject, ValidateFunction } from "ajv";

import type {
  JsonObject,
  SchemaKind,
  SchemaName,
  SchemaValidationFailure,
  SchemaValidationIssue,
  SchemaVersion,
  ShellState,
} from "./types.js";

export const CURRENT_SCHEMA_VERSION: SchemaVersion = "v0.5";

const SCHEMA_NAMES: SchemaName[] = [
  "shell_state.schema.json",
  "state_delta.schema.json",
  "negotiation_result.schema.json",
  "projection_output.schema.json",
  "audit_result.schema.json",
];

const INTERNAL_SCHEMA_FILES = [
  "common_defs.json",
  ...SCHEMA_NAMES,
] as const;

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: import("ajv").default) => void;

function readJsonFile(filePath: string): AnySchemaObject {
  return JSON.parse(readFileSync(filePath, "utf8")) as AnySchemaObject;
}

function formatErrors(errors: ErrorObject[] | null | undefined): SchemaValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: error.params as Record<string, unknown>,
  }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") {
    return document;
  }

  const segments = pointer
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }

    const record = asRecord(current);
    current = record?.[segment];
  }

  if (current === undefined) {
    throw new Error(`Could not resolve JSON pointer "${pointer}".`);
  }

  return current;
}

function parseSchemaRef(currentFileName: string, ref: string): { fileName: string; pointer: string } {
  if (ref.startsWith("#")) {
    return {
      fileName: currentFileName,
      pointer: ref.slice(1),
    };
  }

  const [fileName, fragment = ""] = ref.split("#", 2);
  if (!fileName) {
    throw new Error(`Invalid schema ref "${ref}".`);
  }

  return {
    fileName,
    pointer: fragment,
  };
}

function readVersion(value: unknown): SchemaVersion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const version = (value as { version?: unknown }).version;
  return version === CURRENT_SCHEMA_VERSION ? version : undefined;
}

export function schemaNameForVersion(_version: SchemaVersion, kind: SchemaKind): SchemaName {
  switch (kind) {
    case "shell_state":
      return "shell_state.schema.json";
    case "state_delta":
      return "state_delta.schema.json";
    case "negotiation_result":
      return "negotiation_result.schema.json";
    case "projection_output":
      return "projection_output.schema.json";
    case "audit_result":
      return "audit_result.schema.json";
    default: {
      const exhaustiveCheck: never = kind;
      throw new Error(`Unhandled schema kind ${String(exhaustiveCheck)}.`);
    }
  }
}

export function findRepositoryRoot(startDir?: string): string {
  let currentDir = startDir ?? dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (
      existsSync(join(currentDir, "package.json")) &&
      existsSync(join(currentDir, "schemas", CURRENT_SCHEMA_VERSION, "common_defs.json"))
    ) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not locate the rough-shell repository root.");
    }

    currentDir = parentDir;
  }
}

export class SchemaValidationError extends Error {
  public readonly failure: SchemaValidationFailure;

  public constructor(schemaName: SchemaName, errors: ErrorObject[] | null | undefined) {
    const formatted = formatErrors(errors);
    const message = [
      `Response did not match ${schemaName}.`,
      ...formatted.map(
        (issue) =>
          `${issue.instancePath || "/"} [${issue.keyword}] ${issue.message}`,
      ),
    ].join("\n");

    super(message);
    this.name = "SchemaValidationError";
    this.failure = {
      errors: formatted,
      schemaName,
    };
  }
}

export class SchemaRegistry {
  private readonly ajv: import("ajv").default;

  private readonly repoRoot: string;

  private readonly schemaCache = new Map<string, AnySchemaObject>();

  private readonly providerSchemaCache = new Map<SchemaName, JsonObject>();

  private readonly validatorCache = new Map<SchemaName, ValidateFunction>();

  public constructor(repoRoot = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)))) {
    this.repoRoot = repoRoot;
    this.ajv = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      strict: false,
    });
    addFormats(this.ajv);
    this.loadAllSchemas();
  }

  public getRepositoryRoot(): string {
    return this.repoRoot;
  }

  public getSchema(schemaName: SchemaName): JsonObject {
    const schema = this.schemaCache.get(schemaName);
    if (!schema) {
      throw new Error(`Schema ${schemaName} was not loaded.`);
    }

    return schema as JsonObject;
  }

  public getProviderSchema(schemaName: SchemaName): JsonObject {
    const cached = this.providerSchemaCache.get(schemaName);
    if (cached) {
      return cached;
    }

    const schema = this.getSchema(schemaName);
    const expanded = this.expandSchema(schema, schemaName, new Set()) as JsonObject;
    this.providerSchemaCache.set(schemaName, expanded);
    return expanded;
  }

  public validate<T>(schemaName: SchemaName, value: unknown): T {
    const validator = this.getValidator(schemaName);
    if (!validator(value)) {
      throw new SchemaValidationError(schemaName, validator.errors);
    }

    return value as T;
  }

  public getSchemaName(version: SchemaVersion, kind: SchemaKind): SchemaName {
    return schemaNameForVersion(version, kind);
  }

  public validateShellState(value: unknown): ShellState {
    const version = readVersion(value) ?? CURRENT_SCHEMA_VERSION;
    return this.validate<ShellState>(this.getSchemaName(version, "shell_state"), value);
  }

  private getValidator(schemaName: SchemaName): ValidateFunction {
    const cached = this.validatorCache.get(schemaName);
    if (cached) {
      return cached;
    }

    const validator = this.ajv.getSchema(schemaName);
    if (!validator) {
      throw new Error(`Could not compile validator for ${schemaName}.`);
    }

    this.validatorCache.set(schemaName, validator);
    return validator;
  }

  private loadAllSchemas(): void {
    const schemaDir = join(this.repoRoot, "schemas", CURRENT_SCHEMA_VERSION);

    for (const fileName of INTERNAL_SCHEMA_FILES) {
      const filePath = join(schemaDir, fileName);
      const schema = readJsonFile(filePath);
      this.schemaCache.set(fileName, schema);
      this.ajv.addSchema(schema, fileName);
    }
  }

  private expandSchema(
    value: unknown,
    currentFileName: string,
    seenRefs: Set<string>,
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.expandSchema(entry, currentFileName, seenRefs));
    }

    const record = asRecord(value);
    if (!record) {
      return value;
    }

    const ref = typeof record.$ref === "string" ? record.$ref : undefined;
    if (ref) {
      const { fileName, pointer } = parseSchemaRef(currentFileName, ref);
      const refKey = `${fileName}#${pointer}`;
      if (seenRefs.has(refKey)) {
        throw new Error(`Recursive schema ref "${refKey}" is not supported for provider schema expansion.`);
      }

      const targetDocument = this.schemaCache.get(fileName);
      if (!targetDocument) {
        throw new Error(`Schema file "${fileName}" was not loaded.`);
      }

      const targetValue = resolveJsonPointer(targetDocument, pointer);
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(refKey);
      const expandedTarget = this.expandSchema(targetValue, fileName, nextSeenRefs);
      const siblingEntries = Object.entries(record).filter(([key]) => key !== "$ref");

      if (siblingEntries.length === 0) {
        return expandedTarget;
      }

      const targetRecord = asRecord(expandedTarget);
      const merged = {
        ...(targetRecord ?? {}),
        ...Object.fromEntries(siblingEntries),
      };
      return this.expandSchema(merged, currentFileName, nextSeenRefs);
    }

    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        this.expandSchema(entry, currentFileName, seenRefs),
      ]),
    );
  }
}
