import { stringify, parse } from "yaml";

/** Stable YAML for drift checks — sorted map keys, no line wrapping. */
export function toCanonicalAdminOpenApiYaml(document: unknown): string {
  return `${stringify(document, {
    sortMapEntries: true,
    lineWidth: 0,
    aliasDuplicateObjects: false,
  }).trimEnd()}\n`;
}

export function parseAdminOpenApiYaml(source: string): unknown {
  return parse(source);
}
