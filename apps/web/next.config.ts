import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/cv", destination: "/Eliot-Gevers-CV.pdf" }];
  },
  async headers() {
    return [{
      source: "/cv",
      headers: [{ key: "Content-Disposition", value: 'inline; filename="Eliot-Gevers-CV.pdf"' }],
    }];
  },
};

export default config;
