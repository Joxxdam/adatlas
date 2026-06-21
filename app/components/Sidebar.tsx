const menuItems = [
  "대시보드",
  "레퍼런스 수집",
  "레퍼런스 보드",
  "AI 분석",
  "브랜드 적합도",
  "트렌드",
  "데일리 브리프",
  "설정",
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">AdAtlas</p>
        <h1>AI 광고 레퍼런스 대시보드</h1>
      </div>
      <nav aria-label="주요 메뉴">
        {menuItems.map((item) => (
          <a href={`#${item}`} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <div className="sidebar-note">
        <strong>운영 상태</strong>
        <span>Meta, TikTok, Pinterest API 수집 준비</span>
        <span>매일 오전 9시 자동 실행 가능</span>
        <span>기간별 수집과 보드 저장 지원</span>
      </div>
    </aside>
  );
}
