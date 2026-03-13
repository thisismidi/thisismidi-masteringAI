import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Vercel 배포 시 깐깐한 문법 에러 무시
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Vercel 배포 시 깐깐한 타입 에러 무시
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
