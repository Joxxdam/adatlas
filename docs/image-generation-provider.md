# 이미지 생성·편집 Provider

## 현재 기본 정책

기본 광고 6장 생성은 장면 생성이 아니라 `codex_local`의 단계형 이미지 편집입니다.

```text
무작위 ZIP 레퍼런스
→ 레퍼런스 원본 무손실 복사
→ URL 상품만 교체
→ ProductTruth 문구만 교체
→ 레퍼런스·상품·문구 비생성 QA
→ 치명 오류에만 AI 보정 최대 1회
```

설치된 Codex CLI와 현재 ChatGPT 로그인을 사용하며 자식 프로세스에서 `OPENAI_API_KEY`를 제거합니다. 로컬 Codex 실패를 유료 API나 배경 라이브러리로 자동 전환하지 않습니다.

기본값:

```dotenv
ADATLAS_CODEX_MODEL=gpt-5.6-sol
ADATLAS_CODEX_IMAGE_REASONING=low
ADATLAS_CREATIVE_CONCURRENCY=3
ADATLAS_AUTO_REVISION_LIMIT=1
ADATLAS_CODEX_IMAGE_TIMEOUT_MS=720000
ADATLAS_CODEX_VALIDATION_TIMEOUT_MS=150000
ADATLAS_PAID_API_EXPLICIT_ENABLED=false
```

## Native provider 계약

`CreativeGenerationProvider`는 현재 기본 경로에서 다음 계약을 가집니다.

- `openSession()`: H 결과 하나에 대한 짧은 격리 세션을 한 번만 생성
- `session.generate(input)`: 신규 `reference-staged-edit`에서는 `product-replacement`, `copy-replacement`, 치명 오류의 `qa-repair`에만 완성 래스터를 저장
- 구조 단계: provider를 호출하지 않고 원본을 바이트 동일하게 `01-structure`로 복사. `structure-recreation` 타입은 과거 저장 작업 읽기 호환용으로만 유지
- `session.validate(input)`: 생성에 사용한 같은 세션에서 최종 광고, 선택 ZIP 레퍼런스, URL 상품 원본을 비교하고 구조 충실도·상품 동일성·문구 정확성을 JSON으로 반환
- `session.close()`: 성공·실패와 관계없이 메모리 참조를 해제하고 재사용을 차단
- 각 단계의 `sourceImagePath`는 첫 번째 편집 소스
- `productReferencePaths`는 URL 상세페이지에서 검증한 상품 이미지
- `adReferencePath`는 작업 생성 시 무작위 선택해 고정한 ZIP 광고

각 결과는 독립된 세션 하나를 사용하며 상품 교체 → 문구 교체 → QA → 최대 1회 보정 → 재검수를 같은 세션에서 연속 수행합니다. 결과·prompt version·시간·오류·중간 경로는 GenerationJob에 남기지만 세션 ID는 저장하지 않습니다. 현재 SDK에 archive/delete API가 없어 `close()`는 서버 메모리 참조만 해제합니다.

## 유료 OpenAI provider

`openai_api`는 다음 조건이 모두 충족된 작업에서만 사용할 수 있습니다.

- 사용자가 해당 작업에서 유료 API를 명시 선택
- 서버의 `ADATLAS_PAID_API_EXPLICIT_ENABLED=true`
- 서버에 `OPENAI_API_KEY` 존재
- 승인 시각과 scope가 현재 native 작업에 유효

키나 과거 환경변수만으로 유료 이미지 생성을 열지 않습니다. 빌드, 테스트, 정적 분석은 API를 호출하지 않습니다.

## 레거시 SceneGenerationProvider

`SceneGenerationProvider`, `generateScene`, 배경 라이브러리, ComfyUI와 text-free plate는 레거시 장면/배경 관리 기능용입니다. `/create-product`의 기본 ZIP 레퍼런스 광고 6장 경로에서는 호출하지 않습니다.

관련 환경변수 `PAID_IMAGE_GENERATION_ENABLED`, `ADATLAS_IMAGE_GENERATION_ENABLED`, `ADATLAS_MAX_SCENE_CANDIDATES`, `LOCAL_IMAGE_PROVIDER`, `COMFYUI_*`도 레거시 또는 별도 도구용입니다.

## 출력과 재시도

- 한 작업에서 최대 3장을 병렬 편집
- 개별 자동 QA 수정 최대 1회
- 실패한 카드만 같은 선택 레퍼런스로 재시도
- 다른 성공 카드는 유지
- 최종 1200×1200 JPEG, 800KB 이하
- 저장 후 sharp 재디코딩 검증
