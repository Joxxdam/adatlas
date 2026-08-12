# 이미지 생성 Provider

## 기본 정책

자동 광고 6장 생성은 기존 장면 라이브러리를 먼저 사용한다. OpenAI 유료 이미지 생성은 기본적으로 꺼져 있으며 `PAID_IMAGE_GENERATION_ENABLED=true`와 서버의 `OPENAI_API_KEY`가 함께 있을 때만 provider가 활성화된다. 빌드, 테스트, 정적 분석은 이 플래그를 바꾸거나 API를 호출하지 않는다.

```dotenv
PAID_IMAGE_GENERATION_ENABLED=false
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_API_KEY=
```

## 인터페이스

`SceneGenerationProvider`는 다음 계약을 가진다.

- `isConfigured()`: 키와 비용 게이트를 함께 확인한다.
- `supports(feature)`: `scene`, `reference-image`, `custom-square` 지원 여부를 반환한다.
- `generateScene(input)`: 제품과 글자가 없는 불투명 장면 plate를 만든다.
- `generateReferenceImage(input)`: 명시적인 참조 이미지가 있을 때 edit 흐름을 사용한다.

OpenAI, Gemini, Mock provider가 같은 인터페이스를 구현한다. 자동 생성은 장면 라이브러리가 비어 있거나 부적합하고 비용 게이트가 켜진 경우에만 생성 provider로 확장할 수 있다.

## OpenAI 구성

OpenAI 공식 문서 기준 `gpt-image-2`는 Image API의 generation/edit endpoint를 지원하며 임의 해상도 조건 안에서 1200×1200을 요청할 수 있다. 공식 가이드는 JPEG/WebP 출력과 압축 옵션도 설명한다. AdAtlas는 provider 결과를 그대로 납품하지 않고 sharp로 1200×1200 재구성, WebP 압축, 800KB 제한, 재디코딩 QA를 수행한다.

- [GPT Image 2 모델 문서](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI 이미지 생성 가이드](https://developers.openai.com/api/docs/guides/image-generation)

`gpt-image-2` reference edit에서는 provider 기본 high-fidelity 처리를 사용하며 별도 `input_fidelity`를 보내지 않는다. 모델은 환경변수로 교체할 수 있지만 사용자가 요청한 `gpt-image-2`를 기본값으로 유지한다.

## 비용·재시도

기본 동시성은 2, 최대 3이다. 각 결과는 독립적으로 실패하며 생성 결과·모델·prompt version·시간·오류를 job JSON에 남긴다. 장면 생성 실패 시 mock/라이브러리 fallback을 사용하고 완성된 카드 전체를 잃지 않는다.
