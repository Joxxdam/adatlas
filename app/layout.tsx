import type { Metadata } from "next";
import { CreativeJobStatusIndicator } from "./components/features/creative-generation/CreativeJobStatusIndicator";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAYWIZ | AI 광고 콘텐츠 실험 시스템",
  description: "광고 레퍼런스를 수집하고 AI로 분석해 다음 콘텐츠 제작에 연결하는 대시보드입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <CreativeJobStatusIndicator />
        {children}
      </body>
    </html>
  );
}
