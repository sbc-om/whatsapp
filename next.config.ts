import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Prevent Next.js from walking up the filesystem (and picking up unrelated lockfiles)
    // by explicitly pinning the Turbopack root to this project directory.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
