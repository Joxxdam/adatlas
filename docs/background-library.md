# 광고 배경 라이브러리

AdAtlas의 빠른 제작 배경은 `public/background-library`에 저장되고, 추천에 필요한 정보는 `data/background-library.json`에서 관리합니다. 로열티 프리 기본 라이브러리는 beauty, fashion, food, agriculture, lifestyle, commerce 6개 카테고리별 6장, 총 36장입니다. 여기에 제품과 문구가 없는 후킹 전용 기본 배경 8장을 `public/background-library/hook-base`에서 별도로 관리합니다.

## 출처와 사용 조건

- 기본 사진 출처: Pexels의 개별 무료 사진 페이지
- 라이선스: <https://www.pexels.com/license/>
- 각 사진의 원본 페이지, 직접 다운로드 주소, 라이선스 주소, 다운로드 시점은 `data/background-library.json`에 기록됩니다.
- 원본 출처 목록은 `data/background-library.sources.json`에서 관리합니다.
- AdAtlas는 사진을 1600×1600 WebP로 리사이즈·크롭해 광고 배경으로 사용합니다. 원본 그대로 재판매하거나 스톡 사진 서비스로 재배포하지 않습니다.

## 설치와 검증

```bash
npm run backgrounds:download
npm run backgrounds:verify
```

특정 카테고리만 다시 받으려면 다음처럼 실행합니다.

```bash
npm run backgrounds:download -- --force --category beauty
```

다운로더는 공식 `images.pexels.com` 원본만 요청하고, 파일을 1600×1600 WebP로 변환한 뒤 형식·크기·파일 용량을 검사합니다. 이미 정상 파일이 있으면 기본적으로 다시 받지 않습니다. 한 항목이 실패해도 나머지는 계속 처리하고 마지막에 실패 목록과 종료 코드를 반환합니다.

## 메타데이터

각 항목은 다음 정보를 가집니다.

- 식별 및 파일: `id`, `file`, `category`, `orientation`, `width`, `height`, `enabled`
- 추천 신호: `industries`, `hookTypes`, `scene`, `mood`, `elements`, `colors`, `productPosition`, `textSafeArea`
- 출처: `sourceType`, `sourceName`, `sourceUrl`, `downloadUrl`, `licenseUrl`, `downloadedAt`

추천기는 상품 카테고리와 업종, 선택 후킹, 장면·무드·태그, 상품 위치, 문구 여백을 점수화합니다. 선택한 후킹과 상품 카테고리에 맞는 `AdAtlas Hook Base`를 먼저 추천하고, 가격·구성·USP처럼 고대비 구성이 필요한 경우 commerce 후킹 배경을 함께 사용합니다. 남은 자리는 상세페이지 연계 이미지 한 장과 같은 카테고리의 기존 배경으로 보완합니다. `enabled: false` 항목과 실제 파일이 없는 항목은 API 응답에서 제외됩니다.

후킹 기본 배경은 다음 역할을 포함합니다.

- 감각·상황형 식품: 빈 숯불 불판, 한식 테이블
- USP·선물형 식품: 월넛 보드와 블랙 스톤 스튜디오
- 고민 해결형 뷰티: 물기와 스팀이 남은 샤워 공간
- 쿨링·감각형 뷰티: 얼음과 물보라가 있는 민트 스튜디오
- 가격·구성형 범용: 오렌지 팝 단상, 화이트·레드 고대비 단상
- USP·후기형 범용: 에메랄드 스포트라이트 블랙 스튜디오

## 배경 추가·비활성화

1. 상업 광고와 수정 사용이 가능한 공식 원본 페이지를 확인합니다.
2. 얼굴·브랜드·로고·워터마크·읽을 수 있는 문구가 중심인 이미지는 사용하지 않습니다.
3. `data/background-library.sources.json`에 새 출처와 추천 메타데이터를 추가합니다.
4. 다운로드 명령과 검증 명령을 실행합니다.
5. 더 이상 추천하지 않을 배경은 `data/background-library.json`에서 `enabled`를 `false`로 변경합니다. 원본 목록에서 삭제하면 다음 전체 재생성 시 제외될 수 있으므로 출처 이력을 유지해야 할 때는 비활성화를 사용합니다.

## AI 생성 배경

OpenAI 또는 Gemini 이미지 API 키가 있을 때만 제작 화면에 AI 배경 모드가 활성화됩니다. 생성 프롬프트는 상품·포장·로고·문구·가격·워터마크를 금지하고, 실제 상품과 문구를 합성할 여백과 일관된 조명·접지 그림자를 요구합니다.

사용자가 `라이브러리에 보관`을 누르면 `/api/background-library/save`가 생성 장면을 1600×1600 WebP로 다시 최적화해 `public/background-library/ai-generated`에 저장하고, `sourceType: "ai_generated"` 메타데이터를 추가합니다. AI 생성 파일은 기본 소스 재다운로드 때도 보존됩니다.
