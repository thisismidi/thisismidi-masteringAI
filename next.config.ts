/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // 클라이언트(브라우저) 사이드에서 렌더링할 때 fs 모듈 에러 무시
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },
  // 🚨 Next.js 16 터보팩 빌드 에러 우회용 설정 추가
  turbopack: {},
};

export default nextConfig;
