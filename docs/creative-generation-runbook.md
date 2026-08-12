# 광고 6장 생성 운영 Runbook

## 로컬 실행

```bash
npm install
npm run dev
```

`/create-product`에서 상품 URL을 불러온 뒤 `광고 콘텐츠 6장 만들기`를 누른다. 추가 설정은 필요 없다. 사용자가 선택한 광고 이미지가 있으면 그 순서를 최우선으로 사용한다.

## 검증

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

빌드와 테스트에서는 `PAID_IMAGE_GENERATION_ENABLED`를 켜지 않는다. 결과 파일은 각 카드의 QA 줄에서 1200×1200, KB, 점수를 확인한다.

## 작업 복구

브라우저 sessionStorage에는 마지막 job ID를 저장한다. 동일 상품으로 화면을 다시 열면 `GET /api/creative-generation/jobs/:jobId`로 복구한다. `중단 지점부터 재개`는 실패/취소 카드만 pending으로 되돌리고 성공 이미지는 유지한다.

서버 작업 파일은 `data/creative-generation-jobs/<jobId>.json`이다. 상태는 `pending`, `running`, `partial`, `completed`, `failed`, `cancelled`다.

## 실패 대응

- `실제 상품 이미지가 없습니다`: 상품정보 추출 결과에서 이미지를 선택하거나 업로드한다.
- `ProductTruth에 없는 수치`: 수정 문구에서 수치를 제거하거나 상품 상세페이지의 구조화된 사실로 먼저 등록한다.
- `800KB 초과`: renderer가 WebP quality를 단계적으로 낮춘다. 계속 실패하면 배경 디테일과 overlay 수를 줄인다.
- `디코딩 실패`: 해당 카드만 재생성한다. 다른 성공 결과는 ZIP에 유지된다.
- `배경 장면 없음`: `data/background-library.json`과 실제 `public/background-library` 파일을 검증한다.
- `OpenAI provider 비활성`: 정상 기본 상태다. 유료 생성을 의도한 경우에만 두 환경변수를 서버에서 설정한다.

## 배경 에셋 권리

`SceneAsset.license`에 source name, source page, license URL, author를 유지한다. 사용자 업로드·AI 생성·stock 장면을 구분하며 원본 출처가 없는 외부 파일을 자동 수집하지 않는다.

## 로그와 보존

작업 JSON에는 planner version, scene prompt version, provider, 시도 횟수, 시작/완료 시간, duration, 오류와 QA를 보존한다. 런타임 job과 생성 이미지는 Git에 커밋하지 않는다. 장기 운영에서는 만료 정책과 object storage adapter를 추가한다.

## 소재코드와 성과 매칭 키

QA를 통과한 최종 이미지에는 `AT-{BRAND}-{PRODUCT}-{HOOK}-{YYMMDD}-{UNIQUE}` 형식의 소재코드를 한 번 발급한다. 소재 원본은 `data/creative-assets/assets.json`에 저장하고, Job 결과에는 표시·복구에 필요한 스냅샷을 함께 저장한다. 두 런타임 JSON은 Git에 커밋하지 않는다.

- 새 렌더 요청은 `generationRequestKey`로 멱등 처리한다.
- 문구·이미지·레이아웃 재생성은 새 소재가 되며, 이전 코드를 `parentAssetCode`로 연결하고 `version`을 올린다.
- 개별/ZIP 다운로드 파일명은 `{assetCode}.{실제 확장자}`를 사용한다.
- 광고명은 소재코드와 같고, UTM 표기는 `utm_content={assetCode}`다.
- `extractCreativeAssetCode()`로 광고명·파일명에서 정확한 코드만 찾고, `creativeAssetRepository.matchFromText()`가 exact match만 자동 확정한다.
- `/api/creative-assets`는 코드·브랜드·상품·소구점·기간 검색을 제공한다.

현재 JSON repository의 동시성 잠금은 단일 Node 프로세스를 기준으로 한다. 여러 서버 인스턴스로 확장할 때는 같은 repository 인터페이스를 DB의 unique index(`assetCode`, `generationRequestKey`)와 transaction으로 교체한다.
