/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel 빌드 시 ESLint 경고 무시
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Vercel 빌드 시 타입스크립트 에러 무시
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
