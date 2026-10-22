import { useEffect, useState } from "react";
import { parse } from "yaml";

export interface RuleSetInfo {
  id: string;
  label: string;
}

export interface RuleFileSection {
  title: string;
  rules: string[];
}

export interface RuleFile {
  path: string;
  /** Comment lines at the top of the file: description, sources and licensing. */
  header: string[];
  sections: RuleFileSection[];
  count: number;
  types: Array<[type: string, count: number]>;
  /** False when only the beginning of a large file was read. */
  complete: boolean;
}

export interface RuleOverlap {
  rule: string;
  coveredBy: string;
  path: string;
}

// The domestic list is about 3 MB; details read only its beginning.
const previewByteLimit = 256 * 1024;
const requestTimeout = 20_000;

function checkResponse(response: Response, path: string): void {
  // Static hosting answers a missing file with the app page and HTTP 200.
  if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`${path} 读取失败（HTTP ${response.status}）`);
  }
}

async function fetchWithTimeout<T>(path: string, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), requestTimeout);
  try {
    const response = await fetch(path, { signal: controller.signal });
    checkResponse(response, path);
    return await read(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(`${path} 读取超时`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let entry = cache.get(key);
  if (!entry) {
    entry = load();
    cache.set(key, entry);
    // A failed read can be retried by the next caller.
    entry.catch(() => cache.delete(key));
  }
  return entry;
}

const manifestCache = new Map<string, Promise<ReadonlyMap<string, RuleSetInfo>>>();

export function loadRuleManifest(): Promise<ReadonlyMap<string, RuleSetInfo>> {
  return cached(manifestCache, "manifest", () => fetchWithTimeout("/rules/manifest.yaml", async response => {
    const data = parse(await response.text()) as { ruleSets?: unknown };
    if (!Array.isArray(data?.ruleSets)) throw new Error("规则目录格式无法识别");
    return new Map((data.ruleSets as RuleSetInfo[]).map(({ id, label }) => [id, { id, label }]));
  }));
}

const fileCache = new Map<string, Promise<RuleFile>>();

export function loadRuleFile(path: string): Promise<RuleFile> {
  return cached(fileCache, path, () => fetchWithTimeout(path, async response => {
    const { text, complete } = await readCapped(response, previewByteLimit);
    return parseRuleFile(path, text, complete);
  }));
}

export async function readCapped(response: Response, limit: number): Promise<{ text: string; complete: boolean }> {
  if (!response.body) return { text: await response.text(), complete: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), complete: true };
    text += decoder.decode(value, { stream: true });
    size += value.byteLength;
    if (size >= limit) {
      await reader.cancel();
      // Drop the line cut off by the limit.
      return { text: text.slice(0, text.lastIndexOf("\n")), complete: false };
    }
  }
}

function comment(line: string): string {
  return line.replace(/^[#;]\s?/u, "");
}

export function parseRuleFile(path: string, text: string, complete = true): RuleFile {
  const header: string[] = [];
  const sections: RuleFileSection[] = [];
  const types = new Map<string, number>();
  let inHeader = true;
  let title = "";
  let section: RuleFileSection | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) {
      inHeader = false;
      continue;
    }
    if (/^[#;]/u.test(line)) {
      if (inHeader) {
        header.push(comment(line));
        continue;
      }
      // A comment after rules starts a new section; consecutive comments form one title.
      title = section ? comment(line) : [title, comment(line)].filter(Boolean).join(" ");
      section = null;
      continue;
    }
    inHeader = false;
    if (!section) {
      section = { title, rules: [] };
      sections.push(section);
      title = "";
    }
    section.rules.push(line);
    const type = line.split(",", 1)[0];
    types.set(type, (types.get(type) ?? 0) + 1);
  }
  return {
    path,
    header,
    sections,
    count: sections.reduce((total, item) => total + item.rules.length, 0),
    types: [...types].sort((a, b) => b[1] - a[1]),
    complete,
  };
}

const hostTypes = new Set(["DOMAIN", "DOMAIN-SUFFIX"]);

function hostOf(rule: string): { type: string; host: string } {
  const [type, value = ""] = rule.split(",", 2);
  return { type, host: value.toLowerCase() };
}

export function exampleHosts(file: RuleFile, limit = 4): string[] {
  return file.sections.flatMap(section => section.rules)
    .map(hostOf)
    .filter(rule => hostTypes.has(rule.type) && !rule.host.startsWith("."))
    .slice(0, limit)
    .map(rule => rule.host);
}

function covers(later: string, earlier: string): boolean {
  const target = hostOf(earlier);
  const rule = hostOf(later);
  if (!hostTypes.has(target.type)) return false;
  if (rule.type === "DOMAIN-SUFFIX") return target.host === rule.host || target.host.endsWith(`.${rule.host}`);
  if (rule.type === "DOMAIN") return target.type === "DOMAIN" && target.host === rule.host;
  if (rule.type === "DOMAIN-KEYWORD") return target.host.includes(rule.host);
  return false;
}

/** Rules in this file that a later file would also match, which is why this file has to come first. */
export function findOverlaps(file: RuleFile, later: readonly RuleFile[], limit = 3): RuleOverlap[] {
  const overlaps: RuleOverlap[] = [];
  for (const rule of file.sections.flatMap(section => section.rules)) {
    for (const candidate of later) {
      const coveredBy = candidate.sections.flatMap(section => section.rules).find(laterRule => covers(laterRule, rule));
      if (coveredBy) {
        overlaps.push({ rule, coveredBy, path: candidate.path });
        break;
      }
    }
    if (overlaps.length >= limit) break;
  }
  return overlaps;
}

/** Rule set labels from the published manifest; null until loaded or when it cannot be read. */
export function useRuleManifest(): ReadonlyMap<string, RuleSetInfo> | null {
  const [manifest, setManifest] = useState<ReadonlyMap<string, RuleSetInfo> | null>(null);
  useEffect(() => {
    let active = true;
    loadRuleManifest().then(
      loaded => { if (active) setManifest(loaded); },
      // Labels fall back to rule set ids; the failure stays visible in the console.
      (error: unknown) => console.error(error),
    );
    return () => { active = false; };
  }, []);
  return manifest;
}

export function useRuleFiles(paths: readonly string[]): { files: ReadonlyMap<string, RuleFile>; error: string; loading: boolean } {
  const key = paths.join("\n");
  const [state, setState] = useState<{ key: string; files: ReadonlyMap<string, RuleFile>; error: string }>({ key: "", files: new Map(), error: "" });
  useEffect(() => {
    let active = true;
    const list = key ? key.split("\n") : [];
    void Promise.allSettled(list.map(path => loadRuleFile(path))).then(results => {
      if (!active) return;
      const files = new Map<string, RuleFile>();
      const errors: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") files.set(list[index], result.value);
        else errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      });
      setState({ key, files, error: errors.join("；") });
    });
    return () => { active = false; };
  }, [key]);
  return state.key === key ? { ...state, loading: false } : { files: new Map(), error: "", loading: true };
}
