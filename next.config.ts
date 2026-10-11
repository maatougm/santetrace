import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["node:sqlite", "pdfjs-dist"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/patients/*/documents": [
      "./src/lib/endorecord-pdf-worker.mjs",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
};
export default config;
