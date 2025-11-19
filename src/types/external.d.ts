declare module "toml" {
  export function parse(input: string): unknown;
}

declare module "node:fs" {
  const fs: any;
  export = fs;
}

