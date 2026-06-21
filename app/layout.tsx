import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdAtlas | AI 광고 레퍼런스 대시보드",
  description: "광고 레퍼런스를 수집하고 AI로 분석해 다음 콘텐츠 제작에 연결하는 대시보드입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
