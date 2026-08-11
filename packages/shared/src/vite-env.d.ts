interface ImportMetaEnv {
  MODE: string;
  BASE_URL: string;
  PROD: boolean;
  DEV: boolean;
  SSR: boolean;
  [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
