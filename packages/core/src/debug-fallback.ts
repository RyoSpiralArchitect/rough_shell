import type { PassName } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readLocalizedContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return readString(record.ja) ?? readString(record.en) ?? readString(record.text);
}

function readAnswerLike(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return readString(value);
  }

  const record = value as Record<string, unknown>;

  return (
    readString(record.answer) ??
    readLocalizedContent(record.answer) ??
    readLocalizedContent(record.content) ??
    readString(record.text) ??
    undefined
  );
}

function extractFromProjectCompiler(rawResponse: unknown): string | undefined {
  if (!rawResponse || typeof rawResponse !== "object") {
    return undefined;
  }

  const record = rawResponse as Record<string, unknown>;

  return (
    readAnswerLike(record.answer) ??
    readAnswerLike(record.licensed_partial_answer) ??
    readLocalizedContent(
      ((record.projection_ir as Record<string, unknown> | undefined)?.claims as unknown[] | undefined)
        ?.find((claim) => !!claim && typeof claim === "object")
        ? (((record.projection_ir as Record<string, unknown>).claims as unknown[])[0] as Record<
            string,
            unknown
          >).content
        : undefined,
    ) ??
    undefined
  );
}

function extractFromAuditor(
  rawResponse: unknown,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!rawResponse || typeof rawResponse !== "object") {
    const projectionOutput = input?.projection_output;
    if (!projectionOutput || typeof projectionOutput !== "object") {
      return undefined;
    }

    return readAnswerLike((projectionOutput as Record<string, unknown>).answer);
  }

  const record = rawResponse as Record<string, unknown>;
  return (
    readAnswerLike(record.revised_answer) ??
    readAnswerLike(
      ((input?.projection_output as Record<string, unknown> | undefined)?.answer as unknown),
    ) ??
    undefined
  );
}

export function extractDebugFallbackAnswer(
  pass: PassName,
  rawResponse: unknown,
  input?: Record<string, unknown>,
): string | undefined {
  switch (pass) {
    case "project_compiler":
      return extractFromProjectCompiler(rawResponse);
    case "auditor":
      return extractFromAuditor(rawResponse, input);
    default:
      return undefined;
  }
}
